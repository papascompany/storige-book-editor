/**
 * 게스트 세션 테넌시(siteId) — 실스택 HTTP + 승격 게이트 e2e (2026-07-30).
 *
 * 이 트랙의 실패 모드는 **교차테넌트 IDOR** 이다: siteId 를 잘못 주입하면 파트너 A 가
 * 파트너 B 의 세션을 자기 테넌트로 끌어와 승격하고, 승격은 그 세션의 산출 PDF 를 book
 * 자산으로 연결하므로 **타 파트너 고객의 인쇄물이 유출**된다. 따라서 이 spec 은
 * "주입이 된다"가 아니라 **"잘못된 주입이 막힌다"**를 1급 증거로 고정한다.
 *
 * 구성 — 목이 아니라 실제 사슬을 관통한다:
 *   실 EditSessionsController + 실 EditSessionsService + 인메모리 repo
 *   + 실 OptionalShopJwtGuard + 실 JwtService(진짜 서명/검증)
 *   + 전역 JwtAuthGuard(APP_GUARD — @Public 단락 재현)
 *   → 그 위에 실 BooksService 승격 게이트를 **같은 저장소**로 물려
 *     "createGuest 가 스탬프한 값이 승격 판정에 그대로 도달"함을 실증한다.
 *
 * 커버리지: T1~T6(생성 스탬프) · T14/T15(승격 e2e)
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionMode, SessionStatus } from './entities/edit-session.entity';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
    findOne: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
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
      imports: [JwtModule.register({ secret: JWT_SECRET })],
      controllers: [EditSessionsController],
      providers: [
        EditSessionsService,
        OptionalShopJwtGuard,
        ApiKeyGuard,
        // 프로덕션과 동일하게 전역 JwtAuthGuard 를 얹는다 —
        // @Public 단락(→ passport 미실행 → req.user 부재)이 재현되어야
        // "route-scoped 가드가 실제로 테넌트를 복원한다"가 증거가 된다.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
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
    it('T1 공격: 토큰 없이 body 로 피해자 siteId 주장 → 201 + 저장 siteId=null', async () => {
      const res = await createGuest({}, { siteId: SITE_B }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
      expect(res.body.siteId).toBeNull();
    });

    it('T2 공격: site A 토큰 + body 로 site B 주장 → JWT 가 이긴다(저장 siteId=A)', async () => {
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

    it('T4 공격: 다른 시크릿으로 위조한 토큰(siteId=B) → 201 + siteId=null (decode 아닌 verify 증거)', async () => {
      const forged = signShop({ siteId: SITE_B }, OTHER_SECRET);
      // 페이로드에는 실제로 siteId 가 들어 있다 — decode 였다면 그대로 스탬프됐을 값.
      expect((jwt.decode(forged) as Record<string, unknown>).siteId).toBe(SITE_B);

      const res = await createGuest({ Authorization: `Bearer ${forged}` }).expect(201);

      expect(stored(res.body.id).siteId).toBeNull();
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

  // ── 승격 e2e (트랙 목표의 유일한 성공 증거 + IDOR 차단 증거) ───────────
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

    it('T14 IDOR: site A 스탬프 세션을 site B 키로 승격 → 404(존재 은닉)', async () => {
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

    it('T14-b IDOR: body 로 site A 를 주장해 만든 세션은 site A 키로도 승격 불가(F-1 회귀 락)', async () => {
      // 공격자가 토큰 없이 심은 세션 — dto.siteId 가 먹혔다면 site A 자산이 되었을 것.
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
