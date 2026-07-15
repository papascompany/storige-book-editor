import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Response } from 'express';
import * as Sentry from '@sentry/node';
import { PartnerV1ErrorEnvelope } from '@storige/types';
import { buildErrorEnvelope } from './error-envelope';
import {
  PartnerIdempotentReplaySignal,
  PartnerRateLimitedException,
} from './partner-api.exceptions';
import {
  PartnerRequest,
  ensureRequestId,
  ensureStartedAt,
  requestPath,
  resolvePartnerEnv,
} from './request-context';
import { PartnerAuditService } from '../audit/partner-audit.service';
import {
  IDEMPOTENCY_REPLAYED_HEADER,
  RETRY_AFTER_FALLBACK_SECONDS,
} from '../partner-api.constants';

/**
 * v1 스코프 전역 예외 필터 (설계서 §3.2) — @PartnerV1Controller 조합 데코레이터로
 * 컨트롤러 단위 바인딩. 기존 /api·/external 라우트의 에러 shape 는 무접촉(AD-1).
 *
 * 처리 경로:
 *  1) 멱등 재전달 신호 — 최초 응답 스냅샷을 status 포함 그대로 재전달
 *  2) 그 외 전부 — 에러 봉투 직렬화(+429 는 Retry-After, 5xx 는 Sentry)
 *  가드 실패(401)를 포함한 모든 에러 경로의 감사 기록도 여기서 수행.
 */
@Catch()
@Injectable()
export class PartnerApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly auditService: PartnerAuditService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<PartnerRequest>();
    const res = ctx.getResponse<Response>();
    const requestId = ensureRequestId(req);
    const startedAt = ensureStartedAt(req);

    // 1) 멱등 재전달 — 스냅샷 그대로 (설계서 §4.1: HTTP status 포함 재전달)
    if (exception instanceof PartnerIdempotentReplaySignal) {
      const body = exception.body as Partial<PartnerV1ErrorEnvelope> | null;
      this.recordAudit(req, requestId, startedAt, exception.statusCode,
        body && body.success === false ? (body.errorCode ?? null) : null);
      res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      res.status(exception.statusCode).json(exception.body);
      return;
    }

    const { status, envelope } = buildErrorEnvelope(exception, requestId);

    // 429 — 모든 429 응답 경로에 Retry-After(초) 헤더 필수 (설계서 §5.2).
    // per-Key 가드(PartnerRateLimitedException) 유래는 실측값을 사용하고,
    // 그 외 429(전역 per-IP ThrottlerGuard 의 ThrottlerException 등)는 가드가
    // 이미 세팅한 헤더를 보존하되 없으면 폴백 60초를 부착한다.
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      if (exception instanceof PartnerRateLimitedException) {
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      } else if (!res.getHeader('Retry-After')) {
        res.setHeader('Retry-After', String(RETRY_AFTER_FALLBACK_SECONDS));
      }
    }

    // 5xx — Sentry 전송 (v1 필터가 전역 Sentry 필터를 대체하므로 직접 캡처)
    if (status >= 500) {
      Sentry.captureException(exception);
    }

    this.recordAudit(req, requestId, startedAt, status, envelope.errorCode);
    res.status(status).json(envelope);
  }

  private recordAudit(
    req: PartnerRequest,
    requestId: string,
    startedAt: number,
    statusCode: number,
    errorCode: string | null,
  ): void {
    this.auditService.record({
      requestId,
      siteId: req.user?.siteId ?? null,
      env: req.user?.siteId ? resolvePartnerEnv(req.user) : null,
      apiKeyId: req.user?.apiKeyId ?? null,
      method: req.method,
      path: requestPath(req),
      statusCode,
      errorCode,
      latencyMs: Date.now() - startedAt,
      ip: req.ip ?? null,
    });
  }
}
