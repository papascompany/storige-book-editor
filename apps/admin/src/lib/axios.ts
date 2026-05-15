import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

/**
 * API root URL — `/api` 프리픽스 제거.
 * 운영 환경의 storage 정적 파일은 nginx 가 `/storage/...` 를 직접 서빙
 * (NestJS controller 미경유 → `/api` 가 들어가면 404).
 *
 * - VITE_API_BASE_URL=`https://api.papascompany.co.kr/api` → `https://api.papascompany.co.kr`
 * - VITE_API_BASE_URL=`http://localhost:4000/api`         → `http://localhost:4000`
 */
const API_ROOT_URL = API_BASE_URL.replace(/\/api\/?$/, '');

/**
 * `/storage/...` 형태의 상대 URL 을 이미지 src 로 사용 가능한 절대 URL 로 변환.
 *
 * - 이미 절대 URL (`http(s)://`) 이면 그대로 반환
 * - dev (vite): 상대경로 그대로 반환 → vite proxy 가 `/storage` 를 처리
 *   (vite.config.ts 의 server.proxy 참고)
 * - prod: API 도메인의 root 에 결합 (`/api` 미포함)
 *   예) `/storage/library/clipart/star.svg`
 *       → `https://api.papascompany.co.kr/storage/library/clipart/star.svg`
 *
 * ⚠ 운영에서 `${API_BASE_URL}${url}` 로 결합하면 `/api/storage/...` 가 되어
 *   nginx 매핑 실패 + NestJS controller 도 3-segment 매칭 실패로 404.
 *   2026-05-15 fix.
 */
export function resolveStorageUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (!url.startsWith('/storage/') && !url.startsWith('storage/')) return url;

  const path = url.startsWith('/') ? url : `/${url}`;

  // dev: vite proxy 가 처리하므로 상대경로 유지
  if (import.meta.env.DEV) return path;

  // prod: API root 도메인에 결합 (/api prefix 없이)
  return `${API_ROOT_URL}${path}`;
}

export const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for token refresh
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken } = response.data;
        localStorage.setItem('accessToken', accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return axiosInstance(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout user
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        const basePath = import.meta.env.VITE_ROUTER_BASE || '';
        window.location.href = `${basePath}/login`;
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
