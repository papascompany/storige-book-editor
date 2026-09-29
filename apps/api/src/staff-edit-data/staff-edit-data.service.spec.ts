/**
 * StaffEditDataService (2026-09-29) — 관리자 편집데이터 관리 13개 라우트의 호출자·범위·전제·보관기간·권한·
 * 감사(fail-closed) 순서와 부수효과. 저장소·협력 서비스는 모두 mock.
 */
import 'reflect-metadata';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { WorkerJobStatus } from '@storige/types';
import { StaffEditDataService, memberIdFromMetadata, orderMetaFromMetadata } from './staff-edit-data.service';
import { StaffSessionFileKind } from './dto/staff-edit-data.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S_A = '11111111-1111-4111-8111-111111111111'; // site A
const S_B = '22222222-2222-4222-8222-222222222222'; // site B
const S_NULL = '33333333-3333-4333-8333-333333333333'; // NULL-site
const S_OLD = '44444444-4444-4444-8444-444444444444'; // site A, 보관기간 만료 대상
const S_DONE = '55555555-5555-4555-8555-555555555555'; // site A, 완료
const S_DEL = '66666666-6666-4666-8666-666666666666'; // site A, 삭제됨
const MISSING = '99999999-9999-4999-8999-999999999999';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SITE_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DAY = 86_400_000;

type Raw = Record<string, unknown>;

const rawSession = (id: string, extra: Raw = {}): Raw => ({
  id,
  siteId: SITE_A,
  orderSeqno: '5',
  memberSeqno: '777',
  status: 'editing',
  mode: 'both',
  templateSetId: 'ts-1',
  metadata: JSON.stringify({
    member: { memberId: 'kim@example.com', memberName: '김' },
    orderOptions: { productName: '포토북', title: '여행', quantity: 2, size: { width: 210, height: 297 } },
  }),
  coverFileId: 'file-cover',
  contentFileId: 'file-content',
  contentPdfFileId: null,
  isGuest: 0,
  guestExpiresAt: null,
  createdAt: new Date(Date.now() - 2 * DAY),
  updatedAt: new Date(Date.now() - DAY),
  completedAt: null,
  deletedAt: null,
  ...extra,
});

interface Qb {
  calls: Array<{ m: string; a: unknown[] }>;
  [k: string]: unknown;
}

async function httpError(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('expected rejection');
}

