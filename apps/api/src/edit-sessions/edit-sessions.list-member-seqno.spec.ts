/**
 * 세션 목록(GET /edit-sessions)의 회원 번호 판정 정리 (2026-09-30).
 *
 *  - 비-staff 의 회원 번호 0 조회는 403, 회원 번호 0 호출자의 기본 목록은 빈 목록.
 *  - 비숫자 회원 번호 조회 403 은 종전 동작 그대로.
 *  - orderSeqno 분기: 주문권한이 없는 회원 번호 0 호출자는 빈 목록, 주문 번호 0 은 주문권한 판정에 쓰지 않음.
 *    주문권한(allowedOrderSeqnos)이 있는 호출자는 그 주문의 세션 목록(종전과 동일).
 *  - siteId 분기: shop 토큰은 자기 site 여도 403 FORBIDDEN_SITE_QUERY.
 *  - staff·음수 회원 번호와 admin-app 사용자 목록은 불변.
 *
 * 실제 EditSessionsService + EditSessionsController(직접 생성), 저장소는 mock.
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_SESSION = '11111111-1111-4111-8111-111111111111'; // 회원 123 세션(site A)
const GUEST_SESSION = '22222222-2222-4222-8222-222222222222'; // 게스트 세션(site A, memberSeqno 0)
const OTHER_MEMBER_SESSION = '33333333-3333-4333-8333-333333333333'; // 회원 456 세션(site A)
const NEGATIVE_MEMBER_SESSION = '44444444-4444-4444-8444-444444444444'; // 회원 -5 세션(site A)
const GUEST_TOKEN = 'guest-token-value-7c1e';

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

describe('EditSessionsController — 목록 회원 번호 판정 (2026-09-30)', () => {
  let service: EditSessionsService;
  let controller: EditSessionsController;
  let table: Record<string, EditSessionEntity>;
  let findByMemberSeqnoSpy: jest.SpyInstance;

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

  const ids = (r: { sessions: Array<{ id: string }> }): string[] => r.sessions.map((s) => s.id);

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepo },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn() } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
        { provide: getRepositoryToken(FileEntity), useValue: { findOne: jest.fn() } },
        { provide: PartnerOperatorAuditWriter, useValue: audit },
      ],
    }).compile();
    service = module.get(EditSessionsService);
    controller = new EditSessionsController(service);
    findByMemberSeqnoSpy = jest.spyOn(service, 'findByMemberSeqno');
  });

  it.each(['0', '0.5'])(
    "L1: shop sub '%s' 의 memberSeqno=0 조회 → 403 FORBIDDEN_MEMBER_QUERY, 조회 미실행",
    async (sub) => {
      const r = await httpError(controller.findSessions(undefined, '0', undefined, shopUser(sub)));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('FORBIDDEN_MEMBER_QUERY');
      expect(findByMemberSeqnoSpy).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '0.5'])(
    "L2: shop sub '%s' 의 기본 목록 → 빈 목록, 조회 미실행",
    async (sub) => {
      const out = await controller.findSessions(undefined, undefined, undefined, shopUser(sub));
      expect(out).toEqual({ sessions: [], total: 0 });
      expect(findByMemberSeqnoSpy).not.toHaveBeenCalled();
    },
  );

  it('L3: 비-staff 의 비숫자 memberSeqno 조회 → 403 FORBIDDEN_MEMBER_QUERY (종전 동작 불변 확인)', async () => {
    const r = await httpError(controller.findSessions(undefined, 'abc', undefined, shopUser('123')));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN_MEMBER_QUERY');
    expect(findByMemberSeqnoSpy).not.toHaveBeenCalled();
  });

  it('L4: shop 회원 123 의 memberSeqno=123 / 기본 목록 → 종전과 동일(자기 세션)', async () => {
    expect(ids(await controller.findSessions(undefined, '123', undefined, shopUser('123')))).toEqual([
      MEMBER_SESSION,
    ]);
    expect(ids(await controller.findSessions(undefined, undefined, undefined, shopUser('123')))).toEqual([
      MEMBER_SESSION,
    ]);
    expect(findByMemberSeqnoSpy).toHaveBeenCalledWith(123);
    // 다른 회원 번호 조회는 종전대로 403
    const r = await httpError(controller.findSessions(undefined, '456', undefined, shopUser('123')));
    expect(r.body.code).toBe('FORBIDDEN_MEMBER_QUERY');
  });

  it('L5: staff 의 memberSeqno=0 조회 → 허용 (불변)', async () => {
    const out = await controller.findSessions(undefined, '0', undefined, adminAppUser('ADMIN'));
    expect(ids(out)).toEqual([GUEST_SESSION]);
    expect(findByMemberSeqnoSpy).toHaveBeenCalledWith(0);
  });

  it("L6: 음수 회원 번호 sub '-5' 의 memberSeqno=-5 / 기본 목록 → 허용 (불변)", async () => {
    table[NEGATIVE_MEMBER_SESSION] = baseSession(NEGATIVE_MEMBER_SESSION, { memberSeqno: -5 });
    expect(ids(await controller.findSessions(undefined, '-5', undefined, shopUser('-5')))).toEqual([
      NEGATIVE_MEMBER_SESSION,
    ]);
    expect(ids(await controller.findSessions(undefined, undefined, undefined, shopUser('-5')))).toEqual([
      NEGATIVE_MEMBER_SESSION,
    ]);
    expect(findByMemberSeqnoSpy).toHaveBeenCalledWith(-5);
  });

  it('L7: 주문권한 없는 shop 토큰(회원 번호 0)의 orderSeqno 분기 → 빈 목록', async () => {
    const out = await controller.findSessions('100', undefined, undefined, shopUser('0'));
    expect(out).toEqual({ sessions: [], total: 0 });
  });

  it('L7-b: 주문권한(allowedOrderSeqnos) 있는 shop 토큰(회원 번호 0)의 orderSeqno 분기 → 그 주문의 세션 목록(종전과 동일)', async () => {
    const out = await controller.findSessions('100', undefined, undefined, {
      ...shopUser('0'),
      allowedOrderSeqnos: [100],
    });
    expect(ids(out).sort()).toEqual([GUEST_SESSION, MEMBER_SESSION, OTHER_MEMBER_SESSION].sort());
    const guest = out.sessions.find((s) => s.id === GUEST_SESSION) as unknown as Record<string, unknown>;
    expect(guest.guestToken).toBe(GUEST_TOKEN);
  });

  it('L7-c: allowedOrderSeqnos 에 0 이 있어도 orderSeqno=0 조회는 본인 소유 필터 적용', async () => {
    table[GUEST_SESSION] = { ...table[GUEST_SESSION], orderSeqno: 0 } as EditSessionEntity;
    table[MEMBER_SESSION] = { ...table[MEMBER_SESSION], orderSeqno: 0 } as EditSessionEntity;
    const guestCaller = { ...shopUser('0'), allowedOrderSeqnos: [0] };
    expect(await controller.findSessions('0', undefined, undefined, guestCaller)).toEqual({
      sessions: [],
      total: 0,
    });
    const memberCaller = { ...shopUser('123'), allowedOrderSeqnos: [0] };
    expect(ids(await controller.findSessions('0', undefined, undefined, memberCaller))).toEqual([
      MEMBER_SESSION,
    ]);
  });

  it('L7-d: 주문권한 없는 shop 회원 123 의 orderSeqno 분기 → 본인 세션만(불변)', async () => {
    expect(ids(await controller.findSessions('100', undefined, undefined, shopUser('123')))).toEqual([
      MEMBER_SESSION,
    ]);
  });

  it.each(['0', '123'])(
    "L9: shop 토큰(sub '%s')의 자기 site siteId 조회 → 403 FORBIDDEN_SITE_QUERY, 조회 미실행",
    async (sub) => {
      const bySite = jest.spyOn(service, 'findBySiteId');
      const r = await httpError(controller.findSessions(undefined, undefined, SITE_A, shopUser(sub)));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('FORBIDDEN_SITE_QUERY');
      expect(bySite).not.toHaveBeenCalled();
    },
  );

  it('L10: 사이트 운영자(siteRoles 멤버십)·staff 의 siteId 조회 → 허용(불변)', async () => {
    const bySite = jest.spyOn(service, 'findBySiteId').mockResolvedValue([table[MEMBER_SESSION]]);
    const siteOperator = { ...adminAppUser('SITE_ADMIN'), siteRoles: [{ siteId: SITE_A, role: 'SITE_ADMIN' }] };
    expect(ids(await controller.findSessions(undefined, undefined, SITE_A, siteOperator))).toEqual([
      MEMBER_SESSION,
    ]);
    expect(ids(await controller.findSessions(undefined, undefined, SITE_A, adminAppUser('ADMIN')))).toEqual([
      MEMBER_SESSION,
    ]);
    expect(bySite).toHaveBeenCalledWith(SITE_A);
  });

  it('L8: admin-app CUSTOMER(userId 없음)의 memberSeqno=0 → 403, 기본 목록 → 빈 목록 (종전과 동일)', async () => {
    const r = await httpError(controller.findSessions(undefined, '0', undefined, adminAppUser('CUSTOMER')));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN_MEMBER_QUERY');
    const out = await controller.findSessions(undefined, undefined, undefined, adminAppUser('CUSTOMER'));
    expect(out).toEqual({ sessions: [], total: 0 });
    expect(findByMemberSeqnoSpy).not.toHaveBeenCalled();
  });
});
