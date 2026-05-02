/**
 * Sentry 초기화 (Editor용)
 *
 * Vite 환경변수:
 *  - VITE_SENTRY_DSN — DSN (없으면 silent하게 비활성화)
 *  - VITE_SENTRY_ENVIRONMENT — production/staging/development (기본: import.meta.env.MODE)
 *  - VITE_SENTRY_TRACES_SAMPLE_RATE — 0.0 ~ 1.0 (기본: 0.1)
 *  - VITE_SENTRY_RELEASE — 릴리스 식별자
 *
 * 사용:
 *   // main.tsx 가장 위에서
 *   import { initSentry } from './lib/sentry';
 *   initSentry();
 */
import * as Sentry from '@sentry/react';

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry/editor] DSN not configured — error tracking disabled');
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || 'storige-editor@local',

      tracesSampleRate: parseFloat(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1',
      ),

      // Session Replay (선택, 무거우므로 낮은 비율)
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: parseFloat(
        import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR || '0.1',
      ),

      integrations: [
        Sentry.browserTracingIntegration(),
        // 에러 발생 시 세션 재현 (옵션, 패키지 크기 영향)
      ],

      // 민감 정보 자동 제거
      beforeSend(event) {
        // localStorage에 백업된 거대 페이로드는 제외
        if (event.extra?.canvasData) delete event.extra.canvasData;
        return event;
      },

      ignoreErrors: [
        // 브라우저 확장이 일으키는 흔한 노이즈
        'Non-Error promise rejection captured',
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        // Fabric/카메라/마이크 권한 거부
        'AbortError',
        'NotAllowedError',
        // 네트워크 일시 단절
        'Failed to fetch',
        'NetworkError',
        'Load failed',
      ],
    });

    initialized = true;
    console.log(
      `[Sentry/editor] Initialized for ${import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE}`,
    );
    return true;
  } catch (err) {
    console.error('[Sentry/editor] Initialization failed:', err);
    return false;
  }
}

export { Sentry };
