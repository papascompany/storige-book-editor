/**
 * OPS-S4-N2 — worker 기능 플래그 기동 스냅샷.
 *
 * VALIDATION_CONFIG 는 모듈 로드 시점에 env 를 읽으므로, env 를 바꾼 뒤
 * jest.isolateModules 로 새 레지스트리에서 다시 require 한다.
 */
type FeatureFlagsModule = typeof import('./feature-flags');
type ValidationConfigModule = typeof import('./validation.config');
type PrintNormalizeModule = typeof import('../utils/print-normalize');

interface LoadedModules {
  flags: FeatureFlagsModule;
  validation: ValidationConfigModule;
  printNormalize: PrintNormalizeModule;
}

const FLAG_ENV_KEYS = [
  'CUTOUT_ENABLED',
  'WORKER_LIGHTWEIGHT_VALIDATION',
  'WORKER_LIGHTWEIGHT_SYNTHESIS',
  'WORKER_CROP_MARK_VALIDATION',
  'WORKER_WIRED_FIXABLE_GATING',
  'PRINT_NORMALIZE',
  'PRINT_NORMALIZE_FLATTEN',
  'SPREAD_SNAPSHOT_HARD_FAIL',
] as const;

/** 미설정 시 ON 인 플래그(X1 킬스위치) — 위 FLAG_ENV_KEYS(기본 OFF)와 분리해 단언한다 */
const DEFAULT_ON_KEYS = ['WORKER_TRIMBOX_SIZE_CHECK'] as const;

const EXTRA_ENV_KEYS = ['WORKER_API_KEY', 'DATABASE_PASSWORD'] as const;
const ALL_ENV_KEYS: readonly string[] = [...FLAG_ENV_KEYS, ...DEFAULT_ON_KEYS, ...EXTRA_ENV_KEYS];

const LINE_PATTERN = /^\[FLAGS\] worker( [A-Z_]+=(true|false))+$/;

function loadIsolated(): LoadedModules {
  let loaded: LoadedModules | undefined;
  jest.isolateModules(() => {
    loaded = {
      flags: require('./feature-flags') as FeatureFlagsModule,
      validation: require('./validation.config') as ValidationConfigModule,
      printNormalize: require('../utils/print-normalize') as PrintNormalizeModule,
    };
  });
  if (!loaded) throw new Error('isolateModules did not run');
  return loaded;
}

