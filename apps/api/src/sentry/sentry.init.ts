/**
 * Sentry 초기화 (API용)
 *
 * 환경변수:
 *  - SENTRY_DSN — Sentry 프로젝트 DSN (없으면 silent하게 비활성화)
 *  - SENTRY_ENVIRONMENT — production / staging / development (기본: NODE_ENV)
 *  - SENTRY_TRACES_SAMPLE_RATE — 0.0 ~ 1.0 (기본: 0.1)
 *  - SENTRY_RELEASE — 릴리스 식별자 (기본: 패키지 version)
 *
 * NOTE: Sentry는 main.ts의 가장 위에서 import 되어야 함 (다른 모듈보다 먼저).
 *       NestFactory 생성 전에 init() 호출 필수.
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(serviceName: string = 'storige-api'): boolean {
  if (initialized) return true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // DSN 미설정 시 silent (개발 환경에서 정상)
    console.log(`[Sentry/${serviceName}] DSN not configured — error tracking disabled`);
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || `${serviceName}@${process.env.npm_package_version || '1.0.0'}`,

      // 트랜잭션 샘플링 (성능 추적) — 운영은 0.1, 개발은 1.0 권장
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

      // 민감 정보 자동 제거
      beforeSend(event, hint) {
        // health check / 정상 NotFound 는 무시
        const error: any = hint?.originalException;
        if (error?.name === 'NotFoundException') return null;
        if (event.request?.url?.includes('/health')) return null;

        // request body의 password, token 등 마스킹
        if (event.request?.data && typeof event.request.data === 'object') {
          const data = event.request.data as Record<string, any>;
          for (const key of Object.keys(data)) {
            if (/password|token|secret|api[_-]?key/i.test(key)) {
              data[key] = '[Filtered]';
            }
          }
        }
        return event;
      },

      ignoreErrors: [
        // 클라이언트가 끊은 요청
        'AbortError',
        'ECONNRESET',
        // 정상 비즈니스 로직 에러 (Sentry로 보낼 가치 없음)
        'BadRequestException',
        'UnauthorizedException',
        'ForbiddenException',
      ],
    });

    initialized = true;
    console.log(`[Sentry/${serviceName}] Initialized for ${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV}`);
    return true;
  } catch (err) {
    console.error(`[Sentry/${serviceName}] Initialization failed:`, err);
    return false;
  }
}

export { Sentry };
