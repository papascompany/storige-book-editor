/**
 * GUARDED 외부 라우트 contract test (Stage 0 — 동결 16라우트 밖 인증 시맨틱 고정)
 *
 * contract-freeze.spec.ts(FROZEN 표면)의 자매 spec. 파트너가 X-API-Key 로 호출하는
 * "동결 목록 밖" 외부 라우트 9종의 **가드·인증 시맨틱만** 리플렉션으로 고정한다.
 *
 * FROZEN 과의 차이:
 *  - 응답 shape 은 고정하지 않는다 (additive 진화 허용 — Stage 0 결정).
 *  - 고정하는 것: 경로·HTTP 메서드·@Public(전역 JwtAuthGuard 우회)·ApiKeyGuard 존재·
 *    (shop-session 한정) @Throttle 존재+한도값.
 *
 * 이 spec 이 지키는 회귀 2방향:
 *  (a) ApiKeyGuard 제거/@Public 단독화 → 무인증 개방(보안 회귀) 즉시 red
 *  (b) @Public 제거 → 전역 JwtAuthGuard 적용으로 파트너 X-API-Key 호출 전면 401(무중단 위반) 즉시 red
 *
 * ⚠️ 메서드 파라미터 데코레이터(@CurrentSite 등)는 ROUTE_ARGS 메타데이터라 이 spec 의
 *    단언 대상(PATH/METHOD/GUARDS/IS_PUBLIC)에 영향 없다 — 사이트 스탬프 추가(Stage 0
 *    병행 트랙)와 충돌하지 않는다. 라우트 추가/가드 변경은 여기 스냅샷과 함께 갱신하라.
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkerJobsController } from './worker-jobs/worker-jobs.controller';
import { EditSessionsController } from './edit-sessions/edit-sessions.controller';
import { AuthController } from './auth/auth.controller';
import { IS_PUBLIC_KEY } from './auth/decorators/public.decorator';
import { ApiKeyGuard } from './auth/guards/api-key.guard';

type Ctor = new (...args: never[]) => unknown;

interface GuardedRoute {
  /** 사람이 읽는 계약 표기 */
  contract: string;
  controller: Ctor;
  handler: string;
  method: RequestMethod;
  path: string;
  /** @Throttle 존재 필수 + 한도값 고정 (shop-session 한정) */
  throttle?: { limit: number; ttl: number };
}

/**
 * GUARDED 라우트 스냅샷 — 전부 @Public + ApiKeyGuard 조합(X-API-Key 인증)이 계약.
 * 응답 shape 비고정. master(2026-07-15) 현행 시맨틱 기준.
 */
const GUARDED_ROUTES: GuardedRoute[] = [
  // ── 워커 잡 external 생성/조회 계열 (worker-jobs prefix) ──
  { contract: 'POST /worker-jobs/validate/external (X-API-Key)', controller: WorkerJobsController, handler: 'createValidationJobExternal', method: RequestMethod.POST, path: 'validate/external' },
  { contract: 'POST /worker-jobs/synthesize/external (X-API-Key)', controller: WorkerJobsController, handler: 'createSynthesisJobExternal', method: RequestMethod.POST, path: 'synthesize/external' },
  { contract: 'POST /worker-jobs/fix-pagecount/external (X-API-Key)', controller: WorkerJobsController, handler: 'createPageCountFixJobExternal', method: RequestMethod.POST, path: 'fix-pagecount/external' },
  { contract: 'POST /worker-jobs/split-synthesize/external (X-API-Key)', controller: WorkerJobsController, handler: 'createSplitSynthesisJobExternal', method: RequestMethod.POST, path: 'split-synthesize/external' },
  { contract: 'POST /worker-jobs/check-mergeable/external (X-API-Key, dry-run)', controller: WorkerJobsController, handler: 'checkMergeableExternal', method: RequestMethod.POST, path: 'check-mergeable/external' },

  // ── 워커 콜백 상태 갱신 (P0-3 잠금 이력 — ApiKeyGuard 제거 시 임의 잡 조작 재개방) ──
  { contract: 'PATCH /worker-jobs/external/:id/status (X-API-Key 워커 콜백)', controller: WorkerJobsController, handler: 'updateJobStatusExternal', method: RequestMethod.PATCH, path: 'external/:id/status' },
  { contract: 'PATCH /worker-jobs/:id/status (X-API-Key — external 별칭, P0-3 2026-06-22 잠금)', controller: WorkerJobsController, handler: 'updateJobStatus', method: RequestMethod.PATCH, path: ':id/status' },

  // ── 임포지션 미리보기 (edit-sessions prefix, 순수 조회) ──
  { contract: 'GET /edit-sessions/:id/imposition-preview (X-API-Key)', controller: EditSessionsController, handler: 'getImpositionPreviewExternal', method: RequestMethod.GET, path: ':id/imposition-preview' },

  // ── 임베드 세션 발급 (auth prefix) — 유일하게 @Throttle 한도까지 고정 ──
  { contract: 'POST /auth/shop-session (X-API-Key + Throttle 20/min — SEC-4)', controller: AuthController, handler: 'createShopSession', method: RequestMethod.POST, path: 'shop-session', throttle: { limit: 20, ttl: 60000 } },
];

