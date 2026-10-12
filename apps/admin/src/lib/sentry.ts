/**
 * Sentry 초기화 (Admin용)
 *
 * Vite 환경변수: VITE_SENTRY_DSN, VITE_SENTRY_ENVIRONMENT, VITE_SENTRY_TRACES_SAMPLE_RATE
 *
 * 전송 전처리 훅(beforeBreadcrumb·beforeSend·beforeSendTransaction):
 *   URL·breadcrumb·span·이벤트 값의 자격증명 파라미터·사이트 키·이메일을 '[Filtered]' 로
 *   정규화한다(sentryScrub.ts — 순수 함수).
 */
import * as Sentry from '@sentry/react';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub';

/** 전송하지 않는 오류 문구(부분 일치). */
export const SENTRY_IGNORE_ERRORS: Array<string | RegExp> = [
  'Non-Error promise rejection captured',
  'ResizeObserver loop limit exceeded',
  'Failed to fetch',
  'NetworkError',
  'Load failed',
];

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry/admin] DSN not configured — error tracking disabled');
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || 'storige-admin@local',
      tracesSampleRate: parseFloat(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1',
      ),
      integrations: [Sentry.browserTracingIntegration()],

      // 전송 전 전처리: 자격증명 파라미터·사이트 키·이메일 정규화
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb);
      },
      beforeSend(event) {
        return scrubEvent(event);
      },
      beforeSendTransaction(event) {
        return scrubEvent(event);
      },

      ignoreErrors: SENTRY_IGNORE_ERRORS,
    });

    initialized = true;
    console.log(
      `[Sentry/admin] Initialized for ${import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE}`,
    );
    return true;
  } catch (err) {
    console.error('[Sentry/admin] Initialization failed:', err);
    return false;
  }
}

export { Sentry };
