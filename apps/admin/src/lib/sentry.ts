/**
 * Sentry 초기화 (Admin용)
 *
 * Vite 환경변수: VITE_SENTRY_DSN, VITE_SENTRY_ENVIRONMENT, VITE_SENTRY_TRACES_SAMPLE_RATE
 */
import * as Sentry from '@sentry/react';

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

      ignoreErrors: [
        'Non-Error promise rejection captured',
        'ResizeObserver loop limit exceeded',
        'Failed to fetch',
        'NetworkError',
        'Load failed',
      ],
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
