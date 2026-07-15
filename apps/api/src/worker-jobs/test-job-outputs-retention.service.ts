import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJob } from './entities/worker-job.entity';

/**
 * TestJobOutputsRetentionService — S2-5 (2026-07-16) test env 잡 산출물 24h retention.
 *
 * 대상: options.isTest=true 합성(SYNTHESIZE) 잡의 outputs/{jobId}/ 디렉토리
 * (TEST 워터마크 더미 PDF + .synthesis-complete.json 멱등 마커).
 *
 * **구현 방식 선택 근거** (로드맵 §6 Stage 2 작업 1 "retention 24h 강제"):
 *  - 잡 산출물은 워커가 outputs/{jobId}/ 에 **직접 write** — 파일(File) 엔티티를
 *    경유하지 않아 file-retention.service 의 expires_at/softDelete 머신을 재사용할
 *    수 없다(실물 확인: FileRetentionService 는 files 테이블 전용).
 *  - 워커에는 @nestjs/schedule 자체가 없다(실물 확인: apps/worker package.json).
 *    API 는 동일 ./storage 볼륨을 rw 마운트(docker-compose)하고 worker_jobs 를
 *    정본(DB)으로 조회할 수 있으며, 기존 sweeper cron 선례 2종
 *    (WorkerJobsSweeperService, FileRetentionService)이 이미 API 에 있다.
 *  → API 측 cron 신설이 최소·정합 선택.
 *
 * 안전 설계:
 *  - 선정 게이트 3중: jobType=SYNTHESIZE + options LIKE isTest 마커(SQL 프리필터)
 *    + 코드에서 options.isTest === true 재확인(LIKE 오탐 방어). live 잡은 isTest
 *    키 자체가 없어 구조적으로 선정 불가(오삭제 불가능).
 *  - jobId 는 UUID 형식 검증 후에만 rm — 경로 탈출 원천 차단.
 *  - 삭제 후 options.testOutputsPurgedAt 마커 기록 → 재스캔 제외(무한 재처리 방지).
 *    terminal(>24h) 잡의 options 는 다른 기록자가 없어 병렬 갱신 경합 실질 0.
 *  - 재진입 가드 + 배치 상한(기존 sweeper 패턴 준용).
 *
 * ⚠️ 발화 경로 부재(Stage 3 게이트): 현 Stage 2 에서 isTest 잡을 만들 수 있는
 * 인증 경로가 없어 이 cron 의 대상 집합은 항상 공집합(무해) — 실발화는 Stage 3.
 */
@Injectable()
export class TestJobOutputsRetentionService {
  private readonly logger = new Logger(TestJobOutputsRetentionService.name);

  /** test 잡 산출물 보존 시간 — 24h 강제(로드맵 §6) */
  static readonly RETENTION_MS = 24 * 60 * 60 * 1000;

  /** 1회 스윕 배치 상한 */
  static readonly SWEEP_BATCH_LIMIT = 100;

  /** worker_jobs.id 형식(uuidv4) — rm 전 경로 안전 검증 */
  private static readonly JOB_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** 재진입 가드 */
  private sweeping = false;

  /** 워커 outputsPath(/app/storage/outputs)와 동일 볼륨의 API 측 루트 */
  private readonly storageBase: string;

  constructor(
    @InjectRepository(WorkerJob)
    private readonly workerJobRepository: Repository<WorkerJob>,
    private readonly config: ConfigService,
  ) {
    // files.service.ts:157 선례 — STORAGE_PATH 기본 /app/storage (compose 매핑 동일)
    this.storageBase = this.config.get<string>('STORAGE_PATH', '/app/storage');
  }

  /**
   * 매시 37분 스윕 — 기존 cron 과 어긋나게 배치
   * (file-retention 17/47분, worker-jobs stale sweeper 10분 주기).
   */
  @Cron('37 * * * *', { name: 'test-job-outputs-retention' })
  async handleCron(): Promise<void> {
    await this.sweepTestJobOutputs();
  }

