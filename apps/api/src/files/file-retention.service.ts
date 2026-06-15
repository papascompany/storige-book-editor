import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service';
import { StorageConfigService } from '../settings/storage-config.service';

/**
 * FileRetentionService — 보존정책 cron (2026-06-13, R2 보강 트랙).
 *
 * 동작: `files.expires_at < now` 인 파일을 하드삭제(백엔드 객체 + DB 레코드).
 * - **보수적 설계**: expires_at 이 명시된 파일만 삭제. 기본 null=영구보관 → bookmoa 등 운영 파일 절대 미삭제.
 * - 테넌트(100p_books 등)가 주문 이행 완료 후 `PATCH /files/:id/expiry` 또는 업로드 시 만료 예약 →
 *   이 cron 이 만료분을 정리 → Storige(및 과거 Supabase) 누적이 '활성 주문분'으로 한정.
 * - 재인쇄/CS 는 테넌트가 원본(PageDoc 등)에서 재생성 → 재업로드.
 *
 * thumbnail-cleanup.service.ts 의 @Cron 패턴 재사용. DRY-RUN 지원(FILE_RETENTION_DRY_RUN=1).
 */
@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);
  private readonly batchLimit: number;

  constructor(
    private readonly filesService: FilesService,
    private readonly config: ConfigService,
    private readonly storageConfig: StorageConfigService,
  ) {
    this.batchLimit = Number(this.config.get<string>('FILE_RETENTION_BATCH', '200')) || 200;
  }

  /**
   * 매시 17분(분산) 실행. 만료 파일 배치 정리.
   * enabled/dryRun 은 admin 설정(StorageConfigService) 에서 런타임 조회.
   * 만료가 대량일 수 있으므로 배치(batchLimit)로 제한, 다음 tick 에서 잔여 처리.
   */
  @Cron('17 * * * *')
  async sweepExpired(): Promise<void> {
    const retention = (await this.storageConfig.getEffectiveConfig()).retention;
    if (!retention.enabled) {
      this.logger.debug('[retention] 비활성(admin 설정) — 스킵');
      return;
    }
    const dryRun = retention.dryRun;

    let expired;
    try {
      expired = await this.filesService.findExpired(this.batchLimit);
    } catch (err) {
      this.logger.error(`findExpired 실패: ${(err as Error).message}`);
      return;
    }
    if (!expired.length) return;

    this.logger.log(
      `[retention] 만료 파일 ${expired.length}건 정리 시작 (dryRun=${dryRun}, batch=${this.batchLimit})`,
    );

    let ok = 0;
    let failed = 0;
    for (const file of expired) {
      if (dryRun) {
        this.logger.log(
          `[retention][dry-run] 삭제 대상 ${file.id} backend=${file.storageBackend} expires_at=${file.expiresAt?.toISOString?.() ?? file.expiresAt}`,
        );
        ok++;
        continue;
      }
      try {
        await this.filesService.hardDelete(file.id);
        ok++;
      } catch (err) {
        failed++;
        this.logger.warn(`[retention] ${file.id} 삭제 실패: ${(err as Error).message}`);
      }
    }
    this.logger.log(`[retention] 완료 — 삭제 ${ok} / 실패 ${failed}`);
  }
}
