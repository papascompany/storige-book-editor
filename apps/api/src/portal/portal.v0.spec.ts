/**
 * 파트너 포털 v0 spec (S2-4 — D-7a 보수 스코프).
 *
 * 검증 범위:
 *  - 인가 경계(핵심): SITE_ADMIN 자기 site 만 — 크로스 테넌트 403(TenantGuard),
 *    per-site 역할 경계(멤버십은 있으나 SITE_MANAGER 인 site → 403),
 *    전역 ADMIN/MANAGER 403(이 표면 밖), SUPER_ADMIN dual-mode 통과.
 *  - 시크릿 마스킹: site 뷰에 editorAuthCode/workerAuthCode 원문 부재(prefix 마스킹만).
 *  - PATCH 화이트리스트: allowedOrigins/uploadCallbackUrl 만 — 그 외 필드 400
 *    (forbidNonWhitelisted), origin 형식 강제, 내부/사설 콜백 URL 400.
 *  - test 키 강제: 발급 env='test' 고정, env='live' 시도 **403**(400 아님 — 스코프 계약),
 *    목록/폐기에서 live 키 완전 비노출(404), 발급 원문 1회 노출 규약.
 *  - 가드 스택 리플렉션 고정(JwtAuthGuard+RolesGuard+TenantGuard, @Roles(SITE_ADMIN),
 *    'v1/' prefix 아님 — partner-v1-guarded 전수 스캔 밖 유지).
 *
 * DB 미사용 — sites/partner_api_keys 전부 인메모리 fake. JwtAuthGuard 만 오버라이드
 * (x-test-user 헤더 → req.user), RolesGuard/TenantGuard 는 **실물** 그대로 관통.
 */
import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { UserRole } from '@storige/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SitesService } from '../sites/sites.service';
import { Site } from '../sites/entities/site.entity';
import { PartnerApiKey } from '../partner-api/entities/partner-api-key.entity';
import { PartnerApiKeysService } from '../partner-api/keys/partner-api-keys.service';
import { PortalController } from './portal.controller';
import { PortalService, PortalRequestUser } from './portal.service';

// ── 픽스처 ────────────────────────────────────────────────────────────────

const SITE_A = 'site-a';
const SITE_B = 'site-b';

const EDITOR_CODE_A = 'sk-storige-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WORKER_CODE_A = 'sk-storige-wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww';

