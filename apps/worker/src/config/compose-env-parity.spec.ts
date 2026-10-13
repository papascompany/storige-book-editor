/**
 * docker-compose.yml worker environment ↔ worker 플래그 모듈 정합.
 *
 * 컨테이너에는 compose environment 에 매핑된 키만 전달되고, `.env` 가 없거나 키가 빠지면
 * `${KEY:-<리터럴>}` 의 리터럴로 동작한다. 그래서 플래그 키마다 매핑이 있고, 리터럴이 코드
 * 기본값과 같은 결과를 내야 한다. 기준은 WORKER_FEATURE_FLAG_KEYS 배열이다.
 *
 * 파서는 줄 단위(새 의존성 없음)다. compose 형식이 바뀌어 읽지 못하면 위치를 담은 오류로 실패한다.
 * 같은 파서가 apps/api/src/config/compose-env-parity.spec.ts 에도 있다(패키지 경계를 넘지 않음).
 * VALIDATION_CONFIG 는 모듈 로드 시점에 env 를 읽으므로 feature-flags.spec 과 같이
 * jest.isolateModules 로 새 레지스트리에서 다시 require 한다.
 *
 * ⑦ 은 플래그에 한정하지 않고, 소스가 읽는 env 키가 모두 compose 에 매핑돼 있거나 사유가 붙은
 * 미매핑 목록(UNMAPPED_ALLOWLIST)에 있는지 본다. 같은 스캐너가 api spec ⑨ 에도 있다.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { WORKER_FEATURE_FLAG_KEYS, WorkerFeatureFlagKey, WorkerFeatureFlagSnapshot } from './feature-flags';

type FeatureFlagsModule = typeof import('./feature-flags');

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
  const keys = new Set<string>(WORKER_FEATURE_FLAG_KEYS);
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
  '  worker:',
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
  '  api:',
  '    image: example',
].join('\n');

const API_ENV = composeEnv('api');
const WORKER_ENV = composeEnv('worker');

function loadFlagsIsolated(): FeatureFlagsModule {
  let loaded: FeatureFlagsModule | undefined;
  jest.isolateModules(() => {
    loaded = require('./feature-flags') as FeatureFlagsModule;
  });
  if (!loaded) throw new Error('isolateModules did not run');
  return loaded;
}

/** process.env 를 KEYS 미설정 + overrides 로 바꾼 뒤 새 모듈 레지스트리에서 스냅샷을 만든다. */
function snapshotUnderEnv(
  overrides: Partial<Record<WorkerFeatureFlagKey, string>>,
): WorkerFeatureFlagSnapshot {
  const backup = new Map<string, string | undefined>();
  for (const k of WORKER_FEATURE_FLAG_KEYS) {
    backup.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    return loadFlagsIsolated().buildWorkerFeatureFlagSnapshot();
  } finally {
    for (const [k, v] of backup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// ⑦ 스캐너 — 같은 코드가 api spec ⑨ 에 있다(패키지 경계를 넘지 않음).
// 주석은 api spec ⑦ 과 같은 규칙(줄 첫머리 //·*·/*)으로만 비운다. 블록 주석을 정규식으로 지우면
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
const WORKER_UNMAPPED_ALLOWLIST: ReadonlyArray<{ key: string; kind: UnmappedKind; reason: string }> = [
  { key: 'CONTENT_PDF_GUIDE_DPI', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'CONTENT_PDF_GUIDE_MAX_PAGES', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'LOG_LEVEL', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'OUTPUTS_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PDFFONTS_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PDFIMAGES_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PDFINFO_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'POPPLER_TIMEOUT_MS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'PORT', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'QPDF_MERGE_TIMEOUT_MS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'QPDF_PATH', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'QPDF_TIMEOUT_MS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'TAC_WARN_PERCENT', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'WORKER_DOWNLOAD_ALLOWED_HOSTS', kind: 'code-default', reason: '코드 기본값으로 운영' },
  { key: 'WORKER_DOWNLOAD_TIMEOUT_MS', kind: 'code-default', reason: '코드 기본값으로 운영' },
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

/** ⑦-f 픽스처(줄 번호를 단언하므로 순서를 바꾸지 않는다) */
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

describe('docker-compose worker environment ↔ worker 플래그 모듈 정합', () => {
  it('① 파서 자기검증 — worker 항목 30개 이상·NODE_ENV=production, api 항목 40개 이상', () => {
    expect(WORKER_ENV.size).toBeGreaterThanOrEqual(30);
    expect(WORKER_ENV.get('NODE_ENV')).toBe('production');
    expect(API_ENV.size).toBeGreaterThanOrEqual(40);
  });

  it.each(WORKER_FEATURE_FLAG_KEYS.map((k) => [k]))(
    '② %s 는 KEY=${KEY:-<비어 있지 않은 리터럴>} 로 매핑돼 있다',
    (key) => {
      const value = WORKER_ENV.get(key);
      expect(value).toBeDefined();
      const m = DEFAULTED.exec(value ?? '');
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe(key);
      expect((m?.[2] ?? '').length).toBeGreaterThan(0);
    },
  );

  it.each(WORKER_FEATURE_FLAG_KEYS.map((k) => [k]))(
    '③ %s 의 compose 기본값은 미설정과 같은 유효값을 낸다',
    (key) => {
      const literal = literalOf(WORKER_ENV.get(key) ?? '');
      expect(literal).toBeDefined();
      const withLiteral = snapshotUnderEnv({ [key]: literal });
      const unset = snapshotUnderEnv({});
      expect(withLiteral[key]).toBe(unset[key]);
    },
  );

  it('④ 리터럴이 불리언형인 compose 키는 플래그 KEYS 이거나 사유가 붙은 허용 목록에 있다', () => {
    expect(unlistedBooleanKeys(WORKER_ENV)).toEqual([]);
    for (const a of NON_FLAG_ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(0);
      expect(BOOLEAN_LIKE.test(literalOf(WORKER_ENV.get(a.key) ?? '') ?? '')).toBe(true);
    }
  });

  it('⑤ 파서는 들여쓰기와 관계없이 주석 줄을 건너뛰고 그 뒤 environment 항목도 읽는다', () => {
    const env = composeEnv('worker', PARSER_FIXTURE);
    expect([...env.keys()]).toEqual(['NODE_ENV', 'NEW_TOGGLE', 'OTHER_TOGGLE']);
    expect(unlistedBooleanKeys(env)).toEqual(['NEW_TOGGLE', 'OTHER_TOGGLE']);
  });

  describe('⑥ 소스에서 플래그 키를 process.env 로 직접 읽는 곳', () => {
    const SRC_ROOT = resolve(__dirname, '..');
    const ALLOWED_FILE = 'config/feature-flags.ts';
    const CONSTANT_REASON = '모듈 로드 시점 상수(VALIDATION_CONFIG)에서 읽고, 스냅샷은 그 상수를 쓴다';
    const FUNCTION_REASON = '호출 시점 함수에서 읽고, 스냅샷은 같은 함수를 호출한다';
    const DIRECT_READ_ALLOWLIST: ReadonlyArray<{ file: string; key: WorkerFeatureFlagKey; reason: string }> = [
      { file: 'config/validation.config.ts', key: 'WORKER_LIGHTWEIGHT_VALIDATION', reason: CONSTANT_REASON },
      { file: 'config/validation.config.ts', key: 'WORKER_LIGHTWEIGHT_SYNTHESIS', reason: CONSTANT_REASON },
      { file: 'config/validation.config.ts', key: 'WORKER_WIRED_FIXABLE_GATING', reason: CONSTANT_REASON },
      { file: 'config/validation.config.ts', key: 'WORKER_CROP_MARK_VALIDATION', reason: CONSTANT_REASON },
      { file: 'utils/print-normalize.ts', key: 'PRINT_NORMALIZE', reason: FUNCTION_REASON },
      { file: 'utils/print-normalize.ts', key: 'PRINT_NORMALIZE_FLATTEN', reason: FUNCTION_REASON },
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

    function directReads(): Array<{ file: string; line: number; key: WorkerFeatureFlagKey }> {
      const patterns = WORKER_FEATURE_FLAG_KEYS.map(
        (key) => [key, new RegExp(`process\\.env(?:\\.${key}\\b|\\[\\s*['"\`]${key}['"\`]\\s*\\])`)] as const,
      );
      const hits: Array<{ file: string; line: number; key: WorkerFeatureFlagKey }> = [];
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

  describe('⑦ 소스가 읽는 env 키는 compose worker environment 에 매핑돼 있거나 미매핑 목록에 있다', () => {
    const SRC_ROOT = resolve(__dirname, '..');
    const REPO_ROOT = resolve(__dirname, '../../../..');

    /** 키를 변수로 읽는 파일(키 이름은 같은 파일의 상수 목록에 있다). 바뀌면 검토 후 갱신한다. */
    const DYNAMIC_READ_FILES: readonly string[] = ['main.ts'];
    /** compose 에 있지만 소스가 읽지 않는 키. */
    const RUNTIME_ONLY: ReadonlyArray<{ key: string; reason: string }> = [
      { key: 'NODE_OPTIONS', reason: 'Node 런타임이 읽는다' },
    ];

    const hits = scanEnvReads(SRC_ROOT);

    it('⑦-a 매핑도 미매핑 목록도 없는 키가 없다(file:line KEY)', () => {
      const allow = new Set(WORKER_UNMAPPED_ALLOWLIST.map((a) => a.key));
      const missing = hits.keys
        .filter((h) => !WORKER_ENV.has(h.key) && !allow.has(h.key))
        .map((h) => `${h.file}:${h.line} ${h.key}`);
      expect(missing).toEqual([]);
    });

    it('⑦-b 미매핑 목록은 중복이 없고, 아직 읽히며, compose 에 없고, 사유가 있다', () => {
      const read = new Set(hits.keys.map((h) => h.key));
      const problems: string[] = [];
      const seen = new Set<string>();
      for (const a of WORKER_UNMAPPED_ALLOWLIST) {
        if (seen.has(a.key)) problems.push(`${a.key} 중복`);
        seen.add(a.key);
        if (!read.has(a.key)) problems.push(`${a.key} 읽는 곳 없음`);
        if (WORKER_ENV.has(a.key)) problems.push(`${a.key} compose 매핑 있음`);
        if (a.reason.length === 0) problems.push(`${a.key} 사유 없음`);
      }
      expect(problems).toEqual([]);
    });

    it('⑦-c 키를 변수로 읽는 파일은 정해진 목록과 같다', () => {
      expect(hits.dynamicFiles).toEqual([...DYNAMIC_READ_FILES].sort());
    });

    it('⑦-d 스캐너 감도 — compose worker 키는 모두 스캔 결과나 런타임 전용 목록에 있다', () => {
      const read = new Set(hits.keys.map((h) => h.key));
      const runtime = new Set(RUNTIME_ONLY.map((r) => r.key));
      expect([...WORKER_ENV.keys()].filter((k) => !read.has(k) && !runtime.has(k))).toEqual([]);
      for (const r of RUNTIME_ONLY) {
        expect({ key: r.key, mapped: WORKER_ENV.has(r.key), read: read.has(r.key) }).toEqual({
          key: r.key,
          mapped: true,
          read: false,
        });
        expect(r.reason.length).toBeGreaterThan(0);
      }
    });

    it('⑦-e 전제 — compose 에 env_file 이 없고 worker Dockerfile 에 ENV 지시가 없다', () => {
      expect(COMPOSE.split('\n').filter((l) => /^\s*env_file\s*:/.test(l))).toEqual([]);
      const dockerfile = readFileSync(join(REPO_ROOT, 'docker/worker/Dockerfile'), 'utf8');
      expect(dockerfile.split('\n').filter((l) => /^ENV\s/.test(l))).toEqual([]);
    });

    it('⑦-f 스캐너 픽스처 — 여러 줄 호출·헬퍼·env 인자는 잡고 주석 줄은 건너뛴다', () => {
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