/** 컨트롤러 prefix — 경로 조립의 앞부분이 바뀌면 전 라우트가 이동한다 */
const GUARDED_CONTROLLER_PREFIX: Array<[Ctor, string]> = [
  [WorkerJobsController, 'worker-jobs'],
  [EditSessionsController, 'edit-sessions'],
  [AuthController, 'auth'],
];

function handlerOf(route: GuardedRoute): ((...args: unknown[]) => unknown) | undefined {
  const proto = (route.controller as { prototype: Record<string, unknown> }).prototype;
  return proto[route.handler] as ((...args: unknown[]) => unknown) | undefined;
}

describe('GUARDED — 동결 목록 밖 외부 라우트 인증 시맨틱 (경로·메서드·가드, shape 비고정)', () => {
  describe.each(GUARDED_CONTROLLER_PREFIX)('%p prefix', (ctor, prefix) => {
    it(`@Controller('${prefix}') 유지`, () => {
      expect(Reflect.getMetadata(PATH_METADATA, ctor)).toBe(prefix);
    });
  });

  describe.each(GUARDED_ROUTES.map((r) => [r.contract, r] as const))('%s', (_label, route) => {
    it('핸들러가 존재한다 (rename 은 계약 변경)', () => {
      expect(typeof handlerOf(route)).toBe('function');
    });

    it('경로·HTTP 메서드가 스냅샷과 일치한다', () => {
      const h = handlerOf(route)!;
      expect(Reflect.getMetadata(PATH_METADATA, h)).toBe(route.path);
      expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(route.method);
    });

    it('인증 시맨틱 = @Public + ApiKeyGuard 조합 (X-API-Key)', () => {
      const h = handlerOf(route)!;
      // @Public 제거 → 전역 JwtAuthGuard 로 파트너 X-API-Key 호출이 전면 401 (무중단 위반)
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
      // ApiKeyGuard 제거 → 무인증 개방 (보안 회귀)
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, h) ?? [];
      expect(guards.includes(ApiKeyGuard)).toBe(true);
    });

    if (route.throttle) {
      it(`@Throttle 존재 + 한도 ${route.throttle.limit}/${route.throttle.ttl}ms 고정`, () => {
        const h = handlerOf(route)!;
        // throttler 버전별 메타 키 차이에 견고하도록 prefix 로 수집 (contract-freeze 선례)
        const keys = (Reflect.getMetadataKeys(h) ?? []).map(String);
        const throttlerKeys = keys.filter((k) => k.toUpperCase().includes('THROTTLER'));
        expect(throttlerKeys.length).toBeGreaterThan(0);

        // 한도값 고정 — 상향/하향은 SEC-4 결정 사안이므로 spec 동시 갱신 필수.
        // 현행 throttler 는 키별 플랫 값(THROTTLER:LIMIT=20, THROTTLER:TTL=60000)으로 저장 —
        // 버전별 구조 차이에 견고하도록 "값 집합에 limit·ttl 둘 다 존재"로 단언한다.
        const values = throttlerKeys
          .map((k) => Reflect.getMetadata(k, h) as unknown)
          .filter((v) => v !== null && v !== undefined);
        expect(values).toEqual(
          expect.arrayContaining([route.throttle!.limit, route.throttle!.ttl]),
        );
      });
    }
  });
});
