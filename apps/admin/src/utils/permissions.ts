/**
 * P3a 멀티테넌시 — admin 메뉴 게이팅용 권한 헬퍼.
 *
 * 전역 관리자(SUPER_ADMIN/ADMIN/MANAGER)만 전역 전용 메뉴(운영자 관리·사이트 관리·
 * 저장소 설정)에 접근한다. 사이트 운영자(SITE_ADMIN/SITE_MANAGER)는 숨긴다.
 */

/**
 * 전역 관리자 여부. role 문자열(@storige/types UserRole 값) 을 받는다.
 * - SUPER_ADMIN / ADMIN / MANAGER → true (전역 접근)
 * - SITE_ADMIN / SITE_MANAGER / CUSTOMER / 그 외 → false
 *
 * ⚠️ role 이 undefined(미하이드레이션) 인 경우 false 를 반환한다 — 호출부에서
 *    "role 이 없으면 보수적으로 노출(기존 admin 회귀 방지)" 정책을 직접 적용한다.
 */
export function isGlobalAdmin(role?: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';
}
