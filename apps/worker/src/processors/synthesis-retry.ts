import { DomainError, ErrorCodes } from '../common/errors';

/**
 * JD-2 (2026-10, Wave 3) — 합성 큐 실패 시도의 재시도 판정(순수 함수).
 *
 * api 가 합성 잡을 attempts 3·exponential 30000(대기 30s → 90s)으로 넣는다.
 * 프로세서 catch 는 이 판정으로 다음 중 하나를 고른다.
 * - retry: 재시도할 수 있는 오류이고 남은 시도가 있음 → 상태 PATCH 없이 throw(Bull 재시도, DB 는 PROCESSING 유지).
 * - fail : 입력 오류이거나 마지막 시도 → FAILED PATCH + job.discard() 후 throw.
 * 시도 정보는 bull 4.x 규칙을 따른다: 처리 중 attemptsMade = 앞서 실패한 시도 수,
 * opts.attempts 미지정 = 1(lib/job.js setDefaultOpts), 재시도 조건 attemptsMade+1 < attempts && !discarded.
 */

export interface AttemptInfo {
  /** 이번 시도 번호(1부터). */
  attempt: number;
  /** 최대 시도 수. 읽을 수 없으면 1. */
  maxAttempts: number;
  /** 이번 시도가 마지막인지. 시도 정보를 읽을 수 없으면 true(최종으로 본다). */
  isFinal: boolean;
  /** attemptsMade·opts.attempts 를 bull 규칙대로 읽었는지. false 면 Bull 이 다시 시도할 수 있다고 본다. */
  reliable: boolean;
}

export interface AttemptSource {
  attemptsMade?: unknown;
  opts?: { attempts?: unknown } | null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function getAttemptInfo(job: AttemptSource | null | undefined): AttemptInfo {
  const madeRaw = job?.attemptsMade;
  const attemptsRaw = job?.opts?.attempts;

  let reliable = true;
  let made = 0;
  if (madeRaw !== undefined && madeRaw !== null) {
    if (isNonNegativeInteger(madeRaw)) made = madeRaw;
    else reliable = false;
  }

  let maxAttempts = 1;
  if (attemptsRaw !== undefined) {
    if (isNonNegativeInteger(attemptsRaw) && attemptsRaw >= 1) maxAttempts = attemptsRaw;
    else reliable = false;
  }

  const attempt = made + 1;
  return {
    attempt,
    maxAttempts,
    isFinal: !reliable || attempt >= maxAttempts,
    reliable,
  };
}

export type SynthesisErrorKind = 'domain' | 'http' | 'other';

export interface SynthesisErrorClass {
  retryable: boolean;
  kind: SynthesisErrorKind;
  /** 로그용 오류 코드(대문자·숫자·밑줄만). 없으면 null. */
  code: string | null;
  httpStatus: number | null;
}

/** 재시도하는 DomainError 코드 — 다운로드·조회 일시 오류, 시스템 산출물 검증, 내부 오류. */
export const SYNTHESIS_RETRYABLE_DOMAIN_CODES: ReadonlySet<string> = new Set<string>([
  ErrorCodes.FILE_DOWNLOAD_FAILED,
  ErrorCodes.SPLIT_VERIFICATION_FAILED,
  ErrorCodes.EMPTY_OUTPUT_FILE,
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.INTERNAL_ERROR,
]);

/** 재시도하지 않는 DomainError 코드(입력 오류) — ErrorCodes 의 나머지 전부. 목록에 없는 코드도 재시도하지 않는다. */
export const SYNTHESIS_NON_RETRYABLE_DOMAIN_CODES: ReadonlySet<string> = new Set<string>(
  Object.values(ErrorCodes).filter((code) => !SYNTHESIS_RETRYABLE_DOMAIN_CODES.has(code)),
);

/** 재시도하는 4xx 상태 코드. 그 밖의 4xx 는 재시도하지 않는다. */
export const RETRYABLE_4XX: ReadonlySet<number> = new Set<number>([408, 425, 429]);

/** HTTP 상태 코드의 재시도 여부: 408·425·429·5xx 는 재시도, 그 밖의 4xx 는 재시도하지 않음. */
export function isRetryableHttpStatus(status: number): boolean {
  if (status >= 400 && status < 500) return RETRYABLE_4XX.has(status);
  return true;
}

const LOG_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function readProp(err: unknown, key: string): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as Record<string, unknown>)[key];
}

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && LOG_CODE_PATTERN.test(value) ? value : null;
}

/** HTTP 응답 상태 코드(axios 오류 형태). job-status.service 의 httpStatusOf 와 같은 방식. */
function httpStatusOf(err: unknown): number | null {
  const response = readProp(err, 'response');
  const status = readProp(response, 'status');
  return typeof status === 'number' ? status : null;
}

