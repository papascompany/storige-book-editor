import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PartnerAuditService } from './partner-audit.service';
import { resolveSuccessStatus } from '../http/success-status';
import {
  PartnerRequest,
  ensureRequestId,
  ensureStartedAt,
  requestPath,
  resolvePartnerEnv,
} from '../http/request-context';

/**
 * v1 감사 인터셉터 — 성공 경로 전용 기록.
 *
 * 에러 경로(가드 401 포함)는 PartnerApiExceptionFilter 가 기록한다.
 * (인터셉터는 가드 통과 후에만 실행되므로 인증 실패 감사는 필터만 가능 —
 *  성공=인터셉터 / 실패=필터로 정확히 1회씩 기록되는 구조)
 */
@Injectable()
export class PartnerAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: PartnerAuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    const requestId = ensureRequestId(req);
    const startedAt = ensureStartedAt(req);

    return next.handle().pipe(
      tap(() => {
        this.auditService.record({
          requestId,
          siteId: req.user?.siteId ?? null,
          env: req.user?.siteId ? resolvePartnerEnv(req.user) : null,
          apiKeyId: req.user?.apiKeyId ?? null,
          method: req.method,
          path: requestPath(req),
          statusCode: resolveSuccessStatus(this.reflector, context),
          errorCode: null,
          latencyMs: Date.now() - startedAt,
          ip: req.ip ?? null,
        });
      }),
    );
  }
}
