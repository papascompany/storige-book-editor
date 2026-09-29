/**
 * 관리자 편집데이터 관리(2026-09-29) — EditSessionsService 의 staff 컨텍스트(TenantCaller.staff)와
 * 관리자 발급 운영자 권한(origin 'staff')의 편집 저장 감사. 기존 경로(staff 없음) 불변 회귀 포함.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { EditSessionsService, StaffCallerContext } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import type { PartnerOperatorGrant } from '../auth/partner-operator/partner-operator.types';
import type { UpdateEditSessionDto } from './dto/update-edit-session.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const NULL_SITE = '22222222-2222-4222-8222-222222222222';
const GUEST = '33333333-3333-4333-8333-333333333333';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function httpError(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('expected rejection');
}

const session = (id: string, extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
  ({
    id,
    memberSeqno: 777,
    orderSeqno: 5,
    guestToken: null,
    guestExpiresAt: null,
    siteId: SITE_A,
    status: SessionStatus.EDITING,
    canvasData: [{ page: 1 }],
    metadata: { theme: 'x' },
    contentPdfFileId: null,
    contentPdfMode: null,
    coverFileId: null,
    contentFileId: null,
    templateSetId: null,
    mode: 'both',
    createdAt: new Date(),
    ...extra,
  }) as unknown as EditSessionEntity;

const staffCtx = (extra: Partial<StaffCallerContext> = {}): StaffCallerContext => ({
  userId: ACTOR,
  global: true,
  siteIds: [],
  canDelete: true,
  ...extra,
});

const opGrant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: '44444444-4444-4444-8444-444444444444',
  operatorId: `staff.${ACTOR}`,
  operatorName: 'Storige 관리자',
  siteId: SITE_A,
  sessionIds: [MEMBER],
  capabilities: ['edit'],
  grantExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  origin: 'staff',
  issuedByUserId: ACTOR,
  ...extra,
});

describe('EditSessionsService — staff 컨텍스트', () => {
  let service: EditSessionsService;
  let table: Record<string, EditSessionEntity>;
  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn().mockResolvedValue([]) },
  };
  const versionRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };
  const audit = { recordOrThrow: jest.fn(), recordBestEffort: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    table = {
      [MEMBER]: session(MEMBER),
      [NULL_SITE]: session(NULL_SITE, { siteId: null }),
      [GUEST]: session(GUEST, { memberSeqno: 0, guestToken: 'g-token', guestExpiresAt: new Date(Date.now() + 3600_000) }),
    };
    sessionRepo.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const s = table[opts.where.id];
      return s ? { ...s } : null;
    });
    sessionRepo.save.mockImplementation(async (s: EditSessionEntity) => s);
    sessionRepo.softDelete.mockResolvedValue({ affected: 1 });
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
  });

  describe('회귀 — staff 컨텍스트 없음', () => {
    it('admin 역할 JWT 의 회원 세션 PATCH·complete·DELETE 는 종전대로 403', async () => {
      const caller = { siteId: null, role: 'ADMIN', adminUserId: ACTOR };
      expect((await httpError(service.update(MEMBER, { canvasData: [{ x: 1 }] }, 0, caller))).body.code).toBe('PERMISSION_DENIED');
      expect((await httpError(service.complete(MEMBER, 0, caller))).body.code).toBe('PERMISSION_DENIED');
      expect((await httpError(service.delete(MEMBER, 0, caller))).body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
    });

    it('고객 소유자 경로는 감사 없이 종전대로 저장', async () => {
      await service.update(MEMBER, { canvasData: [{ x: 1 }] }, 777, { siteId: SITE_A, role: 'customer' });
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('staff 컨텍스트', () => {
    it('전역 staff → 회원 세션 update·complete 허용(소유자 판정 대체), NULL-site 도 허용', async () => {
      await service.update(MEMBER, { canvasData: [{ x: 1 }] }, 0, { role: 'ADMIN', staff: staffCtx() });
      const done = await service.complete(MEMBER, 0, { role: 'ADMIN', staff: staffCtx() });
      expect(done.status).toBe(SessionStatus.COMPLETE);
      await service.update(NULL_SITE, { metadata: { a: 1 } }, 0, { role: 'ADMIN', staff: staffCtx() });
      expect(sessionRepo.save).toHaveBeenCalledTimes(3);
    });

    it('사이트 운영자 staff: 자기 사이트 허용, 다른 사이트·NULL-site 는 미존재와 같은 404', async () => {
      const own = { role: 'SITE_ADMIN', staff: staffCtx({ global: false, siteIds: [SITE_A] }) };
      await expect(service.update(MEMBER, { canvasData: [{ y: 1 }] }, 0, own)).resolves.toBeDefined();
      const other = { role: 'SITE_ADMIN', staff: staffCtx({ global: false, siteIds: [SITE_B] }) };
      for (const p of [
        service.update(MEMBER, { canvasData: [] }, 0, other),
        service.complete(MEMBER, 0, other),
        service.delete(MEMBER, 0, other),
        service.update(NULL_SITE, { canvasData: [] }, 0, own),
      ]) {
        const r = await httpError(p);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('SESSION_NOT_FOUND');
      }
      expect(service.isInTenantScope({ siteId: null }, { staff: staffCtx({ global: false, siteIds: [SITE_A] }) })).toBe(false);
    });

    it('delete: canDelete false → 403 STAFF_DELETE_NOT_ALLOWED, true → soft delete', async () => {
      const r = await httpError(service.delete(MEMBER, 0, { role: 'SITE_MANAGER', staff: staffCtx({ global: false, siteIds: [SITE_A], canDelete: false }) }));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('STAFF_DELETE_NOT_ALLOWED');
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
      await service.delete(MEMBER, 0, { role: 'ADMIN', staff: staffCtx() });
      expect(sessionRepo.softDelete).toHaveBeenCalledWith(MEMBER);
    });

    it('staff 컨텍스트 경로는 레거시 게이트를 타지 않는다(게스트 세션도 감사 없이 서비스 호출부가 처리)', async () => {
      await service.update(GUEST, { canvasData: [{ g: 1 }] }, 0, { role: 'ADMIN', staff: staffCtx(), adminUserId: ACTOR });
      await service.complete(GUEST, 0, { role: 'ADMIN', staff: staffCtx(), adminUserId: ACTOR });
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionRepo.manager.query).not.toHaveBeenCalled();
    });
  });

  describe('관리자 발급 운영자 권한(origin staff)의 저장 감사', () => {
    it('canvasData 만 저장 → fail-closed session.update 1행(origin staff, actorUserId=발급자)', async () => {
      await service.update(MEMBER, { canvasData: [{ page: 2 }] } as UpdateEditSessionDto, 0, { partnerOperator: opGrant() });
      expect(audit.recordOrThrow).toHaveBeenCalledTimes(1);
      const entry = audit.recordOrThrow.mock.calls[0][0] as Record<string, unknown>;
      expect(entry).toMatchObject({
        action: 'session.update',
        origin: 'staff',
        actorUserId: ACTOR,
        sessionId: MEMBER,
        operatorId: `staff.${ACTOR}`,
      });
      expect(entry.detail).toMatchObject({ canvasChanged: true, metadataChanged: false, statusChanged: false, fileRefsChanged: false });
      expect(JSON.stringify(entry)).not.toContain('"page":2');
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('metadata 만 저장도 감사, 상태+캔버스 동시 변경은 1행만', async () => {
      await service.update(MEMBER, { metadata: { k: 1 } } as UpdateEditSessionDto, 0, { partnerOperator: opGrant() });
      await service.update(MEMBER, { canvasData: [{ z: 1 }], status: SessionStatus.COMPLETE } as UpdateEditSessionDto, 0, { partnerOperator: opGrant() });
      expect(audit.recordOrThrow).toHaveBeenCalledTimes(2);
      expect((audit.recordOrThrow.mock.calls[1][0] as { detail: Record<string, unknown> }).detail).toMatchObject({
        canvasChanged: true,
        statusChanged: true,
      });
    });

    it('감사 기록 실패 → 503, 저장 안 함', async () => {
      audit.recordOrThrow.mockRejectedValueOnce(new ServiceUnavailableException({ code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE' }));
      const r = await httpError(service.update(MEMBER, { canvasData: [{ page: 3 }] } as UpdateEditSessionDto, 0, { partnerOperator: opGrant() }));
      expect(r.status).toBe(503);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('회귀: 파트너 발급 권한의 캔버스 저장은 fail-closed 감사 행을 새로 만들지 않는다', async () => {
      const partner = opGrant({ origin: 'partner', issuedByUserId: null, operatorId: 'op-7f3c' });
      await service.update(MEMBER, { canvasData: [{ page: 4 }] } as UpdateEditSessionDto, 0, { partnerOperator: partner });
      await service.update(MEMBER, { metadata: { a: 1 } } as UpdateEditSessionDto, 0, { partnerOperator: { ...partner, origin: undefined } });
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionRepo.save).toHaveBeenCalledTimes(2);
      // 상태 변경은 종전대로 1행, origin 키 없음(파트너 기본)
      await service.update(MEMBER, { status: SessionStatus.COMPLETE } as UpdateEditSessionDto, 0, { partnerOperator: partner });
      const entry = audit.recordOrThrow.mock.calls[0][0] as Record<string, unknown>;
      expect(entry).not.toHaveProperty('origin');
      expect(entry).not.toHaveProperty('actorUserId');
    });
  });
});
