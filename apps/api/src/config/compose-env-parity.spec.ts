/**
 * docker-compose.yml api environment ↔ api 플래그 모듈 정합.
 *
 * 컨테이너에는 compose environment 에 매핑된 키만 전달되고, `.env` 가 없거나 키가 빠지면
 * `${KEY:-<리터럴>}` 의 리터럴로 동작한다. 그래서 플래그 키마다 매핑이 있고, 리터럴이 코드
 * 기본값과 같은 결과를 내야 한다. 기준은 API_FEATURE_FLAG_KEYS 배열이다.
 *
 * 파서는 줄 단위(새 의존성 없음)다. compose 형식이 바뀌어 읽지 못하면 위치를 담은 오류로 실패한다.
 * 같은 파서가 apps/worker/src/config/compose-env-parity.spec.ts 에도 있다(패키지 경계를 넘지 않음).
 *
 * ⑨ 는 플래그에 한정하지 않고, 소스가 읽는 env 키가 모두 compose 에 매핑돼 있거나 사유가 붙은
 * 미매핑 목록(UNMAPPED_ALLOWLIST)에 있는지 본다. 같은 스캐너가 worker spec ⑦ 에도 있다.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { ConfigService } from '@nestjs/config';
import {
  API_FEATURE_FLAG_KEYS,
  ApiFeatureFlagKey,
  ApiFeatureFlagSnapshot,
  buildApiFeatureFlagSnapshot,
  collectApiFeatureFlagInputs,
} from './feature-flags';
import { QueueMonitorService } from '../health/queue-monitor.service';
import { FileOrphanService } from '../files/file-orphan.service';
import { FilesService } from '../files/files.service';
import { StorageConfigService } from '../settings/storage-config.service';
import { FILE_CRON_ENV_RULES, FileCronEnvKey } from '../files/file-cron-env';

const COMPOSE = readFileSync(resolve(__dirname, '../../../../docker-compose.yml'), 'utf8');
const ENTRY = /^ {6}- ([A-Z][A-Z0-9_]*)=(.*)$/;
const DEFAULTED = /^\$\{([A-Z][A-Z0-9_]*):-(.*)\}$/;
const BOOLEAN_LIKE = /^(true|false|on|off|0|1)$/i;

function composeEnv(svc: 'api' | 'worker', text: string = COMPOSE): Map<string, string> {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${svc}:`);
  if (start < 0) throw new Error(`compose service ${svc} 없음`);
  const out = new Map<string, string>();
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#|$)/.test(l)) continue; // 주석·빈 줄은 들여쓰기와 관계없이 건너뛴다
    if (/^\S/.test(l) || /^ {2}\S/.test(l)) break; // 다음 최상위 키·다음 서비스
    if (/^ {4}\S/.test(l)) {
      inEnv = l.trim() === 'environment:';
      continue;
    }
    if (!inEnv) continue;
    const m = ENTRY.exec(l);
    if (!m) throw new Error(`environment 형식 미지원 ${svc}:${i + 1} — 파서 갱신 필요`);
    if (out.has(m[1])) throw new Error(`environment 키 중복 ${svc}:${i + 1} ${m[1]}`);
    out.set(m[1], m[2]);
  }
  return out;
}

/** `${VAR:-lit}` 이면 lit, `${…}` 가 없는 고정값이면 그 값, 기본값 없는 보간이면 undefined. */
function literalOf(value: string): string | undefined {
  const m = DEFAULTED.exec(value);
  if (m) return m[2];
  return value.includes('${') ? undefined : value;
}

/** 리터럴이 불리언형인데 플래그가 아닌 키(사유 필수). 현재 없음. */
const NON_FLAG_ALLOWLIST: ReadonlyArray<{ key: string; reason: string }> = [];

