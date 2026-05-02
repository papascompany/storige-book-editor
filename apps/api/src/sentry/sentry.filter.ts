/**
 * Sentry exception filter
 *
 * NestJS의 모든 unhandled exception을 캐치해 Sentry로 전송하면서,
 * 클라이언트 응답은 기존 동작(NestJS 기본 ExceptionFilter)을 따름.
 *
 * 사용:
 *   app.useGlobalFilters(new SentryExceptionFilter());
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SentryFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    // 1. Sentry로 전송할 가치가 있는 에러만 필터링
    if (this.shouldReportToSentry(exception)) {
      Sentry.withScope((scope) => {
        // HTTP 요청 정보 추가
        const ctx = host.switchToHttp();
        const request = ctx.getRequest();
        if (request) {
          scope.setContext('request', {
            method: request.method,
            url: request.url,
            headers: this.filterHeaders(request.headers),
          });
          if (request.user) {
            scope.setUser({
              id: request.user.userId || request.user.sub,
              email: request.user.email,
            });
          }
        }
        Sentry.captureException(exception);
      });
    }

    // 2. NestJS 기본 ExceptionFilter 동작 위임 (HTTP 응답 생성)
    super.catch(exception, host);
  }

  /**
   * Sentry로 전송 여부 결정
   *  - 5xx 에러: 모두 전송
   *  - 4xx 에러: 401/403/404는 제외 (정상 비즈니스 흐름)
   *  - 일반 Error (HTTP 아님): 전송
   */
  private shouldReportToSentry(exception: unknown): boolean {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // 4xx 중 정상 비즈니스 흐름은 제외
      if (status === HttpStatus.UNAUTHORIZED) return false;
      if (status === HttpStatus.FORBIDDEN) return false;
      if (status === HttpStatus.NOT_FOUND) return false;
      if (status === HttpStatus.BAD_REQUEST) return false;
      // 그 외 4xx, 5xx는 모두 전송
      return status >= 400;
    }
    // 일반 Error는 항상 전송
    return exception instanceof Error;
  }

  /**
   * 민감한 헤더 마스킹 (Authorization, Cookie 등)
   */
  private filterHeaders(headers: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (/authorization|cookie|x-api-key|token/i.test(key)) {
        filtered[key] = '[Filtered]';
      } else {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}
