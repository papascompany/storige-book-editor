import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import {
  OperatorAuditRequest,
  OperatorIdentity,
  controllerPathOf,
  httpErrorCode,
  httpErrorStatus,
  operatorIdentity,
  recordOperatorRequest,
} from './partner-operator-request-audit';

interface AuditResponse {
  statusCode?: number;
}

/**
 * 운영자 요청 감사 인터셉터 (APP_INTERCEPTOR, 2026-09-29).
 *
 * req.user.source === 'partner_operator' 인 요청만 기록하고 그 외에는 아무것도 하지 않는다.
 * 성공·실패 모두 action 'request' 1행(메서드·라우트·상태코드·세션/리소스 id·오류 코드)을 best-effort 로
 * 남긴다. 본문·캔버스·토큰·키는 기록하지 않으며, 기록 실패가 응답을 바꾸지 않는다(원래 오류는 그대로 전달).
 */
@Injectable()
export class PartnerOperatorAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditWriter: PartnerOperatorAuditWriter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<OperatorAuditRequest>();
    const identity = operatorIdentity(req?.user);
    if (!identity) return next.handle();

    const res = http.getResponse<AuditResponse>();
    const controllerPath = controllerPathOf(context.getClass());

    return next.handle().pipe(
      tap(() => {
        void this.record(identity, req, controllerPath, res?.statusCode ?? 200, undefined);
      }),
      catchError((err: unknown) => {
        void this.record(identity, req, controllerPath, httpErrorStatus(err), httpErrorCode(err));
        return throwError(() => err);
      }),
    );
  }

  private record(
    identity: OperatorIdentity,
    req: OperatorAuditRequest,
    controllerPath: string | null,
    statusCode: number,
    code: string | undefined,
  ): Promise<void> {
    return recordOperatorRequest(this.auditWriter, {
      identity,
      req,
      controllerPath,
      statusCode,
      errorCode: code,
    });
  }
}