describe('worker feature-flags', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ALL_ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ALL_ENV_KEYS) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('isFlagOn', () => {
    const { isFlagOn } = loadIsolated().flags;

    it.each(['true', 'TRUE', ' true ', '1'])('%j → true', (raw) => {
      expect(isFlagOn(raw)).toBe(true);
    });

    it.each([undefined, '', 'false', '0', 'yes', 'on', '2'])('%j → false', (raw) => {
      expect(isFlagOn(raw)).toBe(false);
    });
  });

  it('대상 env 가 모두 미설정이면 기본 OFF 플래그는 전부 false, 기본 ON 플래그만 true', () => {
    const snap = loadIsolated().flags.buildWorkerFeatureFlagSnapshot();
    for (const k of FLAG_ENV_KEYS) {
      expect(snap[k]).toBe(false);
    }
    for (const k of DEFAULT_ON_KEYS) {
      expect(snap[k]).toBe(true);
    }
  });

  it.each([
    ['false', false],
    ['0', false],
    [' OFF ', false],
    ['no', false],
    ['true', true],
    ['', true],
    ['yes', true],
  ])('WORKER_TRIMBOX_SIZE_CHECK=%j → %s (기본 ON, OFF 값 집합만 끔)', (raw, expected) => {
    process.env.WORKER_TRIMBOX_SIZE_CHECK = raw;
    const { flags, validation } = loadIsolated();
    const snap = flags.buildWorkerFeatureFlagSnapshot();
    expect(snap.WORKER_TRIMBOX_SIZE_CHECK).toBe(expected);
    expect(snap.WORKER_TRIMBOX_SIZE_CHECK).toBe(validation.VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK);
  });

  it.each(FLAG_ENV_KEYS.map((k) => [k]))("%s='true' 이면 해당 키만 true", (key) => {
    process.env[key] = 'true';
    const snap = loadIsolated().flags.buildWorkerFeatureFlagSnapshot();
    for (const k of FLAG_ENV_KEYS) {
      expect(snap[k]).toBe(k === key);
    }
    for (const k of DEFAULT_ON_KEYS) {
      expect(snap[k]).toBe(true);
    }
  });

  describe('파싱 규칙 현행 고정(플래그별로 다름 — 통일하지 않음)', () => {
    it.each([
      ['1', false],
      ['TRUE', true],
      [' true', false],
    ])("WORKER_LIGHTWEIGHT_VALIDATION=%j → %s", (raw, expected) => {
      process.env.WORKER_LIGHTWEIGHT_VALIDATION = raw;
      const snap = loadIsolated().flags.buildWorkerFeatureFlagSnapshot();
      expect(snap.WORKER_LIGHTWEIGHT_VALIDATION).toBe(expected);
    });

    it("PRINT_NORMALIZE='1' → false", () => {
      process.env.PRINT_NORMALIZE = '1';
      expect(loadIsolated().flags.buildWorkerFeatureFlagSnapshot().PRINT_NORMALIZE).toBe(false);
    });

    it.each(['1', ' TRUE '])('CUTOUT_ENABLED=%j → true', (raw) => {
      process.env.CUTOUT_ENABLED = raw;
      expect(loadIsolated().flags.buildWorkerFeatureFlagSnapshot().CUTOUT_ENABLED).toBe(true);
    });

    it.each([
      ['true', true],
      ['TRUE', false],
      ['1', false],
      [' true', false],
    ])('SPREAD_SNAPSHOT_HARD_FAIL=%j → %s (대소문자 구분 정확 일치)', (raw, expected) => {
      process.env.SPREAD_SNAPSHOT_HARD_FAIL = raw;
      const snap = loadIsolated().flags.buildWorkerFeatureFlagSnapshot();
      expect(snap.SPREAD_SNAPSHOT_HARD_FAIL).toBe(expected);
    });
  });

  it.each([
    ['미설정', undefined],
    ['true', 'true'],
    ['TRUE', 'TRUE'],
    ['1', '1'],
  ])('재사용 동치(%s) — 스냅샷 값이 소비 코드의 값과 같다', (_label, raw) => {
    for (const k of FLAG_ENV_KEYS) {
      if (raw === undefined) delete process.env[k];
      else process.env[k] = raw;
    }
    const { flags, validation, printNormalize } = loadIsolated();
    const snap = flags.buildWorkerFeatureFlagSnapshot();
    const cfg = validation.VALIDATION_CONFIG;

    expect(snap.WORKER_LIGHTWEIGHT_VALIDATION).toBe(cfg.LIGHTWEIGHT_VALIDATION);
    expect(snap.WORKER_LIGHTWEIGHT_SYNTHESIS).toBe(cfg.LIGHTWEIGHT_SYNTHESIS);
    expect(snap.WORKER_CROP_MARK_VALIDATION).toBe(cfg.CROP_MARK_VALIDATION);
    expect(snap.WORKER_WIRED_FIXABLE_GATING).toBe(cfg.WIRED_FIXABLE_GATING);
    expect(snap.PRINT_NORMALIZE).toBe(printNormalize.isPrintNormalizeEnabled());
    expect(snap.PRINT_NORMALIZE_FLATTEN).toBe(printNormalize.printNormalizeFlatten());
    expect(snap.CUTOUT_ENABLED).toBe(flags.isFlagOn(process.env.CUTOUT_ENABLED));
    expect(snap.WORKER_TRIMBOX_SIZE_CHECK).toBe(cfg.TRIMBOX_SIZE_CHECK);
  });

  it('키 집합이 WORKER_FEATURE_FLAG_KEYS 와 정확히 같고 값은 전부 boolean', () => {
    const { flags } = loadIsolated();
    const snap = flags.buildWorkerFeatureFlagSnapshot();
    expect(Object.keys(snap).sort()).toEqual([...flags.WORKER_FEATURE_FLAG_KEYS].sort());
    expect([...flags.WORKER_FEATURE_FLAG_KEYS]).toEqual([...FLAG_ENV_KEYS, ...DEFAULT_ON_KEYS]);
    for (const v of Object.values(snap)) {
      expect(typeof v).toBe('boolean');
    }
  });

  it('formatFeatureFlagSnapshot — 한 줄·형식 고정·키 순서 = KEYS 배열 순서', () => {
    process.env.CUTOUT_ENABLED = 'true';
    const { flags } = loadIsolated();
    const line = flags.formatFeatureFlagSnapshot('worker', flags.buildWorkerFeatureFlagSnapshot());

    expect(line).not.toContain('\n');
    expect(line).toMatch(LINE_PATTERN);
    const keys = line
      .replace(/^\[FLAGS\] worker /, '')
      .split(' ')
      .map((t) => t.split('=')[0]);
    expect(keys).toEqual([...flags.WORKER_FEATURE_FLAG_KEYS]);
    expect(line).toContain('CUTOUT_ENABLED=true');
  });

  it('env 원문 값은 출력 문자열에 나타나지 않는다', () => {
    process.env.WORKER_API_KEY = 'sentinel-xyz';
    process.env.DATABASE_PASSWORD = 'sentinel-xyz';
    process.env.CUTOUT_ENABLED = 'sentinel-xyz';
    const { flags } = loadIsolated();
    const line = flags.formatFeatureFlagSnapshot('worker', flags.buildWorkerFeatureFlagSnapshot());

    expect(line).not.toContain('sentinel');
    expect(line).toContain('CUTOUT_ENABLED=false');
    expect(line).toMatch(LINE_PATTERN);
  });
});

