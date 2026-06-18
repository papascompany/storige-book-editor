import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

// 재시도 가능한 상태 코드
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

// 재시도 설정
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1초
  backoffMultiplier: 2, // 지수 백오프
};

// 에러 타입 정의
export interface ApiError {
  code: 'NETWORK_ERROR' | 'TIMEOUT' | 'AUTH_EXPIRED' | 'SERVER_ERROR' | 'VALIDATION_ERROR' | 'UNKNOWN';
  message: string;
  status?: number;
  originalError?: Error;
}

// API 에러 변환 함수
export function parseApiError(error: AxiosError): ApiError {
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return {
      code: 'TIMEOUT',
      message: '서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
      originalError: error,
    };
  }

  if (!error.response) {
    return {
      code: 'NETWORK_ERROR',
      message: '네트워크 연결을 확인해주세요.',
      originalError: error,
    };
  }

  const status = error.response.status;
  const data = error.response.data as any;

  if (status === 401) {
    return {
      code: 'AUTH_EXPIRED',
      message: data?.message || '인증이 만료되었습니다. 다시 로그인해주세요.',
      status,
      originalError: error,
    };
  }

  if (status === 400 || status === 422) {
    return {
      code: 'VALIDATION_ERROR',
      message: data?.message || '입력값을 확인해주세요.',
      status,
      originalError: error,
    };
  }

  // 413 Payload Too Large — 업로드/요청 본문이 한도를 초과.
  // 본문이 비-JSON 평문일 수 있으나(위 transformResponse 가 { message } 로 감쌈)
  // 여기서는 한국어 친화 메시지로 통일한다(원문 "Request Entity Too Large" 노출 방지).
  if (status === 413) {
    return {
      code: 'VALIDATION_ERROR',
      message: '업로드 용량이 서버 한도를 초과했습니다. 더 작은 파일(권장 50MB 이하)로 다시 시도해주세요.',
      status,
      originalError: error,
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: data?.message || '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      status,
      originalError: error,
    };
  }

  return {
    code: 'UNKNOWN',
    message: data?.message || '알 수 없는 오류가 발생했습니다.',
    status,
    originalError: error,
  };
}

/**
 * 임의의 throw 값을 사용자 표시용 메시지로 변환.
 * - AxiosError → parseApiError 의 친화 메시지(401/413/4xx/5xx 분기)
 * - 그 외 Error → message
 * 비-JSON 응답이 transformResponse 로 { message } 가 된 경우도 안전하게 처리된다.
 */
