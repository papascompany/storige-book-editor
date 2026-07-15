import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PartnerEnv } from '../../partner-api/partner-api.constants';
import { resolvePartnerEnv } from '../../partner-api/http/request-context';

export interface CurrentSitePayload {
  siteId: string;
  siteName: string;
  role: 'editor' | 'worker';
  apiKey: string;
  /** 사이트 파일 보존 기간(일). null/0=영구. 업로드 시 expires_at 적용용. */
  retentionDays?: number | null;
  /**
   * [S2-5] 인증 컨텍스트 env — resolvePartnerEnv(req.user) 해석값.
   * 공용 ApiKeyGuard(sites 키)는 req.user.env 를 스탬프하지 않으므로 항상 'live'.
   * 'test' 는 partner_api_keys test 키 인증 경로(PartnerApiKeyGuard)에서만 가능 —
   * 현 잡 생성 표면(external 라우트)은 공용 가드 전용이라 도달 불가(Stage 3 발화).
   * optional(additive) — 미설정은 live 취급(소비측 `=== 'test'` 판정).
   */
  env?: PartnerEnv;
}

/**
 * @CurrentSite() — X-API-Key 인증된 외부 사이트 컨텍스트 추출.
 *
 * 사용:
 *   @Post('synthesize/external')
 *   @UseGuards(ApiKeyGuard)
 *   create(@Body() dto, @CurrentSite() site: CurrentSitePayload) {
 *     // site.siteId, site.siteName 사용 가능
 *   }
 *
 * ApiKeyStrategy.validate() 결과(req.user)에서 site 컨텍스트만 추출.
 * 인증 미통과 시(req.user 없음) undefined 반환 — Guard가 먼저 차단하므로 실 사용 시엔 항상 존재.
 */
export const CurrentSite = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentSitePayload | undefined => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user || !user.siteId) return undefined;
    return {
      siteId: user.siteId,
      siteName: user.siteName,
      role: user.role,
      apiKey: user.apiKey,
      retentionDays: user.retentionDays ?? null,
      // [S2-5] env 해석 단일 지점 재사용 — 미스탬프(sites 키)=live
      env: resolvePartnerEnv(user),
    };
  },
);
