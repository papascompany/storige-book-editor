import { WorkerJobStatus } from '@storige/types';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { WorkerJob } from './entities/worker-job.entity';
import type { UpdateJobStatusDto } from './dto/worker-job.dto';

/**
 * 잡 상태 보고(updateJobStatus)의 전이 판정 — 순수 함수(DB·로그 없음).
 *
 *  - 진행 중(PENDING·PROCESSING) 잡만 요청대로 갱신한다(apply).
 *  - 종결(COMPLETED·FIXABLE·FAILED, 그 밖의 알 수 없는 값 포함) 잡은 바뀌지 않는다.
 *    · 같은 종결 상태를 다시 받으면 repeat(DB 쓰기 없음, 처음 종결 값 유지).
 *    · 시스템 실패(FAILED + JOB_STALLED·JOB_TIMEOUT_SWEPT) 잡에 COMPLETED 가 오면 promote
 *      (워커·내부 호출만 — allowPromote).
 *    · 그 밖은 blocked.
 */

export const IN_FLIGHT_JOB_STATUSES = [WorkerJobStatus.PENDING, WorkerJobStatus.PROCESSING] as const;

export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set<string>([
  WorkerJobStatus.COMPLETED,
  WorkerJobStatus.FIXABLE,
  WorkerJobStatus.FAILED,
]);

/**
 * 시스템 실패 errorCode — 늦은 COMPLETED 로 승격할 수 있는 FAILED 의 코드.
 * 같은 값: apps/worker/src/processors/stalled-job-failure.ts(JOB_STALLED) ·
 * WorkerJobsSweeperService.SWEEP_ERROR_CODE(JOB_TIMEOUT_SWEPT).
 */
export const SYSTEM_FAILURE_ERROR_CODES = ['JOB_STALLED', 'JOB_TIMEOUT_SWEPT'] as const;
export type SystemFailureErrorCode = (typeof SYSTEM_FAILURE_ERROR_CODES)[number];

export type JobStatusTransition =
  | { kind: 'apply' }
  | { kind: 'promote'; fromErrorCode: SystemFailureErrorCode }
  | { kind: 'repeat' }
  | { kind: 'blocked' };

const KNOWN_JOB_STATUSES: ReadonlySet<string> = new Set<string>(Object.values(WorkerJobStatus));

function isInFlightStatus(status: string): boolean {
  return (IN_FLIGHT_JOB_STATUSES as readonly string[]).includes(status);
}

function asSystemFailureErrorCode(code: string | null): SystemFailureErrorCode | null {
  return (SYSTEM_FAILURE_ERROR_CODES as readonly string[]).includes(code ?? '')
    ? (code as SystemFailureErrorCode)
    : null;
}

/**
 * @param current  DB 에서 읽은 잡의 상태·errorCode
 * @param requested 요청 status(없으면 undefined)
 * @param opts.allowPromote 시스템 실패 승격을 허용할 호출자인가(caller 없음 또는 worker 역할)
 */
export function planJobStatusTransition(
  current: { status: string; errorCode: string | null },
  requested: string | undefined,
  opts: { allowPromote: boolean },
): JobStatusTransition {
  if (isInFlightStatus(current.status)) return { kind: 'apply' };
  if (requested === undefined) return { kind: 'blocked' };
  if (requested === current.status) return { kind: 'repeat' };
  if (
    opts.allowPromote &&
    current.status === WorkerJobStatus.FAILED &&
    requested === WorkerJobStatus.COMPLETED
  ) {
    const code = asSystemFailureErrorCode(current.errorCode);
    if (code) return { kind: 'promote', fromErrorCode: code };
  }
  return { kind: 'blocked' };
}

/**
 * 조건부 UPDATE 에 쓸 패치. 값이 undefined 가 아닌 엔티티 컬럼만 담는다.
 *  - 요청 status 가 종결이면 completedAt = now.
 *  - clearError(승격)면 errorCode·errorMessage·errorDetail 을 null 로 비운다.
 */
export function buildJobStatusPatch(
  dto: UpdateJobStatusDto,
  now: Date,
  opts: { clearError: boolean },
): QueryDeepPartialEntity<WorkerJob> {
  const patch: QueryDeepPartialEntity<WorkerJob> = {};
  if (dto.status !== undefined) patch.status = dto.status as WorkerJobStatus;
  if (dto.outputFileId !== undefined) patch.outputFileId = dto.outputFileId;
  if (dto.outputFileUrl !== undefined) patch.outputFileUrl = dto.outputFileUrl;
  if (dto.result !== undefined) patch.result = dto.result;
  if (dto.errorMessage !== undefined) patch.errorMessage = dto.errorMessage;
  if (dto.errorCode !== undefined) patch.errorCode = dto.errorCode;
  if (dto.errorDetail !== undefined) patch.errorDetail = dto.errorDetail;
  if (dto.status !== undefined && TERMINAL_JOB_STATUSES.has(dto.status)) {
    patch.completedAt = now;
  }
  if (opts.clearError) {
    patch.errorCode = null;
    patch.errorMessage = null;
    patch.errorDetail = null;
  }
  return patch;
}

/** 로그용 상태 표기 — 알려진 상태값은 그대로, 없으면 '-', 그 밖은 'other'(원문 미기록). */
export function describeJobStatusForLog(status: string | undefined | null): string {
  if (status === undefined || status === null) return '-';
  return KNOWN_JOB_STATUSES.has(status) ? status : 'other';
}
