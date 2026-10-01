/**
 * 회원 경로 회원 식별 — 회원 번호는 양의 정수만 회원으로 본다.
 *
 *  - guest/migrate: 회원 번호가 양의 정수가 아니면 403 AUTH_REQUIRED(guestToken 형식 검사보다 먼저),
 *    서비스 migrateGuestSessions 도 조회·저장 전에 같은 403.
 *  - 서비스 update·complete·delete: 회원 세션 판정은 userId > 0 일 때만 통과(staff 컨텍스트는 불변).
 *  - GET /my: 회원 번호가 양의 정수가 아니면(0·음수·소수·비숫자) 빈 목록(조회 미실행).
 *  - versions 3종(GET :id/versions·GET :id/versions/:vid·POST :id/versions/:vid/restore): 소유자 판정은 양의 정수 회원 번호만,
 *    restoreVersion 은 회원 번호가 양의 정수가 아니면 userId 0 으로 서비스 호출.
 *  - 게스트 3개 라우트(PATCH guest/:id·GET guest/:id/versions·POST guest/:id/versions/:vid/restore): 토큰은 X-Guest-Token 헤더로만 받는다.
 *  - 실제 서명된 shop JWT(sub '0')로 GET :id 게스트 세션 → 403 GUEST_TOKEN_REQUIRED, DELETE → 403.
 */
import 'reflect-metadata';
import { HttpException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService, memberSeqnoOf } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { User } from '../auth/entities/user.entity';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { SitesService } from '../sites/sites.service';
import type { UpdateEditSessionDto } from './dto/update-edit-session.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_SESSION = '11111111-1111-4111-8111-111111111111'; // 회원 123 세션(site A)
const GUEST_SESSION = '22222222-2222-4222-8222-222222222222'; // 게스트 세션(site A, memberSeqno 0)
const UNOWNED_SESSION = '55555555-5555-4555-8555-555555555555'; // memberSeqno 0·guestToken 없음(site A)
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
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
    [UNOWNED_SESSION]: baseSession(UNOWNED_SESSION, { memberSeqno: 0 }),
  };
}

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

describe('memberSeqnoOf — 회원 번호 판정', () => {
  it.each<[unknown, number]>([
    ['123', 123],
    [123, 123],
    ['1607115440', 1607115440],
  ])('양의 정수 %p → %p', (input, expected) => {
    expect(memberSeqnoOf(input)).toBe(expected);
  });

  it.each<unknown>([undefined, null, '', '0', 0, '-1', -1, '1.5', 1.5, '0.5', '1e+21', '01', ' 1', 'abc', {}])(
    '그 밖의 값 %p → NaN',
    (input) => {
      expect(Number.isNaN(memberSeqnoOf(input))).toBe(true);
    },
  );
});