export function toUserMessage(err: unknown, fallback = '요청에 실패했습니다.'): string {
  if (axios.isAxiosError(err)) return parseApiError(err).message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// 이벤트 리스너 타입
type AuthExpiredListener = () => void;

class ApiClient {
  private client: AxiosInstance;
  private authExpiredListeners: AuthExpiredListener[] = [];

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      // 비-JSON 응답 방어: 프록시/게이트웨이(예: Vercel 서버리스 4.5MB 한도)·nginx 가
      // 내는 평문 413 "Request Entity Too Large" 나 HTML 에러 페이지를 받아도
      // 기본 JSON.parse 가 던지는 "Unexpected token 'R'…" 크래시를 막는다.
      // 정상 JSON 은 그대로 파싱하고, 파싱 실패 시 { message: 원문 } 으로 감싸
      // parseApiError/호출부가 .message 로 안전하게 읽도록 한다. 바이너리(arraybuffer/blob)는
      // string 이 아니므로 그대로 통과.
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

    this.setupInterceptors();
  }

  /**
   * 인증 만료 이벤트 리스너 등록
   */
  onAuthExpired(listener: AuthExpiredListener) {
    this.authExpiredListeners.push(listener);
    return () => {
      this.authExpiredListeners = this.authExpiredListeners.filter(l => l !== listener);
    };
  }

  private emitAuthExpired() {
    this.authExpiredListeners.forEach(listener => listener());
  }

  /**
   * 사일런트 리프레시: refreshToken(30d)으로 새 accessToken 발급.
   * 임베드(iframe/localStorage Bearer)는 쿠키 리프레시가 불가하므로 body 변형 엔드포인트 사용.
   * - 인터셉터 재귀를 피하려고 bare axios 로 호출.
   * - 동시 401 다발 시 단일 갱신만 수행하도록 in-flight Promise 공유.
   * @returns 새 accessToken 또는 null(갱신 불가 → 진짜 만료)
   */
  private refreshInFlight: Promise<string | null> | null = null;
  private async trySilentRefresh(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const refreshToken = localStorage.getItem('auth_refresh_token');
        if (!refreshToken) return null;
        const base = this.getBaseUrl();
        const res = await axios.post(
          `${base}/auth/shop-refresh-body`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
        );
        const newToken = res.data?.accessToken as string | undefined;
        if (newToken) {
          localStorage.setItem('auth_token', newToken);
          console.log('[ApiClient] 사일런트 리프레시 성공 — 액세스 토큰 갱신');
          return newToken;
        }
        return null;
      } catch (e) {
        console.warn('[ApiClient] 사일런트 리프레시 실패:', e);
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  /**
   * Set the base URL for API requests (used for embedded editor)
   */
  setBaseUrl(baseUrl: string) {
    this.client.defaults.baseURL = baseUrl;
  }

  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.client.defaults.baseURL || API_BASE_URL;
  }

  /**
   * 빌드타임 직결 API base (= VITE_API_BASE_URL).
   * 임베드 호스트가 setBaseUrl 로 덮어쓴 런타임 base(호스트 프록시일 수 있음)와 무관하게
   * 항상 Storige API 원본을 가리킨다. 대용량 파일 업로드를 호스트 프록시(예: Vercel
   * 서버리스 4.5MB 본문 한도)로 보내 413 이 나는 것을 막기 위해 업로드 요청은 이 base 로 직결한다.
   * (/storage/upload-public 등 업로드 엔드포인트는 @Public 이라 키 없이 직결 가능.)
   */
  getDirectBaseUrl(): string {
    return API_BASE_URL;
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        // 재시도 카운터 초기화
        (config as any).__retryCount = (config as any).__retryCount || 0;
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as AxiosRequestConfig & { __retryCount?: number };

        // 인증 만료 처리 — 사일런트 리프레시 1회 시도 후 재요청.
        // (포토북 다일 편집 중 액세스 토큰 1h 만료 → refreshToken 으로 자동 갱신.)
        if (error.response?.status === 401) {
          const reqCfg = config as (AxiosRequestConfig & { __authRetried?: boolean }) | undefined;
          // refresh 호출 자체의 401 이거나 이미 한 번 갱신 재시도했다면 → 진짜 만료.
          const isRefreshCall = reqCfg?.url?.includes('/auth/shop-refresh-body');
          if (reqCfg && !reqCfg.__authRetried && !isRefreshCall) {
            const newToken = await this.trySilentRefresh();
            if (newToken) {
              reqCfg.__authRetried = true;
              reqCfg.headers = { ...(reqCfg.headers || {}), Authorization: `Bearer ${newToken}` };
              return this.client.request(reqCfg);
            }
          }
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_refresh_token');
          this.emitAuthExpired();
          return Promise.reject(error);
        }

        // 재시도 로직
        const retryCount = config?.__retryCount || 0;
        const shouldRetry =
          config &&
          retryCount < RETRY_CONFIG.maxRetries &&
          error.response?.status &&
          RETRYABLE_STATUS_CODES.includes(error.response.status);

        if (shouldRetry) {
          config.__retryCount = retryCount + 1;
          const delay = RETRY_CONFIG.retryDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount);

          console.log(`[ApiClient] Retrying request (${retryCount + 1}/${RETRY_CONFIG.maxRetries}) after ${delay}ms`);

          await new Promise(resolve => setTimeout(resolve, delay));
          return this.client.request(config);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * 재시도와 함께 요청 실행
   */
  async requestWithRetry<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw parseApiError(error);
      }
      throw error;
    }
  }

  get<T = any>(url: string, config?: any) {
    return this.client.get<T>(url, config);
  }

  post<T = any>(url: string, data?: any, config?: any) {
    return this.client.post<T>(url, data, config);
  }

  put<T = any>(url: string, data?: any, config?: any) {
    return this.client.put<T>(url, data, config);
  }

  patch<T = any>(url: string, data?: any, config?: any) {
    return this.client.patch<T>(url, data, config);
  }

  delete<T = any>(url: string, config?: any) {
    return this.client.delete<T>(url, config);
  }
}

export const apiClient = new ApiClient();
