/**
 * 잡 상태 전이 판정(planJobStatusTransition)·상태 패치(buildJobStatusPatch) — 순수 함수 표.
 * 시스템 실패 코드 JOB_STALLED 의 워커 쪽 정의: apps/worker/src/processors/stalled-job-failure.ts.
 */
import { WorkerJobStatus } from '@storige/types';
import {
  SYSTEM_FAILURE_ERROR_CODES,
  TERMINAL_JOB_STATUSES,
  buildJobStatusPatch,
  describeJobStatusForLog,
  planJobStatusTransition,
} from './job-status-transition';
import { WorkerJobsSweeperService } from './worker-jobs-sweeper.service';
import type { UpdateJobStatusDto } from './dto/worker-job.dto';

const { PENDING, PROCESSING, COMPLETED, FIXABLE, FAILED } = WorkerJobStatus;
const worker = { allowPromote: true };

describe('planJobStatusTransition', () => {
  it.each([
    [PENDING, null, PROCESSING],
    [PENDING, null, COMPLETED],
    [PROCESSING, null, COMPLETED],
    [PROCESSING, null, FAILED],
    [PROCESSING, null, undefined],
    [PROCESSING, null, PROCESSING],
  ])('진행 중 %s(errorCode=%s) → %s 요청은 apply', (status, errorCode, requested) => {
    expect(planJobStatusTransition({ status, errorCode }, requested, worker)).toEqual({ kind: 'apply' });
  });

  it.each([
    [COMPLETED, null],
    [FIXABLE, null],
    [FAILED, 'PAGE_COUNT_MISMATCH'],
    [FAILED, 'JOB_STALLED'],
  ])('종결 %s(errorCode=%s) 에 같은 상태 → repeat', (status, errorCode) => {
    expect(planJobStatusTransition({ status, errorCode }, status, worker)).toEqual({ kind: 'repeat' });
  });

  it.each(['JOB_STALLED', 'JOB_TIMEOUT_SWEPT'] as const)(
    'FAILED(%s) → COMPLETED 는 promote',
    (code) => {
      expect(planJobStatusTransition({ status: FAILED, errorCode: code }, COMPLETED, worker)).toEqual({
        kind: 'promote',
        fromErrorCode: code,
      });
    },
  );

  it('승격을 허용하지 않는 호출자(테넌트 키)면 FAILED(JOB_STALLED) → COMPLETED 는 blocked', () => {
    expect(
      planJobStatusTransition({ status: FAILED, errorCode: 'JOB_STALLED' }, COMPLETED, { allowPromote: false }),
    ).toEqual({ kind: 'blocked' });
  });

  it.each([
    [FAILED, 'JOB_STALLED', FIXABLE],
    [FAILED, 'JOB_STALLED', PROCESSING],
    [FAILED, 'PAGE_COUNT_MISMATCH', COMPLETED],
    [FAILED, null, COMPLETED],
    [COMPLETED, null, PROCESSING],
    [COMPLETED, null, FAILED],
    [COMPLETED, null, undefined],
    [FIXABLE, null, COMPLETED],
    ['WEIRD', null, PROCESSING],
    ['WEIRD', null, COMPLETED],
  ])('종결 %s(errorCode=%s) → %s 요청은 blocked', (status, errorCode, requested) => {
    expect(planJobStatusTransition({ status, errorCode }, requested, worker)).toEqual({ kind: 'blocked' });
  });
});

describe('buildJobStatusPatch', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');

  it('값이 있는 엔티티 컬럼만 담고, 종결 상태면 completedAt = now', () => {
    const dto: UpdateJobStatusDto = {
      status: COMPLETED,
      outputFileUrl: '/storage/outputs/a.pdf',
      result: { pages: 4 },
      queueJobId: 12,
      outputFiles: [{ type: 'cover', url: '/storage/outputs/c.pdf' }],
    } as UpdateJobStatusDto;
    expect(buildJobStatusPatch(dto, now, { clearError: false })).toEqual({
      status: COMPLETED,
      outputFileUrl: '/storage/outputs/a.pdf',
      result: { pages: 4 },
      completedAt: now,
    });
  });

  it('PROCESSING 이면 completedAt 없음', () => {
    expect(buildJobStatusPatch({ status: PROCESSING }, now, { clearError: false })).toEqual({ status: PROCESSING });
  });

  it('오류 필드는 그대로 담는다', () => {
    const patch = buildJobStatusPatch(
      { status: FAILED, errorCode: 'X', errorMessage: 'm', errorDetail: { a: 1 } },
      now,
      { clearError: false },
    );
    expect(patch).toEqual({ status: FAILED, errorCode: 'X', errorMessage: 'm', errorDetail: { a: 1 }, completedAt: now });
  });

  it('clearError 면 errorCode·errorMessage·errorDetail 을 null 로 비운다', () => {
    expect(buildJobStatusPatch({ status: COMPLETED, errorMessage: 'late' }, now, { clearError: true })).toEqual({
      status: COMPLETED,
      completedAt: now,
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
    });
  });

  it('빈 DTO 는 빈 패치', () => {
    expect(buildJobStatusPatch({}, now, { clearError: false })).toEqual({});
  });
});

describe('상수·로그 표기', () => {
  it('시스템 실패 코드는 스위퍼 코드와 JOB_STALLED 를 포함한다', () => {
    expect(SYSTEM_FAILURE_ERROR_CODES).toContain(WorkerJobsSweeperService.SWEEP_ERROR_CODE);
    expect(SYSTEM_FAILURE_ERROR_CODES).toContain('JOB_STALLED');
  });

  it('종결 상태 집합은 COMPLETED·FIXABLE·FAILED', () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual([COMPLETED, FAILED, FIXABLE].sort());
  });

  it('로그 표기: 알려진 값은 그대로, 없으면 -, 그 밖은 other', () => {
    expect(describeJobStatusForLog(COMPLETED)).toBe(COMPLETED);
    expect(describeJobStatusForLog(undefined)).toBe('-');
    expect(describeJobStatusForLog('X\nY')).toBe('other');
  });
});