/** 리터럴이 불리언형인데 플래그 KEYS 에도 허용 목록에도 없는 키. */
function unlistedBooleanKeys(env: ReadonlyMap<string, string>): string[] {
  const keys = new Set<string>(API_FEATURE_FLAG_KEYS);
  const allow = new Set(NON_FLAG_ALLOWLIST.map((a) => a.key));
  const unknown: string[] = [];
  for (const [key, value] of env) {
    const literal = literalOf(value);
    if (literal === undefined || !BOOLEAN_LIKE.test(literal)) continue;
    if (!keys.has(key) && !allow.has(key)) unknown.push(key);
  }
  return unknown;
}

/** 파서 픽스처 — environment 목록 사이에 들여쓰기가 다른 주석이 있어도 YAML 에서는 같은 목록이다. */
const PARSER_FIXTURE = [
  'services:',
  '  api:',
  '    image: example',
  '    environment:',
  '      - NODE_ENV=production',
  '    # 4칸 주석',
  '      - NEW_TOGGLE=${NEW_TOGGLE:-false}',
  '  # 2칸 주석',
  '# 최상위 주석',
  '      - OTHER_TOGGLE=${OTHER_TOGGLE:-on}',
  '    volumes:',
  '      - ./data:/data',
  '  worker:',
  '    image: example',
].join('\n');

const API_ENV = composeEnv('api');
const WORKER_ENV = composeEnv('worker');

type QueueArg = ConstructorParameters<typeof QueueMonitorService>[0];

