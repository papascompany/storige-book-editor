import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';

/**
 * P3a 보강 — 새로고침/딥링크/새 탭 시 authStore.user(role + siteRoles)는 메모리 전용이라 null 이 된다.
 * (accessToken 은 localStorage 에 영속되지만 user 는 아님 → MainLayout 역할 게이팅이 role 을 잃음.)
 *
 * 토큰이 있는데 user 가 없으면 앱 마운트 시 GET /auth/me 로 1회 재하이드레이션한다.
 * → SITE_ADMIN/SITE_MANAGER 운영자가 새로고침해도 전역 전용 메뉴가 다시 노출되지 않는다.
 * (토큰 무효/만료는 axios 인터셉터가 refresh→실패 시 /login 으로 처리.)
 */
export const AuthBootstrap = () => {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (accessToken && !user) {
      authApi
        .getCurrentUser()
        .then((me) => setUser(me))
        .catch(() => {
          // 무효 토큰은 인터셉터가 처리. 게이팅은 하이드레이션 전까지 보수적 노출 유지.
        });
    }
  }, [accessToken, user, setUser]);

  return null;
};