describe('EditSessions — 회원 경로 회원 식별 (컨트롤러·서비스)', () => {
  let service: EditSessionsService;
  let controller: EditSessionsController;
  let table: Record<string, EditSessionEntity>;
  let logSpy: jest.SpyInstance;

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
    findOne: jest.fn(),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver-new', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };
  const audit = { recordOrThrow: jest.fn(), recordBestEffort: jest.fn(), list: jest.fn() };
  const workerJobs = { createValidationJob: jest.fn().mockResolvedValue({ id: 'job' }) };

  const logsWith = (prefix: string): string[] =>
    logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith(prefix));
  const expectNoTokenInLogs = (): void => {
    for (const call of logSpy.mock.calls as unknown[][]) {
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
    sessionRepo.find.mockResolvedValue([]);
    sessionRepo.save.mockImplementation(async (s: EditSessionEntity) => s);
    sessionRepo.softDelete.mockResolvedValue({ affected: 1 });
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
    jest.spyOn(serviceLogger, 'log').mockImplementation(() => undefined);
    jest.spyOn(serviceLogger, 'warn').mockImplementation(() => undefined);
  });

  // ───────────────── guest/migrate ─────────────────
  describe('guest/migrate', () => {
    it.each(['0', '-1', '1.5'])(
      "MG1: shop sub '%s' → 403 AUTH_REQUIRED, migrateGuestSessions 미호출, 관측 로그 1회(토큰 원문 없음)",
      async (sub) => {
        const migrate = jest.spyOn(service, 'migrateGuestSessions');
        const r = await httpError(controller.migrateGuestToMember({ guestToken: GUEST_TOKEN }, shopUser(sub)));
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('AUTH_REQUIRED');
        expect(migrate).not.toHaveBeenCalled();
        expect(logsWith('[guest-migrate]')).toEqual([
          `[guest-migrate] denied-non-member source=shop site=${SITE_A}`,
        ]);
        expectNoTokenInLogs();
      },
    );

    it("MG2: sub '0' + guestToken 누락 → 403 AUTH_REQUIRED(guestToken 검사보다 먼저), userId 없음 → 403 AUTH_REQUIRED", async () => {
      const a = await httpError(controller.migrateGuestToMember({}, shopUser('0')));
      expect(a.status).toBe(403);
      expect(a.body.code).toBe('AUTH_REQUIRED');
      const b = await httpError(controller.migrateGuestToMember({ guestToken: GUEST_TOKEN }, { role: 'customer' }));
      expect(b.status).toBe(403);
      expect(b.body.code).toBe('AUTH_REQUIRED');
      const c = await httpError(controller.migrateGuestToMember({ guestToken: GUEST_TOKEN }, undefined));
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('AUTH_REQUIRED');
    });

    it("MG3: sub '123' → migrateGuestSessions(token, 123, siteId) 호출", async () => {
      const migrate = jest
        .spyOn(service, 'migrateGuestSessions')
        .mockResolvedValue({ migratedCount: 0, sessionIds: [] });
      await expect(
        controller.migrateGuestToMember({ guestToken: GUEST_TOKEN }, shopUser('123')),
      ).resolves.toEqual({ migratedCount: 0, sessionIds: [] });
      expect(migrate).toHaveBeenCalledWith(GUEST_TOKEN, 123, SITE_A);
      expect(logsWith('[guest-migrate]')).toEqual([]);
    });

    it("MG3-b: sub '123' + guestToken 누락 → 400 GUEST_TOKEN_REQUIRED", async () => {
      const r = await httpError(controller.migrateGuestToMember({}, shopUser('123')));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('GUEST_TOKEN_REQUIRED');
    });

    it.each<[number, string | null]>([
      [0, SITE_A],
      [-1, null],
      [Number.NaN, SITE_A],
    ])('MG4: 서비스 migrateGuestSessions(token, %p, %p) → 403 AUTH_REQUIRED, 조회·저장 미호출', async (member, site) => {
      await expect(service.migrateGuestSessions(GUEST_TOKEN, member, site)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      });
      expect(sessionRepo.find).not.toHaveBeenCalled();
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });
  });

  // ───────────────── 서비스 update·complete·delete ─────────────────
  describe('서비스 회원 판정', () => {
    const customerCaller = { siteId: SITE_A, role: 'customer' };

    it('SV1: userId 0 → 무주 세션 update·complete 403 PERMISSION_DENIED, 저장 없음', async () => {
      const u = await httpError(
        service.update(UNOWNED_SESSION, { canvasData: [{ p: 2 }] } as UpdateEditSessionDto, 0, customerCaller),
      );
      expect(u.status).toBe(403);
      expect(u.body.code).toBe('PERMISSION_DENIED');
      const c = await httpError(service.complete(UNOWNED_SESSION, 0, customerCaller));
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('SV1-b: userId 0 → 회원 123 세션 complete 403 PERMISSION_DENIED', async () => {
      const c = await httpError(service.complete(MEMBER_SESSION, 0, customerCaller));
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('PERMISSION_DENIED');
      const c2 = await httpError(service.complete(MEMBER_SESSION, 0, null));
      expect(c2.status).toBe(403);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('SV1-c: 회원 123 본인 세션 update·complete → 통과', async () => {
      const updated = await service.update(
        MEMBER_SESSION,
        { canvasData: [{ p: 3 }] } as UpdateEditSessionDto,
        123,
        customerCaller,
      );
      expect(updated.id).toBe(MEMBER_SESSION);
      const completed = await service.complete(MEMBER_SESSION, 123, customerCaller);
      expect(completed.status).toBe(SessionStatus.COMPLETE);
    });

    it('SV1-d: 컨트롤러 update·complete 는 회원 번호가 양의 정수가 아니면 userId 0, 양의 정수면 그 수를 넘긴다', async () => {
      const upd = jest.spyOn(service, 'update');
      const cmp = jest.spyOn(service, 'complete');
      await httpError(controller.update(UNOWNED_SESSION, { canvasData: [] } as UpdateEditSessionDto, shopUser('0')));
      await httpError(controller.complete(UNOWNED_SESSION, shopUser('1.5')));
      expect(upd.mock.calls[0][2]).toBe(0);
      expect(cmp.mock.calls[0][1]).toBe(0);
      await controller.complete(MEMBER_SESSION, shopUser('123'));
      expect(cmp.mock.calls[1][1]).toBe(123);
    });

    it('SV2: delete — staff 컨텍스트(canDelete)는 userId 0 으로 무주 세션 삭제 성공, customer caller 의 게스트 세션 삭제는 403', async () => {
      await expect(
        service.delete(UNOWNED_SESSION, 0, {
          siteId: null,
          role: null,
          staff: { userId: 'admin-1', global: true, siteIds: [], canDelete: true },
        }),
      ).resolves.toBeUndefined();
      expect(sessionRepo.softDelete).toHaveBeenCalledWith(UNOWNED_SESSION);
      sessionRepo.softDelete.mockClear();
      const r = await httpError(service.delete(GUEST_SESSION, 0, customerCaller));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PERMISSION_DENIED');
      expect(sessionRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  // ───────────────── GET /my ─────────────────
  describe('GET /my', () => {
    it.each<[string, Record<string, unknown>, string | undefined]>([
      ["sub '0'", shopUser('0'), undefined],
      ["sub '0' summary=1", shopUser('0'), '1'],
      ['비숫자 userId', shopUser('abc'), undefined],
      ['비숫자 userId summary=true', shopUser('abc'), 'true'],
      ["sub '-5'", shopUser('-5'), undefined],
      ["sub '1.5'", shopUser('1.5'), undefined],
      ["sub '12abc' summary=1", shopUser('12abc'), '1'],
    ])('MY1: %s → 빈 목록, 조회 미실행', async (_l, user, summary) => {
      const recent = jest.spyOn(service, 'findMyRecent');
      const recentSummary = jest.spyOn(service, 'findMyRecentSummary');
      await expect(controller.findMy(user, summary)).resolves.toEqual({ sessions: [], total: 0 });
      expect(recent).not.toHaveBeenCalled();
      expect(recentSummary).not.toHaveBeenCalled();
    });

    it("MY1-b: sub '123' → findMyRecent(123) / summary=1 → findMyRecentSummary(123)", async () => {
      const recent = jest.spyOn(service, 'findMyRecent').mockResolvedValue([table[MEMBER_SESSION]]);
      const out = await controller.findMy(shopUser('123'));
      expect(recent).toHaveBeenCalledWith(123);
      expect(out.sessions.map((s) => s.id)).toEqual([MEMBER_SESSION]);
      const recentSummary = jest.spyOn(service, 'findMyRecentSummary').mockResolvedValue([]);
      await controller.findMy(shopUser('123'), '1');
      expect(recentSummary).toHaveBeenCalledWith(123);
    });

    it('MY1-c: userId 없음 → 403 AUTH_REQUIRED', async () => {
      const r = await httpError(controller.findMy({ role: 'customer' }));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('AUTH_REQUIRED');
    });
  });

  // ───────────────── versions 3종 회원 판정 ─────────────────
  describe('versions 3종', () => {
    const MEMBER1_SESSION = '77777777-7777-4777-8777-777777777777'; // 회원 1 세션(site A)

    it.each(['1.5', '1e0', '01'])(
      "VR1: sub '%s' 로 회원 1 세션 versions·version·restore → 403 PERMISSION_DENIED, 서비스 미호출",
      async (sub) => {
        table[MEMBER1_SESSION] = baseSession(MEMBER1_SESSION, { memberSeqno: 1 });
        const list = jest.spyOn(service, 'listVersions');
        const get = jest.spyOn(service, 'getVersion');
        const restore = jest.spyOn(service, 'restoreVersion');
        for (const p of [
          controller.listVersions(MEMBER1_SESSION, shopUser(sub)),
          controller.getVersion(MEMBER1_SESSION, VERSION_ID, shopUser(sub)),
          controller.restoreVersion(MEMBER1_SESSION, VERSION_ID, shopUser(sub)),
        ]) {
          const r = await httpError(p);
          expect(r.status).toBe(403);
          expect(r.body.code).toBe('PERMISSION_DENIED');
        }
        expect(list).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
        expect(restore).not.toHaveBeenCalled();
      },
    );

    it("VR2: sub '123' 로 자기 세션 versions·restore → 통과, restoreVersion(id, vid, 123)", async () => {
      const list = jest.spyOn(service, 'listVersions').mockResolvedValue([]);
      const restore = jest.spyOn(service, 'restoreVersion').mockResolvedValue(table[MEMBER_SESSION]);
      await expect(controller.listVersions(MEMBER_SESSION, shopUser('123'))).resolves.toEqual([]);
      await controller.restoreVersion(MEMBER_SESSION, VERSION_ID, shopUser('123'));
      expect(list).toHaveBeenCalledWith(MEMBER_SESSION);
      expect(restore).toHaveBeenCalledWith(MEMBER_SESSION, VERSION_ID, 123);
    });

    it("VR3: 회원 번호가 양의 정수가 아닌 staff(userId '1.5')의 restore → restoreVersion(id, vid, 0)", async () => {
      jest.spyOn(service, 'gateLegacyStaffMutation').mockResolvedValue(undefined);
      const restore = jest.spyOn(service, 'restoreVersion').mockResolvedValue(table[MEMBER_SESSION]);
      await controller.restoreVersion(MEMBER_SESSION, VERSION_ID, { id: 'admin-1', role: 'ADMIN', userId: '1.5' });
      expect(restore).toHaveBeenCalledWith(MEMBER_SESSION, VERSION_ID, 0);
    });
  });

  // ───────────────── 게스트 3개 라우트 — 헤더 토큰 ─────────────────
  describe('게스트 라우트 토큰 전달', () => {
    type Route = 'update' | 'versions' | 'restore';
    const call = (route: Route, header?: string): Promise<unknown> => {
      if (route === 'update') {
        return controller.updateGuest(GUEST_SESSION, { canvasData: [{ p: 4 }] } as UpdateEditSessionDto, header);
      }
      if (route === 'versions') return controller.listGuestVersions(GUEST_SESSION, header);
      return controller.restoreGuestVersion(GUEST_SESSION, VERSION_ID, header);
    };

    it.each<Route>(['update', 'versions', 'restore'])('QT1: %s — X-Guest-Token 헤더 → 정상 처리', async (route) => {
      await expect(call(route, GUEST_TOKEN)).resolves.toBeDefined();
      expectNoTokenInLogs();
    });

    it.each<Route>(['update', 'versions', 'restore'])(
      'QT2: %s — 헤더 없음 → 403 GUEST_TOKEN_REQUIRED, 서비스 미호출',
      async (route) => {
        const update = jest.spyOn(service, 'update');
        const list = jest.spyOn(service, 'listVersions');
        const restore = jest.spyOn(service, 'restoreVersion');
        const r = await httpError(call(route, undefined));
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('GUEST_TOKEN_REQUIRED');
        expect(update).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(restore).not.toHaveBeenCalled();
        expect(logsWith('[guest-token]')).toEqual([]);
      },
    );
  });
});

// ───────────────── 실제 서명 shop JWT HTTP ─────────────────
describe('EditSessions — 실제 서명 shop JWT(sub 0) HTTP', () => {
  const JWT_SECRET = 'member-identity-spec-secret';
  let app: INestApplication;
  const store = new Map<string, EditSessionEntity>();

  const sessionRepo = {
    create: (o: Record<string, unknown>) => ({ ...o }),
    save: jest.fn(async (o: EditSessionEntity) => {
      store.set(o.id, o);
      return o;
    }),
    findOne: async ({ where, withDeleted }: { where: { id: string }; withDeleted?: boolean }) => {
      const s = store.get(where.id);
      if (!s || (s.deletedAt && !withDeleted)) return null;
      return { ...s };
    },
    find: async () => [],
    softDelete: jest.fn(async () => ({ affected: 1 })),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };

  const signShop = (payload: Record<string, unknown>): string =>
    new JwtService({ secret: JWT_SECRET }).sign(
      { sub: '0', source: 'shop', role: 'customer', siteId: SITE_A, ...payload },
      { expiresIn: '1h' },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [EditSessionsController],
      providers: [
        EditSessionsService,
        OptionalShopJwtGuard,
        ApiKeyGuard,
        JwtStrategy,
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        {
          provide: getRepositoryToken(EditSessionVersionEntity),
          useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() },
        },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn() } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(JWT_SECRET) } },
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: jest.fn().mockResolvedValue(null),
            findByWorkerAuthCode: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.clear();
    for (const [id, s] of Object.entries(sessionsTable())) store.set(id, s);
    sessionRepo.save.mockClear();
    sessionRepo.softDelete.mockClear();
  });

  const http = () => request(app.getHttpServer());

  it("H1: sub '0' 토큰으로 GET :id 게스트 세션 → 403 GUEST_TOKEN_REQUIRED, 본문에 토큰·canvasData 없음", async () => {
    const res = await http()
      .get(`/edit-sessions/${GUEST_SESSION}`)
      .set('Authorization', `Bearer ${signShop({})}`)
      .expect(403);
    expect(res.body.code).toBe('GUEST_TOKEN_REQUIRED');
    expect(JSON.stringify(res.body)).not.toContain(GUEST_TOKEN);
    expect(res.body).not.toHaveProperty('canvasData');
  });

  it("H2: sub '0' 토큰으로 DELETE :id 게스트 세션 → 403 PERMISSION_DENIED, 삭제 없음", async () => {
    const res = await http()
      .delete(`/edit-sessions/${GUEST_SESSION}`)
      .set('Authorization', `Bearer ${signShop({})}`)
      .expect(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(sessionRepo.softDelete).not.toHaveBeenCalled();
  });

  it("H3: sub '0' 토큰으로 무주 세션 PATCH :id·:id/complete → 403 PERMISSION_DENIED, 저장 없음", async () => {
    const token = signShop({});
    const p = await http()
      .patch(`/edit-sessions/${UNOWNED_SESSION}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ canvasData: [{ v: 1 }] })
      .expect(403);
    expect(p.body.code).toBe('PERMISSION_DENIED');
    const c = await http()
      .patch(`/edit-sessions/${UNOWNED_SESSION}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(c.body.code).toBe('PERMISSION_DENIED');
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });

  it("H4: sub '123' 토큰으로 GET :id 자기 세션 → 200, guestToken: null 유지", async () => {
    const res = await http()
      .get(`/edit-sessions/${MEMBER_SESSION}`)
      .set('Authorization', `Bearer ${signShop({ sub: '123' })}`)
      .expect(200);
    expect(res.body.id).toBe(MEMBER_SESSION);
    expect(res.body).toHaveProperty('guestToken', null);
  });

  it("H5: sub '0' 토큰으로 POST guest/migrate → 403 AUTH_REQUIRED", async () => {
    const res = await http()
      .post('/edit-sessions/guest/migrate')
      .set('Authorization', `Bearer ${signShop({})}`)
      .send({ guestToken: GUEST_TOKEN })
      .expect(403);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });

  it('H6: 게스트 3개 라우트 — ?guestToken= 쿼리만 → 403 GUEST_TOKEN_REQUIRED, 저장 없음', async () => {
    const q = `guestToken=${GUEST_TOKEN}`;
    const p = await http().patch(`/edit-sessions/guest/${GUEST_SESSION}?${q}`).send({ canvasData: [{ v: 1 }] }).expect(403);
    expect(p.body.code).toBe('GUEST_TOKEN_REQUIRED');
    const v = await http().get(`/edit-sessions/guest/${GUEST_SESSION}/versions?${q}`).expect(403);
    expect(v.body.code).toBe('GUEST_TOKEN_REQUIRED');
    const r = await http().post(`/edit-sessions/guest/${GUEST_SESSION}/versions/${VERSION_ID}/restore?${q}`).expect(403);
    expect(r.body.code).toBe('GUEST_TOKEN_REQUIRED');
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });

  it('H7: GET guest/:id/versions — X-Guest-Token 헤더 → 200', async () => {
    await http()
      .get(`/edit-sessions/guest/${GUEST_SESSION}/versions`)
      .set('X-Guest-Token', GUEST_TOKEN)
      .expect(200);
  });
});
