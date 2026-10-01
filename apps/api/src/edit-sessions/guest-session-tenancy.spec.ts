/**
 * 게스트 세션 테넌시(siteId) — 실스택 HTTP + 승격 게이트 e2e (2026-07-30).
 *
 * 세션 siteId 는 검증된 JWT 에서만 정해지고, 승격(세션 산출 PDF 를 book 자산으로 연결)은
 * 세션 siteId 와 호출 사이트가 같을 때만 성공한다. 이 spec 은 스탬프 성공 경로와 함께
 * 근거가 없거나 다른 사이트를 가리키는 입력이 스탬프·승격되지 않는 동작을 고정한다.
 *
 * 구성 — 목이 아니라 실제 사슬을 관통한다:
 *   실 EditSessionsController + 실 EditSessionsService + 인메모리 repo
 *   + 실 OptionalShopJwtGuard + 실 JwtService(진짜 서명/검증)
 *   + 전역 JwtAuthGuard(APP_GUARD — @Public 단락 재현)
 *   → 그 위에 실 BooksService 승격 게이트를 **같은 저장소**로 물려
 *     "createGuest 가 스탬프한 값이 승격 판정에 그대로 도달"함을 실증한다.
 *
 * 커버리지: T1~T6(생성 스탬프) · T14/T15(승격 e2e) · G1~G4(게스트 세션 회원 라우트 규칙)
 *          · GR1~GR11(게스트 세션 조회 라우트 GET guest/:id, 2026-09-30)
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionMode, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { User } from '../auth/entities/user.entity';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { SitesService } from '../sites/sites.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { BooksService } from '../books/books.service';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';

const JWT_SECRET = 'tenancy-spec-secret';
const OTHER_SECRET = 'attacker-forged-secret';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const siteCtx = (siteId: string): CurrentSitePayload => ({
  siteId,
  siteName: `site-${siteId.slice(0, 4)}`,
  role: 'editor',
  apiKey: 'k',
  env: 'live',
});

describe('게스트 세션 테넌시 — siteId 스탬프 + 승격 게이트 e2e', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let sessionsService: EditSessionsService;
  let booksService: BooksService;

  /** 인메모리 세션 저장소 — "저장된 siteId" 를 직접 관측하기 위한 진짜 저장 계층 */
  const store = new Map<string, Record<string, any>>();
  let seq = 0;

  const bookCreate = jest.fn();
  const bookSave = jest.fn();
  const assetCreate = jest.fn();
  const assetSave = jest.fn();
  const registerExternalFile = jest.fn();

  const sessionRepo = {
    create: (o: Record<string, any>) => ({ ...o }),
    save: async (o: Record<string, any>) => {
      if (!o.id) o.id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      o.createdAt = o.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
      o.updatedAt = new Date('2026-01-01T00:00:00.000Z');
      store.set(o.id, o);
      return o;
    },
    // TypeORM 기본 동작 재현 — 소프트 삭제 행은 withDeleted 없이는 조회되지 않는다.
    findOne: async ({ where, withDeleted }: { where: { id: string }; withDeleted?: boolean }) => {
      const s = store.get(where.id);
      if (!s || (s.deletedAt && !withDeleted)) return null;
      return s;
    },
    find: async ({ where }: { where: { guestToken: string } }) =>
      [...store.values()].filter((s) => s.guestToken === where.guestToken),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };

  /** 응답 body 의 세션 id 로 실제 저장 레코드를 집는다 */
  const stored = (id: string) => store.get(id)!;

  const signShop = (payload: Record<string, unknown>, secret = JWT_SECRET, expiresIn = '1h') =>
    new JwtService({ secret }).sign({ sub: '0', source: 'shop', ...payload }, { expiresIn });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [EditSessionsController],
      providers: [
        EditSessionsService,
        OptionalShopJwtGuard,
        ApiKeyGuard,
        // 회원 라우트(PATCH :id / :id/complete)의 실 passport 'jwt' 검증 — shop JWT 는 DB 조회 없음
        JwtStrategy,
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        // 프로덕션과 동일하게 전역 JwtAuthGuard 를 얹는다 —
        // @Public 단락(→ passport 미실행 → req.user 부재)이 재현되어야
        // "route-scoped 가드가 실제로 테넌트를 복원한다"가 증거가 된다.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn((v) => v), save: jest.fn(async (v) => v), delete: jest.fn() } },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    jwt = moduleRef.get(JwtService);
    sessionsService = moduleRef.get(EditSessionsService);

    // 승격 게이트 — 실 BooksService 에 **같은** EditSessionsService(=같은 저장소)를 물린다.
    booksService = new BooksService(
      { create: bookCreate, save: bookSave } as any,
      { create: assetCreate, save: assetSave } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      { registerExternalFile } as any,
      sessionsService,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    seq = 0;
    bookCreate.mockImplementation((x: Record<string, unknown>) => x);
    bookSave.mockImplementation(async (x: Record<string, unknown>) => ({
      id: 'book-1',
      ...x,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    assetCreate.mockImplementation((x: Record<string, unknown>) => x);
    assetSave.mockImplementation(async (x: Record<string, unknown>) => x);
    registerExternalFile.mockResolvedValue({ id: 'file-out-1' });
  });

  const createGuest = (headers: Record<string, string> = {}, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/edit-sessions/guest')
      .set(headers)
      .send({ mode: SessionMode.BOTH, ...body });

  // ── 생성 스탬프 (I-1) ─────────────────────────────────────────────────
  describe('POST /edit-sessions/guest — siteId 스탬프 근거는 검증된 JWT 뿐', () => {
    it('T1: 토큰 없이 body 에 siteId 지정 → 201 + 저장 siteId=null', async () => {
      const res = await createGuest({}, { siteId: SITE_B }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
      expect(res.body.siteId).toBeNull();
    });

    it('T2: site A 토큰 + body 에 site B 지정 → JWT 값 사용(저장 siteId=A)', async () => {
      const token = signShop({ siteId: SITE_A, siteName: 'A' });

      const res = await createGuest({ Authorization: `Bearer ${token}` }, { siteId: SITE_B }).expect(
        201,
      );

      expect(stored(res.body.id).siteId).toBe(SITE_A);
    });

    it('T3 무중단: 토큰 없음 → 401 아님(201) + siteId=null (레거시 standalone 무손상)', async () => {
      const res = await createGuest().expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
      // 게스트 계약 자체가 살아 있어야 한다
      expect(res.body.guestToken).toEqual(expect.any(String));
      expect(res.body.guestExpiresAt).toBeTruthy();
    });

    it('T4: 다른 시크릿으로 서명된 토큰(siteId=B) → 201 + siteId=null (서명 검증 기반 판정)', async () => {
      const forged = signShop({ siteId: SITE_B }, OTHER_SECRET);
      // 페이로드에는 실제로 siteId 가 들어 있다 — decode 였다면 그대로 스탬프됐을 값.
      expect((jwt.decode(forged) as Record<string, unknown>).siteId).toBe(SITE_B);

      const res = await createGuest({ Authorization: `Bearer ${forged}` }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
    });

    // F-5: 게스트 세션 생성에도 회원 라우트(Patch D)와 같은 allowedOrderSeqnos 가드를 적용한다.
    it('T5-a: 허용 목록에 없는 orderSeqno 로 게스트 세션 생성 → 403 ORDER_NOT_ALLOWED', async () => {
      const token = signShop({ siteId: SITE_A, allowedOrderSeqnos: [111] });

      await createGuest({ Authorization: `Bearer ${token}` }, { orderSeqno: 222 }).expect(403);
    });

    it('T5-b 무중단: 허용된 orderSeqno 는 그대로 통과(201 + siteId 스탬프)', async () => {
      const token = signShop({ siteId: SITE_A, allowedOrderSeqnos: [111] });

      const res = await createGuest(
        { Authorization: `Bearer ${token}` },
        { orderSeqno: 111 },
      ).expect(201);

      expect(stored(res.body.id).siteId).toBe(SITE_A);
      expect(stored(res.body.id).orderSeqno).toBe(111);
    });

    it('T5-c 무중단: allowedOrderSeqnos 없는 토큰은 기존대로 통과(호환 모드)', async () => {
      const token = signShop({ siteId: SITE_A });

      const res = await createGuest(
        { Authorization: `Bearer ${token}` },
        { orderSeqno: 999 },
      ).expect(201);

      expect(stored(res.body.id).siteId).toBe(SITE_A);
    });

    it('T5-d 무중단: orderSeqno 미지정 게스트는 스코프 토큰이 있어도 통과(게스트는 선택 필드)', async () => {
      const token = signShop({ siteId: SITE_A, allowedOrderSeqnos: [111] });

      const res = await createGuest({ Authorization: `Bearer ${token}` }).expect(201);

      expect(stored(res.body.id).siteId).toBe(SITE_A);
    });

    it('T5 만료 토큰 → 201 + siteId=null', async () => {
      const expired = signShop({ siteId: SITE_A }, JWT_SECRET, '-1s');

      const res = await createGuest({ Authorization: `Bearer ${expired}` }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
    });

    it('T6 정상: 유효한 site A shop JWT → 저장 siteId=A', async () => {
      const token = signShop({ siteId: SITE_A, siteName: 'A' });

      const res = await createGuest({ Authorization: `Bearer ${token}` }).expect(201);

      expect(stored(res.body.id).siteId).toBe(SITE_A);
      // 게스트 계약(무중단) — 스탬프가 붙어도 게스트는 게스트다
      expect(stored(res.body.id).memberSeqno).toBe(0);
      expect(res.body.guestToken).toEqual(expect.any(String));
    });

    it('source!=="shop" 토큰(admin 등)은 스탬프하지 않는다 — 판정 불가 = NULL', async () => {
      const adminish = new JwtService({ secret: JWT_SECRET }).sign(
        { sub: 'u-1', source: 'admin', siteId: SITE_A },
        { expiresIn: '1h' },
      );

      const res = await createGuest({ Authorization: `Bearer ${adminish}` }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
    });

    it('siteId 없는 shop JWT(레거시 발급) → NULL 유지', async () => {
      const noSite = signShop({});

      const res = await createGuest({ Authorization: `Bearer ${noSite}` }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
    });
  });

  // ── 게스트 업데이트 소유 검사 (F-3) ──────────────────────────────────
  describe('PATCH /edit-sessions/guest/:id — 소유 증명 없이는 못 쓴다', () => {
    /** 게스트 세션 하나를 만들고 {id, token} 반환 */
    const seedGuest = async () => {
      const res = await createGuest().expect(201);
      return { id: res.body.id as string, token: res.body.guestToken as string };
    };

    const patch = (id: string) =>
      request(app.getHttpServer()).patch(`/edit-sessions/guest/${id}`);

    it('T12: guestToken 없이 PATCH → 403 GUEST_TOKEN_REQUIRED', async () => {
      const { id } = await seedGuest();

      const res = await patch(id).send({ canvasData: { hacked: true } }).expect(403);

      expect(res.body.code).toBe('GUEST_TOKEN_REQUIRED');
      // 덮어쓰기가 실제로 일어나지 않았다
      expect(stored(id).canvasData).toBeUndefined();
    });

    it('T13-a: query 로만 토큰 전송 → 403 GUEST_TOKEN_REQUIRED, 저장 없음(토큰은 헤더로만 받는다)', async () => {
      const { id, token } = await seedGuest();
      const before = stored(id).canvasData;

      const res = await patch(id)
        .query({ guestToken: token })
        .send({ canvasData: { ok: 1 } })
        .expect(403);

      expect(res.body.code).toBe('GUEST_TOKEN_REQUIRED');
      expect(stored(id).canvasData).toEqual(before);
    });

    it('T13-b 무중단: X-Guest-Token 헤더로만 전송(연동 가이드) → 200', async () => {
      const { id, token } = await seedGuest();

      await patch(id)
        .set('X-Guest-Token', token)
        .send({ canvasData: { ok: 2 } })
        .expect(200);

      expect(stored(id).canvasData).toEqual({ ok: 2 });
    });

    it('틀린 토큰 → 403 GUEST_TOKEN_MISMATCH', async () => {
      const { id } = await seedGuest();

      const res = await patch(id)
        .set('X-Guest-Token', '00000000-0000-4000-8000-999999999999')
        .send({ canvasData: { hacked: true } })
        .expect(403);

      expect(res.body.code).toBe('GUEST_TOKEN_MISMATCH');
    });
  });

  // ── 게스트 세션 조회 라우트 (2026-09-30, ADDITIVE) ────────────────────
  // 검증은 PATCH guest/:id 와 동일: 토큰 선요구 → 조회 → 게스트 여부 → 만료 → 일치.
  describe('GET /edit-sessions/guest/:id — 게스트 토큰으로 조회', () => {
    const MISSING_ID = '00000000-0000-4000-8000-00000000abcd';

    /** site A 스탬프 게스트 세션 + canvasData */
    const seedGuest = async () => {
      const res = await createGuest({ Authorization: `Bearer ${signShop({ siteId: SITE_A })}` }).expect(201);
      const id = res.body.id as string;
      stored(id).canvasData = { pages: [{ p: 1 }] };
      return { id, token: res.body.guestToken as string };
    };

    const get = (id: string) => request(app.getHttpServer()).get(`/edit-sessions/guest/${id}`);

    it('GR1: 토큰 없이 조회 → 403 GUEST_TOKEN_REQUIRED, 세션 조회 전에 거부(없는 id 도 403)', async () => {
      const { id } = await seedGuest();
      const findById = jest.spyOn(sessionsService, 'findById');

      const res = await get(id).expect(403);
      expect(res.body.code).toBe('GUEST_TOKEN_REQUIRED');
      expect(res.body.canvasData).toBeUndefined();

      const missing = await get(MISSING_ID).expect(403);
      expect(missing.body.code).toBe('GUEST_TOKEN_REQUIRED');

      expect(findById).not.toHaveBeenCalled();
      findById.mockRestore();
    });

    it('GR2: ?guestToken= 쿼리만 보내면 → 403 GUEST_TOKEN_REQUIRED(헤더 전용)', async () => {
      const { id, token } = await seedGuest();

      const res = await get(id).query({ guestToken: token }).expect(403);

      expect(res.body.code).toBe('GUEST_TOKEN_REQUIRED');
      expect(res.body.canvasData).toBeUndefined();
    });

    it('GR3: X-Guest-Token 헤더로 조회 → 200, 응답이 저장 레코드와 일치', async () => {
      const { id, token } = await seedGuest();

      const res = await get(id).set('X-Guest-Token', token).expect(200);

      expect(res.body.id).toBe(id);
      expect(res.body.canvasData).toEqual({ pages: [{ p: 1 }] });
      expect(res.body.guestToken).toBe(token);
      expect(res.body.siteId).toBe(SITE_A);
    });

    it('GR3-b: 쿼리 토큰은 무시한다(헤더 정답 + 쿼리 오답 → 200, 헤더 오답 + 쿼리 정답 → 403)', async () => {
      const { id, token } = await seedGuest();
      const wrong = '00000000-0000-4000-8000-999999999999';

      await get(id).set('X-Guest-Token', token).query({ guestToken: wrong }).expect(200);
      const res = await get(id).set('X-Guest-Token', wrong).query({ guestToken: token }).expect(403);
      expect(res.body.code).toBe('GUEST_TOKEN_MISMATCH');
    });

    it('GR4: 틀린 토큰 → 403 GUEST_TOKEN_MISMATCH, 본문에 canvasData 없음', async () => {
      const { id } = await seedGuest();

      const res = await get(id).set('X-Guest-Token', '00000000-0000-4000-8000-999999999999').expect(403);

      expect(res.body.code).toBe('GUEST_TOKEN_MISMATCH');
      expect(res.body.canvasData).toBeUndefined();
    });

    it('GR5: 만료된 게스트 세션 → 403 GUEST_SESSION_EXPIRED', async () => {
      const { id, token } = await seedGuest();
      stored(id).guestExpiresAt = new Date(Date.now() - 1000);

      const res = await get(id).set('X-Guest-Token', token).expect(403);

      expect(res.body.code).toBe('GUEST_SESSION_EXPIRED');
    });

    it('GR6: 회원 세션(guestToken 없음) → 403 NOT_A_GUEST_SESSION', async () => {
      const memberId = '00000000-0000-4000-8000-00000000beef';
      store.set(memberId, {
        id: memberId,
        memberSeqno: 777,
        guestToken: null,
        guestExpiresAt: null,
        siteId: SITE_A,
        canvasData: { secret: true },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const res = await get(memberId).set('X-Guest-Token', 'any-token-value').expect(403);

      expect(res.body.code).toBe('NOT_A_GUEST_SESSION');
      expect(res.body.canvasData).toBeUndefined();
    });

    it('GR7: 없는 세션 + 토큰 → 404 SESSION_NOT_FOUND', async () => {
      const res = await get(MISSING_ID).set('X-Guest-Token', 'any-token-value').expect(404);

      expect(res.body.code).toBe('SESSION_NOT_FOUND');
    });

    it('GR8: UUID 가 아닌 id → 400', async () => {
      await get('not-a-uuid').set('X-Guest-Token', 'any-token-value').expect(400);
    });

    it('GR9: @Public — Authorization 없이 200, 검증 실패·만료 Bearer 를 실어도 200', async () => {
      const { id, token } = await seedGuest();

      await get(id).set('X-Guest-Token', token).expect(200);
      await get(id)
        .set('X-Guest-Token', token)
        .set('Authorization', `Bearer ${signShop({ siteId: SITE_B }, OTHER_SECRET)}`)
        .expect(200);
      await get(id)
        .set('X-Guest-Token', token)
        .set('Authorization', `Bearer ${signShop({ siteId: SITE_A }, JWT_SECRET, '-1s')}`)
        .expect(200);
    });

    it('GR10: 게스트 라우트 — GET guest/:id/versions 200, PATCH guest/:id 200(X-Guest-Token 헤더)', async () => {
      const { id, token } = await seedGuest();

      const versions = await request(app.getHttpServer())
        .get(`/edit-sessions/guest/${id}/versions`)
        .set('X-Guest-Token', token)
        .expect(200);
      expect(Array.isArray(versions.body)).toBe(true);

      await request(app.getHttpServer())
        .get(`/edit-sessions/guest/${id}/versions`)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/edit-sessions/guest/${id}`)
        .set('X-Guest-Token', token)
        .send({ canvasData: { v: 10 } })
        .expect(200);
      expect(stored(id).canvasData).toEqual({ v: 10 });
    });

    it('GR11: 소프트 삭제된 게스트 세션 + 올바른 토큰 → 404 SESSION_NOT_FOUND', async () => {
      const { id, token } = await seedGuest();
      stored(id).deletedAt = new Date('2026-09-30T00:00:00.000Z');

      const res = await get(id).set('X-Guest-Token', token).expect(404);

      expect(res.body.code).toBe('SESSION_NOT_FOUND');
      expect(res.body.canvasData).toBeUndefined();
    });
  });

  // ── 게스트 세션 회원 라우트 규칙 (2026-09-29) ─────────────────────────
  // 규칙: 게스트 세션 저장은 게스트 경로(guestToken)로만, 완료는 guest/migrate 로 흡수된 뒤
  // 회원 토큰으로만. 회원 라우트의 저장·완료는 403(PERMISSION_DENIED / GUEST_COMPLETE_NOT_ALLOWED).
  describe('게스트 세션 — 회원 라우트 저장/완료 규칙', () => {
    const MEMBER = 777;
    const memberToken = () =>
      signShop({ sub: String(MEMBER), role: 'customer', siteId: SITE_A, siteName: 'A' });

    /** site A 스탬프 게스트 세션 */
    const seedGuest = async () => {
      const res = await createGuest({ Authorization: `Bearer ${signShop({ siteId: SITE_A })}` }).expect(201);
      return { id: res.body.id as string, token: res.body.guestToken as string };
    };

    it('G1: 회원 JWT 로 PATCH /edit-sessions/:id (게스트 세션) → 403 PERMISSION_DENIED, 저장 없음', async () => {
      const { id } = await seedGuest();

      const res = await request(app.getHttpServer())
        .patch(`/edit-sessions/${id}`)
        .set('Authorization', `Bearer ${memberToken()}`)
        .send({ canvasData: { v: 1 } })
        .expect(403);

      expect(res.body.code).toBe('PERMISSION_DENIED');
      expect(stored(id).canvasData).toBeUndefined();
    });

    it('G2: 회원 JWT 로 PATCH /edit-sessions/:id/complete (게스트 세션) → 403 GUEST_COMPLETE_NOT_ALLOWED', async () => {
      const { id } = await seedGuest();

      const res = await request(app.getHttpServer())
        .patch(`/edit-sessions/${id}/complete`)
        .set('Authorization', `Bearer ${memberToken()}`)
        .expect(403);

      expect(res.body.code).toBe('GUEST_COMPLETE_NOT_ALLOWED');
      expect(stored(id).status).not.toBe(SessionStatus.COMPLETE);
    });

    it('G3: 게스트 경로 + 유효 토큰 → 200 (게스트 저장 경로 유지)', async () => {
      const { id, token } = await seedGuest();

      await request(app.getHttpServer())
        .patch(`/edit-sessions/guest/${id}`)
        .set('X-Guest-Token', token)
        .send({ canvasData: { v: 3 } })
        .expect(200);

      expect(stored(id).canvasData).toEqual({ v: 3 });
    });

    it('G4: guest/migrate 로 흡수된 뒤 회원 JWT 완료 → 200 + COMPLETE', async () => {
      const { id, token } = await seedGuest();

      const out = await sessionsService.migrateGuestSessions(token, MEMBER, SITE_A);
      expect(out.migratedCount).toBe(1);

      await request(app.getHttpServer())
        .patch(`/edit-sessions/${id}/complete`)
        .set('Authorization', `Bearer ${memberToken()}`)
        .expect(200);

      expect(stored(id).status).toBe(SessionStatus.COMPLETE);
    });
  });

  // ── 마이그레이션 테넌시 (I-2 / I-3) ──────────────────────────────────
  describe('guest/migrate — siteId 무접촉 + 교차 site 거부', () => {
    /** 스탬프된 게스트 세션 생성 */
    const seed = async (siteId: string | null) => {
      const headers: Record<string, string> = siteId
        ? { Authorization: `Bearer ${signShop({ siteId })}` }
        : {};
      const res = await createGuest(headers).expect(201);
      return { id: res.body.id as string, token: res.body.guestToken as string };
    };

    it('T7: 세션 siteId=A 를 caller siteId=B 로 이전 요청 → 403 CROSS_SITE_MIGRATION_DENIED', async () => {
      const { id, token } = await seed(SITE_A);

      await expect(
        sessionsService.migrateGuestSessions(token, 777, SITE_B),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CROSS_SITE_MIGRATION_DENIED' }),
      });

      // 요청 전체 거부 — 부분 흡수도, 조용한 덮어쓰기도 없다
      expect(stored(id).siteId).toBe(SITE_A);
      expect(stored(id).memberSeqno).toBe(0);
      expect(stored(id).guestToken).toBe(token);
    });

    it('T7-b 한 건이라도 교차하면 전체 거부(부분 흡수 금지)', async () => {
      const a = await seed(SITE_A);
      // 같은 토큰을 공유하는 site B 세션을 하나 더 심는다(다중 세션 흡수 시나리오)
      const b = await seed(SITE_B);
      stored(b.id).guestToken = a.token;

      await expect(
        sessionsService.migrateGuestSessions(a.token, 777, SITE_A),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CROSS_SITE_MIGRATION_DENIED' }),
      });

      // 자기 site 세션(a)까지 포함해 **아무것도** 흡수되지 않는다
      expect(stored(a.id).memberSeqno).toBe(0);
      expect(stored(b.id).memberSeqno).toBe(0);
    });

    it('T8 동일 site: 흡수 성공 + siteId 는 여전히 A (I-2 무접촉)', async () => {
      const { id, token } = await seed(SITE_A);

      const out = await sessionsService.migrateGuestSessions(token, 777, SITE_A);

      expect(out.migratedCount).toBe(1);
      expect(stored(id).memberSeqno).toBe(777);
      expect(stored(id).siteId).toBe(SITE_A); // 덮어쓰지 않는다
      expect(stored(id).guestToken).toBeNull();
    });

    it('T9 세션 siteId=null: 흡수해도 NULL 그대로 (migrate 는 스탬프하지 않는다)', async () => {
      const { id, token } = await seed(null);

      const out = await sessionsService.migrateGuestSessions(token, 777, SITE_A);

      expect(out.migratedCount).toBe(1);
      expect(stored(id).memberSeqno).toBe(777);
      expect(stored(id).siteId).toBeNull(); // caller 의 site 를 찍지 않는다
    });

    it('T10 caller siteId 없음(구형 리프레시 토큰): 허용 + siteId 불변', async () => {
      const { id, token } = await seed(SITE_A);

      const out = await sessionsService.migrateGuestSessions(token, 777, null);

      expect(out.migratedCount).toBe(1);
      expect(stored(id).siteId).toBe(SITE_A);
    });

    it('T11 만료 게스트 세션은 흡수하지 않는다', async () => {
      const { id, token } = await seed(SITE_A);
      stored(id).guestExpiresAt = new Date(Date.now() - 1000);

      const out = await sessionsService.migrateGuestSessions(token, 777, SITE_A);

      expect(out.migratedCount).toBe(0);
      expect(stored(id).memberSeqno).toBe(0);
      expect(stored(id).guestToken).toBe(token);
    });
  });

  // ── 승격 e2e (같은 사이트 승격 성공 + 다른 사이트 승격 404) ───────────
  describe('승격 게이트 — createGuest 스탬프가 판정에 도달하는가', () => {
    /** 승격 가능 상태로 만든다(완료 + 산출 PDF) — 스탬프 자체는 건드리지 않는다 */
    const makePromotable = (id: string) => {
      const s = stored(id);
      s.status = SessionStatus.COMPLETE;
      s.contentFile = { fileUrl: '/storage/outputs/x/content.pdf' };
      s.contentPdfPageCount = 40;
    };

    it('T15 site A 스탬프 세션을 site A 키로 승격 → 성공(book 에 세션 연결)', async () => {
      const token = signShop({ siteId: SITE_A, siteName: 'A' });
      const res = await createGuest({ Authorization: `Bearer ${token}` }).expect(201);
      makePromotable(res.body.id);

      await booksService.create(siteCtx(SITE_A), {
        creationType: 'EDITOR_SESSION',
        sessionId: res.body.id,
      } as any);

      const created = bookCreate.mock.calls[0][0];
      expect(created.editSessionId).toBe(res.body.id);
      expect(created.siteId).toBe(SITE_A);
      expect(registerExternalFile).toHaveBeenCalledWith(
        '/storage/outputs/x/content.pdf',
        expect.objectContaining({ siteId: SITE_A }),
      );
    });

    it('T14: site A 스탬프 세션을 site B 키로 승격 → 404 ERR_NOT_FOUND', async () => {
      const token = signShop({ siteId: SITE_A, siteName: 'A' });
      const res = await createGuest({ Authorization: `Bearer ${token}` }).expect(201);
      makePromotable(res.body.id);

      await expect(
        booksService.create(siteCtx(SITE_B), {
          creationType: 'EDITOR_SESSION',
          sessionId: res.body.id,
        } as any),
      ).rejects.toMatchObject({ errorCode: ErrV1.ERR_NOT_FOUND });
      expect(bookCreate).not.toHaveBeenCalled();
    });

    it('T14-b: body 에 site A 를 지정해 만든 세션(siteId=null)은 site A 키로 승격 → PartnerApiException, book 미생성 (F-1)', async () => {
      // 토큰 없이 생성한 세션 — body 의 siteId 는 스탬프 근거가 아니므로 siteId=null.
      const res = await createGuest({}, { siteId: SITE_A }).expect(201);
      makePromotable(res.body.id);

      await expect(
        booksService.create(siteCtx(SITE_A), {
          creationType: 'EDITOR_SESSION',
          sessionId: res.body.id,
        } as any),
      ).rejects.toBeInstanceOf(PartnerApiException);
      expect(bookCreate).not.toHaveBeenCalled();
    });

    it('NULL-site(토큰 없이 생성) 세션은 어떤 테넌트도 승격 불가 → 404 (설계된 fail-closed)', async () => {
      const res = await createGuest().expect(201);
      makePromotable(res.body.id);

      await expect(
        booksService.create(siteCtx(SITE_A), {
          creationType: 'EDITOR_SESSION',
          sessionId: res.body.id,
        } as any),
      ).rejects.toMatchObject({ errorCode: ErrV1.ERR_NOT_FOUND });
    });
  });
});
