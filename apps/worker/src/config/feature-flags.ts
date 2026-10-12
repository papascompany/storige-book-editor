/**
 * 기능 플래그 기동 스냅샷(OPS-S4-N2).
 *
 * 부팅 시 각 플래그의 **유효 불리언**을 한 줄 로그로 남긴다. 값은 소비 코드가 쓰는 것을
 * 그대로 읽는다 — VALIDATION_CONFIG 상수, print-normalize 공개 함수는 재사용한다.
 * CUTOUT_ENABLED 는 CutoutProcessor 의 필드가 비공개라, 같은 술어(isFlagOn)·같은 소스
 * (process.env)로 평가한다. SPREAD_SNAPSHOT_HARD_FAIL 은 synthesis.processor 의 호출 시점
 * 식(`process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true'`)과 같은 식으로 평가한다.
 *
 * 파싱 규칙은 플래그마다 다르다(통일하지 않음 — 동작 변경이므로 테스트로 현행을 고정):
 *  - CUTOUT_ENABLED: 앞뒤 공백 제거 + 대소문자 무시, 'true' 또는 '1' 이면 ON.
 *  - WORKER_* / PRINT_*: 소문자 변환 후 정확히 'true' 일 때만 ON('1'·앞뒤 공백은 OFF).
 *  - SPREAD_SNAPSHOT_HARD_FAIL: 정확히 'true'(대소문자 구분) 일 때만 ON.
 *  - WORKER_TRIMBOX_SIZE_CHECK: **기본 ON**. 'false'·'0'·'off'·'no'(trim·대소문자 무시)일 때만 OFF
 *    (validation.config isTrimBoxSizeCheckEnabled — VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK 재사용).
 *
 * 플래그 추가 방법: WORKER_FEATURE_FLAG_KEYS 에 키 1개, buildWorkerFeatureFlagSnapshot 에
 * 1줄, docker-compose.yml worker environment 에 `KEY=${KEY:-<코드 기본값과 같은 리터럴>}` 매핑 1줄
 * (compose-env-parity.spec 이 매핑·기본값 일치를 강제). 스냅샷 타입이 키 배열에서 파생되므로
 * 한쪽만 추가하면 컴파일 오류가 난다. 배포할 때 운영 `.env` 의 기대값 프로필(FLAGS_EXPECTED_WORKER)에도
 * 키를 더한다 — 빠지면 기동 시 `[FLAGS-CHECK] worker mismatch … (unlisted)` 가 남는다.
 */
import { VALIDATION_CONFIG } from './validation.config';
import { isPrintNormalizeEnabled, printNormalizeFlatten } from '../utils/print-normalize';

/**
 * 플래그 진리값 해석 — API(assertCutoutEnabled)와 **같은 술어**를 써야 한다.
 * 한쪽만 '1' 을 받아들이면 "라우트는 열렸는데 워커는 전건 FAILED" 라는 추적 어려운 상태가 된다.
 * (apps/api/src/config/feature-flags.ts isFlagOn 과 동일 술어)
 */
export function isFlagOn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

export const WORKER_FEATURE_FLAG_KEYS = [
  'CUTOUT_ENABLED',
  'WORKER_LIGHTWEIGHT_VALIDATION',
  'WORKER_LIGHTWEIGHT_SYNTHESIS',
  'WORKER_CROP_MARK_VALIDATION',
  'WORKER_WIRED_FIXABLE_GATING',
  'PRINT_NORMALIZE',
  'PRINT_NORMALIZE_FLATTEN',
  'SPREAD_SNAPSHOT_HARD_FAIL',
  'WORKER_TRIMBOX_SIZE_CHECK',
] as const;

export type WorkerFeatureFlagKey = (typeof WORKER_FEATURE_FLAG_KEYS)[number];
export type WorkerFeatureFlagSnapshot = Readonly<Record<WorkerFeatureFlagKey, boolean>>;

/** 소비 코드가 쓰는 값 그대로(재파싱 금지). 동적 키로 process.env 를 읽지 않는다. */
export function buildWorkerFeatureFlagSnapshot(): WorkerFeatureFlagSnapshot {
  return {
    CUTOUT_ENABLED: isFlagOn(process.env.CUTOUT_ENABLED),
    WORKER_LIGHTWEIGHT_VALIDATION: VALIDATION_CONFIG.LIGHTWEIGHT_VALIDATION,
    WORKER_LIGHTWEIGHT_SYNTHESIS: VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS,
    WORKER_CROP_MARK_VALIDATION: VALIDATION_CONFIG.CROP_MARK_VALIDATION,
    WORKER_WIRED_FIXABLE_GATING: VALIDATION_CONFIG.WIRED_FIXABLE_GATING,
    PRINT_NORMALIZE: isPrintNormalizeEnabled(),
    PRINT_NORMALIZE_FLATTEN: printNormalizeFlatten(),
    // synthesis.processor.ts 와 같은 식(호출 시점 판독)
    SPREAD_SNAPSHOT_HARD_FAIL: process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true',
    WORKER_TRIMBOX_SIZE_CHECK: VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK,
  };
}

