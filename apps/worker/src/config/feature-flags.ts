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
 * 1줄. 스냅샷 타입이 키 배열에서 파생되므로 한쪽만 추가하면 컴파일 오류가 난다.
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
