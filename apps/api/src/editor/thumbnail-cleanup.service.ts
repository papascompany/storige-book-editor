import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EditSessionVersion } from './entities/edit-session-version.entity';

/**
 * BB-Phase 3 follow-up — 시점 썸네일 orphan cleanup cron.
 *
 * 두 갈래로 동작:
 * 1. **Deletion-time** (`unlinkThumbnailIfReferenced`): editor.service.trimVersions가
 *    LRU 초과 version을 DB에서 삭제할 때 호출되어 thumbnail 파일도 즉시 unlink.
 * 2. **Nightly safety net** (`runOrphanCleanup`): 매일 02:30 KST에 storage/thumbnails/
 *    디렉토리를 스캔, EditSessionVersion.thumbnailUrl이 참조하지 않는 파일 중 24시간 이상
 *    된 것을 일괄 삭제. 1번이 실패하거나 외부 DB 조작으로 생긴 orphan을 회수.
 *
 * 안전 장치
 * - 24시간 grace window: 업로드 직후 DB 커밋 전 race condition으로 잠시 orphan으로
 *   보일 수 있는 파일은 보호.
 * - dry-run 환경 변수: `THUMBNAIL_CLEANUP_DRY_RUN=1`이면 삭제 대신 로그만.
 * - storage 디렉토리 미존재 시 silent skip (데이터 0건 운영 환경 대응).
 */
@Injectable()
export class ThumbnailCleanupService {
  private readonly logger = new Logger(ThumbnailCleanupService.name);
  private readonly storagePath: string;
  private readonly dryRun: boolean;
  /** 업로드-DB 커밋 race window 보호 (24시간) */
  private static readonly GRACE_WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(
    private configService: ConfigService,
    @InjectRepository(EditSessionVersion)
    private editSessionVersionRepository: Repository<EditSessionVersion>,
  ) {
    const configuredPath = this.configService.get<string>('STORAGE_PATH', './storage');
    this.storagePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
    this.dryRun = this.configService.get<string>('THUMBNAIL_CLEANUP_DRY_RUN') === '1';
  }

  /**
   * 단건 unlink — DB에서 EditSessionVersion이 삭제될 때 호출.
   * URL이 thumbnails 카테고리가 아니면 silent ignore (안전).
   */
  async unlinkThumbnailIfReferenced(thumbnailUrl: string | null | undefined): Promise<void> {
    if (!thumbnailUrl) return;
    // 우리 카테고리 URL 패턴만 처리 (외부 절대 URL은 건드리지 않음)
    if (!thumbnailUrl.startsWith('/storage/files/thumbnails/')) return;
    const relativePath = thumbnailUrl.replace('/storage/files/', '');
    const absPath = path.join(this.storagePath, relativePath);
    try {
      if (this.dryRun) {
        this.logger.log(`[dry-run] would unlink ${absPath}`);
        return;
      }
      await fs.unlink(absPath);
    } catch (err: any) {
      // ENOENT는 이미 삭제됐거나 파일 시스템에 없음 — 무시
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`unlinkThumbnailIfReferenced ${absPath} 실패: ${err?.message ?? err}`);
      }
    }
  }

  /**
   * 매일 02:30 KST — orphan thumbnail 일괄 삭제.
   * Cron 표현식: `30 2 * * *` (매일 02:30)
   * 운영 시간대(KST) 기준이며 서버 TZ가 UTC면 17:30 UTC에 동작.
   * (필요 시 cron 표현식을 운영 TZ에 맞게 조정)
   */
  @Cron('30 2 * * *', { name: 'thumbnail-orphan-cleanup' })
  async runOrphanCleanup(): Promise<{ scanned: number; deleted: number; protected: number }> {
    const dir = path.join(this.storagePath, 'thumbnails');
    const result = { scanned: 0, deleted: 0, protected: 0 };

    // 디렉토리 미존재 시 silent skip
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.logger.log('thumbnails directory does not exist yet — skipping cleanup');
        return result;
      }
      throw err;
    }
    result.scanned = entries.length;

    if (entries.length === 0) {
      this.logger.log('thumbnails directory is empty — nothing to clean');
      return result;
    }

    // DB에서 참조 중인 thumbnailUrl 수집 (NULL 제외)
    const rows = await this.editSessionVersionRepository
      .createQueryBuilder('v')
      .select('v.thumbnailUrl', 'thumbnailUrl')
      .where('v.thumbnailUrl IS NOT NULL')
      .getRawMany<{ thumbnailUrl: string }>();
    const referencedFilenames = new Set<string>();
    for (const row of rows) {
      const url = row.thumbnailUrl;
      if (!url) continue;
      const filename = path.basename(url);
      referencedFilenames.add(filename);
    }

    const now = Date.now();
    for (const entry of entries) {
      // 참조되면 보호
      if (referencedFilenames.has(entry)) continue;
      // 24시간 grace window 보호
      const filePath = path.join(dir, entry);
      try {
        const stat = await fs.stat(filePath);
        const ageMs = now - stat.mtimeMs;
        if (ageMs < ThumbnailCleanupService.GRACE_WINDOW_MS) {
          result.protected += 1;
          continue;
        }
        if (this.dryRun) {
          this.logger.log(`[dry-run] would unlink orphan ${filePath} (age: ${Math.round(ageMs / 3_600_000)}h)`);
          result.deleted += 1;
          continue;
        }
        await fs.unlink(filePath);
        result.deleted += 1;
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.logger.warn(`failed to inspect/unlink ${filePath}: ${err?.message ?? err}`);
        }
      }
    }

    this.logger.log(
      `orphan cleanup done — scanned=${result.scanned} deleted=${result.deleted} protected=${result.protected}` +
        (this.dryRun ? ' (dry-run)' : ''),
    );
    return result;
  }
}
