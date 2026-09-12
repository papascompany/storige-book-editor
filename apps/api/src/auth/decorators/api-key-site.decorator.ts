import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiKeySitePayload } from '../guards/optional-api-key-site.guard';

/**
 * @ApiKeySite() — `OptionalApiKeySiteGuard` 가 복원한 사이트 컨텍스트 추출 (D6-ⓐ).
 *
 * `@CurrentSite()` 와 다른 점: 그쪽은 `req.user`(ApiKeyGuard/JWT 가 채움)를 읽고 **필수 인증**
 * 라우트에서 쓴다. 이쪽은 `req.apiKeySite` 전용이라 `@Public` 라우트에서 **키가 있을 때만**
 * 값이 생기고, 없으면 `undefined` 다.
 *
 * ⚠️ 두 근거를 한 객체로 합치지 말 것 — 분리 자체가 자동조립 경로의 권한 상승을 막는
 *    장치다(`optional-api-key-site.guard.ts` 불변식 2).
 */
export const ApiKeySite = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeySitePayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ apiKeySite?: ApiKeySitePayload }>();
    const site = req?.apiKeySite;
    return site && typeof site.siteId === 'string' && site.siteId.length > 0 ? site : undefined;
  },
);
