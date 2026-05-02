/**
 * Sentry 초기화 (Worker용)
 *
 * 환경변수: SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE, SENTRY_RELEASE
 *
 * Worker는 HTTP 요청보다 Bull 큐 잡 처리가 주된 워크로드이므로,
 * captureException을 큐 processor에서 명시적으로 호출.
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(serviceName: string = 'storige-worker'): boolean {
  if (initialized) return true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log(`[Sentry/${serviceName}] DSN not configured — error tracking disabled`);
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || `${serviceName}@${process.env.npm_package_version || '1.0.0'}`,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

      beforeSend(event, hint) {
        const error: any = hint?.originalException;
        // 정상 비즈니스 흐름 (FIXABLE 등은 에러 아님) 제외
        if (error?.name === 'ValidationError' && error?.code === 'FIXABLE') return null;
        return event;
      },

      ignoreErrors: ['AbortError', 'ECONNRESET'],
    });

    initialized = true;
    console.log(`[Sentry/${serviceName}] Initialized for ${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV}`);
    return true;
  } catch (err) {
    console.error(`[Sentry/${serviceName}] Initialization failed:`, err);
    return false;
  }
}

/**
 * Bull 큐 잡 처리 중 발생한 예외를 Sentry에 전송하면서 부가 컨텍스트 추가.
 * 잡 ID, 잡 타입, 옵션 등을 함께 기록.
 */
export function captureJobException(
  exception: unknown,
  jobContext: {
    jobId?: string;
    jobType?: string;
    queueName?: string;
    fileUrl?: string;
    fileType?: string;
  },
): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    scope.setTag('job.type', jobContext.jobType || 'unknown');
    scope.setTag('job.queue', jobContext.queueName || 'unknown');
    if (jobContext.jobId) scope.setTag('job.id', jobContext.jobId);
    scope.setContext('job', jobContext);
    Sentry.captureException(exception);
  });
}

export { Sentry };
