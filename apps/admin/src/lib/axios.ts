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
  // 비-JSON 응답 방어: 프록시/nginx 가 내는 평문 413 "Request Entity Too Large" 나
  // HTML 에러 페이지를 받아도 기본 JSON.parse 의 "Unexpected token 'R'…" 크래시를 막는다.
  // 정상 JSON 은 그대로 파싱, 실패 시 { message: 원문 } 으로 감싼다. 바이너리(arraybuffer)는
  // string 이 아니므로 그대로 통과(woff2→ttf 변환 등 영향 없음).
  transformResponse: [
    (data) => {
      if (typeof data !== 'string') return data;
      if (data.length === 0) return data;
      try {
        return JSON.parse(data);
      } catch {
        return { message: data };
      }
    },
  ],
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
    const reqUrl: string = originalRequest?.url || '';

    // 413(업로드 용량 초과) 친화 메시지 정규화 — 평문/HTML 본문이 와도 컴포넌트가
    // data.message 로 일관된 한국어 안내를 읽도록(원문 "Request Entity Too Large" 노출 방지).
    if (error.response?.status === 413) {
      error.response.data = {
        message:
          '업로드 용량이 서버 한도를 초과했습니다. 더 작은 파일(권장 50MB 이하)로 다시 시도해주세요.',
      };
    }

    // 로그인/리프레시 자체의 401 은 리다이렉트하지 않고 호출부(로그인 폼)가 에러 메시지로 처리한다.
    // (안 그러면 비번 오류 시마다 로그인 화면이 에러 페이지로 튕겨 '비번 틀림'을 알 수 없다.)
    const isAuthEndpoint =
      reqUrl.includes('/auth/login') || reqUrl.includes('/auth/refresh');

    // If 401 and not already retried
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint
    ) {
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
        // 버그 수정: VITE_ROUTER_BASE='/' 일 때 `${basePath}/login` = '//login' →
        // 브라우저가 protocol-relative URL 로 해석해 https://login/ (잘못된 호스트) 에러 페이지로 이동.
        // 끝 슬래시를 제거해 항상 정상 절대경로 '/login' 이 되도록 한다.
        const basePath = (import.meta.env.VITE_ROUTER_BASE || '').replace(
          /\/+$/,
          '',
        );
        window.location.href = `${basePath}/login`;
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