function makeSite(id: string, name: string): Site {
  return {
    id,
    name,
    domain: 'https://partner.example.com',
    returnUrlBase: null,
    uploadCallbackUrl: null,
    editorAuthCode: id === SITE_A ? EDITOR_CODE_A : 'sk-storige-bbbb0000000000000000000000',
    workerAuthCode: id === SITE_A ? WORKER_CODE_A : 'sk-storige-bbbb1111111111111111111111',
    status: 'active',
    retentionDays: null,
    pdfConversionEnabled: true,
    beforeAfterUrl: null,
    defaultUnit: 'mm',
    checkWorkorder: true,
    checkCutting: true,
    checkSafezone: true,
    allowedOrigins: ['https://partner.example.com'],
    frameAncestors: null,
    editorLaunchMode: 'inline',
    editorBundleUrl: null,
    editorCssUrl: null,
    editorVersion: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** 인메모리 SitesService fake — 포털이 쓰는 findOne/update 서브셋만 */
class FakeSitesService {
  sites = new Map<string, Site>();

  async findOne(id: string): Promise<Site> {
    const site = this.sites.get(id);
    if (!site) throw new NotFoundException(`Site ${id} not found`);
    return site;
  }

  async update(id: string, dto: Partial<Site>): Promise<Site> {
    const site = await this.findOne(id);
    Object.assign(site, dto, { updatedAt: new Date() });
    return site;
  }
}

/** 인메모리 partner_api_keys fake — PartnerApiKeysService 가 쓰는 서브셋 */
class FakePartnerKeyRepo {
  rows: PartnerApiKey[] = [];

  create(data: Partial<PartnerApiKey>): PartnerApiKey {
    return { ...data } as PartnerApiKey;
  }

  async save(row: PartnerApiKey): Promise<PartnerApiKey> {
    const saved: PartnerApiKey = {
      ...row,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    const idx = this.rows.findIndex((r) => r.id === saved.id);
    if (idx >= 0) this.rows[idx] = saved;
    else this.rows.push(saved);
    return saved;
  }

  async find(options: { where: Partial<PartnerApiKey> }): Promise<PartnerApiKey[]> {
    return this.rows.filter((r) => this.matches(r, options.where));
  }

  async findOne(options: {
    where: Partial<PartnerApiKey>;
  }): Promise<PartnerApiKey | null> {
    return this.rows.find((r) => this.matches(r, options.where)) ?? null;
  }

  async update(): Promise<{ affected: number }> {
    return { affected: 0 };
  }

  private matches(row: PartnerApiKey, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(
      ([key, expected]) =>
        (row as unknown as Record<string, unknown>)[key] === expected,
    );
  }
}

// ── 테스트 사용자 (x-test-user 헤더로 req.user 주입) ─────────────────────

const siteAdminA: PortalRequestUser = {
  role: UserRole.SITE_ADMIN,
  siteRoles: [{ siteId: SITE_A, role: UserRole.SITE_ADMIN }],
};
/** site A=ADMIN, site B=MANAGER 혼합 배정 — B 는 멤버십은 있으나 역할 경계 밖 */
const mixedRoles: PortalRequestUser = {
  role: UserRole.SITE_ADMIN,
  siteRoles: [
    { siteId: SITE_A, role: UserRole.SITE_ADMIN },
    { siteId: SITE_B, role: UserRole.SITE_MANAGER },
  ],
};
const siteManager: PortalRequestUser = {
  role: UserRole.SITE_MANAGER,
  siteRoles: [{ siteId: SITE_A, role: UserRole.SITE_MANAGER }],
};
/**
 * 게이트 동기화(P1-1) — 전역 role 은 SITE_MANAGER 로 생성됐지만 site A 에 SITE_ADMIN
 * 배정된 계정. UI 게이팅(hasSiteAdminAssignment)은 배정 기준이므로 메뉴가 보이는데,
 * RolesGuard 를 전역 role 로 좁히면 assertSiteAdmin 도달 전 403 이 되던 불일치를 검증.
 */
const globalManagerSiteAdminOnA: PortalRequestUser = {
  role: UserRole.SITE_MANAGER,
  siteRoles: [{ siteId: SITE_A, role: UserRole.SITE_ADMIN }],
};
const superAdmin: PortalRequestUser = { role: UserRole.SUPER_ADMIN };
const globalAdmin: PortalRequestUser = { role: UserRole.ADMIN };

describe('파트너 포털 v0 (/api/portal/sites/:siteId — SITE_ADMIN 셀프서브)', () => {
  let app: INestApplication;
  let sitesService: FakeSitesService;
  let keyRepo: FakePartnerKeyRepo;
  let keysService: PartnerApiKeysService;

  beforeAll(async () => {
    sitesService = new FakeSitesService();
    keyRepo = new FakePartnerKeyRepo();

    const moduleRef = await Test.createTestingModule({
      controllers: [PortalController],
      providers: [
        PortalService,
        PartnerApiKeysService,
        { provide: SitesService, useValue: sitesService },
        { provide: getRepositoryToken(PartnerApiKey), useValue: keyRepo },
      ],
    })
      // JwtAuthGuard 만 대체 — RolesGuard/TenantGuard 는 실물 관통(인가 경계 실검증)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context.switchToHttp().getRequest();
          const raw = req.headers['x-test-user'];
          if (typeof raw !== 'string' || raw.length === 0) {
            throw new UnauthorizedException();
          }
          req.user = JSON.parse(raw);
          return true;
        },
      })
      .compile();

    keysService = moduleRef.get(PartnerApiKeysService);

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // main.ts 와 동일 옵션 — PATCH 화이트리스트(forbidNonWhitelisted) 검증에 필수
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sitesService.sites = new Map([
      [SITE_A, makeSite(SITE_A, 'Partner A')],
      [SITE_B, makeSite(SITE_B, 'Partner B')],
    ]);
    keyRepo.rows = [];
  });

  const as = (user: PortalRequestUser) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('x-test-user', JSON.stringify(user)),
    patch: (path: string) =>
      request(app.getHttpServer()).patch(path).set('x-test-user', JSON.stringify(user)),
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set('x-test-user', JSON.stringify(user)),
    delete: (path: string) =>
      request(app.getHttpServer()).delete(path).set('x-test-user', JSON.stringify(user)),
  });

  // ── 인가 경계 ────────────────────────────────────────────────────────────

  describe('인가 경계 (크로스 테넌트/역할)', () => {
    it('SITE_ADMIN — 자기 site 조회 200', async () => {
      const res = await as(siteAdminA).get(`/api/portal/sites/${SITE_A}`).expect(200);
      expect(res.body.data.id).toBe(SITE_A);
    });

    it('크로스 테넌트 — 타 site 조회 403 TENANT_FORBIDDEN (TenantGuard 실물)', async () => {
      const res = await as(siteAdminA).get(`/api/portal/sites/${SITE_B}`).expect(403);
      expect(res.body.code).toBe('TENANT_FORBIDDEN');
    });

    it('크로스 테넌트 — 타 site 키 발급/폐기/설정변경 전부 403', async () => {
      await as(siteAdminA)
        .post(`/api/portal/sites/${SITE_B}/partner-keys`)
        .send({})
        .expect(403);
      await as(siteAdminA)
        .delete(`/api/portal/sites/${SITE_B}/partner-keys/any-id`)
        .expect(403);
      await as(siteAdminA)
        .patch(`/api/portal/sites/${SITE_B}`)
        .send({ uploadCallbackUrl: 'https://evil.example.com/hook' })
        .expect(403);
    });

    it('per-site 역할 경계 — 멤버십은 있으나 그 site 역할이 SITE_MANAGER 면 403 PORTAL_FORBIDDEN', async () => {
      // TenantGuard(멤버십)는 통과하지만 서비스 2차 경계가 막아야 한다
      const res = await as(mixedRoles).get(`/api/portal/sites/${SITE_B}`).expect(403);
      expect(res.body.code).toBe('PORTAL_FORBIDDEN');
      // 자기 SITE_ADMIN site 는 정상
      await as(mixedRoles).get(`/api/portal/sites/${SITE_A}`).expect(200);
    });

    it('순수 SITE_MANAGER(SITE_ADMIN 배정 없음) — 403 (assertSiteAdmin 경계)', async () => {
      // @Roles 가 SITE_MANAGER 를 포함(게이트 동기화)하므로 RolesGuard 는 통과하지만,
      // 해당 site 역할이 SITE_MANAGER 라 서비스 2차 경계(assertSiteAdmin)가 막는다.
      const res = await as(siteManager)
        .get(`/api/portal/sites/${SITE_A}`)
        .expect(403);
      expect(res.body.code).toBe('PORTAL_FORBIDDEN');
    });

    it('게이트 동기화(P1-1) — 전역 SITE_MANAGER + 해당 site SITE_ADMIN 배정이면 200', async () => {
      // per-site 판정을 assertSiteAdmin 에 위임 → 배정된 SITE_ADMIN 은 통과해야 한다
      const res = await as(globalManagerSiteAdminOnA)
        .get(`/api/portal/sites/${SITE_A}`)
        .expect(200);
      expect(res.body.data.id).toBe(SITE_A);
    });

    it('전역 ADMIN — 403 (이 표면 밖 — 기존 /api/sites 사용, 기존 화면 무변경)', async () => {
      await as(globalAdmin).get(`/api/portal/sites/${SITE_A}`).expect(403);
    });

    it('SUPER_ADMIN — dual-mode 전역 통과', async () => {
      await as(superAdmin).get(`/api/portal/sites/${SITE_A}`).expect(200);
      await as(superAdmin).get(`/api/portal/sites/${SITE_B}`).expect(200);
    });

    it('미인증 — 401', async () => {
      await request(app.getHttpServer()).get(`/api/portal/sites/${SITE_A}`).expect(401);
    });
  });

  // ── 시크릿 마스킹 ────────────────────────────────────────────────────────

  describe('시크릿 마스킹', () => {
    it('site 뷰 — 인증코드 원문 부재, prefix 마스킹만', async () => {
      const res = await as(siteAdminA).get(`/api/portal/sites/${SITE_A}`).expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(EDITOR_CODE_A);
      expect(body).not.toContain(WORKER_CODE_A);
      expect(res.body.data.editorAuthCodeMasked).toBe(`${EDITOR_CODE_A.slice(0, 12)}…`);
      expect(res.body.data.workerAuthCodeMasked).toBe(`${WORKER_CODE_A.slice(0, 12)}…`);
      expect(res.body.data).not.toHaveProperty('editorAuthCode');
      expect(res.body.data).not.toHaveProperty('workerAuthCode');
    });
  });

  // ── PATCH 셀프 설정 ─────────────────────────────────────────────────────

  describe('PATCH 셀프 설정 (allowedOrigins / uploadCallbackUrl)', () => {
    it('정상 변경 — origin 정규화(트레일링 슬래시 제거) + 콜백 URL 반영', async () => {
      const res = await as(siteAdminA)
        .patch(`/api/portal/sites/${SITE_A}`)
        .send({
          allowedOrigins: ['https://app.example.com/', 'https://staging.example.com'],
          uploadCallbackUrl: 'https://api.example.com/storige/webhook',
        })
        .expect(200);
      expect(res.body.data.allowedOrigins).toEqual([
        'https://app.example.com',
        'https://staging.example.com',
      ]);
      expect(res.body.data.uploadCallbackUrl).toBe(
        'https://api.example.com/storige/webhook',
      );
      // 실제 저장 반영 확인
      expect(sitesService.sites.get(SITE_A)!.allowedOrigins).toEqual([
        'https://app.example.com',
        'https://staging.example.com',
      ]);
    });

    it('uploadCallbackUrl: null — 해제 허용', async () => {
      sitesService.sites.get(SITE_A)!.uploadCallbackUrl = 'https://old.example.com/x';
      const res = await as(siteAdminA)
        .patch(`/api/portal/sites/${SITE_A}`)
        .send({ uploadCallbackUrl: null })
        .expect(200);
      expect(res.body.data.uploadCallbackUrl).toBeNull();
    });

    it('origin 에 path 포함 — 400', async () => {
      await as(siteAdminA)
        .patch(`/api/portal/sites/${SITE_A}`)
        .send({ allowedOrigins: ['https://app.example.com/path'] })
        .expect(400);
    });

    it('내부/사설 콜백 URL — 400 (localhost·사설 IPv4·.internal)', async () => {
      for (const url of [
        'https://localhost/hook',
        'http://127.0.0.1/hook',
        'http://10.0.0.5/hook',
        'http://192.168.0.2/hook',
        'http://172.20.1.1/hook',
        'http://169.254.169.254/latest/meta-data',
        'https://metadata.internal/hook',
        'https://host.docker.internal/hook',
      ]) {
        await as(siteAdminA)
          .patch(`/api/portal/sites/${SITE_A}`)
          .send({ uploadCallbackUrl: url })
          .expect(400);
      }
    });

    it('화이트리스트 밖 필드(name/status/editorAuthCode 등) — 400 forbidNonWhitelisted', async () => {
      for (const payload of [
        { name: 'hacked' },
        { status: 'suspended' },
        { editorAuthCode: 'sk-storige-injected000000000000' },
        { frameAncestors: ['https://evil.example.com'] },
        { retentionDays: 0 },
      ]) {
        await as(siteAdminA)
          .patch(`/api/portal/sites/${SITE_A}`)
          .send(payload)
          .expect(400);
      }
      // 필드 불변 확인
      const site = sitesService.sites.get(SITE_A)!;
      expect(site.name).toBe('Partner A');
      expect(site.status).toBe('active');
    });

    it('빈 PATCH — 200 멱등 (현재 뷰 반환)', async () => {
      const res = await as(siteAdminA)
        .patch(`/api/portal/sites/${SITE_A}`)
        .send({})
        .expect(200);
      expect(res.body.data.id).toBe(SITE_A);
    });
  });

  // ── test 키 셀프 관리 ───────────────────────────────────────────────────

  describe('test 키 셀프 발급/목록/폐기', () => {
    it("발급 — env 미지정 시 'test' 강제 + 원문 1회 노출(sk_test_ 접두)", async () => {
      const res = await as(siteAdminA)
        .post(`/api/portal/sites/${SITE_A}/partner-keys`)
        .send({ name: 'staging' })
        .expect(201);
      expect(res.body.data.key).toMatch(/^sk_test_[0-9a-f]{48}$/);
      expect(res.body.data.apiKey.env).toBe('test');
      expect(res.body.data.apiKey.siteId).toBe(SITE_A);
      // 저장분은 해시 — 원문/키해시 응답 재노출 없음
      expect(keyRepo.rows[0].keyHash).toBe(
        PartnerApiKeysService.hashKey(res.body.data.key),
      );
      expect(res.body.data.apiKey).not.toHaveProperty('keyHash');
    });

    it("env:'test' 명시 — 200/201 정상", async () => {
      await as(siteAdminA)
        .post(`/api/portal/sites/${SITE_A}/partner-keys`)
        .send({ env: 'test' })
        .expect(201);
    });

    it("env:'live' 시도 — 403 PORTAL_LIVE_KEY_FORBIDDEN (승인 큐 우회 차단)", async () => {
      const res = await as(siteAdminA)
        .post(`/api/portal/sites/${SITE_A}/partner-keys`)
        .send({ env: 'live' })
        .expect(403);
      expect(res.body.code).toBe('PORTAL_LIVE_KEY_FORBIDDEN');
      expect(keyRepo.rows).toHaveLength(0); // 발급 자체가 없어야 한다
    });

    it('목록 — test 키만, live 키 메타데이터 비노출 + prefix 마스킹', async () => {
      const testKey = await keysService.issue(SITE_A, 'test', 'mine');
      const liveKey = await keysService.issue(SITE_A, 'live', 'ops-issued');
      const otherSite = await keysService.issue(SITE_B, 'test', 'not-mine');

      const res = await as(siteAdminA)
        .get(`/api/portal/sites/${SITE_A}/partner-keys`)
        .expect(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.items[0].id).toBe(testKey.apiKey.id);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(liveKey.apiKey.id); // live 비노출
      expect(body).not.toContain(otherSite.apiKey.id); // 타 site 비노출
      expect(body).not.toContain(testKey.plaintextKey); // 원문 비노출
    });

    it('폐기 — 자기 test 키 revoked', async () => {
      const testKey = await keysService.issue(SITE_A, 'test', null);
      const res = await as(siteAdminA)
        .delete(`/api/portal/sites/${SITE_A}/partner-keys/${testKey.apiKey.id}`)
        .expect(200);
      expect(res.body.data.status).toBe('revoked');
      expect(keyRepo.rows[0].status).toBe('revoked');
    });

    it('폐기 — live 키 id 는 404 (포털 표면에서 live 키 조작 불가·존재 오라클 차단)', async () => {
      const liveKey = await keysService.issue(SITE_A, 'live', null);
      await as(siteAdminA)
        .delete(`/api/portal/sites/${SITE_A}/partner-keys/${liveKey.apiKey.id}`)
        .expect(404);
      expect(keyRepo.rows[0].status).toBe('active'); // live 키 불변
    });

    it('폐기 — 타 site 의 test 키 id 는 404 (siteId 스코프)', async () => {
      const otherSite = await keysService.issue(SITE_B, 'test', null);
      await as(siteAdminA)
        .delete(`/api/portal/sites/${SITE_A}/partner-keys/${otherSite.apiKey.id}`)
        .expect(404);
      expect(keyRepo.rows[0].status).toBe('active');
    });
  });

  // ── 가드 스택 리플렉션 고정 (contract) ──────────────────────────────────

  describe('가드 스택 계약 (리플렉션)', () => {
    it('JwtAuthGuard + RolesGuard + TenantGuard 순서 고정', () => {
      const guards: unknown[] =
        Reflect.getMetadata(GUARDS_METADATA, PortalController) ?? [];
      expect(guards).toEqual([JwtAuthGuard, RolesGuard, TenantGuard]);
    });

    it('@Roles(SITE_ADMIN, SITE_MANAGER) — per-site 판정은 assertSiteAdmin 위임, 전역 ADMIN/MANAGER 부여 금지', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, PortalController);
      // 게이트 동기화(P1-1): SITE_MANAGER 도 RolesGuard 통과시키되 순수 SITE_MANAGER 는
      // 서비스 경계(assertSiteAdmin)에서 403. 전역 ADMIN/MANAGER 는 여전히 목록 밖 → 403.
      expect(roles).toEqual([UserRole.SITE_ADMIN, UserRole.SITE_MANAGER]);
      expect(roles).not.toContain(UserRole.ADMIN);
      expect(roles).not.toContain(UserRole.MANAGER);
    });

    it("경로 prefix 는 'portal/...' — v1 표면(partner-v1-guarded 전수 스캔) 밖", () => {
      const path = Reflect.getMetadata(PATH_METADATA, PortalController);
      expect(path).toBe('portal/sites/:siteId');
      expect(/^v1(\/|$)/.test(path)).toBe(false);
    });
  });
});
