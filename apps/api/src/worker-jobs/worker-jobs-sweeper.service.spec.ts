/**
 * WK-4 회귀 테스트 (2026-06-13) — 고아 잡 스위퍼.
 *
 * 생성 2시간 경과 PENDING/PROCESSING 잡을 기존 FAILED 경로
 * (WorkerJobsService.updateJobStatus — 세션 갱신/웹훅 재사용)로 전환하는지 고정.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, LessThan } from 'typeorm';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsSweeperService } from './worker-jobs-sweeper.service';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJob } from './entities/worker-job.entity';

describe('WorkerJobsSweeperService (WK-4)', () => {
  let sweeper: WorkerJobsSweeperService;
  let repoFind: jest.Mock;
  let updateJobStatus: jest.Mock;

  const staleJob = (id: string, status: WorkerJobStatus, createdAt: Date): Partial<WorkerJob> => ({
    id,
    status,
    jobType: WorkerJobType.SYNTHESIZE,
    createdAt,
  });

  beforeEach(async () => {
    repoFind = jest.fn().mockResolvedValue([]);
    updateJobStatus = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerJobsSweeperService,
        { provide: getRepositoryToken(WorkerJob), useValue: { find: repoFind } },
        { provide: WorkerJobsService, useValue: { updateJobStatus } },
      ],
    }).compile();

    sweeper = module.get(WorkerJobsSweeperService);
  });

  it('생성 2시간 경과 PENDING/PROCESSING 잡을 조회해야 한다 (배치 상한 포함)', async () => {
    const now = new Date('2026-06-13T12:00:00.000Z');
    await sweeper.sweepStaleJobs(now);

    expect(repoFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: In([WorkerJobStatus.PENDING, WorkerJobStatus.PROCESSING]),
          createdAt: LessThan(new Date('2026-06-13T10:00:00.000Z')), // now - 2h
        },
        take: WorkerJobsSweeperService.SWEEP_BATCH_LIMIT,
      }),
    );
  });

  it('고아 잡이 없으면 아무 전환도 하지 않아야 한다', async () => {
    const swept = await sweeper.sweepStaleJobs();
    expect(swept).toBe(0);
    expect(updateJobStatus).not.toHaveBeenCalled();
  });

  it('고아 잡을 FAILED 로 전환하며 기존 updateJobStatus 경로(웹훅 재사용)를 사용해야 한다', async () => {
    const now = new Date('2026-06-13T12:00:00.000Z');
    const created = new Date('2026-06-13T09:00:00.000Z'); // 3시간 전
    repoFind.mockResolvedValue([
      staleJob('job-a', WorkerJobStatus.PENDING, created),
      staleJob('job-b', WorkerJobStatus.PROCESSING, created),
    ]);

    const swept = await sweeper.sweepStaleJobs(now);

    expect(swept).toBe(2);
    expect(updateJobStatus).toHaveBeenCalledTimes(2);
    expect(updateJobStatus).toHaveBeenCalledWith(
      'job-a',
      expect.objectContaining({
        status: WorkerJobStatus.FAILED,
        errorCode: WorkerJobsSweeperService.SWEEP_ERROR_CODE,
        errorMessage: expect.stringContaining('2시간'),
        errorDetail: expect.objectContaining({
          sweptBy: 'worker-jobs-stale-sweeper',
          previousStatus: WorkerJobStatus.PENDING,
        }),
      }),
    );
    expect(updateJobStatus).toHaveBeenCalledWith(
      'job-b',
      expect.objectContaining({
        status: WorkerJobStatus.FAILED,
        errorDetail: expect.objectContaining({
          previousStatus: WorkerJobStatus.PROCESSING,
        }),
      }),
    );
  });

  it('한 잡의 전환 실패가 나머지 스윕을 막지 않아야 한다', async () => {
    const created = new Date(Date.now() - 3 * 60 * 60 * 1000);
    repoFind.mockResolvedValue([
      staleJob('job-fail', WorkerJobStatus.PENDING, created),
      staleJob('job-ok', WorkerJobStatus.PROCESSING, created),
    ]);
    updateJobStatus
      .mockRejectedValueOnce(new Error('DB lock timeout'))
      .mockResolvedValueOnce({});

    const swept = await sweeper.sweepStaleJobs();

    expect(swept).toBe(1);
    expect(updateJobStatus).toHaveBeenCalledTimes(2);
  });

  it('이전 스윕 진행 중이면 동시 실행을 skip 해야 한다', async () => {
    const created = new Date(Date.now() - 3 * 60 * 60 * 1000);
    let resolveFind: (jobs: any[]) => void;
    repoFind.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFind = resolve)),
    );

    const first = sweeper.sweepStaleJobs(); // find 에서 대기 중 (sweeping=true)
    const second = await sweeper.sweepStaleJobs(); // 즉시 skip
    expect(second).toBe(0);

    resolveFind!([staleJob('job-a', WorkerJobStatus.PENDING, created)]);
    const firstResult = await first;
    expect(firstResult).toBe(1);
  });

  it('cron 진입점(handleCron)이 스윕을 호출해야 한다', async () => {
    const spy = jest.spyOn(sweeper, 'sweepStaleJobs').mockResolvedValue(0);
    await sweeper.handleCron();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('정책 상수: 2시간 임계 + JOB_TIMEOUT_SWEPT 에러 코드', () => {
    expect(WorkerJobsSweeperService.STALE_AFTER_MS).toBe(2 * 60 * 60 * 1000);
    expect(WorkerJobsSweeperService.SWEEP_ERROR_CODE).toBe('JOB_TIMEOUT_SWEPT');
  });
});
