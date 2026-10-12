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
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WORKER_FEATURE_FLAG_KEYS, WorkerFeatureFlagKey, WorkerFeatureFlagSnapshot } from './feature-flags';

type FeatureFlagsModule = typeof import('./feature-flags');

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
    const keys = new Set<string>(WORKER_FEATURE_FLAG_KEYS);
    const allow = new Set(NON_FLAG_ALLOWLIST.map((a) => a.key));
    const unknown: string[] = [];
    for (const [key, value] of WORKER_ENV) {
      const literal = literalOf(value);
      if (literal === undefined || !BOOLEAN_LIKE.test(literal)) continue;
      if (!keys.has(key) && !allow.has(key)) unknown.push(key);
    }
    expect(unknown).toEqual([]);
    for (const a of NON_FLAG_ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(0);
      expect(BOOLEAN_LIKE.test(literalOf(WORKER_ENV.get(a.key) ?? '') ?? '')).toBe(true);
    }
  });
});
