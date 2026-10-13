/**
 * 파트너 잡 응답 형태 — 정해진 키만 싣는다.
 *
 * 컨트롤러가 `PARTNER_JOB_VIEW` 가 켜졌을 때 파트너 잡 라우트(조회·생성) 응답에 쓴다. 꺼져 있으면
 * 이 함수를 거치지 않는다(서비스 반환 객체 그대로).
 *
 * 키(고정, 순서 무관)
 *  - `id`·`jobType`·`status`·`editSessionId`·`sessionId`·`outputFileId`·`outputFileUrl`·`errorCode`·
 *    `createdAt`·`completedAt`: 저장값 그대로(없으면 null).
 *  - `options`: `contentTrim`·`siteWebhook`·`editSessionId` 키만. 셋 다 없으면 null.
 *  - `result`: 검증 잡(VALIDATE)은 저장 형식(`{ result: {...} }` 또는 감싸지 않은 형식)을 유지하고, 본문은
 *    `isValid`·`errors`·`warnings`·`metadata`, 오류·경고 항목은 `code`·`message`·`details`·`autoFixable`·
 *    `fixMethod` 만 남긴다. `FILE_CORRUPTED` 항목은 `message` 가 고정 문구이고 `details` 가 없다.
 *    그 밖의 잡 유형은 저장값 그대로다.
 *  - `errorMessage`: 저장값이 null 이거나 빈 문자열이면 그대로. 그 밖에는 다음 순서로 정한다.
 *    ① 검증 잡이고 남긴 오류 항목에 문구가 있으면 그 문구를 `'; '` 로 잇는다(워커 검증 문구와 같은 형식).
 *    ② `errorCode` 가 있고 `INTERNAL_ERROR` 가 아니면 저장값.
 *    ③ 그 밖에는 잡 유형별 고정 문구(합성은 합성 실패 기본 문구와 같다).
 *  - `errorDetail`: 문자열·수·불리언·null 값의 키만 남긴다. 남는 키가 없으면 null.
 *
 * 순수 함수 — 입력 객체를 바꾸지 않는다. 같은 출력을 다시 넣어도 결과가 같다.
 */
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { FILE_CORRUPTED_MESSAGE } from '../books/finalization-error-detail';

export type PartnerJobPrimitive = string | number | boolean | null;

/** `options` 에 남기는 키. */
export const PARTNER_JOB_OPTION_KEYS = ['contentTrim', 'siteWebhook', 'editSessionId'] as const;

export type PartnerJobOptionKey = (typeof PARTNER_JOB_OPTION_KEYS)[number];

export type PartnerJobOptions = Partial<Record<PartnerJobOptionKey, unknown>>;

/** 응답 키 목록(고정). */
export const PARTNER_JOB_VIEW_KEYS = [
  'id',
  'jobType',
  'status',
  'editSessionId',
  'sessionId',
  'outputFileId',
  'outputFileUrl',
  'errorCode',
  'createdAt',
  'completedAt',
  'options',
  'result',
  'errorMessage',
  'errorDetail',
] as const;

export interface PartnerJobView {
  id: string;
  jobType: WorkerJobType;
  status: WorkerJobStatus;
  editSessionId: string | null;
  sessionId: string | null;
  outputFileId: string | null;
  outputFileUrl: string | null;
  errorCode: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
  options: PartnerJobOptions | null;
  result: unknown;
  errorMessage: string | null;
  errorDetail: Record<string, PartnerJobPrimitive> | null;
}

/** 투영에 읽는 잡 필드 — WorkerJob 엔티티가 그대로 들어간다. */
export interface PartnerJobSource {
  id: string;
  jobType: WorkerJobType;
  status: WorkerJobStatus;
  editSessionId?: string | null;
  sessionId?: string | null;
  outputFileId?: string | null;
  outputFileUrl?: string | null;
  errorCode?: string | null;
  createdAt?: Date | null;
  completedAt?: Date | null;
  options?: unknown;
  result?: unknown;
  errorMessage?: string | null;
  errorDetail?: unknown;
}

/** 검증 결과 본문에 남기는 키. */
const VALIDATION_BODY_KEYS = ['isValid', 'errors', 'warnings', 'metadata'] as const;

/** 검증 오류·경고 항목에 남기는 키. */
const VALIDATION_ISSUE_KEYS = ['code', 'message', 'details', 'autoFixable', 'fixMethod'] as const;

