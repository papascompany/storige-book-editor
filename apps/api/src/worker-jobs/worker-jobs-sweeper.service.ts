import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { WorkerJobStatus } from '@storige/types';
import { WorkerJob } from './entities/worker-job.entity';
import { WorkerJobsService } from './worker-jobs.service';

/**
 * WK-4 (2026-06-13) — 고아 잡 스위퍼.
 *
 * 배경: 워커가 상태 업데이트에 최종 실패하거나(API 다운/재배포 등),
 * 워커 프로세스가 잡 처리 중 죽으면 worker_jobs 레코드가 PENDING/PROCESSING
 * 으로 영원히 남는다. 호출자(bookmoa 등)는 폴링/웹훅 어느 쪽으로도 종결
 * 신호를 받지 못한다.
 *
 * 동작: 10분 주기로 "생성 후 2시간 경과 && 아직 PENDING/PROCESSING" 잡을
 * FAILED 로 전환한다. 전환은 WorkerJobsService.updateJobStatus 를 그대로
 * 사용하므로 기존 FAILED 경로(EditSession workerStatus 갱신, synthesis/
 * validation 웹훅 콜백)가 동일하게 재사용된다.
 *
 * 비고: ScheduleModule.forRoot() 는 app.module 에 기존재(@nestjs/schedule).
 */
@Injectable()
export class WorkerJobsSweeperService {
  private readonly logger = new Logger(WorkerJobsSweeperService.name);

  /** 생성 후 이 시간(ms)이 지나도 PENDING/PROCESSING 이면 FAILED 전환 */
  static readonly STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2시간

  /** 1회 스윕 배치 상한 (대량 적체 시 cron 한 사이클 폭주 방지) */
  static readonly SWEEP_BATCH_LIMIT = 200;

  /** 스위퍼가 찍는 세분화 에러 코드 (WK-1 errorCode 컬럼 활용) */
  static readonly SWEEP_ERROR_CODE = 'JOB_TIMEOUT_SWEPT';

  /** 동시 실행 가드 (이전 스윕이 길어지면 다음 사이클 skip) */
  private sweeping = false;

  constructor(
    @InjectRepository(WorkerJob)
    private readonly workerJobRepository: Repository<WorkerJob>,
    private readonly workerJobsService: WorkerJobsService,
  ) {}

  /** 10분 주기 스윕 (cron 진입점) */
  @Cron('*/10 * * * *', { name: 'worker-jobs-stale-sweeper' })
  async handleCron(): Promise<void> {
    await this.sweepStaleJobs();
  }

  /**
   * 생성 2시간 경과 PENDING/PROCESSING 잡을 FAILED 로 전환.
   * @returns 전환된 잡 수
   */
  async sweepStaleJobs(now: Date = new Date()): Promise<number> {
    if (this.sweeping) {
      this.logger.warn('sweepStaleJobs: 이전 스윕 진행 중 — 이번 사이클 skip');
      return 0;
    }
    this.sweeping = true;

    try {
      const threshold = new Date(
        now.getTime() - WorkerJobsSweeperService.STALE_AFTER_MS,
      );

      const staleJobs = await this.workerJobRepository.find({
        where: {
          status: In([WorkerJobStatus.PENDING, WorkerJobStatus.PROCESSING]),
          createdAt: LessThan(threshold),
        },
        order: { createdAt: 'ASC' },
        take: WorkerJobsSweeperService.SWEEP_BATCH_LIMIT,
      });

      if (staleJobs.length === 0) {
        return 0;
      }

      this.logger.warn(
        `sweepStaleJobs: ${staleJobs.length}건 고아 잡 발견 (threshold=${threshold.toISOString()})`,
      );

      let swept = 0;
      for (const job of staleJobs) {
        try {
          // 기존 FAILED 경로 재사용 — 세션 workerStatus 갱신 + 웹훅 콜백 포함.
          await this.workerJobsService.updateJobStatus(job.id, {
            status: WorkerJobStatus.FAILED,
            errorCode: WorkerJobsSweeperService.SWEEP_ERROR_CODE,
            errorMessage:
              `워커 잡이 생성 후 2시간 내 완료되지 않아 스위퍼가 FAILED 처리했습니다 ` +
              `(jobType=${job.jobType}, 직전 상태=${job.status}, 생성=${job.createdAt?.toISOString?.() ?? job.createdAt})`,
            errorDetail: {
              sweptBy: 'worker-jobs-stale-sweeper',
              sweptAt: now.toISOString(),
              previousStatus: job.status,
              createdAt: job.createdAt?.toISOString?.() ?? String(job.createdAt),
              staleAfterMs: WorkerJobsSweeperService.STALE_AFTER_MS,
            },
          });
          swept++;
          this.logger.warn(
            `sweepStaleJobs: job ${job.id} (${job.jobType}, ${job.status}) → FAILED`,
          );
        } catch (error) {
          // 한 잡의 실패가 나머지 스윕을 막지 않도록 개별 격리.
          this.logger.error(
            `sweepStaleJobs: job ${job.id} FAILED 전환 실패(다음 사이클 재시도): ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(`sweepStaleJobs: ${swept}/${staleJobs.length}건 FAILED 전환 완료`);
      return swept;
    } finally {
      this.sweeping = false;
    }
  }
}
