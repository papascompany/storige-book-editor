import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@storige/types';

/**
 * P1 멀티테넌시 (2026-06-17) — 테넌트(site) 접근 스코핑 가드.
 *
 * 요청에 명시된 site(param/query/body 의 siteId)가 현재 사용자가 권한을 가진 site 인지 강제한다.
 * - **전역 관리자**(role = SUPER_ADMIN | ADMIN): 모든 site 통과 (dual-mode — 기존 admin 무변경).
 * - **외부 shop/api-key**(user.siteId 고정): 요청 site 가 자신의 site 와 같을 때만 통과.
 * - **사이트 운영자**(SITE_ADMIN/SITE_MANAGER): JWT 의 siteRoles 클레임에 포함된 site 만 통과.
 * - 요청에 siteId 가 없으면 통과한다(목록 조회 등은 QueryScope 헬퍼가 자동으로 자기 site 로 필터).
 *
 * ⚠️ 선택 적용 — 보호가 필요한 admin/외부 라우터에만 `@UseGuards(JwtAuthGuard, TenantGuard)`.
 * ApiKey 전용 라우터는 이미 site 가 키로 고정되므로 별도 적용 불필요(적용해도 통과).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false; // JwtAuthGuard 가 먼저 인증

    // 전역 관리자(dual-mode): 모든 site 접근
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return true;
    }

    const requestedSiteId: string | undefined =
      req.params?.siteId || req.query?.siteId || req.body?.siteId;

    // 외부 shop-session / api-key: site 가 토큰/키로 고정됨
    if (user.siteId) {
      if (!requestedSiteId || requestedSiteId === user.siteId) return true;
      throw new ForbiddenException({
        code: 'TENANT_FORBIDDEN',
        message: '이 사이트에 대한 권한이 없습니다.',
      });
    }

    // 사이트 운영자: siteRoles 클레임으로 검증
    const allowedSiteIds: string[] = Array.isArray(user.siteRoles)
      ? user.siteRoles.map((r: { siteId: string }) => r.siteId)
      : [];

    // site 미지정 요청(목록 등) → 통과. 실제 데이터 범위는 QueryScope 헬퍼가 제한.
    if (!requestedSiteId) return true;

    if (allowedSiteIds.includes(requestedSiteId)) return true;

    throw new ForbiddenException({
      code: 'TENANT_FORBIDDEN',
      message: '이 사이트에 대한 권한이 없습니다.',
    });
  }
}
