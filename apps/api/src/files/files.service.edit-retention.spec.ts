/**
 * 파일 보존 sweep·영구삭제의 편집데이터 보관기간 제외 + 복구 (2026-09-29).
 *
 * 실제 TypeORM(mysql 드라이버, 연결 없음)으로 SQL 을 생성해 비교한다.
 *  - 보호 사이트 없음 → 생성 SQL 이 종전(HEAD) 쿼리와 동일
 *  - 보호 사이트 2개 → NOT EXISTS + 사이트별 파라미터, sites 조인 없음
 *  - reviveForEditRetention → soft-deleted id 만 갱신
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder, UpdateQueryBuilder } from 'typeorm';
import { FilesService } from './files.service';
import { FileEntity } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';

interface CapturedQuery {
  sql: string;
  params: Record<string, unknown>;
}

describe('FilesService — 편집데이터 보관기간', () => {
  let ds: DataSource;
  let repo: Repository<FileEntity>;
  let service: FilesService;
  let captured: CapturedQuery[];
  let querySpy: jest.SpyInstance;

  beforeAll(async () => {
    // 연결하지 않는다(initialize 미호출) — SQL 문자열 생성용 메타데이터만 만든다.
    ds = new DataSource({ type: 'mysql', database: 'spec_no_connect', entities: [FileEntity] });
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    repo = ds.getRepository(FileEntity);
  });

  beforeEach(() => {
    captured = [];
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getMany')
      .mockImplementation(function (this: SelectQueryBuilder<FileEntity>) {
        captured.push({ sql: this.getQuery(), params: this.getParameters() });
        return Promise.resolve([]);
      });
    querySpy = jest.spyOn(ds.manager, 'query').mockResolvedValue([]);
    service = new FilesService(
      repo,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      {} as unknown as ObjectStorageService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** TypeORM 이 별칭을 인용부호로 감싼다(`f`.`id`) — 비교용으로 제거 */
  const plain = (sql: string): string => sql.replace(/`/g, '');

  /** 보호 사이트 없음 기준 findExpired 쿼리(2026-09-30: NULL-site 세션은 NULL 파일 + 직접 참조 파일 보호) */
  const legacyFindExpiredSql = (limit: number): string =>
    repo
      .createQueryBuilder('f')
      .where('f.expires_at IS NOT NULL')
      .andWhere('f.expires_at < :now', { now: new Date() })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM file_edit_sessions s
           WHERE s.order_seqno = f.order_seqno
             AND s.status <> 'complete'
             AND s.deleted_at IS NULL
             AND (
               s.site_id = f.site_id
               OR (
                 s.site_id IS NULL
                 AND (
                   f.site_id IS NULL
                   OR s.cover_file_id = f.id
                   OR s.content_file_id = f.id
                   OR s.content_pdf_file_id = f.id
                 )
               )
             )
         )`,
      )
      .orderBy('f.expires_at', 'ASC')
      .take(limit)
      .getQuery();

  /** HEAD(변경 전) findSoftDeletedOlderThan 쿼리 그대로 */
  const legacyPurgeSql = (cutoff: Date, limit: number): string =>
    repo
      .createQueryBuilder('f')
      .withDeleted()
      .where('f.deleted_at IS NOT NULL')
      .andWhere('f.deleted_at < :cutoff', { cutoff })
      .andWhere('f.expires_at IS NOT NULL')
      .orderBy('f.deleted_at', 'ASC')
      .take(limit)
      .getQuery();

  it('보호 사이트 없음 → findExpired·findSoftDeletedOlderThan SQL 이 종전과 동일', async () => {
    await service.findExpired(50);
    const cutoff = new Date('2026-09-27T00:00:00Z');
    await service.findSoftDeletedOlderThan(cutoff, 70);
    expect(captured).toHaveLength(2);
    expect(captured[0].sql).toBe(legacyFindExpiredSql(50));
    expect(captured[1].sql).toBe(legacyPurgeSql(cutoff, 70));
    expect(Object.keys(captured[0].params).some((k) => k.startsWith('ers'))).toBe(false);
    // 보호 사이트 조회는 sites 단일 테이블, edit_retention_days > 0
    expect(String(querySpy.mock.calls[0][0])).toMatch(/FROM sites WHERE edit_retention_days > 0/);
  });

  it('보호 사이트 2개 → 두 쿼리 모두 NOT EXISTS + 사이트별 파라미터, sites 조인 없음', async () => {
    querySpy.mockResolvedValue([
      { id: 'site-1', days: 30 },
      { id: 'site-2', days: '365' },
    ]);
    const before = Date.now();
    await service.findExpired(10);
    await service.findSoftDeletedOlderThan(new Date(), 10);
    expect(captured).toHaveLength(2);
    for (const cq of captured) {
      const q = { sql: plain(cq.sql), params: cq.params };
      expect(q.sql).toContain('file_edit_sessions s2');
      expect(q.sql).toContain('s2.cover_file_id = f.id OR s2.content_file_id = f.id OR s2.content_pdf_file_id = f.id');
      expect(q.sql).toContain('(s2.site_id = :ers0 AND s2.created_at > :erc0) OR (s2.site_id = :ers1 AND s2.created_at > :erc1)');
      expect(q.sql).not.toMatch(/JOIN\s+`?sites`?/i);
      expect(q.sql).not.toMatch(/s2\.deleted_at/);
      expect(q.params.ers0).toBe('site-1');
      expect(q.params.ers1).toBe('site-2');
      const c0 = (q.params.erc0 as Date).getTime();
      const c1 = (q.params.erc1 as Date).getTime();
      expect(Math.abs(before - 30 * 86_400_000 - c0)).toBeLessThan(5000);
      expect(Math.abs(before - 365 * 86_400_000 - c1)).toBeLessThan(5000);
    }
  });

  it('보호 사이트 조회 실패 → 예외 전달(이번 배치 삭제 안 함)', async () => {
    querySpy.mockRejectedValue(new Error("Unknown column 'edit_retention_days'"));
    await expect(service.findExpired(10)).rejects.toThrow('edit_retention_days');
    expect(captured).toHaveLength(0);
  });

  it('reviveForEditRetention: soft-deleted id 만 복구(deleted_at NULL + expires_at = max(기존, until))', async () => {
    const rawSpy = jest
      .spyOn(SelectQueryBuilder.prototype, 'getRawMany')
      .mockImplementation(function (this: SelectQueryBuilder<FileEntity>) {
        captured.push({ sql: this.getQuery(), params: this.getParameters() });
        return Promise.resolve([{ id: 'f-deleted' }]);
      });
    const updates: CapturedQuery[] = [];
    jest
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockImplementation(function (this: UpdateQueryBuilder<FileEntity>) {
        updates.push({ sql: this.getQuery(), params: this.getParameters() });
        return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] });
      });
    const until = new Date('2027-01-01T00:00:00Z');
    const out = await service.reviveForEditRetention(['f-deleted', 'f-live', 'f-deleted', ''], until);
    expect(out).toEqual(['f-deleted']);
    expect(rawSpy).toHaveBeenCalledTimes(1);
    expect(plain(captured[0].sql)).toContain('f.deleted_at IS NOT NULL');
    expect(captured[0].params.ids).toEqual(['f-deleted', 'f-live']);
    expect(updates).toHaveLength(1);
    const upd = plain(updates[0].sql);
    expect(upd).toContain('deleted_at = NULL');
    expect(upd).toContain('expires_at = GREATEST(COALESCE(expires_at, :until), :until)');
    expect(upd).toContain('WHERE id IN (:...revived) AND deleted_at IS NOT NULL');
    expect(updates[0].params.revived).toEqual(['f-deleted']);
    expect(updates[0].params.until).toBe(until);
  });

  it('reviveForEditRetention: soft-deleted 가 없으면 갱신하지 않는다', async () => {
    jest.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockResolvedValue([]);
    const exec = jest.spyOn(UpdateQueryBuilder.prototype, 'execute');
    expect(await service.reviveForEditRetention(['a'], new Date())).toEqual([]);
    expect(await service.reviveForEditRetention([], new Date())).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });
});
