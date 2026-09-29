/**
 * 운영자 대리 편집 (2026-09-29, ADDITIVE) — 편집 세션 7개 핸들러의 범위·소유자 대체·삭제 권한·
 * 파일 참조 검사·응답 비노출·감사 기록(fail-closed), 그리고 기존 고객/staff/게스트 규칙 무변경.
 *
 * 실제 EditSessionsService + EditSessionsController, 저장소는 mock.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import type { DynamicModule } from '@nestjs/common';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionsModule } from './edit-sessions.module';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import { PartnerOperatorAuditLogEntity } from '../auth/entities/partner-operator-audit-log.entity';
import type {
  PartnerOperatorGrant,
  PartnerOperatorUser,
} from '../auth/partner-operator/partner-operator.types';
import type { UpdateEditSessionDto } from './dto/update-edit-session.dto';
import type { CreateEditSessionDto } from './dto/create-edit-session.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER = '11111111-1111-4111-8111-111111111111'; // 범위 내 회원 세션(site A)
const GUEST = '22222222-2222-4222-8222-222222222222'; // 범위 내 게스트 세션(site A)
const OTHER_SITE = '33333333-3333-4333-8333-333333333333'; // site B (권한 목록에는 있음)
const NULL_SITE = '44444444-4444-4444-8444-444444444444'; // site NULL (권한 목록에는 있음)
const OUT_OF_SCOPE = '55555555-5555-4555-8555-555555555555'; // site A, 권한 목록에 없음
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const FILE_SAME = '77777777-7777-4777-8777-777777777777';
const FILE_NULL = '88888888-8888-4888-8888-888888888888';
const FILE_OTHER = '99999999-9999-4999-8999-999999999999';
const GID = 'abababab-abab-4bab-8bab-abababababab';

const nowSec = (): number => Math.floor(Date.now() / 1000);

const grant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: GID,
  operatorId: 'op-7f3c',
  operatorName: '운영팀',
  siteId: SITE_A,
  sessionIds: [MEMBER, GUEST, OTHER_SITE, NULL_SITE],
  capabilities: ['edit'],
  onBehalfOfMemberSeqno: 777,
  grantExpiresAt: nowSec() + 3600,
  ...extra,
});

const operator = (g: PartnerOperatorGrant = grant()): PartnerOperatorUser => ({
  userId: `po:${g.operatorId}`,
  email: '',
  name: '운영팀',
  role: 'partner_operator',
  source: 'partner_operator',
  permissions: [],
  siteId: g.siteId,
  siteName: 'Site A',
  partnerOperator: g,
});

const customer = { userId: '777', role: 'customer', source: 'shop', siteId: SITE_A };
const staff = { id: 'admin-1', role: 'ADMIN' };

function baseSession(id: string, extra: Partial<EditSessionEntity> = {}): EditSessionEntity {
  return {
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
    ...extra,
  } as unknown as EditSessionEntity;
}

function sessionsTable(): Record<string, EditSessionEntity> {
  return {
    [MEMBER]: baseSession(MEMBER),
    [GUEST]: baseSession(GUEST, {
      memberSeqno: 0,
      guestToken: 'guest-secret-token',
      guestExpiresAt: new Date(Date.now() + 3600_000),
    }),
    [OTHER_SITE]: baseSession(OTHER_SITE, { siteId: SITE_B }),
    [NULL_SITE]: baseSession(NULL_SITE, { siteId: null }),
    [OUT_OF_SCOPE]: baseSession(OUT_OF_SCOPE),
  };
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

describe('운영자 대리 편집 — EditSessions', () => {
  let service: EditSessionsService;
  let controller: EditSessionsController;
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
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver-new', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };
  const fileRepo = { findOne: jest.fn() };
  const audit = { recordOrThrow: jest.fn(), recordBestEffort: jest.fn(), list: jest.fn() };
  const workerJobs = { createValidationJob: jest.fn().mockResolvedValue({ id: 'job' }) };

  const build = async (withOperatorDeps = true): Promise<void> => {
    const providers = [
      EditSessionsService,
      { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
      { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepo },
      { provide: WorkerJobsService, useValue: workerJobs },
      { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
      ...(withOperatorDeps
        ? [
            { provide: getRepositoryToken(FileEntity), useValue: fileRepo },
            { provide: PartnerOperatorAuditWriter, useValue: audit },
          ]
        : []),
    ];
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    service = module.get(EditSessionsService);
    controller = new EditSessionsController(service);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    table = sessionsTable();
    sessionRepo.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const s = table[opts.where.id];
      return s ? { ...s } : null;
    });
    sessionRepo.save.mockImplementation(async (s: EditSessionEntity) => s);
    sessionRepo.softDelete.mockResolvedValue({ affected: 1 });
    versionRepo.find.mockResolvedValue([]);
    versionRepo.findOne.mockImplementation(async (opts: { where: { id?: string } }) =>
      opts?.where?.id === VERSION_ID ? { id: VERSION_ID, canvasData: [{ restored: true }], pageCount: 1 } : null,
    );
    audit.recordOrThrow.mockResolvedValue(undefined);
    fileRepo.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const files: Record<string, { id: string; siteId: string | null }> = {
        [FILE_SAME]: { id: FILE_SAME, siteId: SITE_A },
        [FILE_NULL]: { id: FILE_NULL, siteId: null },
        [FILE_OTHER]: { id: FILE_OTHER, siteId: SITE_B },
      };
      return files[opts.where.id] ?? null;
    });
    await build();
  });

  // ───────────────── 7개 핸들러 × 범위 매트릭스 ─────────────────
  type Op = (id: string, user: unknown) => Promise<unknown>;
  const handlers: Array<[string, Op]> = [
    ['findOne', (id, u) => controller.findOne(id, u)],
    ['update', (id, u) => controller.update(id, { canvasData: [{ page: 2 }] } as UpdateEditSessionDto, u)],
    ['complete', (id, u) => controller.complete(id, u)],
    ['delete', (id, u) => controller.delete(id, u)],
    ['listVersions', (id, u) => controller.listVersions(id, u)],
    ['getVersion', (id, u) => controller.getVersion(id, VERSION_ID, u)],
    ['restoreVersion', (id, u) => controller.restoreVersion(id, VERSION_ID, u)],
  ];
  const deleteOperator = operator(grant({ capabilities: ['edit', 'delete'] }));

  describe.each(handlers)('%s', (name, call) => {
    it('범위 내 회원 세션 → 성공', async () => {
      await expect(call(MEMBER, deleteOperator)).resolves.toBeDefined();
    });

    if (['update', 'complete', 'delete', 'findOne'].includes(name)) {
      it('범위 내 게스트 세션 → 성공', async () => {
        await expect(call(GUEST, deleteOperator)).resolves.toBeDefined();
      });
    }

    it.each([
      ['다른 사이트 세션(권한 목록에 있어도)', OTHER_SITE, deleteOperator],
      ['NULL-site 세션(권한 목록에 있어도)', NULL_SITE, deleteOperator],
      ['같은 사이트·권한 목록 밖 세션', OUT_OF_SCOPE, deleteOperator],
      ['만료된 권한', MEMBER, operator(grant({ capabilities: ['edit', 'delete'], grantExpiresAt: nowSec() - 1 }))],
      ['다른 사이트 권한', MEMBER, operator(grant({ capabilities: ['edit', 'delete'], siteId: SITE_B }))],
    ])('%s → 404 SESSION_NOT_FOUND, 저장·삭제 없음', async (_l, id, user) => {
      const r = await httpError(call(id, user));
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });
  });

  // ───────────────── 삭제 권한 ─────────────────
  describe('delete 권한', () => {
    it("'delete' 권한 없음 → 403 PARTNER_OPERATOR_CAPABILITY_REQUIRED, softDelete 없음", async () => {
      const r = await httpError(controller.delete(MEMBER, operator()));
      expect(r.status).toBe(403);
      expect(r.body).toEqual({
        code: 'PARTNER_OPERATOR_CAPABILITY_REQUIRED',
        message: '이 운영자 권한에는 삭제가 포함되어 있지 않습니다.',
      });
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
    });

    it('범위 판정(404)이 권한 판정(403)보다 먼저', async () => {
      const r = await httpError(controller.delete(OTHER_SITE, operator()));
      expect(r.status).toBe(404);
    });

    it('삭제 감사 행(statusFrom·orderSeqno)이 softDelete 보다 먼저', async () => {
      await controller.delete(MEMBER, deleteOperator);
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session.delete',
          sessionId: MEMBER,
          grantId: GID,
          siteId: SITE_A,
          operatorId: 'op-7f3c',
          detail: { statusFrom: SessionStatus.EDITING, orderSeqno: 5 },
        }),
      );
      expect(audit.recordOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
        sessionRepo.softDelete.mock.invocationCallOrder[0],
      );
    });
  });

  // ───────────────── 게스트 생성 거부 ─────────────────
  it('POST /edit-sessions/guest 운영자 → 403 PARTNER_OPERATOR_ROUTE_NOT_ALLOWED, 세션 생성 없음', async () => {
    const createSpy = jest.spyOn(service, 'create');
    const stampUser = { userId: 'po:op', source: 'partner_operator', siteId: SITE_A, grantId: GID, operatorId: 'op' };
    const r = await httpError(controller.createGuest({} as CreateEditSessionDto, stampUser));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PARTNER_OPERATOR_ROUTE_NOT_ALLOWED');
    expect(createSpy).not.toHaveBeenCalled();
  });

  // ───────────────── 응답 비노출 ─────────────────
  describe('응답에서 guestToken 제거(운영자만)', () => {
    it.each<[string, (u: unknown) => Promise<Record<string, unknown>>]>([
      ['findOne', (u) => controller.findOne(GUEST, u) as unknown as Promise<Record<string, unknown>>],
      ['update', (u) => controller.update(GUEST, { canvasData: [{ p: 9 }] } as UpdateEditSessionDto, u) as unknown as Promise<Record<string, unknown>>],
      ['complete', (u) => controller.complete(GUEST, u) as unknown as Promise<Record<string, unknown>>],
      ['restoreVersion', (u) => controller.restoreVersion(GUEST, VERSION_ID, u) as unknown as Promise<Record<string, unknown>>],
    ])('%s: 운영자 응답에 guestToken/guestExpiresAt 키 없음', async (_l, call) => {
      const out = await call(operator());
      expect(out).not.toHaveProperty('guestToken');
      expect(out).not.toHaveProperty('guestExpiresAt');
      expect(JSON.stringify(out)).not.toContain('guest-secret-token');
    });

    it('회귀: 고객(소유자) 응답은 guestToken 키를 그대로 가진다', async () => {
      const out = (await controller.findOne(MEMBER, customer)) as unknown as Record<string, unknown>;
      expect(out).toHaveProperty('guestToken', null);
      expect(out).toHaveProperty('guestExpiresAt', null);
    });
  });

  // ───────────────── 감사 기록 ─────────────────
  describe('상태 변경 감사(fail-closed)', () => {
    it('update 상태 변경 → session.update(statusFrom/statusTo) 가 save 보다 먼저', async () => {
      await controller.update(MEMBER, { status: SessionStatus.COMPLETE } as UpdateEditSessionDto, operator());
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session.update',
          sessionId: MEMBER,
          detail: { statusFrom: SessionStatus.EDITING, statusTo: SessionStatus.COMPLETE, fileRefs: {} },
        }),
      );
      expect(audit.recordOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
        sessionRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('update 파일 참조 변경 → fileRefs 기록', async () => {
      await controller.update(MEMBER, { coverFileId: FILE_SAME } as UpdateEditSessionDto, operator());
      expect(audit.recordOrThrow.mock.calls[0][0].detail).toEqual({
        statusFrom: SessionStatus.EDITING,
        statusTo: SessionStatus.EDITING,
        fileRefs: { cover: FILE_SAME },
      });
    });

    it('일반 캔버스 자동저장 → 의미 감사 행 없음(요청 행은 인터셉터 담당)', async () => {
      await controller.update(MEMBER, { canvasData: [{ page: 2 }] } as UpdateEditSessionDto, operator());
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('complete → session.complete(statusFrom) 가 save 보다 먼저', async () => {
      await controller.complete(MEMBER, operator());
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'session.complete', detail: { statusFrom: SessionStatus.EDITING } }),
      );
      expect(audit.recordOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
        sessionRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('restoreVersion → session.version_restore(versionId, statusFrom)', async () => {
      await controller.restoreVersion(MEMBER, VERSION_ID, operator());
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session.version_restore',
          detail: { versionId: VERSION_ID, statusFrom: SessionStatus.EDITING },
        }),
      );
    });

    it.each<[string, () => Promise<unknown>, () => jest.Mock[]]>([
      ['update(status)', () => controller.update(MEMBER, { status: SessionStatus.COMPLETE } as UpdateEditSessionDto, operator()), () => [sessionRepo.save]],
      ['complete', () => controller.complete(MEMBER, operator()), () => [sessionRepo.save]],
      ['delete', () => controller.delete(MEMBER, deleteOperator), () => [sessionRepo.softDelete]],
      ['restoreVersion', () => controller.restoreVersion(MEMBER, VERSION_ID, operator()), () => [sessionRepo.save, versionRepo.save]],
    ])('%s: 감사 저장 실패 → 503 PARTNER_OPERATOR_AUDIT_UNAVAILABLE, 변경 없음', async (_l, call, mutators) => {
      audit.recordOrThrow.mockRejectedValue(
        new ServiceUnavailableException({ code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE', message: 'x' }),
      );
      const r = await httpError(call());
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('PARTNER_OPERATOR_AUDIT_UNAVAILABLE');
      for (const m of mutators()) expect(m).not.toHaveBeenCalled();
    });

    it('감사 기록기 미주입 구성 → 운영자 상태 변경 503 (fail-closed)', async () => {
      await build(false);
      const r = await httpError(controller.complete(MEMBER, operator()));
      expect(r.status).toBe(503);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('세션 metadata 에 운영자 정보를 쓰지 않는다', async () => {
      await controller.update(
        MEMBER,
        { status: SessionStatus.COMPLETE, metadata: { page: 3 } } as unknown as UpdateEditSessionDto,
        operator(),
      );
      await controller.complete(MEMBER, operator());
      for (const [saved] of sessionRepo.save.mock.calls as Array<[EditSessionEntity]>) {
        const meta = JSON.stringify(saved.metadata ?? {});
        expect(meta).not.toContain('op-7f3c');
        expect(meta).not.toContain(GID);
        expect(meta).not.toContain('partner');
      }
    });

    it('운영자 쓰기의 버전 스냅샷 created_by 는 null', async () => {
      await controller.update(MEMBER, { canvasData: [{ page: 2 }] } as UpdateEditSessionDto, operator());
      expect(versionRepo.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: null }));
    });
  });

  // ───────────────── 파일 참조 검사 ─────────────────
  describe('운영자 파일 참조 검사', () => {
    it.each([
      ['coverFileId', { coverFileId: FILE_OTHER }],
      ['contentFileId', { contentFileId: FILE_OTHER }],
      ['contentPdfFileId', { contentPdfFileId: FILE_OTHER }],
      ['존재하지 않는 파일', { coverFileId: 'deadbeef-dead-4ead-8ead-deaddeaddead' }],
    ])('%s 다른 사이트/없음 → 400 FILE_NOT_IN_SCOPE, 저장 없음', async (_l, dto) => {
      const r = await httpError(controller.update(MEMBER, dto as UpdateEditSessionDto, operator()));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('FILE_NOT_IN_SCOPE');
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });

    it('NULL-site·같은 사이트 파일 → 통과', async () => {
      await controller.update(MEMBER, { coverFileId: FILE_NULL, contentFileId: FILE_SAME } as UpdateEditSessionDto, operator());
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
      expect(fileRepo.findOne).toHaveBeenCalledWith({ where: { id: FILE_NULL }, select: ['id', 'siteId'] });
    });

    it('회귀: 고객은 파일 참조 검사를 받지 않는다(종전 동작)', async () => {
      await controller.update(MEMBER, { coverFileId: FILE_OTHER } as UpdateEditSessionDto, customer);
      expect(fileRepo.findOne).not.toHaveBeenCalled();
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────── 회귀: 기존 규칙 ─────────────────
  describe('회귀 — 고객·staff·게스트 규칙 불변', () => {
    it('isStaffRole(partner_operator) === false', () => {
      expect(EditSessionsService.isStaffRole('partner_operator')).toBe(false);
    });

    it('고객 소유자 → 성공 / 비소유 고객 → 403 PERMISSION_DENIED', async () => {
      await expect(controller.findOne(MEMBER, customer)).resolves.toBeDefined();
      const r = await httpError(controller.findOne(MEMBER, { ...customer, userId: '999' }));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
    });

    it('고객: 게스트 세션 회원 경로 update → 403 / complete → 403 GUEST_COMPLETE_NOT_ALLOWED', async () => {
      expect((await httpError(controller.update(GUEST, {} as UpdateEditSessionDto, customer))).status).toBe(403);
      const r = await httpError(controller.complete(GUEST, customer));
      expect(r.body.code).toBe('GUEST_COMPLETE_NOT_ALLOWED');
    });

    it('고객 삭제는 소유자만(권한 코드는 종전 PERMISSION_DENIED)', async () => {
      const r = await httpError(controller.delete(MEMBER, { ...customer, userId: '999' }));
      expect(r.body.code).toBe('PERMISSION_DENIED');
      await controller.delete(MEMBER, customer);
      expect(sessionRepo.softDelete).toHaveBeenCalledWith(MEMBER);
    });

    it('게스트 토큰 경로(guestVerified) → 저장', async () => {
      await service.update(GUEST, { canvasData: [{ g: 1 }] } as UpdateEditSessionDto, 0, null, { guestVerified: true });
      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('staff 는 교차 사이트도 조회(종전)', async () => {
      await expect(controller.findOne(OTHER_SITE, staff)).resolves.toBeDefined();
    });

    it('고객 caller 규칙: NULL-site 세션은 종전대로 범위 안', () => {
      expect(service.isInTenantScope({ siteId: null }, { siteId: SITE_A, role: 'customer' })).toBe(true);
      expect(service.isInTenantScope({ id: NULL_SITE, siteId: null }, { partnerOperator: grant() })).toBe(false);
    });

    it('고객 경로는 감사 기록기를 호출하지 않는다', async () => {
      await controller.update(MEMBER, { status: SessionStatus.COMPLETE } as UpdateEditSessionDto, customer);
      await controller.complete(MEMBER, customer);
      await controller.delete(MEMBER, customer);
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });

    it('비운영자 사용자의 source 만 partner_operator 인 경우(권한 객체 없음) → 소유자 대체 없음', async () => {
      const r = await httpError(
        controller.update(MEMBER, {} as UpdateEditSessionDto, { userId: 'po:x', source: 'partner_operator', siteId: SITE_A }),
      );
      expect(r.status).toBe(403);
    });
  });

  // ───────────────── 모듈 배선 ─────────────────
  it('EditSessionsModule: 감사 기록기 등록 + FileEntity·감사 엔티티 저장소 등록', () => {
    const providers = (Reflect.getMetadata('providers', EditSessionsModule) ?? []) as unknown[];
    expect(providers).toContain(PartnerOperatorAuditWriter);
    const imports = (Reflect.getMetadata('imports', EditSessionsModule) ?? []) as unknown[];
    const typeorm = imports.find((m): m is DynamicModule => (m as DynamicModule)?.module === TypeOrmModule);
    const tokens = (typeorm?.providers ?? []).map((p) => (p as { provide: unknown }).provide);
    expect(tokens).toEqual(
      expect.arrayContaining([
        getRepositoryToken(FileEntity),
        getRepositoryToken(PartnerOperatorAuditLogEntity),
        getRepositoryToken(EditSessionEntity),
      ]),
    );
  });
});