function isDomainErrorLike(err: unknown): err is { code: string; detail?: unknown } {
  if (err instanceof DomainError) return true;
  // name 조건을 함께 봐서 Node 시스템 오류의 code(ENOENT 등)를 DomainError 로 보지 않는다.
  return readProp(err, 'name') === 'DomainError' && typeof readProp(err, 'code') === 'string';
}

export function classifySynthesisError(err: unknown): SynthesisErrorClass {
  if (isDomainErrorLike(err)) {
    const detailStatus = readProp(err.detail, 'httpStatus');
    return {
      retryable: SYNTHESIS_RETRYABLE_DOMAIN_CODES.has(err.code),
      kind: 'domain',
      code: safeCode(err.code),
      httpStatus: typeof detailStatus === 'number' ? detailStatus : null,
    };
  }

  const httpStatus = httpStatusOf(err);
  if (httpStatus !== null) {
    return {
      retryable: isRetryableHttpStatus(httpStatus),
      kind: 'http',
      code: safeCode(readProp(err, 'code')),
      httpStatus,
    };
  }

  // 응답 없는 네트워크 오류, fs 오류, qpdf/gs 실패, 파싱 오류, 그 밖의 값은 재시도한다.
  return {
    retryable: true,
    kind: 'other',
    code: safeCode(readProp(err, 'code')),
    httpStatus: null,
  };
}

export type SynthesisFailureAction = 'retry' | 'fail';
export type SynthesisFailureReason = 'retryable' | 'non-retryable' | 'exhausted';

export interface SynthesisFailureDecision extends AttemptInfo, SynthesisErrorClass {
  action: SynthesisFailureAction;
  reason: SynthesisFailureReason;
  /** 남은 시도를 버리는지(로그용). 마지막 시도이고 시도 정보를 읽었으면 false. */
  discard: boolean;
}

const FALLBACK_DECISION: SynthesisFailureDecision = {
  attempt: 1,
  maxAttempts: 1,
  isFinal: true,
  reliable: false,
  retryable: true,
  kind: 'other',
  code: null,
  httpStatus: null,
  action: 'fail',
  reason: 'exhausted',
  discard: true,
};

/** 실패 시도 판정. throw 하지 않는다(내부 예외는 최종 실패로 판정). */
export function decideSynthesisFailure(
  job: AttemptSource | null | undefined,
  err: unknown,
): SynthesisFailureDecision {
  try {
    const attemptInfo = getAttemptInfo(job);
    const errorClass = classifySynthesisError(err);
    const action: SynthesisFailureAction =
      errorClass.retryable && !attemptInfo.isFinal ? 'retry' : 'fail';
    const reason: SynthesisFailureReason = !errorClass.retryable
      ? 'non-retryable'
      : attemptInfo.isFinal
        ? 'exhausted'
        : 'retryable';
    return {
      ...attemptInfo,
      ...errorClass,
      action,
      reason,
      discard: action === 'fail' && (!attemptInfo.isFinal || !attemptInfo.reliable),
    };
  } catch {
    return { ...FALLBACK_DECISION };
  }
}

/**
 * FAILED 를 PATCH 할 때 job.discard() 를 부르는지.
 * 불변식: FAILED PATCH ⇒ discard. 시도 정보를 읽었고 최대 시도가 1인 잡(attempts 미지정)은
 * Bull 이 다시 시도하지 않으므로 부르지 않는다.
 */
export function shouldDiscardOnFail(decision: SynthesisFailureDecision): boolean {
  return decision.action === 'fail' && (decision.maxAttempts > 1 || !decision.reliable);
}

/** [SYNTH_RETRY] 로그를 남기는지 — 최대 시도가 1이고 시도 정보를 읽은 잡은 남기지 않는다. */
export function shouldLogSynthRetry(decision: SynthesisFailureDecision): boolean {
  return decision.maxAttempts > 1 || !decision.reliable;
}

export type SynthRetryOutcome = 'retry' | 'fail' | 'completed';

/** 오류 메시지·URL·경로는 넣지 않는다. */
export function formatSynthRetryLog(args: {
  jobId: string;
  queueJobId: string | number | undefined;
  mode: string;
  decision: SynthesisFailureDecision;
  outcome: SynthRetryOutcome;
}): string {
  const { jobId, queueJobId, mode, decision, outcome } = args;
  const reason = outcome === 'completed' ? 'completed-marker' : decision.reason;
  const discard = outcome === 'fail' && decision.discard ? 'yes' : 'no';
  return (
    `[SYNTH_RETRY] jobId=${jobId} queueJobId=${queueJobId ?? '-'} mode=${mode} ` +
    `attempt=${decision.attempt}/${decision.maxAttempts} action=${outcome} reason=${reason} ` +
    `code=${decision.code ?? '-'} http=${decision.httpStatus ?? '-'} discard=${discard}`
  );
}
