import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { PartnerV1SuccessEnvelope } from '@storige/types';

/**
 * v1 성공 봉투 인터셉터 (설계서 §3.1) — 필드 4종 고정
 * {success, message, data, pagination}.
 *
 * 핸들러 반환값을 data 로 감싼다. 목록 라우트는 PaginatedResult(작업 6)를
 * 반환하면 pagination 이 채워진다 — 그 외 pagination=null.
 */
@Injectable()
export class PartnerEnvelopeInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<PartnerV1SuccessEnvelope<unknown>> {
    return next.handle().pipe(
      map((result: unknown): PartnerV1SuccessEnvelope<unknown> => {
        return {
          success: true,
          message: 'Success',
          data: result ?? null,
          pagination: null,
        };
      }),
    );
  }
}