describe('worker 기대값 프로필 대조 — [FLAGS-CHECK]', () => {
  const { checkFlagExpectation, formatFlagExpectationLine, formatFeatureFlagSnapshot, WORKER_FEATURE_FLAG_KEYS } =
    loadIsolated().flags;
  type Snapshot = ReturnType<FeatureFlagsModule['buildWorkerFeatureFlagSnapshot']>;
  const SNAP: Snapshot = {
    CUTOUT_ENABLED: true,
    WORKER_LIGHTWEIGHT_VALIDATION: true,
    WORKER_LIGHTWEIGHT_SYNTHESIS: false,
    WORKER_CROP_MARK_VALIDATION: false,
    WORKER_WIRED_FIXABLE_GATING: true,
    PRINT_NORMALIZE: false,
    PRINT_NORMALIZE_FLATTEN: false,
    SPREAD_SNAPSHOT_HARD_FAIL: false,
    WORKER_TRIMBOX_SIZE_CHECK: true,
  };
  /** [FLAGS] worker 줄의 토큰 부분 그대로 */
  const PROFILE = formatFeatureFlagSnapshot('worker', SNAP).replace(/^\[FLAGS\] worker /, '');
  const lineOf = (profile: unknown, production = true): string | null =>
    formatFlagExpectationLine('worker', checkFlagExpectation(SNAP, profile, production));

  it('production 이 아니면 검사하지 않는다(줄 없음)', () => {
    expect(checkFlagExpectation(SNAP, undefined, false)).toEqual({ status: 'skipped' });
    expect(lineOf('CUTOUT_ENABLED=false', false)).toBeNull();
  });

  it.each<[unknown]>([[undefined], [''], ['  ']])('production 에서 프로필 %j → missing', (profile) => {
    expect(lineOf(profile)).toBe('[FLAGS-CHECK] worker missing');
  });

  it('[FLAGS] 줄 토큰과 같은 프로필 → ok n=키 수(쉼표 구분 포함)', () => {
    expect(WORKER_FEATURE_FLAG_KEYS.length).toBe(9);
    expect(lineOf(PROFILE)).toBe('[FLAGS-CHECK] worker ok n=9');
    expect(lineOf(PROFILE.split(' ').join(', '))).toBe('[FLAGS-CHECK] worker ok n=9');
  });

  it('값이 다르면 mismatch(유효값·기대값), 프로필에 없으면 unlisted', () => {
    const profile = PROFILE.replace('WORKER_WIRED_FIXABLE_GATING=true', 'WORKER_WIRED_FIXABLE_GATING=false')
      .split(' ')
      .filter((t) => !t.startsWith('WORKER_TRIMBOX_SIZE_CHECK='))
      .join(' ');
    expect(lineOf(profile)).toBe(
      '[FLAGS-CHECK] worker mismatch WORKER_WIRED_FIXABLE_GATING=true(expected=false) WORKER_TRIMBOX_SIZE_CHECK=true(unlisted)',
    );
  });

  it('KEYS 밖 키·형식 오류·중복은 invalid — 토큰 원문은 남기지 않는다', () => {
    const profile = `${PROFILE} JOB_LINK_STRICT=true sentinel-xyz CUTOUT_ENABLED=1`;
    const line = lineOf(profile);
    expect(line).toBe('[FLAGS-CHECK] worker invalid n=3 names=JOB_LINK_STRICT,CUTOUT_ENABLED');
    expect(line).not.toContain('sentinel');
  });

  it('[FLAGS-CHECK] 줄은 [FLAGS] 정규식에 걸리지 않는다', () => {
    for (const line of [lineOf(PROFILE), lineOf(''), lineOf('X=1')]) {
      expect(line).toMatch(/^\[FLAGS-CHECK\] worker (ok|missing|invalid|mismatch)( |$)/);
      expect(/\[FLAGS\]/.test(line ?? '')).toBe(false);
    }
  });
});
