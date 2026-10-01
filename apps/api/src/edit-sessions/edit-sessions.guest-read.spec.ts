/**
 * 세션 상세 조회·삭제·수정·완료의 회원 소유 판정.
 *
 *  - 회원 경로의 회원 번호는 양의 정수만 회원으로 본다(없음·0·음수·소수·지수표기·비숫자는 어떤 세션의 소유자도 아님).
 *  - findOne(GET :id): 회원 번호가 양의 정수가 아닌 shop 토큰의 게스트 세션 조회는 403 GUEST_TOKEN_REQUIRED
 *    + 운영 관측 로그 1줄(토큰 원문 없음). 그 밖의 거부는 PERMISSION_DENIED.
 *  - delete(DELETE :id): 같은 호출자의 게스트 세션 삭제는 403 PERMISSION_DENIED + 관측 로그 1줄.
 *  - 회원 경로 응답(:id 계열·삭제 목록·복구)은 게스트 세션의 guestToken 을 포함하지 않는다(staff 는 guestExpiresAt 유지).
 *  - 목록(GET /edit-sessions) 판정은 edit-sessions.list-member-seqno.spec.ts 에서 다룬다.
 *
 * 실제 EditSessionsService + EditSessionsController(직접 생성), 저장소는 mock.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, Logger } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import type {
  PartnerOperatorGrant,
  PartnerOperatorUser,
} from '../auth/partner-operator/partner-operator.types';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_SESSION = '11111111-1111-4111-8111-111111111111'; // 회원 123 세션(site A)
const GUEST_SESSION = '22222222-2222-4222-8222-222222222222'; // 게스트 세션(site A, memberSeqno 0)
const OTHER_MEMBER_SESSION = '33333333-3333-4333-8333-333333333333'; // 회원 456 세션(site A)
const UNOWNED_SESSION = '55555555-5555-4555-8555-555555555555'; // memberSeqno 0·guestToken 없음(site A)
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const GUEST_TOKEN = 'guest-token-value-7c1e';

const nowSec = (): number => Math.floor(Date.now() / 1000);

function baseSession(id: string, extra: Partial<EditSessionEntity> = {}): EditSessionEntity {
  return {
    id,
    memberSeqno: 123,
    orderSeqno: 100,
    guestToken: null,
    guestExpiresAt: null,
    siteId: SITE_A,
    status: SessionStatus.EDITING,
    canvasData: [{ page: 1 }],
    metadata: null,
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
    [MEMBER_SESSION]: baseSession(MEMBER_SESSION),
    [GUEST_SESSION]: baseSession(GUEST_SESSION, {
      memberSeqno: 0,
      guestToken: GUEST_TOKEN,
      guestExpiresAt: new Date(Date.now() + 3600_000),
    }),
    [OTHER_MEMBER_SESSION]: baseSession(OTHER_MEMBER_SESSION, { memberSeqno: 456 }),
    [UNOWNED_SESSION]: baseSession(UNOWNED_SESSION, { memberSeqno: 0 }),
  };
}

// ── 호출자 ────────────────────────────────────────────────────────────
/** admin-app JWT → JwtStrategy 가 User 엔티티를 그대로 반환(userId 없음, source 없음). */
const adminAppUser = (role: string): Record<string, unknown> => ({
  id: `admin-${role.toLowerCase()}`,
  email: `${role.toLowerCase()}@example.com`,
  role,
});
/** shop-session JWT → { userId: sub, source: 'shop', ... } */
const shopUser = (sub: string): Record<string, unknown> => ({
  userId: sub,
  role: 'customer',
  source: 'shop',
  siteId: SITE_A,
});

const grant = (): PartnerOperatorGrant => ({
  grantId: 'abababab-abab-4bab-8bab-abababababab',
  operatorId: 'op-7f3c',
  operatorName: '운영팀',
  siteId: SITE_A,
  sessionIds: [GUEST_SESSION, MEMBER_SESSION],
  capabilities: ['edit'],
  onBehalfOfMemberSeqno: 777,
  grantExpiresAt: nowSec() + 3600,
});
const operator = (): PartnerOperatorUser => ({
  userId: 'po:op-7f3c',
  email: '',
  name: '운영팀',
  role: 'partner_operator',
  source: 'partner_operator',
  permissions: [],
  siteId: SITE_A,
  siteName: 'Site A',
  partnerOperator: grant(),
});

async function httpError(
  p: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) {
      return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    }
    throw e;
  }
  throw new Error('expected rejection');
}

