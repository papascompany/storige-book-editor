/**
 * 최종화 실패 진단(`errorDetail`) 형식 — 저장할 값과 응답할 값을 만드는 순수 함수.
 *
 * 형식
 *  - 검증·합성 잡 실패: `{ stage, jobStatus, result }`
 *    - `stage`: `'validate'`(검증 잡) · `'compose'`(합성 잡)
 *    - `result`: 검증 잡이면 `{ errors, warnings }` — 각 항목은 `code`·`message`·`autoFixable`·
 *      `fixMethod` 키만 남긴다. 합성 잡이거나 잡 결과가 없으면 `null`.
 *  - 최종화 내부 처리 실패: `{ code, reason }` — `code` 는 FINALIZATION_INTERNAL_REASON 의 키,
 *    `reason` 은 그 코드의 고정 문구.
 *
 * 응답은 읽는 시점에 toPublicErrorDetail 로 다시 투영한다(같은 입력을 두 번 투영해도 결과가 같다).
 * 예전 형식(`{ reason }`·`{ jobStatus, result }`)으로 저장된 행도 위 형식으로 읽힌다.
 */
import { WorkerJobStatus } from '@storige/types';

/** 최종화 내부 처리 실패 사유 코드 → 고정 문구. */
export const FINALIZATION_INTERNAL_REASON = {
  TRANSITION_FAILED: '최종화 처리 중 오류가 발생했습니다. 다시 최종화해 주세요.',
  OUTPUT_URL_MISSING: '합성 결과 파일을 찾을 수 없습니다. 다시 최종화해 주세요.',
  OUTPUT_REGISTER_FAILED: '합성 결과 파일을 등록하지 못했습니다. 다시 최종화해 주세요.',
} as const;

export type FinalizationInternalReasonCode = keyof typeof FINALIZATION_INTERNAL_REASON;

export type FinalizationJobStage = 'validate' | 'compose';

/** 검증 오류·경고 항목 — 남기는 키만. */
export type FinalizationIssue = {
  code?: string;
  message?: string;
  autoFixable?: boolean;
  fixMethod?: string;
};

export type FinalizationJobResult = {
  errors: FinalizationIssue[];
  warnings: FinalizationIssue[];
};

export type FinalizationJobFailureDetail = {
  stage: FinalizationJobStage;
  jobStatus: WorkerJobStatus | null;
  result: FinalizationJobResult | null;
};

export type FinalizationInternalFailureDetail = {
  code: FinalizationInternalReasonCode;
  reason: string;
};

export type FinalizationErrorDetail =
  | FinalizationJobFailureDetail
  | FinalizationInternalFailureDetail;

/** 잡 실패 진단을 만들 때 읽는 잡 필드. */
export type SettledJobSnapshot = {
  status: string;
  result?: unknown;
};

/** `FILE_CORRUPTED` 항목의 message 고정 문구(워커 검증의 같은 코드 기본 문구). */
export const FILE_CORRUPTED_MESSAGE = '파일이 손상되었습니다. 다시 업로드해주세요.';

/** 예전 `{ reason }` 문자열의 접두어 → 사유 코드. */
const LEGACY_REASON_PREFIXES: ReadonlyArray<readonly [string, FinalizationInternalReasonCode]> = [
  ['전이 예외', 'TRANSITION_FAILED'],
  ['synthesis output url 부재', 'OUTPUT_URL_MISSING'],
  ['산출물 등록 실패', 'OUTPUT_REGISTER_FAILED'],
];

const JOB_STATUSES: ReadonlySet<string> = new Set<string>(Object.values(WorkerJobStatus));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInternalReasonCode(v: unknown): v is FinalizationInternalReasonCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FINALIZATION_INTERNAL_REASON, v);
}

function isJobStage(v: unknown): v is FinalizationJobStage {
  return v === 'validate' || v === 'compose';
}

function toJobStatus(v: unknown): WorkerJobStatus | null {
  return typeof v === 'string' && JOB_STATUSES.has(v) ? (v as WorkerJobStatus) : null;
}

/** 내부 처리 실패 진단 — 사유 코드와 고정 문구. */
export function internalFailureDetail(
  code: FinalizationInternalReasonCode,
): FinalizationInternalFailureDetail {
  return { code, reason: FINALIZATION_INTERNAL_REASON[code] };
}

function projectIssue(item: Record<string, unknown>): FinalizationIssue {
  const out: FinalizationIssue = {};
  if (typeof item.code === 'string') out.code = item.code;
  if (typeof item.message === 'string') out.message = item.message;
  if (out.code === 'FILE_CORRUPTED') out.message = FILE_CORRUPTED_MESSAGE;
  if (typeof item.autoFixable === 'boolean') out.autoFixable = item.autoFixable;
  if (typeof item.fixMethod === 'string') out.fixMethod = item.fixMethod;
  return out;
}

function projectIssues(list: unknown): FinalizationIssue[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map(projectIssue);
}

/**
 * 검증 잡 결과 → `{ errors, warnings }`. 검증 잡 결과는 `{ result: { errors, warnings, ... } }` 로
 * 한 번 감싸여 저장되므로 감싼 형태와 감싸지 않은 형태를 모두 읽는다. 객체가 아니면 null.
 */
function projectValidationResult(raw: unknown): FinalizationJobResult | null {
  if (!isRecord(raw)) return null;
  const inner = isRecord(raw.result) ? raw.result : raw;
  return {
    errors: projectIssues(inner.errors),
    warnings: projectIssues(inner.warnings),
  };
}

function buildJobFailureDetail(
  stage: FinalizationJobStage,
  jobStatus: unknown,
  result: unknown,
): FinalizationJobFailureDetail {
  return {
    stage,
    jobStatus: toJobStatus(jobStatus),
    result: stage === 'validate' ? projectValidationResult(result) : null,
  };
}

/** 검증·합성 잡 실패 진단. */
export function jobFailureDetail(
  stage: FinalizationJobStage,
  job: SettledJobSnapshot,
): FinalizationJobFailureDetail {
  return buildJobFailureDetail(stage, job.status, job.result ?? null);
}

function legacyReasonCode(reason: string): FinalizationInternalReasonCode {
  for (const [prefix, code] of LEGACY_REASON_PREFIXES) {
    if (reason.startsWith(prefix)) return code;
  }
  return 'TRANSITION_FAILED';
}

/**
 * 저장된 errorDetail → 응답 errorDetail.
 *
 * - `{ code, reason }`(사유 코드): 코드의 고정 문구로 바꾼다.
 * - 예전 `{ reason }`: 접두어로 사유 코드를 정하고(알 수 없으면 TRANSITION_FAILED) 고정 문구로 바꾼다.
 * - `{ stage, jobStatus, result }`: 같은 규칙으로 다시 투영한다.
 * - 예전 `{ jobStatus, result }`: `stage` 를 `legacyStage` 로 채워 투영한다.
 * - 그 밖의 값과 null: null.
 */
export function toPublicErrorDetail(
  stored: unknown,
  legacyStage: FinalizationJobStage = 'validate',
): FinalizationErrorDetail | null {
  if (!isRecord(stored)) return null;
  if (isInternalReasonCode(stored.code)) return internalFailureDetail(stored.code);
  if (isJobStage(stored.stage)) {
    return buildJobFailureDetail(stored.stage, stored.jobStatus, stored.result ?? null);
  }
  if (typeof stored.reason === 'string') {
    return internalFailureDetail(legacyReasonCode(stored.reason));
  }
  if ('jobStatus' in stored) {
    return buildJobFailureDetail(legacyStage, stored.jobStatus, stored.result ?? null);
  }
  return null;
}
