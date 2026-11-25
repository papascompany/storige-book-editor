import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
import { FileEntity } from '../files/entities/file.entity';
import { FilesService } from '../files/files.service';

/** 1회 처리 세션 수 — 남은 건은 다음 시각에 이어서 처리한다 */
export const STAFF_PURGE_BATCH = 50;

type IdRow = Record<string, unknown>;

function ids(rows: IdRow[], keys: string[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'string' && v.length > 0) out.add(v);
    }
  }
  return Array.from(out);
}

export interface StaffPurgeSessionResult {
  sessionId: string;
  purged: boolean;
  jobs: number;
  versions: number;
  files: number;
  sharedFilesKept: number;
}

/**
 * 관리자 삭제 영구 삭제 (2026-11-25).
 *
 * 대상은 관리자가 편집데이터관리에서 지운 세션 중 purge_after(삭제 + 48h)가 지난 것뿐이다.
 * 보관 중인 세션이나 고객이 지운 세션(purge_after NULL)은 건드리지 않는다 — 자동 보존기간 삭제가 아니다.
 *
 * 세션 1건마다:
 *  1) 그 세션의 워커 잡을 찾고, 세션·잡이 가리키는 파일 id 를 모은다.
 *  2) 다른 세션(삭제분 포함)·다른 잡·책 자산이 함께 쓰는 파일은 남긴다.
 *  3) 트랜잭션: 잡 → 버전 → 세션 행 삭제. 세션 삭제 직전에 조건(삭제 상태·기한 경과)을 다시 확인해
 *     그사이 복구된 세션은 건너뛴다.
 *  4) 커밋 뒤 그 세션만 쓰던 파일의 저장소 객체(R2/로컬)와 files 행을 지운다(FilesService.hardDeleteEntity).
 */
@Injectable()
export class StaffDeletePurgeService {
  private readonly logger = new Logger(StaffDeletePurgeService.name);
  /** 재진입 가드 — 한 배치가 1시간을 넘기면 다음 사이클은 건너뛴다 */
  private running = false;

  constructor(
    @InjectRepository(EditSessionEntity)
    private readonly sessionRepository: Repository<EditSessionEntity>,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly filesService: FilesService,
  ) {}