/** 한 줄, `KEY=true|false` 토큰만. 값은 boolean 으로 강제(env 원문 출력 불가). */
export function formatFeatureFlagSnapshot(
  service: 'worker',
  snap: WorkerFeatureFlagSnapshot,
): string {
  return (
    `[FLAGS] ${service} ` +
    WORKER_FEATURE_FLAG_KEYS.map((k) => `${k}=${snap[k] === true}`).join(' ')
  );
}

/**
 * 기대값 프로필 대조(FLAGS_EXPECTED, compose 매핑 `FLAGS_EXPECTED=${FLAGS_EXPECTED_WORKER:-}`).
 * apps/api/src/config/feature-flags.ts 의 checkFlagExpectation 과 같은 규칙(isFlagOn 복제 선례).
 *
 * 프로필은 [FLAGS] 줄과 같은 `KEY=true|false` 토큰을 공백 또는 쉼표로 나열한 문자열이다.
 * production 에서만 대조하고, 결과는 `[FLAGS-CHECK]` 한 줄로 남긴다(부팅은 막지 않는다).
 *  - 프로필이 비어 있으면 missing
 *  - KEYS 의 유효값이 프로필과 다르거나 프로필에 없으면 mismatch(키·유효값·기대값 또는 unlisted)
 *  - KEYS 밖 키·형식 오류 토큰·중복 키는 invalid(개수와 키 형식에 맞는 이름만 — 토큰 원문은 남기지 않는다)
 * 접두어가 `[FLAGS-CHECK]` 라 `\[FLAGS\]` 정규식에 걸리지 않는다(기존 [FLAGS] 줄 확인 방식 불변).
 */
export interface WorkerFlagExpectationMismatch {
  readonly key: WorkerFeatureFlagKey;
  readonly actual: boolean;
  /** 프로필 값. 프로필에 키가 없으면 undefined(unlisted). */
  readonly expected: boolean | undefined;
}

export type WorkerFlagExpectationResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'missing' }
  | { readonly status: 'ok'; readonly n: number }
  | {
      readonly status: 'problem';
      readonly invalidCount: number;
      readonly invalidNames: readonly string[];
      readonly mismatches: readonly WorkerFlagExpectationMismatch[];
    };

const FLAG_PROFILE_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const FLAG_PROFILE_MAX_NAMES = 20;

function isWorkerFeatureFlagKey(name: string): name is WorkerFeatureFlagKey {
  return (WORKER_FEATURE_FLAG_KEYS as readonly string[]).includes(name);
}

export function checkFlagExpectation(
  snap: WorkerFeatureFlagSnapshot,
  profileRaw: unknown,
  production: boolean,
): WorkerFlagExpectationResult {
  if (!production) return { status: 'skipped' };
  const raw = typeof profileRaw === 'string' ? profileRaw.trim() : '';
  if (raw === '') return { status: 'missing' };

  const expected = new Map<WorkerFeatureFlagKey, boolean>();
  const invalidNames: string[] = [];
  let invalidCount = 0;
  for (const token of raw.split(/[\s,]+/)) {
    if (token === '') continue;
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : '';
    const value = eq > 0 ? token.slice(eq + 1) : '';
    const validName = FLAG_PROFILE_NAME.test(name);
    if (
      !validName ||
      !isWorkerFeatureFlagKey(name) ||
      (value !== 'true' && value !== 'false') ||
      expected.has(name)
    ) {
      invalidCount++;
      if (validName && !invalidNames.includes(name) && invalidNames.length < FLAG_PROFILE_MAX_NAMES) {
        invalidNames.push(name);
      }
      continue;
    }
    expected.set(name, value === 'true');
  }

  const mismatches: WorkerFlagExpectationMismatch[] = [];
  for (const key of WORKER_FEATURE_FLAG_KEYS) {
    const actual = snap[key] === true;
    const want = expected.get(key);
    if (want !== actual) mismatches.push({ key, actual, expected: want });
  }

  if (invalidCount === 0 && mismatches.length === 0) {
    return { status: 'ok', n: WORKER_FEATURE_FLAG_KEYS.length };
  }
  return { status: 'problem', invalidCount, invalidNames, mismatches };
}

/** `[FLAGS-CHECK]` 한 줄. production 이 아니어서 건너뛰었으면 null. */
export function formatFlagExpectationLine(
  service: 'worker',
  r: WorkerFlagExpectationResult,
): string | null {
  switch (r.status) {
    case 'skipped':
      return null;
    case 'missing':
      return `[FLAGS-CHECK] ${service} missing`;
    case 'ok':
      return `[FLAGS-CHECK] ${service} ok n=${r.n}`;
    case 'problem': {
      const parts: string[] = [];
      if (r.invalidCount > 0) {
        const names = r.invalidNames.length > 0 ? ` names=${r.invalidNames.join(',')}` : '';
        parts.push(`invalid n=${r.invalidCount}${names}`);
      }
      if (r.mismatches.length > 0) {
        const items = r.mismatches.map(
          (m) =>
            `${m.key}=${m.actual}(${m.expected === undefined ? 'unlisted' : `expected=${m.expected}`})`,
        );
        parts.push(`mismatch ${items.join(' ')}`);
      }
      return `[FLAGS-CHECK] ${service} ${parts.join(' ')}`;
    }
  }
}
