import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkerJobType } from '@storige/types';
import { WorkerJob } from './entities/worker-job.entity';

/**
 * CutoutOutputsRetentionService — 컷아웃 산출물 보존기간 정리 (2026-08-05, S-P2A-B 샤드2).
 *
 * **왜 이 슬라이스에 함께 넣는가**: 컷아웃 생성 라우트는 `@Public`(무인증)이고 워커가
 * `/app/storage/cutouts/<jobId>/` 에 PNG 를 직접 write 한다. 정리 주체가 없으면
 * **무인증 디스크 소진 경로**가 열린 채로 배포된다(프로덕션 디스크는 이미 85% 사용 실측).
 * "기존 content-pdf-guides 도 정리가 없다"는 것은 완화 근거가 아니라 두 번째 사고 지점이다.
 *
 * 구현 방식은 TestJobOutputsRetentionService(S2-5) 선례를 그대로 따른다:
 *  - 워커에는 @nestjs/schedule 이 없고, API 가 동일 ./storage 볼륨을 rw 마운트한다.
 *  - 산출물은 files 테이블을 경유하지 않으므로 FileRetentionService 를 재사용할 수 없다.
 *
 * 안전 설계:
 *  - jobType=CUTOUT 인 잡만 선정 → 다른 잡 산출물은 구조적으로 선정 불가.
 *  - jobId 는 UUID 형식 검증 후에만 rm — 경로 탈출 원천 차단.
 *  - 삭제 후 options.cutoutOutputsPurgedAt 마커 기록 → 재스캔 제외(무한 재처리 방지).
 *  - 재진입 가드 + 배치 상한.
 *
 * ⚠️ 결과 URL 은 `worker_jobs.result.cutoutUrl` 에 남지만 파일은 사라진다 — 편집기가
 *    이미 캔버스에 넣은 이미지는 저장된 canvasData 의 src 로 남으므로, 보존기간은
 *    "편집 중 재사용 창"으로 보고 넉넉히 잡는다(기본 7일).
 */
@Injectable()
export class CutoutOutputsRetentionService {
  private readonly logger = new Logger(CutoutOutputsRetentionService.name);

  /** 컷아웃 산출물 보존 기간(기본 7일) — env CUTOUT_RETENTION_DAYS 로 조정 */
  static readonly DEFAULT_RETENTION_DAYS = 7;

  /** 1회 스윕 배치 상한 */
  static readonly SWEEP_BATCH_LIMIT = 200;

  /** worker_jobs.id 형식(uuidv4) — rm 전 경로 안전 검증 */
  private static readonly JOB_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** 재진입 가드 */
  private sweeping = false;

  private readonly storageBase: string;
  private readonly retentionMs: number;

  constructor(
    @InjectRepository(WorkerJob)
    private readonly workerJobRepository: Repository<WorkerJob>,
    private readonly config: ConfigService,
  ) {
    this.storageBase = this.config.get<string>('STORAGE_PATH', '/app/storage');
    const days =
      Number(this.config.get<string>('CUTOUT_RETENTION_DAYS')) ||
      CutoutOutputsRetentionService.DEFAULT_RETENTION_DAYS;
    this.retentionMs = days * 24 * 60 * 60 * 1000;
  }

  /** 매시 53분 — 기존 cron(17/47분 file-retention, 37분 test-retention, 10분 sweeper)과 어긋나게 배치 */
  @Cron('53 * * * *', { name: 'cutout-outputs-retention' })
  async handleCron(): Promise<void> {
    await this.sweepCutoutOutputs();
  }

  /**
   * 보존기간 경과한 CUTOUT 잡의 `cutouts/<jobId>` 삭제 + purge 마커 기록.
   * @returns 삭제 처리된 잡 수
   */
  async sweepCutoutOutputs(now: Date = new Date()): Promise<number> {
    if (this.sweeping) {
      this.logger.warn('[cutout-retention] 이전 스윕 진행 중 — 이번 사이클 skip');
      return 0;
    }
    this.sweeping = true;

    try {
      const cutoff = new Date(now.getTime() - this.retentionMs);

      let candidates: WorkerJob[];
      try {
        candidates = await this.workerJobRepository
          .createQueryBuilder('job')
          .where('job.jobType = :jobType', { jobType: WorkerJobType.CUTOUT })
          .andWhere(
            '(job.options IS NULL OR job.options NOT LIKE :purgedMarker)',
            { purgedMarker: '%"cutoutOutputsPurgedAt"%' },
          )
          // 종결 시각 기준 — terminal 은 completedAt 이 세팅되지만 방어적으로 createdAt 폴백
          .andWhere('COALESCE(job.completedAt, job.createdAt) < :cutoff', { cutoff })
          .orderBy('job.createdAt', 'ASC')
          .take(CutoutOutputsRetentionService.SWEEP_BATCH_LIMIT)
          .getMany();
      } catch (err) {
        this.logger.error(
          `[cutout-retention] 후보 조회 실패: ${(err as Error).message}`,
        );
        return 0;
      }

      if (candidates.length === 0) return 0;

      this.logger.log(
        `[cutout-retention] 컷아웃 산출물 ${candidates.length}건 정리 시작 (cutoff=${cutoff.toISOString()})`,
      );

      let purged = 0;
      for (const job of candidates) {
        try {
          if (!CutoutOutputsRetentionService.JOB_ID_PATTERN.test(job.id)) {
            this.logger.warn(
              `[cutout-retention] job ${job.id} — 비정형 id, 산출물 삭제 skip(마커만 기록)`,
            );
          } else {
            const outputDir = path.join(this.storageBase, 'cutouts', job.id);
            await fs.rm(outputDir, { recursive: true, force: true });
          }

          await this.workerJobRepository.update(job.id, {
            options: {
              ...(job.options ?? {}),
              cutoutOutputsPurgedAt: now.toISOString(),
            },
          });
          purged += 1;
        } catch (err) {
          // 개별 실패는 다음 사이클에 재시도된다(마커 미기록 = 후보 유지).
          this.logger.error(
            `[cutout-retention] job ${job.id} 정리 실패: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(`[cutout-retention] ${purged}/${candidates.length}건 정리 완료`);
      return purged;
    } finally {
      this.sweeping = false;
    }
  }
}
