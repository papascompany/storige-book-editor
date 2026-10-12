/**
 * docker-compose.yml api environment ↔ api 플래그 모듈 정합.
 *
 * 컨테이너에는 compose environment 에 매핑된 키만 전달되고, `.env` 가 없거나 키가 빠지면
 * `${KEY:-<리터럴>}` 의 리터럴로 동작한다. 그래서 플래그 키마다 매핑이 있고, 리터럴이 코드
 * 기본값과 같은 결과를 내야 한다. 기준은 API_FEATURE_FLAG_KEYS 배열이다.
 *
 * 파서는 줄 단위(새 의존성 없음)다. compose 형식이 바뀌어 읽지 못하면 위치를 담은 오류로 실패한다.
 * 같은 파서가 apps/worker/src/config/compose-env-parity.spec.ts 에도 있다(패키지 경계를 넘지 않음).
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

function composeEnv(svc: 'api' | 'worker'): Map<string, string> {
  const lines = COMPOSE.split('\n');
  const start = lines.indexOf(`  ${svc}:`);
  if (start < 0) throw new Error(`compose service ${svc} 없음`);
  const out = new Map<string, string>();
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) || /^ {2}\S/.test(l)) break; // 다음 최상위 키·다음 서비스
    if (/^ {4}\S/.test(l)) {
      inEnv = l.trim() === 'environment:';
      continue;
    }
    if (!inEnv || /^\s*(#|$)/.test(l)) continue;
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
    const keys = new Set<string>(API_FEATURE_FLAG_KEYS);
    const allow = new Set(NON_FLAG_ALLOWLIST.map((a) => a.key));
    const unknown: string[] = [];
    for (const [key, value] of API_ENV) {
      const literal = literalOf(value);
      if (literal === undefined || !BOOLEAN_LIKE.test(literal)) continue;
      if (!keys.has(key) && !allow.has(key)) unknown.push(key);
    }
    expect(unknown).toEqual([]);
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
});