  /**
   * 24h 경과한 isTest 잡의 outputs/{jobId} 삭제 + purge 마커 기록.
   * @returns 삭제 처리된 잡 수
   */
  async sweepTestJobOutputs(now: Date = new Date()): Promise<number> {
    if (this.sweeping) {
      this.logger.warn('[test-retention] 이전 스윕 진행 중 — 이번 사이클 skip');
      return 0;
    }
    this.sweeping = true;

    try {
      const cutoff = new Date(
        now.getTime() - TestJobOutputsRetentionService.RETENTION_MS,
      );

      let candidates: WorkerJob[];
      try {
        candidates = await this.workerJobRepository
          .createQueryBuilder('job')
          .where('job.jobType = :jobType', {
            jobType: WorkerJobType.SYNTHESIZE,
          })
          .andWhere('job.status IN (:...statuses)', {
            statuses: [
              WorkerJobStatus.COMPLETED,
              WorkerJobStatus.FIXABLE,
              WorkerJobStatus.FAILED,
            ],
          })
          // json 컬럼(MariaDB LONGTEXT) 텍스트 프리필터 — JSON.stringify 산출은
          // 공백 없는 `"isTest":true` 고정. 최종 판정은 아래 코드 재확인이 정본.
          .andWhere('job.options LIKE :testMarker', {
            testMarker: '%"isTest":true%',
          })
          .andWhere('job.options NOT LIKE :purgedMarker', {
            purgedMarker: '%"testOutputsPurgedAt"%',
          })
          // 종결 시각 기준 24h — terminal 상태는 completedAt 이 세팅되지만(updateJobStatus)
          // 방어적으로 createdAt 폴백(COALESCE)
          .andWhere('COALESCE(job.completedAt, job.createdAt) < :cutoff', {
            cutoff,
          })
          .orderBy('job.createdAt', 'ASC')
          .take(TestJobOutputsRetentionService.SWEEP_BATCH_LIMIT)
          .getMany();
      } catch (err) {
        this.logger.error(
          `[test-retention] 후보 조회 실패: ${(err as Error).message}`,
        );
        return 0;
      }

      if (candidates.length === 0) return 0;

      this.logger.log(
        `[test-retention] test 잡 산출물 ${candidates.length}건 정리 시작 (cutoff=${cutoff.toISOString()})`,
      );

      let purged = 0;
      for (const job of candidates) {
        try {
          // LIKE 프리필터 오탐 방어 — isTest 정본 재확인 (live 잡 오삭제 구조적 차단)
          if (job.options?.isTest !== true || job.options?.testOutputsPurgedAt) {
            continue;
          }
          // 경로 안전 — jobId 가 uuid 형식일 때만 rm (탈출/오염 원천 차단)
          if (!TestJobOutputsRetentionService.JOB_ID_PATTERN.test(job.id)) {
            this.logger.warn(
              `[test-retention] job ${job.id} — 비정형 id, 산출물 삭제 skip(마커만 기록)`,
            );
          } else {
            const outputDir = path.join(this.storageBase, 'outputs', job.id);
            await fs.rm(outputDir, { recursive: true, force: true });
          }

          // purge 마커 — 재스캔 제외. terminal 잡 options 는 병렬 기록자 없음(주석 상단).
          await this.workerJobRepository.update(job.id, {
            options: {
              ...job.options,
              testOutputsPurgedAt: now.toISOString(),
            },
          });

          purged++;
          this.logger.log(
            `[test-retention] job ${job.id} outputs 정리 완료 (완료시각=${job.completedAt?.toISOString?.() ?? job.completedAt})`,
          );
        } catch (err) {
          // 개별 실패 격리 — 다음 사이클 재시도(마커 미기록이므로 재선정됨)
          this.logger.error(
            `[test-retention] job ${job.id} 정리 실패(다음 사이클 재시도): ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `[test-retention] 완료 — ${purged}/${candidates.length}건 정리`,
      );
      return purged;
    } finally {
      this.sweeping = false;
    }
  }
}
