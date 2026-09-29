/**
 * 레거시 관리자 경로(admin-app JWT)의 편집데이터 보관기간·감사 게이트(2026-09-29).
 *
 * 대상: POST /edit-sessions/:id/versions/:vid/restore(비소유 staff), POST /edit-sessions/:id/restore,
 * 게스트 세션 staff PATCH /:id · PATCH /:id/complete. 만료 → 409, 허용 → 감사 행, 감사 실패 → 503.
 * 고객·소유자·운영자·게스트 토큰 경로는 게이트를 타지 않는다.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import type { PartnerOperatorGrant, PartnerOperatorUser } from '../auth/partner-operator/partner-operator.types';
import type { UpdateEditSessionDto } from './dto/update-edit-session.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const DELETED = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DAY = 86_400_000;

const admin = { id: ADMIN_ID, role: 'ADMIN' };
const customer = { userId: '777', role: 'customer', source: 'shop', siteId: SITE_A };

async function httpError(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('expected rejection');
}

const base = (id: string, extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
  ({
    id,
    memberSeqno: 777,
    orderSeqno: 5,
    guestToken: null,
    guestExpiresAt: null,
    siteId: SITE_A,
    status: SessionStatus.EDITING,
    mode: 'both',
    canvasData: [{ page: 1 }],
    metadata: null,
    contentPdfFileId: null,
    contentPdfMode: null,
    coverFileId: null,
    contentFileId: null,
    templateSetId: null,
    createdAt: new Date(Date.now() - 2 * DAY),
    deletedAt: null,
    ...extra,
  }) as unknown as EditSessionEntity;

describe('레거시 관리자 경로 — 보관기간·감사 게이트', () => {
  let service: EditSessionsService;
  let controller: EditSessionsController;
  let table: Record<string, EditSessionEntity>;
  let siteDays: number | null;
  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn() },
  };
  const versionRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver-new', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };
  const audit = { recordOrThrow: jest.fn(), recordBestEffort: jest.fn() };

  const legacyAuditCalls = (): Array<Record<string, unknown>> =>
    audit.recordOrThrow.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((e) => String(e.action).startsWith('staff.legacy.'));

  beforeEach(async () => {
    jest.clearAllMocks();
    siteDays = null;
    table = {
      [MEMBER]: base(MEMBER),
      [GUEST]: base(GUEST, { memberSeqno: 0, guestToken: 'guest-tok', guestExpiresAt: new Date(Date.now() + 3600_000) }),
      [DELETED]: base(DELETED, { deletedAt: new Date() }),
    };
    sessionRepo.findOne.mockImplementation(async (opts: { where: { id: string }; withDeleted?: boolean }) => {
      const s = table[opts.where.id];
      if (!s) return null;
      if (s.deletedAt && !opts.withDeleted) return null;
      return { ...s };
    });
    sessionRepo.save.mockImplementation(async (s: EditSessionEntity) => s);
    sessionRepo.restore.mockResolvedValue({ affected: 1 });
    sessionRepo.manager.query.mockImplementation(async () => [{ days: siteDays }]);
    versionRepo.findOne.mockImplementation(async (opts: { where: { id?: string } }) =>
      opts?.where?.id === VERSION_ID ? { id: VERSION_ID, canvasData: [{ restored: true }], pageCount: 1 } : null,
    );
    audit.recordOrThrow.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepo },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn().mockResolvedValue({ id: 'j' }) } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
        { provide: getRepositoryToken(FileEntity), useValue: { findOne: jest.fn() } },
        { provide: PartnerOperatorAuditWriter, useValue: audit },
      ],
    }).compile();
    service = module.get(EditSessionsService);
    controller = new EditSessionsController(service);
  });

  type Call = () => Promise<unknown>;
  const routes: Array<[string, string, Call, () => jest.Mock]> = [
    ['versions/:vid/restore (비소유 staff)', 'staff.legacy.version_restore', () => controller.restoreVersion(MEMBER, VERSION_ID, admin), () => sessionRepo.save],
    [':id/restore', 'staff.legacy.restore', () => controller.restore(DELETED, admin), () => sessionRepo.restore],
    ['게스트 세션 staff PATCH', 'staff.legacy.guest_update', () => controller.update(GUEST, { canvasData: [{ g: 2 }] } as UpdateEditSessionDto, admin), () => sessionRepo.save],
    ['게스트 세션 staff complete', 'staff.legacy.guest_complete', () => controller.complete(GUEST, admin), () => sessionRepo.save],
  ];

  describe.each(routes)('%s', (_label, action, call, mutation) => {
    it('보관기간 안(또는 미설정) → 감사 행(origin staff, actor=admin id) 후 진행', async () => {
      siteDays = 30;
      await expect(call()).resolves.toBeDefined();
      const rows = legacyAuditCalls();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action,
        origin: 'staff',
        grantId: null,
        actorUserId: ADMIN_ID,
        operatorId: `staff.${ADMIN_ID}`,
        siteId: SITE_A,
      });
      expect(mutation()).toHaveBeenCalled();
    });

    it('만료 → 409 EDIT_RETENTION_EXPIRED, 감사·변경 없음', async () => {
      siteDays = 1; // 세션 생성 2일 전
      const r = await httpError(call());
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EDIT_RETENTION_EXPIRED');
      expect(r.body.retentionUntil).toEqual(expect.any(String));
      expect(legacyAuditCalls()).toHaveLength(0);
      expect(mutation()).not.toHaveBeenCalled();
    });

    it('감사 실패 → 503 STAFF_AUDIT_UNAVAILABLE, 변경 없음', async () => {
      audit.recordOrThrow.mockRejectedValue(new ServiceUnavailableException());
      const r = await httpError(call());
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('STAFF_AUDIT_UNAVAILABLE');
      expect(mutation()).not.toHaveBeenCalled();
    });
  });

  it('사이트 보관기간 조회 실패 → 503(fail-closed), 변경 없음', async () => {
    sessionRepo.manager.query.mockRejectedValue(new Error("Unknown column 'edit_retention_days'"));
    const r = await httpError(controller.restore(DELETED, admin));
    expect(r.status).toBe(503);
    expect(sessionRepo.restore).not.toHaveBeenCalled();
  });

  it('없는 세션 restore → 종전과 같은 404 SESSION_NOT_FOUND', async () => {
    const r = await httpError(controller.restore('99999999-9999-4999-8999-999999999999', admin));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SESSION_NOT_FOUND');
  });

  describe('게이트를 타지 않는 경로', () => {
    it('소유 고객의 버전 복원·수정·완료', async () => {
      await controller.restoreVersion(MEMBER, VERSION_ID, customer);
      await controller.update(MEMBER, { canvasData: [{ c: 1 }] } as UpdateEditSessionDto, customer);
      await controller.complete(MEMBER, customer);
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionRepo.manager.query).not.toHaveBeenCalled();
    });

    it('운영자 대리 편집 권한의 버전 복원(운영자 감사만, 레거시 게이트 없음)', async () => {
      const grant: PartnerOperatorGrant = {
        grantId: '44444444-4444-4444-8444-444444444444',
        operatorId: 'op-1',
        operatorName: null,
        siteId: SITE_A,
        sessionIds: [MEMBER],
        capabilities: ['edit'],
        grantExpiresAt: Math.floor(Date.now() / 1000) + 600,
      };
      const op: PartnerOperatorUser = {
        userId: 'po:op-1',
        email: '',
        name: 'op-1',
        role: 'partner_operator',
        source: 'partner_operator',
        permissions: [],
        siteId: SITE_A,
        siteName: 'A',
        partnerOperator: grant,
      };
      await controller.restoreVersion(MEMBER, VERSION_ID, op);
      expect(legacyAuditCalls()).toHaveLength(0);
      expect(sessionRepo.manager.query).not.toHaveBeenCalled();
    });

    it('게스트 토큰 경로(PATCH guest/:id, guest versions restore)', async () => {
      await controller.updateGuest(GUEST, { canvasData: [{ g: 9 }] } as UpdateEditSessionDto, 'guest-tok');
      await controller.restoreGuestVersion(GUEST, VERSION_ID, 'guest-tok');
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionRepo.manager.query).not.toHaveBeenCalled();
    });

    it('회원 세션 소유자이기도 한 staff 의 버전 복원은 게이트 없음', async () => {
      await controller.restoreVersion(MEMBER, VERSION_ID, { ...admin, userId: '777' });
      expect(legacyAuditCalls()).toHaveLength(0);
    });

    it('admin JWT 가 아닌 staff 역할(소문자, shop 형태)의 게스트 PATCH 는 종전대로(게이트 없음)', async () => {
      await controller.update(GUEST, { canvasData: [{ g: 3 }] } as UpdateEditSessionDto, { userId: '1', role: 'admin', source: 'shop' });
      expect(legacyAuditCalls()).toHaveLength(0);
    });
  });
});
