import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  getTenantScope,
  TenantScope,
} from '../../common/helpers/tenant-scope.helper';

/**
 * P2b 멀티테넌시 (2026-06-17) — 요청 사용자의 테넌트 스코프를 컨트롤러 파라미터로 주입.
 *
 * 사용: `findAll(@CurrentScope() scope: TenantScope)` → service 에서
 *       `applySiteScope(qb, alias, scope, { includeNull })` 로 사이트별 조회 격리.
 * - 전역 관리자(SUPER_ADMIN/ADMIN/MANAGER): isGlobal=true → 필터 없음(기존 admin 무변경).
 * - 외부 shop/api-key(req.user.siteId): 자기 site 로 스코프.
 * - 사이트 운영자(SITE_ADMIN/SITE_MANAGER): JWT siteRoles 의 site 들로 스코프.
 *
 * req.user 가 없으면(@Public 라우트) getTenantScope 가 siteIds=[] 를 반환하므로
 * @Public 라우트에는 부착하지 말 것(includeNull=false 면 빈 결과). 외부계약 라우트도 제외.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantScope => {
    const request = ctx.switchToHttp().getRequest();
    return getTenantScope(request.user);
  },
);
