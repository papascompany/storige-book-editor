import { create } from 'zustand';
import { User } from '@storige/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /**
   * P3b 테넌트 스위처 — 현재 선택된 site 컨텍스트.
   * null = 전체 보기(전역 admin 기본). 사이트 운영자는 TenantSwitcher 가 자기 site 로 자동 고정.
   * 서버가 권위(테넌트 격리는 API 스코프가 강제) — 이 값은 목록 필터 파라미터로만 쓰인다.
   */
  currentSiteId: string | null;

  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  setUser: (user: User) => void;
  setCurrentSiteId: (siteId: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  currentSiteId: localStorage.getItem('currentSiteId'),

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    set({
      user,
      accessToken,
      refreshToken,
      isAuthenticated: true,
    });
  },

  clearAuth: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentSiteId');
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      currentSiteId: null,
    });
  },

  setUser: (user) => {
    set({ user });
  },

  setCurrentSiteId: (siteId) => {
    if (siteId) {
      localStorage.setItem('currentSiteId', siteId);
    } else {
      localStorage.removeItem('currentSiteId');
    }
    set({ currentSiteId: siteId });
  },
}));
