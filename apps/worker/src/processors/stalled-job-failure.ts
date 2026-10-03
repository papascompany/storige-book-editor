import type { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import type {
  JobStatusPayload,
  JobStatusService,
} from '../services/job-status.service';
import { captureJobException } from '../sentry/sentry.init';

/**
 * JD-4 (2026-10) — stalled 한도 초과 실패 기록.
 *
 * Bull 이 stalled 한도(maxStalledCount)를 넘긴 잡을 실패시키면, 큐 failed 리스너가
 * 이 헬퍼로 DB 잡을 FAILED(errorCode JOB_STALLED)로 기록한다.
 * - 프로세서가 던진 일반 오류(프로세서 catch 가 FAILED 를 PATCH 하거나 합성 재시도로 넘김)는 처리하지 않는다.
 * - stalled 한도 초과는 Bull 이 attempts 와 무관하게 종결시키므로(재시도 없음) 남은 시도와 관계없이 기록한다.
 *   Bull 이 이미 failed 로 옮긴 잡이라 job.discard() 는 필요 없다.
 * - 먼저 상태를 조회해 PENDING/PROCESSING 일 때만 기록한다(종결된 잡은 그대로 둔다).
 * - 합성 완료 마커가 있으면 FAILED 대신 캐시된 COMPLETED 를 1회 재보고한다.
 * - 리스너는 이름 필터 없이 큐마다 1개다(pdf-conversion 공유 큐는 ConversionProcessor 한 곳).
 *   job.name 은 routes 로 걸러 큐에 실린 잡 종류별 jobType 을 정한다.
 * 이 함수는 throw/reject 하지 않는다.
 */

/** bull 4.x stalled 한도 초과 사유 문자열(lib/queue.js moveUnlockedJobsToWait, Lua moveStalledJobsToWait). */
export const STALLED_LIMIT_FAILED_REASON = 'job stalled more than allowable limit';
export const JOB_STALLED_ERROR_CODE = 'JOB_STALLED';
export const JOB_STALLED_ERROR_MESSAGE =
  '워커 처리 중 작업이 반복해서 중단되어 실패로 기록했습니다. 필요하면 같은 요청으로 새 작업을 만들어 주세요.';

/** 상태 조회 결과 중 아직 처리 중으로 보는 값(이 경우에만 기록한다). */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

export interface StalledFailureRoute {
  jobType: string;
}

export interface StalledFailureDeps {
  queueName: string;
  /** job.name → jobType. 여기에 없는 잡 이름은 처리하지 않는다. */
  routes: Readonly<Record<string, StalledFailureRoute>>;
  jobStatusService: Pick<
    JobStatusService,
    'fetchJobStatusWithRetry' | 'updateJobStatusWithRetry'
  >;
  logger: Pick<Logger, 'log' | 'warn' | 'error'>;
  /**
   * 완료 산출 근거(합성 완료 마커)의 캐시된 COMPLETED 페이로드. 없으면 null.
   * 상태가 PENDING/PROCESSING 이면 FAILED 대신 이 페이로드를 1회 재보고한다.
   */
  loadCompletedPayload?: (domainJobId: string) => Promise<JobStatusPayload | null>;
  now?: () => Date;
}

export type StalledFailureOutcome =
  | 'ignored'
  | 'invalidJob'
  | 'notFound'
  | 'alreadyTerminal'
  | 'statusUnavailable'
  | 'patched'
  | 'patchFailed'
  | 'completedReported'
  | 'completedReportFailed'
  | 'error';

type StalledJob = Pick<Job<unknown>, 'id' | 'name' | 'data' | 'failedReason'>;

function messageOf(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as { message?: unknown }).message;
}

/** bull stalled 한도 초과로 발화한 failed 이벤트인지(오류 메시지 또는 job.failedReason 일치). */
export function isStalledLimitFailure(
  job: Pick<Job<unknown>, 'failedReason'> | null | undefined,
  err: unknown,
): boolean {
  return (
    messageOf(err) === STALLED_LIMIT_FAILED_REASON ||
    job?.failedReason === STALLED_LIMIT_FAILED_REASON
  );
}

function domainJobIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const jobId = (data as { jobId?: unknown }).jobId;
  return typeof jobId === 'string' && jobId.length > 0 ? jobId : null;
}

/**
 * stalled 한도 초과 실패를 DB 잡 상태에 반영한다. 결과는 outcome 으로 돌려주고,
 * 처리한 잡마다 `[JOB_STALLED] … outcome=…` 로그 1줄을 남긴다. 절대 reject 하지 않는다.
 */
export async function reportStalledLimitFailure(
  job: StalledJob | null | undefined,
  err: unknown,
  deps: StalledFailureDeps,
): Promise<StalledFailureOutcome> {
  const { queueName, routes, jobStatusService, logger } = deps;
  try {
    if (!isStalledLimitFailure(job, err)) return 'ignored';

    if (!job) {
      // removeOnFail:true 등으로 잡 해시가 없으면 bull 이 null job 으로 발화한다.
      logger.warn(
        `[JOB_STALLED] queue=${queueName} outcome=invalidJob (job payload unavailable)`,
      );
      return 'invalidJob';
    }

    const route = Object.prototype.hasOwnProperty.call(routes, job.name)
      ? routes[job.name]
      : undefined;
    if (!route) return 'ignored';

    const queueJobId = String(job.id);
    const jobId = domainJobIdOf(job.data);
    if (!jobId) {
      logger.warn(
        `[JOB_STALLED] queue=${queueName} name=${job.name} queueJobId=${queueJobId} outcome=invalidJob (jobId missing)`,
      );
      return 'invalidJob';
    }

    const context = { jobType: route.jobType, queueName };
    captureJobException(new Error(STALLED_LIMIT_FAILED_REASON), { jobId, ...context });

    const finish = (
      outcome: StalledFailureOutcome,
      previousStatus: string,
      level: 'log' | 'warn',
    ): StalledFailureOutcome => {
      logger[level](
        `[JOB_STALLED] queue=${queueName} name=${job.name} jobId=${jobId} ` +
          `queueJobId=${queueJobId} outcome=${outcome} previousStatus=${previousStatus}`,
      );
      return outcome;
    };

    const completedPayload = deps.loadCompletedPayload
      ? await deps.loadCompletedPayload(jobId)
      : null;

    const lookup = await jobStatusService.fetchJobStatusWithRetry(jobId);
    if (!lookup.ok) {
      return lookup.reason === 'notFound'
        ? finish('notFound', '-', 'log')
        : finish('statusUnavailable', '-', 'warn');
    }
    const previousStatus = lookup.status;
    if (!IN_FLIGHT_STATUSES.has(previousStatus)) {
      return finish('alreadyTerminal', previousStatus, 'log');
    }

    if (completedPayload) {
      // 합성 멱등 가드와 같은 재보고(수신측 upsert). FAILED 는 보내지 않는다.
      const ok = await jobStatusService.updateJobStatusWithRetry(
        jobId,
        completedPayload,
        context,
      );
      return ok
        ? finish('completedReported', previousStatus, 'log')
        : finish('completedReportFailed', previousStatus, 'warn');
    }

    const now = deps.now ?? (() => new Date());
    const payload: JobStatusPayload = {
      status: 'FAILED',
      errorCode: JOB_STALLED_ERROR_CODE,
      errorMessage: JOB_STALLED_ERROR_MESSAGE,
      errorDetail: {
        failedBy: 'worker-stalled-listener',
        queueName,
        jobName: job.name,
        queueJobId,
        reason: STALLED_LIMIT_FAILED_REASON,
        previousStatus,
        detectedAt: now().toISOString(),
      },
      queueJobId: job.id,
    };
    const ok = await jobStatusService.updateJobStatusWithRetry(jobId, payload, context);
    return ok
      ? finish('patched', previousStatus, 'log')
      : finish('patchFailed', previousStatus, 'warn');
  } catch (e: unknown) {
    logger.error(
      `[JOB_STALLED] queue=${queueName} outcome=error: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 'error';
  }
}
