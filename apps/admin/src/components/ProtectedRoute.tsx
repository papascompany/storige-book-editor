import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { isGlobalAdmin } from '../utils/permissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/**
 * P3b — 전역 admin 전용 라우트(사이트 관리·운영자 관리·저장소 설정).
 * 메뉴 게이팅(MainLayout)과 동일 정책: role 미하이드레이션이면 통과(기존 admin 회귀 방지,
 * 하이드레이션 후 재렌더에서 리다이렉트). 서버 403 이 최종 방어선이며 이 가드는 UX 계층.
 */
export const GlobalOnlyRoute = ({ children }: ProtectedRouteProps) => {
  const user = useAuthStore((state) => state.user);

  if (user?.role && !isGlobalAdmin(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
