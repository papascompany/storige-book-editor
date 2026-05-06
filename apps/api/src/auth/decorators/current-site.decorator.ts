import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentSitePayload {
  siteId: string;
  siteName: string;
  role: 'editor' | 'worker';
  apiKey: string;
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
    };
  },
);
