import { Logger } from '@nestjs/common';
import { StaffDeletePurgeService, STAFF_PURGE_BATCH } from './staff-delete-purge.service';

/**
 * 관리자 삭제 영구 삭제 (2026-11-25) — SQL 을 문자열로 받아 응답하는 가짜 EntityManager 로
 * 대상 선정·공유 파일 보존·삭제 순서·복구된 세션 건너뛰기를 확인한다.
 */
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Row = Record<string, unknown>;
type Responder = (sql: string, params: unknown[]) => Row[] | { affectedRows: number };

function makeService(respond: Responder) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    return respond(sql, params);
  });
  const em = { query };
  const sessionRepository = {
    query,
    manager: { transaction: jest.fn(async (fn: (m: typeof em) => Promise<unknown>) => fn(em)) },
  };
  const files: Record<string, Row> = {};
  const fileRepository = {
    findOne: jest.fn(async (o: { where: { id: string } }) => files[o.where.id] ?? null),
  };
  const filesService = { hardDeleteEntity: jest.fn(async () => undefined) };
  const service = new StaffDeletePurgeService(sessionRepository as never, fileRepository as never, filesService as never);
  return { service, queries, files, filesService, sessionRepository };
}

describe('StaffDeletePurgeService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('대상 조회: 삭제 상태 + purge_after 가 있고 지난 세션만, 배치 상한', async () => {
    const { service, queries } = makeService(() => [{ id: S }]);
    const now = new Date();
    await expect(service.findDue(now, STAFF_PURGE_BATCH)).resolves.toEqual([S]);
    const q = queries[0];
    expect(q.sql).toContain('deleted_at IS NOT NULL');
    expect(q.sql).toContain('purge_after IS NOT NULL');
    expect(q.sql).toContain('purge_after <= ?');
    expect(q.params).toEqual([now, STAFF_PURGE_BATCH]);
  });

  it('세션만 쓰던 파일은 지우고, 다른 세션·잡·책 자산이 쓰는 파일은 남긴다. 잡 → 버전 → 세션 순서', async () => {
    const h = makeService((sql) => {
      if (sql.startsWith('SELECT id, cover_file_id')) {
        return [{ id: S, cover_file_id: 'f-cover', content_file_id: 'f-shared-session', content_pdf_file_id: null }];
      }
      if (sql.startsWith('SELECT id, file_id')) {
        return [
          { id: 'j-1', file_id: 'f-cover', output_file_id: 'f-out', pdf_file_id: null },
          { id: 'j-2', file_id: 'f-shared-job', output_file_id: 'f-book', pdf_file_id: null },
        ];
      }
      if (sql.startsWith('SELECT cover_file_id')) return [{ cover_file_id: null, content_file_id: 'f-shared-session', content_pdf_file_id: null }];
      if (sql.startsWith('SELECT file_id, output_file_id')) return [{ file_id: 'f-shared-job', output_file_id: null, pdf_file_id: null }];
      if (sql.startsWith('SELECT file_id FROM book_assets')) return [{ file_id: 'f-book' }];
      if (sql.startsWith('SELECT output_file_id FROM book_finalizations')) return [];
      if (sql.startsWith('DELETE FROM worker_jobs')) return { affectedRows: 2 };
      if (sql.startsWith('DELETE FROM file_edit_session_versions')) return { affectedRows: 3 };
      if (sql.startsWith('DELETE FROM file_edit_sessions')) return { affectedRows: 1 };
      throw new Error(`unexpected sql: ${sql}`);
    });
    h.files['f-cover'] = { id: 'f-cover' };
    h.files['f-out'] = { id: 'f-out' };

    const r = await h.service.purgeSession(S);

    expect(r).toEqual({ sessionId: S, purged: true, jobs: 2, versions: 3, files: 2, sharedFilesKept: 3 });
    const deleted = h.filesService.hardDeleteEntity.mock.calls.map((c) => (c as unknown as [Row])[0].id);
    expect(deleted.sort()).toEqual(['f-cover', 'f-out']);
    const order = h.queries.filter((q) => q.sql.startsWith('DELETE')).map((q) => q.sql.split(' ')[2]);
    expect(order).toEqual(['worker_jobs', 'file_edit_session_versions', 'file_edit_sessions']);
    const otherJobs = h.queries.find((q) => q.sql.startsWith('SELECT file_id, output_file_id'));
    expect(otherJobs?.sql).toContain('AND id NOT IN (?,?)');
    expect(otherJobs?.params.slice(-2)).toEqual(['j-1', 'j-2']);
  });

  it('그사이 복구된 세션(조건 재확인 0행)은 아무것도 지우지 않는다', async () => {
    const h = makeService((sql) => {
      if (sql.startsWith('SELECT id, cover_file_id')) return [];
      throw new Error(`unexpected sql: ${sql}`);
    });
    await expect(h.service.purgeSession(S)).resolves.toMatchObject({ purged: false, files: 0 });
    expect(h.filesService.hardDeleteEntity).not.toHaveBeenCalled();
    expect(h.queries.some((q) => q.sql.startsWith('DELETE'))).toBe(false);
  });

  it('잡·파일 없는 세션: 버전·세션 행만 지운다', async () => {
    const h = makeService((sql) => {
      if (sql.startsWith('SELECT id, cover_file_id')) return [{ id: S, cover_file_id: null, content_file_id: null, content_pdf_file_id: null }];
      if (sql.startsWith('SELECT id, file_id')) return [];
      if (sql.startsWith('DELETE FROM file_edit_session_versions')) return { affectedRows: 0 };
      if (sql.startsWith('DELETE FROM file_edit_sessions')) return { affectedRows: 1 };
      throw new Error(`unexpected sql: ${sql}`);
    });
    await expect(h.service.purgeSession(S)).resolves.toEqual({
      sessionId: S,
      purged: true,
      jobs: 0,
      versions: 0,
      files: 0,
      sharedFilesKept: 0,
    });
  });

  it('주기 실행: 한 세션이 실패해도 다음 세션을 계속 처리한다', async () => {
    const h = makeService(() => []);
    jest.spyOn(h.service, 'findDue').mockResolvedValue(['s-1', 's-2']);
    const purge = jest
      .spyOn(h.service, 'purgeSession')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ sessionId: 's-2', purged: true, jobs: 0, versions: 0, files: 0, sharedFilesKept: 0 });
    await h.service.purgeExpired();
    expect(purge).toHaveBeenCalledTimes(2);
  });
});