describe('StaffEditDataService', () => {
  let table: Record<string, Raw>;
  let siteDays: Record<string, number | null>;
  let userSiteRows: Record<string, Array<{ siteId: string; role: string }>>;
  let listRows: Raw[];
  let qbs: Qb[];
  let order: string[];

  const makeQb = (): Qb => {
    const qb: Qb = { calls: [] };
    let whereParams: Record<string, unknown> = {};
    const chain = ['select', 'addSelect', 'withDeleted', 'andWhere', 'orderBy', 'offset', 'limit', 'groupBy', 'setParameters'];
    for (const m of chain) {
      qb[m] = jest.fn((...a: unknown[]) => {
        qb.calls.push({ m, a });
        return qb;
      });
    }
    qb.where = jest.fn((...a: unknown[]) => {
      qb.calls.push({ m: 'where', a });
      whereParams = (a[1] as Record<string, unknown>) ?? {};
      return qb;
    });
    qb.getRawOne = jest.fn(async () => {
      const id = whereParams.id as string;
      return table[id] ? { ...table[id] } : undefined;
    });
    qb.getCount = jest.fn(async () => listRows.length);
    qb.getRawMany = jest.fn(async () => listRows.map((r) => ({ ...r })));
    qbs.push(qb);
    return qb;
  };

  const sessionRepo = {
    createQueryBuilder: jest.fn(() => makeQb()),
    manager: {
      createQueryBuilder: jest.fn(() => {
        const q: Record<string, jest.Mock> = {};
        for (const m of ['select', 'addSelect', 'from', 'where']) q[m] = jest.fn(() => q);
        q.getRawMany = jest.fn(async () => [{ id: 'ts-1', name: '포토북 세트' }]);
        return q;
      }),
    },
  };
  const siteRepo = {
    findOne: jest.fn(async (o: { where: { id: string } }) =>
      o.where.id in siteDays ? { id: o.where.id, name: `site ${o.where.id.slice(0, 1)}`, editRetentionDays: siteDays[o.where.id] } : null,
    ),
    find: jest.fn(async () => Object.entries(siteDays).map(([id, d]) => ({ id, name: `site ${id.slice(0, 1)}`, editRetentionDays: d }))),
  };
  const userSiteRoleRepo = {
    find: jest.fn(async (o: { where: { userId: string } }) => userSiteRows[o.where.userId] ?? []),
  };
  const editSessions = {
    complete: jest.fn(async () => ({ status: 'complete', completedAt: new Date() })),
    delete: jest.fn(async () => undefined),
    restoreSession: jest.fn(async () => ({})),
    pinStaffBaseline: jest.fn(async () => {
      order.push('pin');
      return null;
    }),
  };
  const workerJobs = {
    findJobsBySession: jest.fn(async () => [] as unknown[]),
    findJobScopeRef: jest.fn(),
    findOne: jest.fn(),
    createStaffComposeFromSession: jest.fn(async () => ({ id: 'job-new', status: 'PENDING', jobType: 'SYNTHESIZE' })),
  };
  const files = {
    reviveForEditRetention: jest.fn(async () => {
      order.push('revive');
      return [] as string[];
    }),
    getFileStream: jest.fn(),
  };
  const grants = {
    mintForStaff: jest.fn(async () => {
      order.push('mint');
      return {
        success: true,
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        grantId: 'g-1',
        grantExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        capabilities: ['edit'],
      };
    }),
    listStaffGrantsForSession: jest.fn(async () => []),
    revokeStaff: jest.fn(async () => ({ success: true, grantId: 'g', revoked: true })),
  };
  const audit = {
    recordOrThrow: jest.fn(async () => undefined),
    recordBestEffort: jest.fn(async () => undefined),
    hasStaffUpdateAfter: jest.fn(async () => false),
    latestStaffUpdateBySession: jest.fn(async () => new Map<string, Date>()),
    latestCompletionAuditBySession: jest.fn(async () => new Map<string, Date>()),
    listStaff: jest.fn(async () => []),
  };

  let service: StaffEditDataService;
  const admin = { id: ADMIN_ID, role: 'ADMIN' };
  const siteAdmin = { id: SITE_USER, role: 'SITE_ADMIN' };
  const siteManager = { id: SITE_USER, role: 'SITE_MANAGER' };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks 는 mockResolvedValue 등으로 바꾼 구현을 되돌리지 않는다 — 테스트 간 누수 방지로 기본 구현 재설정.
    audit.recordOrThrow.mockImplementation(async () => undefined);
    audit.hasStaffUpdateAfter.mockImplementation(async () => false);
    audit.latestStaffUpdateBySession.mockImplementation(async () => new Map<string, Date>());
    audit.latestCompletionAuditBySession.mockImplementation(async () => new Map<string, Date>());
    files.reviveForEditRetention.mockImplementation(async () => {
      order.push('revive');
      return [] as string[];
    });
    files.getFileStream.mockReset();
    workerJobs.findJobsBySession.mockImplementation(async () => [] as unknown[]);
    workerJobs.findJobScopeRef.mockReset();
    workerJobs.findOne.mockReset();
    editSessions.pinStaffBaseline.mockImplementation(async () => {
      order.push('pin');
      return null;
    });
    qbs = [];
    order = [];
    siteDays = { [SITE_A]: 30, [SITE_B]: null };
    userSiteRows = { [SITE_USER]: [{ siteId: SITE_A, role: 'SITE_ADMIN' }] };
    table = {
      [S_A]: rawSession(S_A),
      [S_B]: rawSession(S_B, { siteId: SITE_B }),
      [S_NULL]: rawSession(S_NULL, { siteId: null }),
      [S_OLD]: rawSession(S_OLD, { createdAt: new Date(Date.now() - 40 * DAY) }),
      [S_DONE]: rawSession(S_DONE, { status: 'complete', completedAt: new Date(Date.now() - DAY) }),
      [S_DEL]: rawSession(S_DEL, { deletedAt: new Date() }),
    };
    listRows = [rawSession(S_A), rawSession(S_DONE, { status: 'complete', completedAt: new Date(Date.now() - DAY) })];
    service = new StaffEditDataService(
      sessionRepo as never,
      siteRepo as never,
      userSiteRoleRepo as never,
      editSessions as never,
      workerJobs as never,
      files as never,
      grants as never,
      audit as never,
    );
  });

  const mutations = (): jest.Mock[] => [
    editSessions.complete,
    editSessions.delete,
    editSessions.restoreSession,
    editSessions.pinStaffBaseline,
    workerJobs.createStaffComposeFromSession,
    files.reviveForEditRetention,
    grants.mintForStaff,
    grants.revokeStaff,
  ];

  // ───────────────────────── 호출자·역할 ─────────────────────────
  describe('호출자·역할', () => {
    it.each([
      ['ADMIN', { id: ADMIN_ID, role: 'ADMIN' }],
      ['MANAGER', { id: ADMIN_ID, role: 'MANAGER' }],
      ['SUPER_ADMIN', { id: ADMIN_ID, role: 'SUPER_ADMIN' }],
    ])('%s 는 전역(사이트 행 조회 없음)', async (_l, user) => {
      const actor = await service.resolveActor(user);
      expect(actor.global).toBe(true);
      expect(userSiteRoleRepo.find).not.toHaveBeenCalled();
      await expect(service.complete(user, S_B)).resolves.toMatchObject({ success: true });
    });

    it('SITE_* 범위는 JWT siteRoles 가 아니라 DB 행에서 온다', async () => {
      const user = { ...siteAdmin, siteRoles: [{ siteId: SITE_B, role: 'SITE_ADMIN' }] };
      await expect(service.complete(user, S_A)).resolves.toMatchObject({ success: true });
      const r = await httpError(service.complete(user, S_B));
      expect(r.status).toBe(404);
      expect(userSiteRoleRepo.find).toHaveBeenCalledWith({ where: { userId: SITE_USER }, select: ['siteId', 'role'] });
    });

    it('users.role SITE_ADMIN 이어도 그 사이트 행 역할이 SITE_MANAGER 면 삭제 불가', async () => {
      userSiteRows[SITE_USER] = [{ siteId: SITE_A, role: 'SITE_MANAGER' }];
      const r = await httpError(service.remove(siteAdmin, S_A));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('STAFF_DELETE_NOT_ALLOWED');
      expect(editSessions.delete).not.toHaveBeenCalled();
    });

    it.each([
      ['shop 토큰', { userId: '777', role: 'customer', source: 'shop', siteId: SITE_A }],
      ['운영자 토큰', { userId: 'po:x', role: 'partner_operator', source: 'partner_operator', partnerOperator: {} }],
      ['CUSTOMER 계정', { id: ADMIN_ID, role: 'CUSTOMER' }],
      ['역할 위조 문자열', { id: ADMIN_ID, role: 'admin' }],
      ['사용자 없음', undefined],
    ])('%s → 403 STAFF_ROLE_REQUIRED', async (_l, user) => {
      const r = await httpError(service.listSessions(user, {}));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('STAFF_ROLE_REQUIRED');
    });
  });

  // ───────────────────────── 범위·전제 ─────────────────────────
  describe('범위·전제', () => {
    it('범위 밖 세션과 없는 세션은 같은 404 SESSION_NOT_FOUND', async () => {
      const out = await httpError(service.listJobs(siteAdmin, S_B));
      const missing = await httpError(service.listJobs(siteAdmin, MISSING));
      expect(out).toEqual(missing);
      expect(out).toEqual({ status: 404, body: { code: 'SESSION_NOT_FOUND', message: '편집 세션을 찾을 수 없습니다.' } });
    });

    it('NULL-site: 전역은 조회·완료 가능, 사이트 운영자는 404', async () => {
      await expect(service.listJobs(admin, S_NULL)).resolves.toEqual({ items: [] });
      await expect(service.complete(admin, S_NULL)).resolves.toMatchObject({ success: true });
      expect((await httpError(service.listJobs(siteAdmin, S_NULL))).status).toBe(404);
    });

    it('NULL-site: editor-session·synthesize → 409 STAFF_SESSION_SITE_REQUIRED', async () => {
      for (const p of [service.openEditorSession(admin, S_NULL, {}), service.synthesize(admin, S_NULL, {})]) {
        const r = await httpError(p);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('STAFF_SESSION_SITE_REQUIRED');
      }
      expect(grants.mintForStaff).not.toHaveBeenCalled();
      expect(workerJobs.createStaffComposeFromSession).not.toHaveBeenCalled();
    });

    it('삭제된 세션: editor-session·complete·synthesize·delete → 409 SESSION_DELETED', async () => {
      for (const p of [
        service.openEditorSession(admin, S_DEL, {}),
        service.complete(admin, S_DEL),
        service.synthesize(admin, S_DEL, {}),
        service.remove(admin, S_DEL),
      ]) {
        const r = await httpError(p);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('SESSION_DELETED');
      }
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────── 보관기간 ─────────────────────────
  describe('보관기간', () => {
    it.each<[string, () => Promise<unknown>]>([
      ['complete', () => service.complete(admin, S_OLD)],
      ['restore', () => service.restore(admin, S_OLD)],
      ['editor-session', () => service.openEditorSession(admin, S_OLD, {})],
      ['synthesize', () => service.synthesize(admin, S_OLD, {})],
    ])('만료 → %s 409 EDIT_RETENTION_EXPIRED, 감사·변경 없음', async (_l, call) => {
      const r = await httpError(call());
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EDIT_RETENTION_EXPIRED');
      expect(r.body.retentionUntil).toEqual(expect.any(String));
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      for (const m of mutations()) expect(m).not.toHaveBeenCalled();
    });

    it('만료 후 삭제는 삭제 권한자에게 허용 + 감사(retentionState expired)', async () => {
      await expect(service.remove(admin, S_OLD)).resolves.toMatchObject({ success: true });
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.session.delete', origin: 'staff', actorUserId: ADMIN_ID, detail: expect.objectContaining({ retentionState: 'expired' }) }),
      );
      expect(editSessions.delete).toHaveBeenCalledWith(S_OLD, 0, expect.objectContaining({ staff: expect.objectContaining({ canDelete: true }) }));
    });

    it('미설정 사이트(편집데이터 보관기간 없음)는 기한 제한 없음', async () => {
      siteDays[SITE_A] = null;
      await expect(service.complete(admin, S_OLD)).resolves.toMatchObject({ success: true });
    });
  });

  // ───────────────────────── 권한 ─────────────────────────
  describe('SITE_MANAGER 권한', () => {
    beforeEach(() => {
      userSiteRows[SITE_USER] = [{ siteId: SITE_A, role: 'SITE_MANAGER' }];
    });

    it('삭제·복구·삭제 권한 발급 → 403, 편집기·완료·합성은 허용', async () => {
      for (const p of [
        service.remove(siteManager, S_A),
        service.restore(siteManager, S_A),
        service.openEditorSession(siteManager, S_A, { allowDelete: true }),
      ]) {
        const r = await httpError(p);
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('STAFF_DELETE_NOT_ALLOWED');
      }
      await expect(service.openEditorSession(siteManager, S_A, {})).resolves.toMatchObject({ success: true });
      await expect(service.complete(siteManager, S_A)).resolves.toMatchObject({ success: true });
      await expect(service.synthesize(siteManager, S_A, {})).resolves.toMatchObject({ success: true });
    });
  });

  // ───────────────────────── 완료 ─────────────────────────
  describe('complete', () => {
    it('이미 완료 → 409 SESSION_ALREADY_COMPLETE', async () => {
      const r = await httpError(service.complete(admin, S_DONE));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('SESSION_ALREADY_COMPLETE');
      expect(editSessions.complete).not.toHaveBeenCalled();
    });

    it('감사 → EditSessionsService.complete(staff 컨텍스트)', async () => {
      await service.complete(siteAdmin, S_A);
      expect(audit.recordOrThrow).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.session.complete', siteId: SITE_A, sessionId: S_A, grantId: null }));
      expect(editSessions.complete).toHaveBeenCalledWith(S_A, 0, {
        role: 'SITE_ADMIN',
        staff: { userId: SITE_USER, global: false, siteIds: [SITE_A], canDelete: true },
      });
    });
  });

  // ───────────────────────── 감사 fail-closed ─────────────────────────
  describe('감사 기록 실패 → 503, 변경 없음', () => {
    beforeEach(() => {
      audit.recordOrThrow.mockRejectedValue(new ServiceUnavailableException());
    });
    it.each<[string, () => Promise<unknown>]>([
      ['complete', () => service.complete(admin, S_A)],
      ['delete', () => service.remove(admin, S_A)],
      ['restore', () => service.restore(admin, S_DEL)],
      ['synthesize', () => service.synthesize(admin, S_A, {})],
    ])('%s', async (_l, call) => {
      const r = await httpError(call());
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('STAFF_AUDIT_UNAVAILABLE');
      for (const m of mutations()) expect(m).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────── 합성 ─────────────────────────
  describe('synthesize', () => {
    it('관리자 편집 후 미완료 → 409 OUTPUT_STALE, allowStale 이면 진행', async () => {
      audit.hasStaffUpdateAfter.mockResolvedValue(true);
      const r = await httpError(service.synthesize(admin, S_DONE, {}));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('OUTPUT_STALE');
      expect(audit.hasStaffUpdateAfter).toHaveBeenCalledWith(S_DONE, expect.any(Date));
      await expect(service.synthesize(admin, S_DONE, { allowStale: true })).resolves.toMatchObject({ success: true });
    });

    it('서버가 읽은 세션 사이트로 새 잡 생성(알림 기본 끔) + 감사 2행', async () => {
      workerJobs.findJobsBySession.mockResolvedValue([{ id: 'old' }]);
      files.reviveForEditRetention.mockResolvedValue(['file-cover']);
      const out = await service.synthesize(admin, S_A, { outputMode: 'separate', reason: '재합성' });
      expect(out).toEqual({ success: true, job: { id: 'job-new', status: 'PENDING', jobType: 'SYNTHESIZE' } });
      expect(workerJobs.createStaffComposeFromSession).toHaveBeenCalledWith(S_A, SITE_A, {
        outputMode: 'separate',
        notifyPartner: false,
        actorUserId: ADMIN_ID,
      });
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.session.synthesize', detail: expect.objectContaining({ previousJobCount: 1, notifyPartner: false, allowStale: false }) }),
      );
      expect(audit.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.session.synthesize.job', detail: { jobId: 'job-new', revivedFileIds: ['file-cover'] } }),
      );
      // 보관기간 안(설정된 사이트) → 세션 직접 참조 파일 복구(보관 종료 시각까지)
      expect(files.reviveForEditRetention).toHaveBeenCalledWith(['file-cover', 'file-content'], expect.any(Date));
    });

    it('미설정 사이트 → 파일 복구 없음', async () => {
      siteDays[SITE_A] = null;
      await service.synthesize(admin, S_A, {});
      expect(files.reviveForEditRetention).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────── 편집기 권한 ─────────────────────────
  describe('editor-session', () => {
    it('파일 복구 → staff-baseline → 발급 순서, 권한 만료 상한 = 보관 종료', async () => {
      const out = await service.openEditorSession(admin, S_A, { allowDelete: true, ttlSeconds: 600, reason: 'CS' });
      expect(order).toEqual(['revive', 'pin', 'mint']);
      const created = (table[S_A].createdAt as Date).getTime();
      expect(grants.mintForStaff).toHaveBeenCalledWith({
        sessionId: S_A,
        siteId: SITE_A,
        siteName: 'site a',
        actorUserId: ADMIN_ID,
        allowDelete: true,
        ttlSeconds: 600,
        notAfterUnix: Math.floor((created + 30 * DAY) / 1000),
        reason: 'CS',
        onBehalfOfMemberSeqno: 777,
      });
      expect(out).toMatchObject({
        success: true,
        accessToken: 'a',
        refreshToken: 'r',
        grantId: 'g-1',
        sessionId: S_A,
        editorPath: `/embed?sessionId=${S_A}&adminEdit=session`,
      });
    });

    it('staff-baseline 저장 실패 → 503 STAFF_BASELINE_UNAVAILABLE, 발급 없음', async () => {
      editSessions.pinStaffBaseline.mockRejectedValueOnce(new Error('db down'));
      const r = await httpError(service.openEditorSession(admin, S_A, {}));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('STAFF_BASELINE_UNAVAILABLE');
      expect(grants.mintForStaff).not.toHaveBeenCalled();
    });

    it('미설정 사이트 → 만료 상한 없음(notAfterUnix null)', async () => {
      siteDays[SITE_A] = null;
      await service.openEditorSession(admin, S_A, {});
      expect(grants.mintForStaff).toHaveBeenCalledWith(expect.objectContaining({ notAfterUnix: null, allowDelete: false }));
    });
  });

  // ───────────────────────── 목록 ─────────────────────────
  describe('listSessions', () => {
    it('사이트 운영자: DB 범위 필터·삭제 필터·보관기간 필터가 쿼리에 들어간다', async () => {
      await service.listSessions(siteAdmin, { deleted: 'only', retention: 'active', status: 'editing' });
      const qb = qbs[0];
      const where = qb.calls.filter((c) => c.m === 'andWhere').map((c) => String(c.a[0]));
      expect(qb.calls.some((c) => c.m === 'withDeleted')).toBe(true);
      expect(where).toContain('s.deletedAt IS NOT NULL');
      expect(where.some((w) => w.includes('s.siteId IN (:...tenantSiteIds_s)'))).toBe(true);
      const scopeCall = qb.calls.find((c) => String(c.a[0]).includes('tenantSiteIds_s'));
      expect(scopeCall?.a[1]).toEqual({ tenantSiteIds_s: [SITE_A] });
      const retentionCall = qb.calls.find((c) => c.m === 'andWhere' && String(c.a[0]).includes('s.created_at > :lrc0'));
      expect(retentionCall).toBeDefined();
      expect((retentionCall?.a[1] as Record<string, unknown>).lrs0).toBe(SITE_A);
      expect(where).toContain('s.status = :fStatus');
    });

    it('범위 밖 siteId 쿼리 → 403 TENANT_FORBIDDEN', async () => {
      const r = await httpError(service.listSessions(siteAdmin, { siteId: SITE_B }));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('TENANT_FORBIDDEN');
    });

    it('전역: 범위 필터 없음(NULL-site 포함), 기본은 삭제 제외', async () => {
      await service.listSessions(admin, {});
      const qb = qbs[0];
      expect(qb.calls.some((c) => c.m === 'withDeleted')).toBe(false);
      expect(qb.calls.some((c) => String(c.a[0]).includes('tenantSiteIds'))).toBe(false);
    });

    it('항목: guestToken 없음, memberId·orderMeta·템플릿명·보관기한·편집 후 미완료·삭제 권한 매핑', async () => {
      audit.latestStaffUpdateBySession.mockResolvedValue(new Map([[S_DONE, new Date()]]));
      const out = await service.listSessions(admin, { page: 1, limit: 20 });
      expect(out.total).toBe(2);
      expect(JSON.stringify(out)).not.toMatch(/guestToken|guest_token/);
      const a = out.items.find((i) => i.id === S_A);
      expect(a).toMatchObject({
        siteId: SITE_A,
        siteName: 'site a',
        orderSeqno: 5,
        memberSeqno: 777,
        memberId: 'kim@example.com',
        orderMeta: { productName: '포토북', title: '여행', quantity: 2, size: '210×297mm' },
        templateSetName: '포토북 세트',
        isGuest: false,
        canDelete: true,
        staffEditedAfterComplete: false,
      });
      expect(a?.retention.state).toBe('active');
      expect(a?.retention.days).toBe(30);
      expect(out.items.find((i) => i.id === S_DONE)?.staffEditedAfterComplete).toBe(true);
    });

    it('편집 후 미완료: completed_at(초 단위)과 같은 초의 편집 저장은 미완료로 표시하지 않음(정밀도 보정)', async () => {
      const T = Date.parse('2026-09-29T10:00:00.000Z');
      listRows = [rawSession(S_A), rawSession(S_DONE, { status: 'complete', completedAt: new Date(T) })];
      audit.latestStaffUpdateBySession.mockResolvedValue(new Map([[S_DONE, new Date(T + 200)]]));
      audit.latestCompletionAuditBySession.mockResolvedValue(new Map([[S_DONE, new Date(T + 350)]]));
      const out = await service.listSessions(admin, { page: 1, limit: 20 });
      expect(out.items.find((i) => i.id === S_DONE)?.staffEditedAfterComplete).toBe(false);
      expect(audit.latestCompletionAuditBySession).toHaveBeenCalledWith([S_DONE]);

      audit.latestStaffUpdateBySession.mockResolvedValue(new Map([[S_DONE, new Date(T + 1500)]]));
      audit.latestCompletionAuditBySession.mockResolvedValue(new Map<string, Date>());
      const later = await service.listSessions(admin, { page: 1, limit: 20 });
      expect(later.items.find((i) => i.id === S_DONE)?.staffEditedAfterComplete).toBe(true);
    });
  });

  it('보고서: 읽기 전용(감사·변경 호출 없음), 사이트별 집계 + purge disabled', async () => {
    listRows = [{ siteId: SITE_A, total: '10', active: '6', expired: '3', expiredDeleted: '1' }];
    const out = await service.retentionReport(admin, {});
    expect(out.items).toEqual([
      { siteId: SITE_A, siteName: 'site a', editRetentionDays: 30, total: 10, active: 6, expired: 3, expiredDeleted: 1, unset: 1, purge: 'disabled' },
    ]);
    expect(audit.recordOrThrow).not.toHaveBeenCalled();
    expect(audit.recordBestEffort).not.toHaveBeenCalled();
    for (const m of mutations()) expect(m).not.toHaveBeenCalled();
    const sel = qbs[0].calls.filter((c) => c.m === 'addSelect').map((c) => String(c.a[0]));
    expect(sel.some((x) => x.includes('s.created_at > :rrc0'))).toBe(true);
    expect(sel.join(' ')).not.toMatch(/JOIN/i);
  });

  // ───────────────────────── 권한 목록·회수 ─────────────────────────
  it('grants: 범위 확인 후 세션 사이트로 조회 / revoke: DB 범위로 위임(파트너 권한·범위 밖은 권한 서비스가 404)', async () => {
    await service.listGrants(siteAdmin, S_A);
    expect(grants.listStaffGrantsForSession).toHaveBeenCalledWith(S_A, SITE_A);
    expect((await httpError(service.listGrants(siteAdmin, S_B))).status).toBe(404);
    await service.revokeGrant(siteAdmin, 'g-1');
    expect(grants.revokeStaff).toHaveBeenCalledWith('g-1', { global: false, siteIds: [SITE_A] }, SITE_USER);
    await service.revokeGrant(admin, 'g-2');
    expect(grants.revokeStaff).toHaveBeenLastCalledWith('g-2', { global: true, siteIds: [] }, ADMIN_ID);
  });

  // ───────────────────────── 산출물·입력 파일 ─────────────────────────
  describe('jobs/:jobId/output · sessions/:id/files/:kind', () => {
    const res = (): Response => ({ setHeader: jest.fn(), on: jest.fn(), removeHeader: jest.fn() }) as unknown as Response;

    it('잡이 가리키는 세션이 범위 밖 → 없는 잡과 같은 404 JOB_NOT_FOUND', async () => {
      workerJobs.findJobScopeRef.mockResolvedValueOnce({ id: 'j', editSessionId: S_B, siteId: SITE_B });
      const out = await httpError(service.streamJobOutput(siteAdmin, 'j', res()));
      workerJobs.findJobScopeRef.mockResolvedValueOnce(null);
      const missing = await httpError(service.streamJobOutput(siteAdmin, 'j', res()));
      expect(out.status).toBe(404);
      expect(out.body.code).toBe('JOB_NOT_FOUND');
      expect(missing).toEqual(out);
      expect(workerJobs.findOne).not.toHaveBeenCalled();
    });

    it('세션 없는 NULL-site 잡은 전역만, 범위 안 잡은 스트리밍 헬퍼로(미완료 → 400)', async () => {
      workerJobs.findJobScopeRef.mockResolvedValue({ id: 'j', editSessionId: null, siteId: null });
      expect((await httpError(service.streamJobOutput(siteAdmin, 'j', res()))).status).toBe(404);
      workerJobs.findOne.mockResolvedValue({ status: WorkerJobStatus.PROCESSING, result: null });
      const r = await httpError(service.streamJobOutput(admin, 'j', res()));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('JOB_NOT_COMPLETED');
      expect(workerJobs.findOne).toHaveBeenCalledWith('j');
    });

    it('입력 파일: 범위 밖 → 404, 파일 id 는 세션 컬럼에서만', async () => {
      expect((await httpError(service.streamSessionFile(siteAdmin, S_B, StaffSessionFileKind.cover, res()))).status).toBe(404);
      files.getFileStream.mockResolvedValue({
        stream: Readable.from(['%PDF']),
        file: { mimeType: 'application/pdf', originalName: 'cover.pdf' },
        size: 4,
      });
      const r = res();
      (r as unknown as { pipe?: unknown }).pipe = undefined;
      await service.streamSessionFile(siteAdmin, S_A, StaffSessionFileKind.cover, Object.assign(r, { write: jest.fn(), end: jest.fn(), once: jest.fn(), emit: jest.fn() }));
      expect(files.getFileStream).toHaveBeenCalledWith('file-cover');
      const nf = await httpError(service.streamSessionFile(siteAdmin, S_A, StaffSessionFileKind.contentPdf, res()));
      expect(nf.status).toBe(404);
      expect(nf.body.code).toBe('FILE_NOT_FOUND');
    });
  });

  it('audit: 전역은 all, 사이트 운영자는 DB 사이트, 범위 밖 siteId → 403', async () => {
    await service.audit(admin, { limit: 10 });
    expect(audit.listStaff).toHaveBeenCalledWith(expect.objectContaining({ siteIds: 'all', limit: 10 }));
    await service.audit(siteAdmin, { sessionId: S_A });
    expect(audit.listStaff).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: [SITE_A], sessionId: S_A }));
    expect((await httpError(service.audit(siteAdmin, { siteId: SITE_B }))).status).toBe(403);
  });
});

describe('metadata 매핑', () => {
  it('memberId / orderMeta', () => {
    expect(memberIdFromMetadata({ member: { memberId: 'a@b.c' } })).toBe('a@b.c');
    expect(memberIdFromMetadata(null)).toBeNull();
    expect(orderMetaFromMetadata({ size: { width: 100, height: 200 } })).toEqual({ productName: null, title: null, quantity: null, size: '100×200mm' });
    expect(orderMetaFromMetadata({ theme: 'x' })).toBeNull();
    expect(orderMetaFromMetadata(null)).toBeNull();
  });
});
