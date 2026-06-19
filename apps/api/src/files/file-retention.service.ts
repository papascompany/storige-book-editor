import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';
import { StorageConfigService } from '../settings/storage-config.service';

/**
 * FileRetentionService — 보존정책 2단계 cron (2026-06-19, 데이터손실 안전 재설계).
 *
 * **2단계 + 48h 복구창**:
 *  1) sweepExpired (@Cron 17분): expires_at < now 만료 파일 → softDelete(deleted_at 세팅).
 *     DB행·R2객체 유지. 즉시 다운로드/조회에서 404. 복구 가능.
 *  2) purgeSoftDeleted (@Cron 47분): deleted_at < now - GRACE(기본 48h) → hardDelete
 *     (R2 객체 + DB 행 영구삭제). 복구창 만료분만.
 *
 * **불변식**: 대상 선정은 불변(expires_at NULL=영구보관, bookmoa 보호). 즉시영구→2단계로 '방식'만 변경.
 * dryRun(admin/env) 존중 — 첫 배포는 dryRun=ON 권장(후보 로그만 확인).
 */
@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);
  private readonly batchLimit: number;
  private readonly graceHours: number;
  /** 재진입 가드 — 한 배치가 tick 간격(1h)을 넘기면 다음 사이클 skip(자기 오버랩 방지). */
  private sweeping = false;
  private purging = false;

  constructor(
    private readonly filesService: FilesService,
    private readonly config: ConfigService,
    private readonly storageConfig: StorageConfigService,
  ) {
    this.batchLimit = Number(this.config.get<string>('FILE_RETENTION_BATCH', '200')) || 200;
    // 복구창(시간). 기본 48h. 0 이하면 48 로 강제(즉시 purge 사고 방지).
    const g = Number(this.config.get<string>('FILE_PURGE_GRACE_HOURS', '48'));
    this.graceHours = Number.isFinite(g) && g > 0 ? g : 48;
  }

  /**
   * 1단계 — 만료 파일 soft-delete. 매시 17분.
   * enabled/dryRun 은 admin 설정(StorageConfigService) 런타임 조회.
   * 만료가 대량일 수 있으므로 배치(batchLimit)로 제한, 다음 tick 에서 잔여 처리.
   */
  @Cron('17 * * * *')
  async sweepExpired(): Promise<void> {
    if (this.sweeping) {
      this.logger.warn('[retention:sweep] 이전 실행 진행 중 — 이번 사이클 skip');
      return;
    }
    this.sweeping = true;
    try {
      const retention = (await this.storageConfig.getEffectiveConfig()).retention;
      if (!retention.enabled) {
        this.logger.debug('[retention:sweep] 비활성(admin 설정) — 스킵');
        return;
      }
      const dryRun = retention.dryRun;

      let expired;
      try {
        expired = await this.filesService.findExpired(this.batchLimit);
      } catch (err) {
        this.logger.error(`[retention:sweep] findExpired 실패: ${(err as Error).message}`);
        return;
      }
      if (!expired.length) return;

      this.logger.log(
        `[retention:sweep] 만료 파일 ${expired.length}건 soft-delete 시작 (dryRun=${dryRun}, batch=${this.batchLimit})`,
      );

      let ok = 0;
      let failed = 0;
      for (const file of expired) {
        if (dryRun) {
          this.logger.log(
            `[retention:sweep][dry-run] softDelete 대상 ${file.id} backend=${file.storageBackend} expires_at=${file.expiresAt?.toISOString?.() ?? file.expiresAt}`,
          );
          ok++;
          continue;
        }
        try {
          await this.filesService.softDelete(file.id);
          ok++;
        } catch (err) {
          failed++;
          this.logger.warn(`[retention:sweep] ${file.id} softDelete 실패: ${(err as Error).message}`);
        }
      }
      this.logger.log(`[retention:sweep] 완료 — soft-delete ${ok} / 실패 ${failed}`);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * 2단계 — 복구창(GRACE) 만료된 soft-deleted 파일 영구삭제. 매시 47분.
   * sweep 과 30분 어긋나게 배치 → 같은 tick 충돌·DB 경합 회피.
   */
  @Cron('47 * * * *')
  async purgeSoftDeleted(): Promise<void> {
    if (this.purging) {
      this.logger.warn('[retention:purge] 이전 실행 진행 중 — 이번 사이클 skip');
      return;
    }
    this.purging = true;
    try {
      const retention = (await this.storageConfig.getEffectiveConfig()).retention;
      if (!retention.enabled) {
        this.logger.debug('[retention:purge] 비활성(admin 설정) — 스킵');
        return;
      }
      const dryRun = retention.dryRun;
      const cutoff = new Date(Date.now() - this.graceHours * 60 * 60 * 1000);

      let stale;
      try {
        stale = await this.filesService.findSoftDeletedOlderThan(cutoff, this.batchLimit);
      } catch (err) {
        this.logger.error(`[retention:purge] findSoftDeletedOlderThan 실패: ${(err as Error).message}`);
        return;
      }
      if (!stale.length) return;

      this.logger.log(
        `[retention:purge] 복구창(${this.graceHours}h) 만료 ${stale.length}건 영구삭제 시작 (dryRun=${dryRun}, cutoff=${cutoff.toISOString()})`,
      );

      let ok = 0;
      let failed = 0;
      for (const file of stale) {
        if (dryRun) {
          this.logger.log(
            `[retention:purge][dry-run] hardDelete 대상 ${file.id} backend=${file.storageBackend} deleted_at=${file.deletedAt?.toISOString?.() ?? file.deletedAt}`,
          );
          ok++;
          continue;
        }
        try {
          await this.filesService.hardDeleteEntity(file);
          ok++;
        } catch (err) {
          failed++;
          this.logger.warn(`[retention:purge] ${file.id} hardDelete 실패: ${(err as Error).message}`);
        }
      }
      this.logger.log(`[retention:purge] 완료 — 영구삭제 ${ok} / 실패 ${failed}`);
    } finally {
      this.purging = false;
    }
  }
}