  @Cron('23 * * * *')
  async purgeExpired(): Promise<void> {
    if (this.running) {
      this.logger.warn('[staff-purge] 이전 실행 진행 중 — 이번 사이클 skip');
      return;
    }
    this.running = true;
    try {
      const due = await this.findDue(new Date(), STAFF_PURGE_BATCH);
      if (due.length === 0) return;
      this.logger.log(`[staff-purge] 복구 기한이 지난 관리자 삭제 세션 ${due.length}건 영구 삭제 시작`);
      let purged = 0;
      let failed = 0;
      for (const id of due) {
        try {
          const r = await this.purgeSession(id);
          if (r.purged) {
            purged++;
            this.logger.log(
              `[staff-purge] session=${id} 잡 ${r.jobs} · 버전 ${r.versions} · 파일 ${r.files} 삭제(공유 파일 ${r.sharedFilesKept} 유지)`,
            );
          }
        } catch (err) {
          failed++;
          this.logger.error(`[staff-purge] session=${id} 실패: ${(err as Error).message}`);
        }
      }
      this.logger.log(`[staff-purge] 완료 — 영구 삭제 ${purged} / 실패 ${failed}`);
    } catch (err) {
      this.logger.error(`[staff-purge] 대상 조회 실패: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** purge_after 가 지난 관리자 삭제 세션 id (오래된 순) */
  async findDue(now: Date, limit: number): Promise<string[]> {
    const rows: IdRow[] = await this.sessionRepository.query(
      'SELECT id FROM file_edit_sessions WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= ? ORDER BY purge_after ASC LIMIT ?',
      [now, limit],
    );
    return ids(rows, ['id']);
  }

  async purgeSession(sessionId: string): Promise<StaffPurgeSessionResult> {
    const result: StaffPurgeSessionResult = {
      sessionId,
      purged: false,
      jobs: 0,
      versions: 0,
      files: 0,
      sharedFilesKept: 0,
    };

    const exclusiveFileIds = await this.sessionRepository.manager.transaction(async (em) => {
      const sessionRows: IdRow[] = await em.query(
        'SELECT id, cover_file_id, content_file_id, content_pdf_file_id FROM file_edit_sessions WHERE id = ? AND deleted_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= ? FOR UPDATE',
        [sessionId, new Date()],
      );
      if (sessionRows.length === 0) return null; // 복구됐거나 이미 지워짐

      const jobRows: IdRow[] = await em.query(
        'SELECT id, file_id, output_file_id, pdf_file_id FROM worker_jobs WHERE edit_session_id = ? OR session_id = ?',
        [sessionId, sessionId],
      );
      const jobIds = ids(jobRows, ['id']);
      const candidates = Array.from(
        new Set([
          ...ids(sessionRows, ['cover_file_id', 'content_file_id', 'content_pdf_file_id']),
          ...ids(jobRows, ['file_id', 'output_file_id', 'pdf_file_id']),
        ]),
      );
      const shared = await this.sharedFileIds(em, sessionId, jobIds, candidates);

      if (jobIds.length > 0) {
        const r = await em.query(`DELETE FROM worker_jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`, jobIds);
        result.jobs = affected(r);
      }
      const v = await em.query('DELETE FROM file_edit_session_versions WHERE session_id = ?', [sessionId]);
      result.versions = affected(v);
      await em.query('DELETE FROM file_edit_sessions WHERE id = ?', [sessionId]);
      result.purged = true;
      result.sharedFilesKept = shared.size;
      return candidates.filter((id) => !shared.has(id));
    });

    if (!exclusiveFileIds) return result;

    for (const fileId of exclusiveFileIds) {
      const file = await this.fileRepository.findOne({ where: { id: fileId }, withDeleted: true });
      if (!file) continue;
      await this.filesService.hardDeleteEntity(file);
      result.files++;
    }
    return result;
  }

  /** 후보 파일 중 이 세션·잡 밖에서도 쓰이는 것 — 다른 세션(삭제분 포함)·다른 잡·책 자산 */
  private async sharedFileIds(
    em: EntityManager,
    sessionId: string,
    jobIds: string[],
    candidates: string[],
  ): Promise<Set<string>> {
    const shared = new Set<string>();
    if (candidates.length === 0) return shared;
    const inList = candidates.map(() => '?').join(',');
    const keep = (rows: IdRow[], keys: string[]): void => {
      for (const id of ids(rows, keys)) if (candidates.includes(id)) shared.add(id);
    };

    keep(
      await em.query(
        `SELECT cover_file_id, content_file_id, content_pdf_file_id FROM file_edit_sessions WHERE id <> ? AND (cover_file_id IN (${inList}) OR content_file_id IN (${inList}) OR content_pdf_file_id IN (${inList}))`,
        [sessionId, ...candidates, ...candidates, ...candidates],
      ),
      ['cover_file_id', 'content_file_id', 'content_pdf_file_id'],
    );

    const notMine = jobIds.length > 0 ? ` AND id NOT IN (${jobIds.map(() => '?').join(',')})` : '';
    keep(
      await em.query(
        `SELECT file_id, output_file_id, pdf_file_id FROM worker_jobs WHERE (file_id IN (${inList}) OR output_file_id IN (${inList}) OR pdf_file_id IN (${inList}))${notMine}`,
        [...candidates, ...candidates, ...candidates, ...jobIds],
      ),
      ['file_id', 'output_file_id', 'pdf_file_id'],
    );

    keep(await em.query(`SELECT file_id FROM book_assets WHERE file_id IN (${inList})`, candidates), ['file_id']);
    keep(
      await em.query(`SELECT output_file_id FROM book_finalizations WHERE output_file_id IN (${inList})`, candidates),
      ['output_file_id'],
    );
    return shared;
  }
}

/** mysql2 DELETE 결과의 affectedRows (TypeORM query 반환 형태가 드라이버마다 달라 방어적으로 읽는다) */
function affected(result: unknown): number {
  if (result && typeof result === 'object') {
    const rec = result as Record<string, unknown>;
    if (typeof rec.affectedRows === 'number') return rec.affectedRows;
    if (Array.isArray(result) && result.length > 1 && typeof result[1] === 'number') return result[1];
  }
  return 0;
}
