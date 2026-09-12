/**
 * OptionalApiKeySiteGuard (D6-ⓐ, 2026-09-12) — 불변식 잠금.
 *
 * 이 가드는 `@Public` 동결 라우트(`POST /worker-jobs/compose-mixed`)에 붙는다. 동결 단정은
 * `contract-freeze.spec.ts:136` 의 `guards.includes(ApiKeyGuard) === false` 로 "X-API-Key 가
 * **필수가 아니다**" 를 잠그는 것이므로, 이 가드가 **절대 throw 하지 않는 한** 동결은 유지된다.
 * 아래 테스트가 그 "절대"를 고정한다.
 */
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OptionalApiKeySiteGuard } from './guards/optional-api-key-site.guard';
import { AuthModule } from './auth.module';
import { SitesService } from '../sites/sites.service';
import { WorkerJobsController } from '../worker-jobs/worker-jobs.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';

type Req = { headers: Record<string, unknown>; user?: unknown; apiKeySite?: unknown };

const ctxOf = (req: Req): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('OptionalApiKeySiteGuard', () => {
  let guard: OptionalApiKeySiteGuard;
  let sites: { findByEditorAuthCode: jest.Mock; findByWorkerAuthCode: jest.Mock };
  const ORIGINAL_WORKER_KEY = process.env.WORKER_API_KEY;

  beforeEach(() => {
    sites = {
      findByEditorAuthCode: jest.fn(async () => null),
      findByWorkerAuthCode: jest.fn(async () => null),
    };
    guard = new OptionalApiKeySiteGuard(sites as unknown as SitesService);
    delete process.env.WORKER_API_KEY;
  });

  afterAll(() => {
    if (ORIGINAL_WORKER_KEY === undefined) delete process.env.WORKER_API_KEY;
    else process.env.WORKER_API_KEY = ORIGINAL_WORKER_KEY;
  });

  // ── 불변식 1: 절대 throw 하지 않는다 ──────────────────────────────────
  describe('불변식 1 — 절대 throw 하지 않는다(@Public 동결 유지)', () => {
    it('키 없음 → 통과, 컨텍스트 미설정', async () => {
      const req: Req = { headers: {} };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.apiKeySite).toBeUndefined();
      expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
    });

    it('공백뿐인 키 → 통과, 조회조차 하지 않는다', async () => {
      const req: Req = { headers: { 'x-api-key': '   ' } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.apiKeySite).toBeUndefined();
      expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
    });

    it('무효·폐기(status!==active) 키 → 401 이 아니라 통과 + 스탬프 포기', async () => {
      const req: Req = { headers: { 'x-api-key': 'sk-revoked' } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.apiKeySite).toBeUndefined();
      // 폐기 키 차단은 findBy*AuthCode 의 status:'active' 조건이 담당한다.
      expect(sites.findByEditorAuthCode).toHaveBeenCalledWith('sk-revoked');
      expect(sites.findByWorkerAuthCode).toHaveBeenCalledWith('sk-revoked');
    });

    it('DB 조회가 throw 해도 통과한다(잡 생성 무중단)', async () => {
      sites.findByEditorAuthCode.mockRejectedValue(new Error('DB down'));
      const req: Req = { headers: { 'x-api-key': 'sk-x' } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.apiKeySite).toBeUndefined();
    });
  });

  // ── 불변식 2: req.user 를 건드리지 않는다 ─────────────────────────────
  describe('불변식 2 — req.user 를 건드리지 않는다(자동조립 권한 상승 차단)', () => {
    it('유효 키여도 req.user 는 그대로다', async () => {
      sites.findByEditorAuthCode.mockResolvedValue({ id: 'site-A', name: 'A' });
      const sentinel = { source: 'shop', siteId: 'site-JWT' };
      const req: Req = { headers: { 'x-api-key': 'sk-a' }, user: sentinel };
      await guard.canActivate(ctxOf(req));
      // 같은 객체 그대로 — 덮어쓰기·병합 모두 없음.
      expect(req.user).toBe(sentinel);
      expect(req.apiKeySite).toEqual({ siteId: 'site-A', siteName: 'A' });
    });

    it('req.user 가 없던 요청에 user 를 만들지 않는다', async () => {
      sites.findByEditorAuthCode.mockResolvedValue({ id: 'site-A', name: 'A' });
      const req: Req = { headers: { 'x-api-key': 'sk-a' } };
      await guard.canActivate(ctxOf(req));
      expect(req.user).toBeUndefined();
    });
  });

  // ── 불변식 4: 내부 워커 키는 테넌트 신원이 아니다 ─────────────────────
  it('불변식 4 — 내부 WORKER_API_KEY 는 스탬프 권위가 아니다(Default Site 오귀속 방지)', async () => {
    process.env.WORKER_API_KEY = 'internal-worker-key';
    const req: Req = { headers: { 'x-api-key': 'internal-worker-key' } };
    await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(req.apiKeySite).toBeUndefined();
    expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
  });

  // ── 키 해석 ───────────────────────────────────────────────────────────
  describe('사이트 해석', () => {
    it('editor 키로 매칭', async () => {
      sites.findByEditorAuthCode.mockResolvedValue({ id: 'site-A', name: 'A' });
      const req: Req = { headers: { 'x-api-key': 'sk-editor' } };
      await guard.canActivate(ctxOf(req));
      expect(req.apiKeySite).toEqual({ siteId: 'site-A', siteName: 'A' });
      expect(sites.findByWorkerAuthCode).not.toHaveBeenCalled();
    });

    it('worker 키로도 매칭(파트너가 어느 키를 쓰는지에 의존하지 않는다)', async () => {
      sites.findByWorkerAuthCode.mockResolvedValue({ id: 'site-B', name: 'B' });
      const req: Req = { headers: { 'x-api-key': 'sk-worker' } };
      await guard.canActivate(ctxOf(req));
      expect(req.apiKeySite).toEqual({ siteId: 'site-B', siteName: 'B' });
    });
  });

  // ── 모듈 배선 ─────────────────────────────────────────────────────────
  // ⚠️ route-scoped 가드는 컨테이너 전역 metatype 탐색으로 찾힌다. 어느 모듈에도
  //    provider 로 등록돼 있지 않으면 **요청 시점에** 생성이 실패한다
  //    (worker-jobs.module.ts 주석이 같은 함정을 명시).
  describe('모듈 배선', () => {
    it('AuthModule 의 providers·exports 에 등록돼 있다', () => {
      const providers: unknown[] = Reflect.getMetadata('providers', AuthModule) ?? [];
      const exports_: unknown[] = Reflect.getMetadata('exports', AuthModule) ?? [];
      expect(providers).toContain(OptionalApiKeySiteGuard);
      expect(exports_).toContain(OptionalApiKeySiteGuard);
    });

    it('SitesService 주입으로 실제 생성된다', async () => {
      const mod = await Test.createTestingModule({
        providers: [
          OptionalApiKeySiteGuard,
          { provide: SitesService, useValue: sites },
        ],
      }).compile();
      expect(mod.get(OptionalApiKeySiteGuard)).toBeInstanceOf(OptionalApiKeySiteGuard);
      await mod.close();
    });

    it('compose-mixed 핸들러에 실제로 붙어 있다', () => {
      const guards: unknown[] =
        Reflect.getMetadata(GUARDS_METADATA, WorkerJobsController.prototype.createComposeMixed) ??
        [];
      expect(guards).toContain(OptionalApiKeySiteGuard);
    });
  });
});
