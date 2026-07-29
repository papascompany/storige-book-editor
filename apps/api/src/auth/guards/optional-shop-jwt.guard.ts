import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * OptionalShopJwtGuard — @Public 라우트에서 **서명 검증된** shop-session JWT 의
 * 테넌트 컨텍스트(siteId)만 선택적으로 복원하는 route-scoped 가드 (2026-07-30).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * 전역 JwtAuthGuard 는 @Public 라우트에서 `return true` 로 단락한다 → passport 미실행
 * → `req.user === undefined`. 그래서 게스트 세션 생성(`POST /edit-sessions/guest`)은
 * 편집기가 Authorization: Bearer 를 **실어 보내는데도** siteId 를 알 수 없었고,
 * 세션이 NULL-site 로 저장되어 회원 전환 후에도 파트너 승격이 404 였다.
 *
 * 이 가드는 @Public 을 **유지**한 채(계약 불변) 토큰이 있으면 검증만 해서
 * req.user 에 테넌트를 복원한다. 인증을 강제하지 않는다.
 *
 * ── 불변식 ────────────────────────────────────────────────────────────────
 *  1. **항상 true 를 반환한다.** 토큰 부재/위조/만료 어느 경우에도 401 을 던지지 않는다
 *     — 게스트 생성은 무인증 라우트이고, 여기서 던지면 레거시 standalone(`/`) 경로와
 *     파트너 게스트 폴백이 즉시 파손된다(무중단 위반).
 *  2. 🚨 **`jwt.decode()` 금지 — 반드시 `jwt.verify()`.** 검증 없는 decode 는
 *     "나는 site B 다"라는 임의 주장을 그대로 신뢰하는 것이라, 막으려던 교차테넌트
 *     IDOR 을 새로 만든다. 이 금지는 리뷰 필수 확인 항목이다.
 *  3. 테넌트 근거는 **서명 검증된 shop-session JWT 의 payload.siteId 단 하나**다.
 *     그 siteId 의 근원은 X-API-Key(ApiKeyGuard) 로 발급된 shop-session 이므로
 *     결국 파트너 API 키가 유일한 신뢰 뿌리다.
 *     (Origin/Referer·templateSetId·memberSeqno/orderSeqno 추론은 전부 기각 —
 *      무인증 위조 가능하거나 실측 커버리지 0% 또는 테넌트 간 중복.)
 *  4. 판정 불가 시 req.user 를 **설정하지 않는다** → 호출부는 NULL 스탬프(fail-closed).
 */
@Injectable()
export class OptionalShopJwtGuard implements CanActivate {
  private readonly logger = new Logger(OptionalShopJwtGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
      user?: unknown;
    }>();

    const token = this.extractBearerToken(req?.headers?.authorization);
    if (!token) {
      return true; // 토큰 없음 — 레거시/무인증 흐름 그대로 통과(NULL 스탬프)
    }

    let payload: Record<string, unknown>;
    try {
      // ⚠️ verify — 서명·만료를 모두 검증한다. decode 로 바꾸지 말 것(불변식 2).
      payload = this.jwtService.verify(token) as Record<string, unknown>;
    } catch {
      // 위조·만료·시크릿 불일치 — 401 이 아니라 "테넌트 판정 불가"로 처리(불변식 1).
      this.logger.debug('shop JWT 검증 실패 — siteId 스탬프 없이 통과');
      return true;
    }

    const siteId = payload?.siteId;
    if (payload?.source !== 'shop' || typeof siteId !== 'string' || siteId.length === 0) {
      return true; // shop-session 이 아니거나 site 컨텍스트 없음 → 판정 불가
    }

    req.user = {
      userId: typeof payload.sub === 'string' ? payload.sub : undefined,
      source: 'shop',
      siteId,
      siteName: typeof payload.siteName === 'string' ? payload.siteName : undefined,
    };
    return true;
  }

  /**
   * Authorization: Bearer <token> 만 수용.
   * (JwtStrategy 의 storige_access 쿠키 폴백은 admin 표면 전용이라 의도적으로 제외 —
   *  수용 범위를 넓히는 것은 스탬프 근거를 넓히는 것이므로 fail-closed 원칙에 어긋난다.)
   */
  private extractBearerToken(authorization: unknown): string | null {
    if (typeof authorization !== 'string') return null;
    const [scheme, value] = authorization.split(' ');
    if (!value || scheme?.toLowerCase() !== 'bearer') return null;
    const token = value.trim();
    return token.length > 0 ? token : null;
  }
}
