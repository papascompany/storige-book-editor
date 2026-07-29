/**
 * EditSessionsModule 실배선 스모크 — DI 는 기동 시점에만 실체화된다 (2026-07-30).
 *
 * ── 왜 이 spec 이 필요한가 ────────────────────────────────────────────────
 * 게스트 siteId 스탬프의 다른 spec 들(guest-session-tenancy · controller.spec)은
 * 전부 **테스트가 직접 선언한 배선**(`JwtModule.register({secret})` + providers)에서
 * 돈다. 즉 "프로덕션 EditSessionsModule 과 동일 배선"은 주석의 주장일 뿐이고,
 * 실제 모듈 메타데이터는 어떤 테스트도 읽지 않았다.
 *
 * 그래서 다음 실수들이 **suite 전체 green 인 채로** 프로덕션에만 터진다:
 *   · providers 에서 OptionalShopJwtGuard 누락 → 요청 시 Nest 가 가드를 못 만든다
 *   · imports 에서 JwtModule 누락 → 가드 생성자의 JwtService 미해결(기동 실패)
 *   · secret 키 오타(JWT_SECRET → JWT_SECERT) → verify 가 항상 실패 →
 *     **조용히 전량 NULL 스탬프**로 회귀(가장 위험: 에러 없이 기능만 죽는다)
 *
 * 이 spec 은 EditSessionsModule 의 **실제 메타데이터**에서 JwtModule 동적 모듈을
 * 꺼내 컴파일하고, 그 배선으로 만들어진 가드가 진짜로 서명을 검증하는지 확인한다.
 * DB·큐 의존성을 건드리지 않으므로 전체 모듈 컴파일 없이도 결정적으로 돈다.
 */
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { DynamicModule } from '@nestjs/common';
import { EditSessionsModule } from './edit-sessions.module';
import { EditSessionsController } from './edit-sessions.controller';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';

const SECRET = 'module-wiring-secret';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ctxWith = (authorization?: string): { ctx: ExecutionContext; req: Record<string, any> } => {
  const req: Record<string, any> = { headers: authorization ? { authorization } : {} };
  return {
    req,
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
  };
};

describe('EditSessionsModule 실배선 — 게스트 siteId 스탬프 DI', () => {
  const imports = (Reflect.getMetadata('imports', EditSessionsModule) ?? []) as unknown[];
  const providers = (Reflect.getMetadata('providers', EditSessionsModule) ?? []) as unknown[];
  const controllers = (Reflect.getMetadata('controllers', EditSessionsModule) ?? []) as unknown[];

  it('모듈이 OptionalShopJwtGuard 를 providers 에 등록한다 (누락 시 요청 때 가드 생성 실패)', () => {
    expect(providers).toContain(OptionalShopJwtGuard);
    expect(controllers).toContain(EditSessionsController);
  });

  it('모듈이 JwtModule 을 직접 imports 한다 (AuthModule 은 JwtModule 을 export 하지 않는다)', () => {
    const jwtDynamic = imports.find(
      (m): m is DynamicModule => (m as DynamicModule)?.module === JwtModule,
    );
    expect(jwtDynamic).toBeDefined();
  });

  describe('선언된 JwtModule 배선으로 만든 가드', () => {
    let guard: OptionalShopJwtGuard;
    let jwt: JwtService;

    beforeAll(async () => {
      const jwtDynamic = imports.find(
        (m): m is DynamicModule => (m as DynamicModule)?.module === JwtModule,
      );
      if (!jwtDynamic) throw new Error('EditSessionsModule 에 JwtModule 배선이 없다');

      // ⚠️ 테스트가 secret 을 다시 선언하지 않는다 — 모듈이 선언한 useFactory 가
      //    ConfigService 에서 어떤 키를 읽는지를 그대로 검증한다(키 오타 탐지).
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ JWT_SECRET: SECRET })],
          }),
          jwtDynamic,
        ],
        providers: [OptionalShopJwtGuard],
      }).compile();

      guard = moduleRef.get(OptionalShopJwtGuard);
      jwt = moduleRef.get(JwtService);
    });

    it('가드가 DI 로 해결된다 (JwtService 주입 성공)', () => {
      expect(guard).toBeInstanceOf(OptionalShopJwtGuard);
    });

    it('모듈이 읽는 secret 으로 서명한 shop JWT → siteId 복원', () => {
      const token = jwt.sign({ sub: '7', source: 'shop', siteId: SITE_A }, { expiresIn: '1h' });
      const { ctx, req } = ctxWith(`Bearer ${token}`);

      expect(guard.canActivate(ctx)).toBe(true);
      expect(req.user?.siteId).toBe(SITE_A);
    });

    it('다른 시크릿으로 위조한 토큰 → 통과하되 스탬프 없음 (verify 가 실배선에서도 작동)', () => {
      const forged = new JwtService({ secret: 'forged' }).sign(
        { sub: '7', source: 'shop', siteId: SITE_A },
        { expiresIn: '1h' },
      );
      const { ctx, req } = ctxWith(`Bearer ${forged}`);

      expect(guard.canActivate(ctx)).toBe(true);
      expect(req.user).toBeUndefined();
    });

    it('토큰 없음 → 401 아님 + 스탬프 없음 (무인증 게스트 생성 무손상)', () => {
      const { ctx, req } = ctxWith();

      expect(guard.canActivate(ctx)).toBe(true);
      expect(req.user).toBeUndefined();
    });
  });
});