/** process.env 를 KEYS 미설정 + overrides 로 바꾼 뒤 main.ts 와 같은 경로로 스냅샷을 만든다. */
function snapshotUnderEnv(overrides: Partial<Record<ApiFeatureFlagKey, string>>): ApiFeatureFlagSnapshot {
  const backup = new Map<string, string | undefined>();
  for (const k of API_FEATURE_FLAG_KEYS) {
    backup.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    const config = new ConfigService();
    const queue = {} as unknown as QueueArg;
    const queueMonitor = new QueueMonitorService(queue, queue, queue);
    const fileOrphan = new FileOrphanService(
      {} as unknown as FilesService,
      config,
      {} as unknown as StorageConfigService,
    );
    return buildApiFeatureFlagSnapshot(
      collectApiFeatureFlagInputs(
        (key, defaultValue) =>
          defaultValue === undefined ? config.get<string>(key) : config.get<string>(key, defaultValue),
        { queueMonitor, fileOrphan },
      ),
    );
  } finally {
    for (const [k, v] of backup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// ⑨ 스캐너 — 같은 코드가 worker spec ⑦ 에 있다(패키지 경계를 넘지 않음).
// 주석은 ⑦ 과 같은 규칙(줄 첫머리 //·*·/*)으로만 비운다. 블록 주석을 정규식으로 지우면
// 문자열 안의 '//' 뒤에 오는 읽기를 놓친다.
// ---------------------------------------------------------------------------

/** 코드가 읽지만 compose 에 매핑하지 않는 키. kind 는 분류, reason 은 짧은 사유. */
type UnmappedKind =
  | 'code-default'
  | 'admin-setting'
  | 'optional-off'
  | 'bootstrap'
  | 'cli'
  | 'no-effect'
  | 'hold';
const API_UNMAPPED_ALLOWLIST: ReadonlyArray<{ key: string; kind: UnmappedKind; reason: string }> = [
  { key: 'ADMIN_EMAIL', kind: 'bootstrap', reason: '최초 1회' },
  { key: 'ADMIN_PASSWORD', kind: 'bootstrap', reason: '최초 1회' },
  { key: 'BOOKMOA_DB_HOST', kind: 'optional-off', reason: '선택 연동, 운영 미사용' },
  { key: 'BOOKMOA_DB_NAME', kind: 'optional-off', reason: '선택 연동, 운영 미사용' },
  { key: 'BOOKMOA_DB_PASSWORD', kind: 'optional-off', reason: '선택 연동, 운영 미사용' },
  { key: 'BOOKMOA_DB_PORT', kind: 'optional-off', reason: '선택 연동, 운영 미사용' },
  { key: 'BOOKMOA_DB_USER', kind: 'optional-off', reason: '선택 연동, 운영 미사용' },
  { key: 'FONT_PROXY_ALLOWED_HOSTS', kind: 'hold', reason: '운영 확인 후 결정' },
  { key: 'JWT_EXPIRES_IN', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'LOG_LEVEL', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'MAX_BODY_SIZE', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'METRICS_REFRESH_INTERVAL_MS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'OPENAPI_PARTNER_OUT', kind: 'cli', reason: 'CLI 전용' },
  { key: 'PARTNER_API_IDEMPOTENCY_TTL_HOURS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PARTNER_API_RATE_LIMIT_GENERAL_PER_MIN', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PARTNER_API_RATE_LIMIT_HEAVY_PER_MIN', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PORT', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PORTAL_TEST_KEY_LIMIT', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'S3_ACCESS_KEY_ID', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'S3_BUCKET', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'S3_ENDPOINT', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'S3_FORCE_PATH_STYLE', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'S3_REGION', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'S3_SECRET_ACCESS_KEY', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'STORAGE_BASE_URL', kind: 'hold', reason: '운영 확인 후 결정' },
  { key: 'STORAGE_DRIVER', kind: 'admin-setting', reason: '관리자 설정 행 우선' },
  { key: 'THUMBNAIL_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'UPLOAD_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
];

const ENV_KEY = String.raw`([A-Z][A-Z0-9_]*)`;
const QUOTE = String.raw`['"\x60]`;
const ENV_GETTERS = ['get', 'getOrThrow', 'env', 'strictFlag', 'positiveIntFromEnv', 'resolveFileEnvNumber'];
/** process.env.K · process.env['K'] · getter('K')(여러 줄·첫 인자 config 포함) · env.K */
const READ_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`process\.env\.${ENV_KEY}\b`, 'g'),
  new RegExp(String.raw`process\.env\[\s*${QUOTE}${ENV_KEY}${QUOTE}\s*\]`, 'g'),
  new RegExp(
    String.raw`\b(?:${ENV_GETTERS.join('|')})\s*(?:<[^>()]*>)?\s*\(\s*(?:[A-Za-z_][\w.]*\s*,\s*)?${QUOTE}${ENV_KEY}${QUOTE}`,
    'g',
  ),
  new RegExp(String.raw`(?<![\w.])env\.${ENV_KEY}\b`, 'g'),
];
/** 키를 변수로 읽는 호출(process.env[변수], config.get(변수)) */
const DYNAMIC_PATTERNS: readonly RegExp[] = [
  /process\.env\[(?!\s*['"`])/g,
  /\b(?:config|configService|this\.config|this\.configService)\.(?:get|getOrThrow)\s*(?:<[^>()]*>)?\s*\(\s*(?=[^\s'"`])/g,
];

function scanEnvText(text: string): { keys: Array<{ key: string; line: number }>; dynamicLines: number[] } {
  const t = text
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n');
  const lineOf = (i: number): number => t.slice(0, i).split('\n').length;
  const keys: Array<{ key: string; line: number }> = [];
  const dynamicLines: number[] = [];
  for (const re of READ_PATTERNS) {
    for (const m of t.matchAll(re)) keys.push({ key: m[1], line: lineOf(m.index ?? 0) });
  }
  for (const re of DYNAMIC_PATTERNS) {
    for (const m of t.matchAll(re)) dynamicLines.push(lineOf(m.index ?? 0));
  }
  return { keys, dynamicLines: [...new Set(dynamicLines)].sort((a, b) => a - b) };
}

function scanEnvReads(srcRoot: string): {
  keys: Array<{ file: string; line: number; key: string }>;
  dynamicFiles: string[];
} {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) return walk(full);
      return ent.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(ent.name) ? [full] : [];
    });
  const keys: Array<{ file: string; line: number; key: string }> = [];
  const dynamicFiles: string[] = [];
  for (const full of walk(srcRoot)) {
    const file = relative(srcRoot, full).split(sep).join('/');
    const r = scanEnvText(readFileSync(full, 'utf8'));
    for (const k of r.keys) keys.push({ file, ...k });
    if (r.dynamicLines.length > 0) dynamicFiles.push(file);
  }
  return { keys, dynamicFiles: dynamicFiles.sort() };
}

/** ⑨-f 픽스처(줄 번호를 단언하므로 순서를 바꾸지 않는다) */
const SCANNER_FIXTURE = [
  'const a = process.env.ALPHA_KEY;',
  "const b = process.env['BRAVO_KEY'];",
  "this.configService.get<number>(\n  'CHARLIE_KEY',\n  100,\n);",
  "config.getOrThrow('DELTA_KEY');",
  "env('ECHO_KEY', 'x');",
  "positiveIntFromEnv(\n  config,\n  'FOXTROT_KEY',\n  300,\n);",
  'function f(env: NodeJS.ProcessEnv) { return env.GOLF_KEY; }',
  '// process.env.HOTEL_COMMENTED',
  "/* config.get('INDIA_BLOCK') */",
  "const url = 'http://x//y'; const c = process.env.JULIET_AFTER_URL;",
  'for (const k of KEYS) process.env[k];',
  'this.configService.get(key);',
  "this.configService.get<string>(\n 'KILO_KEY');",
].join('\n');

describe('docker-compose api environment ↔ api 플래그 모듈 정합', () => {
  it('① 파서 자기검증 — api 항목 40개 이상·NODE_ENV=production, worker 항목 30개 이상', () => {
    expect(API_ENV.size).toBeGreaterThanOrEqual(40);
    expect(API_ENV.get('NODE_ENV')).toBe('production');
    expect(WORKER_ENV.size).toBeGreaterThanOrEqual(30);
  });

  it.each(API_FEATURE_FLAG_KEYS.map((k) => [k]))(
    '② %s 는 KEY=${KEY:-<비어 있지 않은 리터럴>} 로 매핑돼 있다',
    (key) => {
      const value = API_ENV.get(key);
      expect(value).toBeDefined();
      const m = DEFAULTED.exec(value ?? '');
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe(key);
      expect((m?.[2] ?? '').length).toBeGreaterThan(0);
    },
  );

  it.each(API_FEATURE_FLAG_KEYS.map((k) => [k]))(
    '③ %s 의 compose 기본값은 미설정과 같은 유효값을 낸다',
    (key) => {
      const literal = literalOf(API_ENV.get(key) ?? '');
      expect(literal).toBeDefined();
      const withLiteral = snapshotUnderEnv({ [key]: literal });
      const unset = snapshotUnderEnv({});
      expect(withLiteral[key]).toBe(unset[key]);
    },
  );

  it('④ 리터럴이 불리언형인 compose 키는 플래그 KEYS 이거나 사유가 붙은 허용 목록에 있다', () => {
    expect(unlistedBooleanKeys(API_ENV)).toEqual([]);
    for (const a of NON_FLAG_ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(0);
      expect(BOOLEAN_LIKE.test(literalOf(API_ENV.get(a.key) ?? '') ?? '')).toBe(true);
    }
  });

  it('⑤ api·worker 양쪽에 있는 플래그는 compose 값이 같다', () => {
    const shared = API_FEATURE_FLAG_KEYS.filter((k) => WORKER_ENV.has(k));
    expect(shared).toEqual(expect.arrayContaining(['CUTOUT_ENABLED', 'SPREAD_SNAPSHOT_HARD_FAIL']));
    for (const k of shared) {
      expect({ key: k, worker: WORKER_ENV.get(k) }).toEqual({ key: k, worker: API_ENV.get(k) });
    }
  });

  it.each(Object.keys(FILE_CRON_ENV_RULES).map((k) => [k as FileCronEnvKey]))(
    '⑥ 파일 정리 수치 %s 의 compose 기본값은 규칙 기본값과 같다',
    (key) => {
      const m = DEFAULTED.exec(API_ENV.get(key) ?? '');
      expect(m?.[1]).toBe(key);
      expect(m?.[2]).toBe(String(FILE_CRON_ENV_RULES[key].def));
    },
  );

  describe('⑦ 소스에서 플래그 키를 process.env 로 직접 읽는 곳', () => {
    const SRC_ROOT = resolve(__dirname, '..');
    const ALLOWED_FILE = 'config/feature-flags.ts';
    const DIRECT_READ_ALLOWLIST: ReadonlyArray<{ file: string; key: ApiFeatureFlagKey; reason: string }> = [
      {
        file: 'health/queue-monitor.service.ts',
        key: 'QUEUE_MONITOR_ENABLED',
        reason: '필드 초기화에서 읽고, 스냅샷은 isEnabled() 로 같은 값을 받는다',
      },
    ];

    function listSourceFiles(dir: string): string[] {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...listSourceFiles(full));
        else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) out.push(full);
      }
      return out;
    }

    function directReads(): Array<{ file: string; line: number; key: ApiFeatureFlagKey }> {
      const patterns = API_FEATURE_FLAG_KEYS.map(
        (key) => [key, new RegExp(`process\\.env(?:\\.${key}\\b|\\[\\s*['"\`]${key}['"\`]\\s*\\])`)] as const,
      );
      const hits: Array<{ file: string; line: number; key: ApiFeatureFlagKey }> = [];
      for (const full of listSourceFiles(SRC_ROOT)) {
        const file = relative(SRC_ROOT, full).split(sep).join('/');
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((text, idx) => {
          const t = text.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          for (const [key, re] of patterns) {
            if (re.test(text)) hits.push({ file, line: idx + 1, key });
          }
        });
      }
      return hits;
    }

    const hits = directReads();

    it('config/feature-flags.ts 와 허용 목록 밖에는 없다', () => {
      const outside = hits
        .filter((h) => h.file !== ALLOWED_FILE)
        .filter((h) => !DIRECT_READ_ALLOWLIST.some((a) => a.file === h.file && a.key === h.key))
        .map((h) => `${h.file}:${h.line} ${h.key}`);
      expect(outside).toEqual([]);
    });

    it.each(DIRECT_READ_ALLOWLIST.map((a) => [`${a.file} ${a.key}`, a]))(
      '허용 목록 %s 는 아직 쓰이고 사유가 있다',
      (_label, a) => {
        expect(a.reason.length).toBeGreaterThan(0);
        expect(hits.some((h) => h.file === a.file && h.key === a.key)).toBe(true);
      },
    );
  });

  it('⑧ 파서는 들여쓰기와 관계없이 주석 줄을 건너뛰고 그 뒤 environment 항목도 읽는다', () => {
    const env = composeEnv('api', PARSER_FIXTURE);
    expect([...env.keys()]).toEqual(['NODE_ENV', 'NEW_TOGGLE', 'OTHER_TOGGLE']);
    expect(unlistedBooleanKeys(env)).toEqual(['NEW_TOGGLE', 'OTHER_TOGGLE']);
  });

  describe('⑨ 소스가 읽는 env 키는 compose api environment 에 매핑돼 있거나 미매핑 목록에 있다', () => {
    const SRC_ROOT = resolve(__dirname, '..');
    const REPO_ROOT = resolve(__dirname, '../../../..');

    /** 키를 변수로 읽는 파일(키 이름은 같은 파일의 상수 목록·규칙 표에 있다). 바뀌면 검토 후 갱신한다. */
    const DYNAMIC_READ_FILES: readonly string[] = [
      'files/file-cron-env.ts',
      'main.ts',
      'partner-api/partner-api.config.ts',
      'settings/storage-config.service.ts',
      'webhook/v2/partner-webhooks.controller.ts',
      'worker-jobs/worker-jobs.controller.ts',
    ];
    /** compose 에 있지만 소스가 아니라 런타임이 읽는 키. api 는 없음. */
    const RUNTIME_ONLY: ReadonlyArray<{ key: string; reason: string }> = [];

    const hits = scanEnvReads(SRC_ROOT);

    it('⑨-a 매핑도 미매핑 목록도 없는 키가 없다(file:line KEY)', () => {
      const allow = new Set(API_UNMAPPED_ALLOWLIST.map((a) => a.key));
      const missing = hits.keys
        .filter((h) => !API_ENV.has(h.key) && !allow.has(h.key))
        .map((h) => `${h.file}:${h.line} ${h.key}`);
      expect(missing).toEqual([]);
    });

    it('⑨-b 미매핑 목록은 중복이 없고, 아직 읽히며, compose 에 없고, 사유가 있다', () => {
      const read = new Set(hits.keys.map((h) => h.key));
      const problems: string[] = [];
      const seen = new Set<string>();
      for (const a of API_UNMAPPED_ALLOWLIST) {
        if (seen.has(a.key)) problems.push(`${a.key} 중복`);
        seen.add(a.key);
        if (!read.has(a.key)) problems.push(`${a.key} 읽는 곳 없음`);
        if (API_ENV.has(a.key)) problems.push(`${a.key} compose 매핑 있음`);
        if (a.reason.length === 0) problems.push(`${a.key} 사유 없음`);
      }
      expect(problems).toEqual([]);
    });

    it('⑨-c 키를 변수로 읽는 파일은 정해진 목록과 같다', () => {
      expect(hits.dynamicFiles).toEqual([...DYNAMIC_READ_FILES].sort());
    });

    it('⑨-d 스캐너 감도 — compose api 키는 모두 스캔 결과나 런타임 전용 목록에 있다', () => {
      const read = new Set(hits.keys.map((h) => h.key));
      const runtime = new Set(RUNTIME_ONLY.map((r) => r.key));
      expect([...API_ENV.keys()].filter((k) => !read.has(k) && !runtime.has(k))).toEqual([]);
      for (const r of RUNTIME_ONLY) {
        expect({ key: r.key, mapped: API_ENV.has(r.key), read: read.has(r.key) }).toEqual({
          key: r.key,
          mapped: true,
          read: false,
        });
        expect(r.reason.length).toBeGreaterThan(0);
      }
    });

    it('⑨-e 전제 — compose 에 env_file 이 없고 api Dockerfile 에 ENV 지시가 없다', () => {
      expect(COMPOSE.split('\n').filter((l) => /^\s*env_file\s*:/.test(l))).toEqual([]);
      const dockerfile = readFileSync(join(REPO_ROOT, 'docker/api/Dockerfile'), 'utf8');
      expect(dockerfile.split('\n').filter((l) => /^ENV\s/.test(l))).toEqual([]);
    });

    it('⑨-f 스캐너 픽스처 — 여러 줄 호출·헬퍼·env 인자는 잡고 주석 줄은 건너뛴다', () => {
      const r = scanEnvText(SCANNER_FIXTURE);
      expect([...new Set(r.keys.map((k) => k.key))].sort()).toEqual([
        'ALPHA_KEY',
        'BRAVO_KEY',
        'CHARLIE_KEY',
        'DELTA_KEY',
        'ECHO_KEY',
        'FOXTROT_KEY',
        'GOLF_KEY',
        'JULIET_AFTER_URL',
        'KILO_KEY',
      ]);
      expect(r.keys.find((k) => k.key === 'CHARLIE_KEY')?.line).toBe(3);
      expect(r.dynamicLines).toEqual([18, 19]);
    });
  });
});
