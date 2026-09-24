/**
 * W1 (2026-09-25) — 파트너 worker 키 테넌시 우회 교정의 회귀 잠금.
 *
 * `role === 'worker'` 는 assertSiteAccess 등 8곳에서 테넌트 스코프를 통째로 건너뛴다.
 * 종전에는 editor 코드 조회에 실패해 worker 코드로 매칭되기만 하면 'worker' 가 되어,
 * editor≠worker 코드를 가진 파트너가 자기 worker 키로 타사 자원에 접근할 수 있었다.
 * 아래 테스트는 "worker = 내부 WORKER_API_KEY 뿐" 을 가드·전략·소스 세 층에서 고정한다.
 */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { resolveApiKeyRole } from './api-key-role';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { SitesService } from '../sites/sites.service';

type Req = { headers: Record<string, unknown>; user?: Record<string, unknown> };

const ctxOf = (req: Req): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const INTERNAL = 'internal-worker-key-fixture';
const PARTNER_EDITOR = 'partner-editor-code-fixture';
const PARTNER_WORKER = 'partner-worker-code-fixture';
const PARTNER_SITE = { id: 'site-partner', name: 'Partner', retentionDays: null };
const DEFAULT_SITE = { id: 'site-default', name: 'Default Site', retentionDays: null };

function sitesMock(): { findByEditorAuthCode: jest.Mock; findByWorkerAuthCode: jest.Mock } {
  return {
    // 내부 키는 Default Site 의 editor==worker 코드라 editor 조회에서 먼저 매칭된다(운영과 동일)
    findByEditorAuthCode: jest.fn(async (code: string) =>
      code === PARTNER_EDITOR ? PARTNER_SITE : code === INTERNAL ? DEFAULT_SITE : null,
    ),
    findByWorkerAuthCode: jest.fn(async (code: string) =>
      code === PARTNER_WORKER ? PARTNER_SITE : code === INTERNAL ? DEFAULT_SITE : null,
    ),
  };
}