describe('EditSessionsController — 상세 조회·삭제 소유 판정 (2026-09-30)', () => {
  let service: EditSessionsService;
  let controller: EditSessionsController;
  let table: Record<string, EditSessionEntity>;
  let logSpy: jest.SpyInstance;
  let serviceLogSpy: jest.SpyInstance;

  const sessionRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn().mockResolvedValue([]) },
  };
  const versionRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const audit = { recordOrThrow: jest.fn(), recordBestEffort: jest.fn(), list: jest.fn() };
  const workerJobs = { createValidationJob: jest.fn().mockResolvedValue({ id: 'job' }) };

  /** 컨트롤러가 남긴 게스트 조회 관측 로그 메시지 */
  const guestReadLogs = (): string[] =>
    logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.startsWith('[guest-read]'));
  /** 서비스가 남긴 게스트 삭제 관측 로그 메시지 */
  const guestDeleteLogs = (): string[] =>
    serviceLogSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.startsWith('[guest-delete]'));
  /** 모든 로그 호출(컨트롤러·서비스)에 게스트 토큰 원문이 없다 */
  const expectNoTokenInLogs = (): void => {
    for (const call of [...logSpy.mock.calls, ...serviceLogSpy.mock.calls] as unknown[][]) {
      expect(JSON.stringify(call)).not.toContain(GUEST_TOKEN);
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    table = sessionsTable();
    sessionRepo.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const s = table[opts.where.id];
      return s ? { ...s } : null;
    });
    sessionRepo.find.mockImplementation(async (opts: { where: { memberSeqno?: number; orderSeqno?: number } }) =>
      Object.values(table).filter((s) =>
        opts.where.memberSeqno !== undefined
          ? Number(s.memberSeqno) === opts.where.memberSeqno
          : Number(s.orderSeqno) === opts.where.orderSeqno,
      ),
    );
    sessionRepo.softDelete.mockResolvedValue({ affected: 1 });
    sessionRepo.save.mockImplementation(async (s: EditSessionEntity) => s);
    versionRepo.findOne.mockImplementation(async (opts: { where: { id?: string } }) =>
      opts?.where?.id === VERSION_ID ? { id: VERSION_ID, canvasData: [{ restored: true }], pageCount: 1 } : null,
    );
    audit.recordOrThrow.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepo },
        { provide: WorkerJobsService, useValue: workerJobs },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
        { provide: getRepositoryToken(FileEntity), useValue: { findOne: jest.fn() } },
        { provide: PartnerOperatorAuditWriter, useValue: audit },
      ],
    }).compile();
    service = module.get(EditSessionsService);
    controller = new EditSessionsController(service);
    const controllerLogger = (controller as unknown as { logger: Logger }).logger;
    logSpy = jest.spyOn(controllerLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(controllerLogger, 'warn').mockImplementation(() => undefined);
    const serviceLogger = (service as unknown as { logger: Logger }).logger;
    serviceLogSpy = jest.spyOn(serviceLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(serviceLogger, 'warn').mockImplementation(() => undefined);
  });

  // ───────────────── findOne (GET :id) ─────────────────
  describe('findOne', () => {
    it('M1: admin-app CUSTOMER(userId 없음)의 게스트 세션 조회 → 403 PERMISSION_DENIED', async () => {
      const r = await httpError(controller.findOne(GUEST_SESSION, adminAppUser('CUSTOMER')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
    });

    it.each(['SITE_MANAGER', 'SITE_ADMIN'])(
      'M2: admin-app %s(userId 없음)의 게스트 세션 조회 → 403 PERMISSION_DENIED',
      async (role) => {
        const r = await httpError(controller.findOne(GUEST_SESSION, adminAppUser(role)));
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('PERMISSION_DENIED');
      },
    );

    it.each(['ADMIN', 'MANAGER', 'SUPER_ADMIN'])(
      'M3: admin-app %s(staff)의 게스트 세션 조회 → 200, guestToken 키 없음·guestExpiresAt 있음',
      async (role) => {
        const out = (await controller.findOne(GUEST_SESSION, adminAppUser(role))) as unknown as Record<string, unknown>;
        expect(out.id).toBe(GUEST_SESSION);
        expect('guestToken' in out).toBe(false);
        expect(out.guestExpiresAt).toBeInstanceOf(Date);
        expect(JSON.stringify(out)).not.toContain(GUEST_TOKEN);
        expect(guestReadLogs()).toEqual([]);
      },
    );

    it.each<[string, (u: Record<string, unknown>) => Promise<unknown>]>([
      ['update', (u) => controller.update(GUEST_SESSION, { canvasData: [{ p: 9 }] } as never, u)],
      ['complete', (u) => controller.complete(GUEST_SESSION, u)],
      ['restoreVersion', (u) => controller.restoreVersion(GUEST_SESSION, VERSION_ID, u)],
    ])('M3-b: admin-app ADMIN(staff)의 게스트 세션 %s 응답 → guestToken 키 없음·guestExpiresAt 있음', async (_l, call) => {
      const out = (await call(adminAppUser('ADMIN'))) as Record<string, unknown>;
      expect(out.id).toBe(GUEST_SESSION);
      expect('guestToken' in out).toBe(false);
      expect(out.guestExpiresAt).toBeInstanceOf(Date);
      expect(JSON.stringify(out)).not.toContain(GUEST_TOKEN);
    });

    it('M4: 회원 번호 0 shop 토큰의 게스트 세션 상세 → 403 GUEST_TOKEN_REQUIRED, 본문에 canvasData·guestToken 없음', async () => {
      const r = await httpError(controller.findOne(GUEST_SESSION, shopUser('0')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('GUEST_TOKEN_REQUIRED');
      expect(r.body).not.toHaveProperty('canvasData');
      expect(JSON.stringify(r.body)).not.toContain(GUEST_TOKEN);
    });

    it('M5: shop 회원 123 → 자기 세션 200, 다른 회원 세션 403 (불변)', async () => {
      const own = await controller.findOne(MEMBER_SESSION, shopUser('123'));
      expect(own.id).toBe(MEMBER_SESSION);
      const r = await httpError(controller.findOne(OTHER_MEMBER_SESSION, shopUser('123')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
      // 회원 123 은 게스트 세션의 소유자가 아니다(불변)
      const g = await httpError(controller.findOne(GUEST_SESSION, shopUser('123')));
      expect(g.status).toBe(403);
      expect(guestReadLogs()).toEqual([]);
    });

    it('M6: 범위 안 운영자 → 200 + guestToken/guestExpiresAt 제거 (응답 규칙 불변)', async () => {
      const out = (await controller.findOne(GUEST_SESSION, operator())) as unknown as Record<string, unknown>;
      expect(out.id).toBe(GUEST_SESSION);
      expect('guestToken' in out).toBe(false);
      expect('guestExpiresAt' in out).toBe(false);
      expect(guestReadLogs()).toEqual([]);
    });

    it('M7: M4 거부 시 관측 로그 1회 — 세션 id·site·출처만, 토큰 원문 없음', async () => {
      await httpError(controller.findOne(GUEST_SESSION, shopUser('0')));
      const logs = guestReadLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(`[guest-read] denied-member-route session=${GUEST_SESSION} site=${SITE_A} source=shop`);
      expectNoTokenInLogs();
    });

    it('M7-b: 회원 세션 조회에는 관측 로그를 남기지 않는다', async () => {
      await controller.findOne(MEMBER_SESSION, shopUser('123'));
      await controller.findOne(MEMBER_SESSION, adminAppUser('ADMIN'));
      expect(guestReadLogs()).toEqual([]);
    });

    it('M8: 회원 번호 0 shop 토큰의 무주 세션(memberSeqno 0·guestToken 없음) 조회·삭제 → 403 PERMISSION_DENIED', async () => {
      const r = await httpError(controller.findOne(UNOWNED_SESSION, shopUser('0')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
      const d = await httpError(controller.delete(UNOWNED_SESSION, shopUser('0')));
      expect(d.status).toBe(403);
      expect(d.body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
      expect(guestReadLogs()).toEqual([]);
      expect(guestDeleteLogs()).toEqual([]);
    });

    it.each<[string, number]>([
      ['-5', -5],
      ['1.5', 1],
      ['0.5', 0],
      ['1e+21', 1],
    ])(
      "M9: shop sub '%s' → memberSeqno %d 세션의 조회·삭제·수정·완료 모두 403 PERMISSION_DENIED, 저장·삭제 없음",
      async (sub, memberSeqno) => {
        table[UNOWNED_SESSION] = baseSession(UNOWNED_SESSION, { memberSeqno });
        const user = shopUser(sub);
        for (const p of [
          controller.findOne(UNOWNED_SESSION, user),
          controller.delete(UNOWNED_SESSION, user),
          controller.update(UNOWNED_SESSION, { canvasData: [{ p: 2 }] } as never, user),
          controller.complete(UNOWNED_SESSION, user),
        ]) {
          const r = await httpError(p);
          expect(r.status).toBe(403);
          expect(r.body.code).toBe('PERMISSION_DENIED');
        }
        expect(sessionRepo.softDelete).not.toHaveBeenCalled();
        expect(sessionRepo.save).not.toHaveBeenCalled();
      },
    );

    it('M10: shop 회원 123 의 자기 회원 세션 조회 응답은 guestToken: null 키를 유지한다', async () => {
      const out = (await controller.findOne(MEMBER_SESSION, shopUser('123'))) as unknown as Record<string, unknown>;
      expect(out).toHaveProperty('guestToken', null);
      expect(out).toHaveProperty('guestExpiresAt', null);
    });
  });

  // ───────────────── staff 전용 삭제 목록·복구 응답 ─────────────────
  describe('staff 삭제 목록·복구 응답', () => {
    it('M11: GET deleted 목록의 게스트 세션 항목 → guestToken 키 없음·guestExpiresAt 있음, 회원 세션은 guestToken: null', async () => {
      jest.spyOn(service, 'findDeleted').mockImplementation(async () => {
        const sessions = [table[GUEST_SESSION], table[MEMBER_SESSION]].map((s) => service.toSummaryResponseDto(s, null));
        return { sessions, total: sessions.length };
      });
      const out = await controller.findDeleted(adminAppUser('ADMIN'));
      const guest = out.sessions.find((s) => s.id === GUEST_SESSION) as unknown as Record<string, unknown>;
      const member = out.sessions.find((s) => s.id === MEMBER_SESSION) as unknown as Record<string, unknown>;
      expect('guestToken' in guest).toBe(false);
      expect(guest.guestExpiresAt).toBeInstanceOf(Date);
      expect(member).toHaveProperty('guestToken', null);
      expect(JSON.stringify(out)).not.toContain(GUEST_TOKEN);
    });

    it('M12: POST :id/restore 의 게스트 세션 응답 → guestToken 키 없음·guestExpiresAt 있음', async () => {
      const out = (await controller.restore(GUEST_SESSION, adminAppUser('ADMIN'))) as unknown as Record<string, unknown>;
      expect(out.id).toBe(GUEST_SESSION);
      expect('guestToken' in out).toBe(false);
      expect(out.guestExpiresAt).toBeInstanceOf(Date);
    });
  });

  // ───────────────── delete (DELETE :id) ─────────────────
  describe('delete', () => {
    it('D1: admin-app CUSTOMER(userId 없음)의 게스트 세션 삭제 → 403 PERMISSION_DENIED, softDelete 미호출', async () => {
      const r = await httpError(controller.delete(GUEST_SESSION, adminAppUser('CUSTOMER')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
    });

    it('D2: 회원 번호 0 shop 토큰의 게스트 세션 삭제 → 403 PERMISSION_DENIED, softDelete 미호출, 관측 로그 1회(토큰 원문 없음)', async () => {
      const r = await httpError(controller.delete(GUEST_SESSION, shopUser('0')));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
      expect(guestDeleteLogs()).toEqual([
        `[guest-delete] denied-member-route session=${GUEST_SESSION} site=${SITE_A}`,
      ]);
      expectNoTokenInLogs();
    });

    it('D3: shop 회원 본인 세션 삭제 → 성공, 다른 회원 세션 → 403 (불변)', async () => {
      await expect(controller.delete(MEMBER_SESSION, shopUser('123'))).resolves.toEqual({ success: true });
      expect(sessionRepo.softDelete).toHaveBeenCalledWith(MEMBER_SESSION);
      sessionRepo.softDelete.mockClear();
      const r = await httpError(controller.delete(OTHER_MEMBER_SESSION, shopUser('123')));
      expect(r.status).toBe(403);
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
    });

    it.each(['ADMIN', 'MANAGER', 'SUPER_ADMIN'])(
      'D4: admin-app %s 의 레거시 DELETE :id 게스트 세션 삭제 → 403 PERMISSION_DENIED (관리자 삭제는 /admin/edit-data 경로)',
      async (role) => {
        const r = await httpError(controller.delete(GUEST_SESSION, adminAppUser(role)));
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('PERMISSION_DENIED');
        expect(sessionRepo.softDelete).not.toHaveBeenCalled();
      },
    );
  });
});
