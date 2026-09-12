/**
 * 자동조립 opt-in (2026-08-13) — `POST /worker-jobs/compose-mixed` **라우트 계약** 잠금.
 *
 * 서비스 유닛스펙(worker-jobs.service.compose-mixed-assembly.spec.ts)이 도출·인가 로직을
 * 지킨다면, 이 스펙은 그 앞단 배선을 지킨다:
 *  1. `@Public()` 유지 — 동결 계약(auth:'public')은 additive 가드를 붙여도 그대로다.
 *  2. `OptionalShopJwtGuard` 가 붙어 있다 — 토큰이 없거나 위조여도 401 이 아니라 통과.
 *  3. **caller 는 검증된 shop-session 에서만 복원**된다. 다른 출처(admin JWT 등)의 siteId 나
 *     body 로 들어온 siteId 는 자동조립 인가 주체가 될 수 없다(테넌트 위조 차단).
 */
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { WorkerJobsController } from './worker-jobs.controller';

describe('WorkerJobsController.createComposeMixed — 자동조립 caller 배선', () => {
  let controller: WorkerJobsController;
  let workerJobsService: { createComposeMixedJob: jest.Mock };

  const dto = {
    editSessionId: 'sess-1',
    assembleFromSession: true,
  } as never;

  beforeEach(() => {
    workerJobsService = { createComposeMixedJob: jest.fn(async () => ({ id: 'job-1' })) };
    controller = new WorkerJobsController(
      workerJobsService as never,
      { get: jest.fn() } as never, // configService
    );
  });

  const callerArg = () => workerJobsService.createComposeMixedJob.mock.calls[0][1];

  // ── 라우트 계약(동결) ──────────────────────────────────────────────────
  it('@Public() 유지 — additive 가드를 붙여도 동결 계약(auth:public)이 유지된다', () => {
    const handler = WorkerJobsController.prototype.createComposeMixed;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('OptionalShopJwtGuard 가 걸려 있다(토큰 부재·위조도 401 없이 통과 — 기존 호출자 무중단)', () => {
    const guards = Reflect.getMetadata('__guards__', WorkerJobsController.prototype.createComposeMixed);
    expect(guards).toContain(OptionalShopJwtGuard);
  });

  // ── caller 복원 규약 ───────────────────────────────────────────────────
  it("검증된 shop-session(source='shop' + siteId) 만 caller 로 전달", async () => {
    await controller.createComposeMixed(dto, { source: 'shop', siteId: 'site-A' });
    expect(callerArg()).toEqual({ siteId: 'site-A', allowedOrderSeqnos: undefined });
  });

  // ── 주문 스코프(적대검증 MAJOR) ────────────────────────────────────────
  // 가드가 서명 검증된 JWT 에서 allowedOrderSeqnos 를 복원해 준다
  // (optional-shop-jwt.guard.ts:70-75). 컨트롤러가 이 필드를 잘라내면 서비스는
  // 같은 테넌트 내 타 고객 세션 조립을 막을 수 없다.
  it('allowedOrderSeqnos 를 caller 로 전달한다(주문 스코프 가드 근거)', async () => {
    await controller.createComposeMixed(dto, {
      source: 'shop',
      siteId: 'site-A',
      allowedOrderSeqnos: [111, 112],
    });
    expect(callerArg()).toEqual({ siteId: 'site-A', allowedOrderSeqnos: [111, 112] });
  });

  it('allowedOrderSeqnos 가 배열이 아니면 undefined 로 정규화(호환 모드)', async () => {
    await controller.createComposeMixed(dto, {
      source: 'shop',
      siteId: 'site-A',
      allowedOrderSeqnos: 'all',
    });
    expect(callerArg()).toEqual({ siteId: 'site-A', allowedOrderSeqnos: undefined });
  });

  it('토큰 없음(게스트) → caller undefined (자동조립은 서비스에서 404 fail-closed)', async () => {
    await controller.createComposeMixed(dto, undefined);
    expect(callerArg()).toBeUndefined();
  });

  it("shop 이 아닌 출처(admin JWT 등)의 siteId 는 caller 가 되지 않는다", async () => {
    await controller.createComposeMixed(dto, { source: 'admin', siteId: 'site-A', role: 'ADMIN' });
    expect(callerArg()).toBeUndefined();
  });

  it('source 만 shop 이고 siteId 가 문자열이 아니면 caller 가 되지 않는다', async () => {
    await controller.createComposeMixed(dto, { source: 'shop' });
    expect(callerArg()).toBeUndefined();
  });

  it('body 는 caller 에 영향을 주지 않는다 — dto 는 그대로 1번째 인자로 전달', async () => {
    const bodyWithSite = { ...(dto as object), siteId: 'site-FORGED' } as never;
    await controller.createComposeMixed(bodyWithSite, undefined);

    // [D6-ⓐ 2026-09-12] 3번째 인자 = 사이트 키 컨텍스트. 키 없는 호출은 undefined.
    expect(workerJobsService.createComposeMixedJob).toHaveBeenCalledWith(
      bodyWithSite,
      undefined,
      undefined,
    );
  });

  // ── [D6-ⓐ] 사이트 키 컨텍스트 배선 ─────────────────────────────────────
  // 🚨 caller(2번째)와 apiKeySite(3번째)는 **끝까지 분리**돼야 한다. 한 객체로 합치면
  //    자동조립 인가 게이트(assembleComposeInputFromSession 의 caller.siteId 일치 검사)가
  //    API 키로 통과되고, API 키에는 allowedOrderSeqnos 주문 스코프가 없어 호환 모드로
  //    떨어진다 → 같은 테넌트의 **타 고객 세션**을 합본으로 뽑는 권한 상승.
  describe('사이트 키 컨텍스트(apiKeySite) 배선', () => {
    const apiKeySite = { siteId: 'site-KEY', siteName: 'KEY' };

    it('3번째 인자로 그대로 전달된다', () => {
      return controller.createComposeMixed(dto, undefined, apiKeySite).then(() => {
        expect(workerJobsService.createComposeMixedJob.mock.calls[0][2]).toEqual(apiKeySite);
      });
    });

    it('caller 와 섞이지 않는다 — 키만 있으면 caller 는 여전히 undefined', async () => {
      await controller.createComposeMixed(dto, undefined, apiKeySite);
      expect(callerArg()).toBeUndefined();
    });

    it('shop-session 과 키가 동시에 있어도 각자 자기 자리로 간다', async () => {
      await controller.createComposeMixed(
        dto,
        { source: 'shop', siteId: 'site-JWT', allowedOrderSeqnos: [111] },
        apiKeySite,
      );
      expect(callerArg()).toEqual({ siteId: 'site-JWT', allowedOrderSeqnos: [111] });
      expect(workerJobsService.createComposeMixedJob.mock.calls[0][2]).toEqual(apiKeySite);
    });
  });
});