describe('W1 — X-API-Key 역할 판정', () => {
  const ORIGINAL = process.env.WORKER_API_KEY;
  beforeEach(() => {
    process.env.WORKER_API_KEY = INTERNAL;
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.WORKER_API_KEY;
    else process.env.WORKER_API_KEY = ORIGINAL;
  });

  describe('resolveApiKeyRole (단일 원천)', () => {
    it('내부 WORKER_API_KEY → worker', () => {
      expect(resolveApiKeyRole(INTERNAL, INTERNAL)).toBe('worker');
    });
    it('그 밖의 키 → editor (파트너 worker 코드 포함)', () => {
      expect(resolveApiKeyRole(PARTNER_WORKER, INTERNAL)).toBe('editor');
      expect(resolveApiKeyRole(PARTNER_EDITOR, INTERNAL)).toBe('editor');
    });
    it('내부 키 미설정·빈 문자열이면 누구도 worker 가 아니다', () => {
      expect(resolveApiKeyRole(PARTNER_WORKER, undefined)).toBe('editor');
      expect(resolveApiKeyRole('', '')).toBe('editor');
    });
  });

  describe('ApiKeyGuard', () => {
    let guard: ApiKeyGuard;
    let sites: ReturnType<typeof sitesMock>;
    beforeEach(() => {
      sites = sitesMock();
      guard = new ApiKeyGuard(sites as unknown as SitesService);
    });

    it('🔴 파트너 worker 코드 → 그 사이트로 인증되지만 role 은 editor (테넌트 바이패스 불가)', async () => {
      const req: Req = { headers: { 'x-api-key': PARTNER_WORKER } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ siteId: PARTNER_SITE.id, role: 'editor', source: 'shop' });
      expect(sites.findByWorkerAuthCode).toHaveBeenCalledWith(PARTNER_WORKER);
    });

    it('파트너 editor 코드 → role editor (종전과 동일)', async () => {
      const req: Req = { headers: { 'x-api-key': PARTNER_EDITOR } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ siteId: PARTNER_SITE.id, role: 'editor' });
      expect(sites.findByWorkerAuthCode).not.toHaveBeenCalled();
    });

    it('내부 WORKER_API_KEY → role worker (P2c 워커 콜백 무중단 — 종전과 동일)', async () => {
      const req: Req = { headers: { 'x-api-key': INTERNAL } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ siteId: DEFAULT_SITE.id, role: 'worker' });
    });

    it('내부 키가 worker 코드 조회로만 매칭돼도 role worker', async () => {
      sites.findByEditorAuthCode.mockResolvedValue(null);
      const req: Req = { headers: { 'x-api-key': INTERNAL } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ role: 'worker' });
    });

    it('내부 키가 설정되지 않은 환경에서는 worker 코드 키도 editor', async () => {
      delete process.env.WORKER_API_KEY;
      const req: Req = { headers: { 'x-api-key': PARTNER_WORKER } };
      await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ role: 'editor' });
    });

    it('알 수 없는 키 → 401', async () => {
      const req: Req = { headers: { 'x-api-key': 'unknown' } };
      await expect(guard.canActivate(ctxOf(req))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('키 없음 → 401', async () => {
      const req: Req = { headers: {} };
      await expect(guard.canActivate(ctxOf(req))).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('ApiKeyStrategy (현재 사용처 0곳 — 연결 시 재발 방지)', () => {
    const validate = (s: ApiKeyStrategy, key: string): Promise<Record<string, unknown> | false> =>
      new Promise((resolve) => {
        (s as unknown as {
          validate: (k: string, done: (e: Error | null, d: Record<string, unknown> | false) => void) => Promise<void>;
        }).validate(key, (_e, d) => resolve(d));
      });

    it('🔴 파트너 worker 코드 → role editor', async () => {
      const s = new ApiKeyStrategy(sitesMock() as unknown as SitesService);
      await expect(validate(s, PARTNER_WORKER)).resolves.toMatchObject({ siteId: PARTNER_SITE.id, role: 'editor' });
    });
    it('내부 WORKER_API_KEY → role worker (가드와 동일 판정)', async () => {
      const s = new ApiKeyStrategy(sitesMock() as unknown as SitesService);
      await expect(validate(s, INTERNAL)).resolves.toMatchObject({ role: 'worker' });
    });
    it('알 수 없는 키 → false', async () => {
      const s = new ApiKeyStrategy(sitesMock() as unknown as SitesService);
      await expect(validate(s, 'unknown')).resolves.toBe(false);
    });
  });

  describe('소스 정적 잠금 — role 을 worker 로 부여하는 곳은 api-key-role.ts 뿐', () => {
    // 이번 결함은 부여 지점이 두 곳(가드·전략)이었다. 우회 부여가 다시 생기면 여기서 실패한다.
    const SRC = path.resolve(__dirname, '..');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
      });
    // `role = 'worker'` 대입, `role: 'worker'` 객체 리터럴(타입 유니온 `role: 'worker' | …` 는 제외)
    const ASSIGN = /\brole\s*=\s*['"]worker['"]|\brole\s*:\s*['"]worker['"](?!\s*\|)/;

    it('비-spec 소스에서 role 에 worker 를 직접 부여하는 코드가 없다', () => {
      const offenders = walk(SRC)
        .filter((f) => !f.endsWith(path.join('auth', 'api-key-role.ts')))
        .flatMap((f) =>
          fs
            .readFileSync(f, 'utf-8')
            .split('\n')
            .map((line, i) => ({ f: path.relative(SRC, f), line: i + 1, text: line }))
            .filter(({ text }) => !text.trim().startsWith('//') && !text.trim().startsWith('*') && ASSIGN.test(text)),
        );
      expect(offenders).toEqual([]);
    });
  });
});
