import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, concatMap, from, switchMap, throwError } from 'rxjs';
import { ErrV1 } from '@storige/types';
import {
  IDEMPOTENCY_KEY_HEADER,
  PARTNER_ENV_LIVE,
} from '../partner-api.constants';
import {
  PartnerApiException,
  PartnerIdempotentReplaySignal,
} from '../http/partner-api.exceptions';
import { buildErrorEnvelope } from '../http/error-envelope';
import { resolveSuccessStatus } from '../http/success-status';
import {
  PartnerRequest,
  ensureRequestId,
  requestPath,
} from '../http/request-context';
import { canonicalBodyHash } from './canonical-hash';
import {
  IdempotencyClaim,
  PartnerIdempotencyService,
} from './partner-idempotency.service';

/**
 * v1 멱등 인터셉터 (설계서 §4) — v1 POST 라우트 전체 자동 적용
 * (@PartnerV1Controller 조합 데코레이터가 모듈 레벨로 바인딩).
 *
 * - 적용: POST + `Idempotency-Key` 헤더 존재 시. GET/PUT/DELETE 는 자연 멱등으로 미캐시.
 * - scope = siteId + env('live' 고정, Stage 2 전) + method + path(실값) + key
 * - 동일 키+동일 body → 최초 응답 스냅샷 재전달(+Idempotency-Replayed 헤더 — 필터 처리)
 * - 동일 키+다른 body → 422 ERR_IDEMPOTENCY_KEY_MISMATCH
 * - 처리 중 동일 키 → 409 ERR_IDEMPOTENCY_IN_PROGRESS
 * - 스냅샷은 2xx·결정적 4xx 만 저장, 5xx 는 선점 해제(재시도 가능)
 *
 * 인터셉터 순서 전제: 감사 → [멱등] → 봉투 — 안쪽 봉투 인터셉터의 출력(최종 봉투)이
 * 이 인터셉터의 스트림으로 올라오므로 스냅샷 = 실제 응답 바이트와 동일 shape.
 */
@Injectable()
export class PartnerIdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PartnerIdempotencyInterceptor.name);

  constructor(
    private readonly idempotencyService: PartnerIdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    if (req.method !== 'POST') return next.handle();

    const rawHeader = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (rawHeader === undefined) return next.handle(); // 미제공 — 멱등 보호 없이 통과

    const key = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!key || key.length > 128) {
      throw new PartnerApiException(
        ErrV1.ERR_VALIDATION_FAILED,
        400,
        'Idempotency-Key 헤더는 1~128자여야 합니다',
        [],
        null,
      );
    }

    const user = req.user;
    if (!user?.siteId) return next.handle(); // 가드 뒤라 항상 존재 — 방어적 통과

    const requestHash = canonicalBodyHash(req.body);
    const claimPromise = this.idempotencyService.claim(
      {
        siteId: user.siteId,
        env: PARTNER_ENV_LIVE,
        method: req.method,
        path: requestPath(req),
        key,
      },
      requestHash,
    );

    return from(claimPromise).pipe(
      switchMap((claim: IdempotencyClaim) => {
        switch (claim.kind) {
          case 'mismatch':
            return throwError(
              () =>
                new PartnerApiException(
                  ErrV1.ERR_IDEMPOTENCY_KEY_MISMATCH,
                  422,
                  '동일 Idempotency-Key 로 다른 본문이 요청되었습니다',
                ),
            );
          case 'in_progress':
            return throwError(
              () =>
                new PartnerApiException(
                  ErrV1.ERR_IDEMPOTENCY_IN_PROGRESS,
                  409,
                  '동일 Idempotency-Key 요청이 처리 중입니다. 원 요청 완료 후 재시도하세요',
                ),
            );
          case 'replay':
            // 최초 응답 스냅샷 재전달 — status 제어를 위해 필터로 승격
            return throwError(
              () => new PartnerIdempotentReplaySignal(claim.statusCode, claim.body),
            );
          case 'claimed':
            return this.executeClaimed(context, next, claim.id, req);
        }
      }),
    );
  }

  private executeClaimed(
    context: ExecutionContext,
    next: CallHandler,
    claimId: string,
    req: PartnerRequest,
  ): Observable<unknown> {
    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        // 성공(2xx) — 최종 봉투 스냅샷 고정
        await this.safeFinalize(() =>
          this.idempotencyService.complete(
            claimId,
            resolveSuccessStatus(this.reflector, context),
            body,
          ),
        );
        return body;
      }),
      catchError((err: unknown) => {
        const requestId = ensureRequestId(req);
        const { status, envelope } = buildErrorEnvelope(err, requestId);
        const finalize =
          status < 500
            ? // 결정적 4xx — 에러 봉투 스냅샷 저장(재호출 시 동일 응답 재전달)
              this.idempotencyService.complete(claimId, status, envelope)
            : // 5xx — 저장하지 않고 선점 해제(재시도 가능 유지)
              this.idempotencyService.release(claimId);
        return from(this.safeFinalize(() => finalize)).pipe(
          concatMap(() => throwError(() => err)),
        );
      }),
    );
  }

  /** 멱등 저장 실패가 파트너 응답을 파손하지 않도록 격리 */
  private async safeFinalize(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      this.logger.warn(
        `멱등 스냅샷 저장/해제 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
