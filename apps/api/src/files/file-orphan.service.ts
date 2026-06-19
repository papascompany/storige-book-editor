import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';
import { StorageConfigService } from '../settings/storage-config.service';
import { FileEntity } from './entities/file.entity';

/**
 * FileOrphanService — P1 고아 파일 누적방어 cron (2026-06-19).
 *
 * 미참조(주문/세션/워커잡 무연결) 업로드 잔재를 보수적으로 강등.
 *  - 후보: FilesService.findOrphanCandidates (다중 NOT EXISTS AND, grace 경과).
 *  - 처리: softDeleteWithExpiry → expires_at=now + deleted_at=now.
 *          → 기존 FileRetentionService.purge(@Cron 47분, 48h grace)가 hardDelete.
 *  - cron: 매시 :07 (sweep:17 / purge:47 과 다른 분 → DB 경합 회피).
 *  - dryRun: storageConfig.retention.dryRun OR env FILE_ORPHAN_DRY_RUN=1. **첫 배포 ON 권장**.
 *  - enabled: storageConfig.retention.enabled (보존정책 OFF면 고아정리도 OFF) AND env FILE_ORPHAN_ENABLED.
 *  - 재진입 가드 + 배치 limit(FILE_RETENTION_BATCH 공유).
 *
 * ⚠️ 데이터손실 방지: 즉시 hardDelete 안 함. soft+expiry 로 48h 복구창 부여(restore API).
 */
@Injectable()
export class FileOrphanService {
  private readonly logger = new Logger(FileOrphanService.name);
  private readonly batchLimit: number;
  private readonly pendingGraceHours: number;
  private readonly readyGraceDays: number;
  private readonly envEnabled: boolean;
  private readonly envDryRun: boolean;
  private running = false;

  constructor(
    private readonly filesService: FilesService,
    private readonly config: ConfigService,
    private readonly storageConfig: StorageConfigService,
  ) {
    this.batchLimit =
      Number(this.config.get<string>('FILE_RETENTION_BATCH', '200')) || 200;
    // grace 하한 강제(즉시강등 사고 방지): pending/failed 최소 24h, ready 최소 1d.
    const ph = Number(this.config.get<string>('FILE_ORPHAN_GRACE_PENDING_HOURS', '24'));
    this.pendingGraceHours = Number.isFinite(ph) && ph >= 1 ? ph : 24;
    // ready 고아 grace 기본 30일(보수적) — 외부 통합의 '업로드→주문' 지연이 길 수 있어
    // 정상 파일이 주문 연결 전 강등되지 않게 넉넉히. env 로 하향 가능. 하한 1일.
    const rd = Number(this.config.get<string>('FILE_ORPHAN_GRACE_READY_DAYS', '30'));
    this.readyGraceDays = Number.isFinite(rd) && rd >= 1 ? rd : 30;
    this.envEnabled = this.config.get<string>('FILE_ORPHAN_ENABLED', 'true') !== 'false';
    // ⚠️ 첫 배포 안전: env 미설정이면 dryRun ON 으로 기본. 검증 후 명시적으로 '0' 설정.
    this.envDryRun = this.config.get<string>('FILE_ORPHAN_DRY_RUN', '1') !== '0';
  }

  /** 매시 :07 — 고아 후보 강등(soft+expiry). 잔여는 다음 tick. */
  @Cron('7 * * * *')
  async sweepOrphans(): Promise<void> {
    if (!this.envEnabled) return;
    if (this.running) {
      this.logger.warn('[orphan] 이전 실행 진행 중 — 이번 사이클 skip');
      return;
    }
    this.running = true;
    try {
      const retention = (await this.storageConfig.getEffectiveConfig()).retention;
      if (!retention.enabled) {
        this.logger.debug('[orphan] 보존정책 비활성(admin) — 스킵');
        return;
      }
      // env dryRun(첫 배포 ON) OR admin dryRun — 어느 쪽이든 ON 이면 dry.
      const dryRun = this.envDryRun || retention.dryRun;

      let candidates: FileEntity[];
      try {
        candidates = await this.filesService.findOrphanCandidates(
          this.pendingGraceHours,
          this.readyGraceDays,
          this.batchLimit,
        );
      } catch (err) {
        this.logger.error(`[orphan] findOrphanCandidates 실패: ${(err as Error).message}`);
        return;
      }
      if (!candidates.length) return;

      this.logger.log(
        `[orphan] 고아 후보 ${candidates.length}건 강등 시작 ` +
          `(dryRun=${dryRun}, batch=${this.batchLimit}, ` +
          `graceP=${this.pendingGraceHours}h, graceR=${this.readyGraceDays}d)`,
      );

      let ok = 0,
        failed = 0,
        skipped = 0;
      for (const f of candidates) {
        if (dryRun) {
          this.logger.log(
            `[orphan][dry-run] 강등대상 ${f.id} status=${f.status} ` +
              `backend=${f.storageBackend} created_at=${f.createdAt?.toISOString?.() ?? f.createdAt} ` +
              `member=${f.memberSeqno ?? 'null'} key=${f.storageKey ?? 'null'}`,
          );
          ok++;
          continue;
        }
        try {
          const did = await this.filesService.softDeleteWithExpiry(f.id);
          if (did) ok++;
          else skipped++;
        } catch (err) {
          failed++;
          this.logger.warn(`[orphan] ${f.id} 강등 실패: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `[orphan] 완료 — 강등 ${ok} / skip ${skipped} / 실패 ${failed} ` +
          `(48h 후 purge 가 영구삭제, restore API 로 복구가능)`,
      );
    } finally {
      this.running = false;
    }
  }
}