/** 잡 유형별 실패 고정 문구(③). 합성은 워커 합성 실패 기본 문구와 같다. */
export const PARTNER_JOB_FAILURE_MESSAGE: Readonly<Record<WorkerJobType, string>> = {
  [WorkerJobType.VALIDATE]: '검증 처리 중 오류가 발생했습니다',
  [WorkerJobType.CONVERT]: '변환 처리 중 오류가 발생했습니다',
  [WorkerJobType.SYNTHESIZE]: '합성 처리 중 오류가 발생했습니다',
  [WorkerJobType.RENDER_PAGES]: '페이지 렌더링 중 오류가 발생했습니다',
  [WorkerJobType.CUTOUT]: '배경 제거 처리 중 오류가 발생했습니다',
};

/** 알 수 없는 잡 유형의 실패 고정 문구. */
export const PARTNER_JOB_FAILURE_MESSAGE_DEFAULT = '처리 중 오류가 발생했습니다';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function isPrimitive(v: unknown): v is PartnerJobPrimitive {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function projectIssue(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of VALIDATION_ISSUE_KEYS) {
    if (hasOwn(item, key)) out[key] = item[key];
  }
  if (out.code === 'FILE_CORRUPTED') {
    out.message = FILE_CORRUPTED_MESSAGE;
    delete out.details;
  }
  return out;
}

function projectIssues(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map(projectIssue);
}

function projectValidationBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of VALIDATION_BODY_KEYS) {
    if (!hasOwn(body, key)) continue;
    out[key] = key === 'errors' || key === 'warnings' ? projectIssues(body[key]) : body[key];
  }
  return out;
}

/**
 * 검증 잡 결과 — 워커는 `{ result: {...} }` 로 감싸 보고하고 그대로 저장되므로 감싼 형식을 유지한다.
 * 감싸지 않은 형식도 그 형식대로 읽는다. 객체가 아니면 null.
 */
function projectValidationResult(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.result)) return { result: projectValidationBody(raw.result) };
  return projectValidationBody(raw);
}

function validationErrorMessages(projected: Record<string, unknown> | null): string[] {
  if (projected === null) return [];
  const body = isRecord(projected.result) ? projected.result : projected;
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const messages: string[] = [];
  for (const item of errors) {
    if (isRecord(item) && typeof item.message === 'string' && item.message !== '') {
      messages.push(item.message);
    }
  }
  return messages;
}

function projectOptions(raw: unknown): PartnerJobOptions | null {
  if (!isRecord(raw)) return null;
  const out: PartnerJobOptions = {};
  let kept = 0;
  for (const key of PARTNER_JOB_OPTION_KEYS) {
    if (hasOwn(raw, key)) {
      out[key] = raw[key];
      kept++;
    }
  }
  return kept > 0 ? out : null;
}

function projectErrorDetail(raw: unknown): Record<string, PartnerJobPrimitive> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, PartnerJobPrimitive> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (isPrimitive(value)) {
      out[key] = value;
      kept++;
    }
  }
  return kept > 0 ? out : null;
}

function failureMessageFor(jobType: unknown): string {
  return typeof jobType === 'string' &&
    Object.prototype.hasOwnProperty.call(PARTNER_JOB_FAILURE_MESSAGE, jobType)
    ? PARTNER_JOB_FAILURE_MESSAGE[jobType as WorkerJobType]
    : PARTNER_JOB_FAILURE_MESSAGE_DEFAULT;
}

function projectErrorMessage(
  job: PartnerJobSource,
  projectedValidation: Record<string, unknown> | null,
): string | null {
  const raw = job.errorMessage;
  if (raw === null || raw === undefined) return null;
  if (raw === '') return raw;
  if (job.jobType === WorkerJobType.VALIDATE) {
    const messages = validationErrorMessages(projectedValidation);
    if (messages.length > 0) return messages.join('; ');
  }
  const code = job.errorCode;
  if (typeof code === 'string' && code !== '' && code !== 'INTERNAL_ERROR') return raw;
  return failureMessageFor(job.jobType);
}

/** 잡 → 파트너 잡 응답 형태. */
export function toPartnerJobView(job: PartnerJobSource): PartnerJobView {
  const isValidation = job.jobType === WorkerJobType.VALIDATE;
  const projectedValidation = isValidation ? projectValidationResult(job.result) : null;
  return {
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    editSessionId: job.editSessionId ?? null,
    sessionId: job.sessionId ?? null,
    outputFileId: job.outputFileId ?? null,
    outputFileUrl: job.outputFileUrl ?? null,
    errorCode: job.errorCode ?? null,
    createdAt: job.createdAt ?? null,
    completedAt: job.completedAt ?? null,
    options: projectOptions(job.options),
    result: isValidation ? projectedValidation : (job.result ?? null),
    errorMessage: projectErrorMessage(job, projectedValidation),
    errorDetail: projectErrorDetail(job.errorDetail),
  };
}
