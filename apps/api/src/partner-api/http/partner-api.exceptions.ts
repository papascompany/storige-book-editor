import { HttpException } from '@nestjs/common';
import { ErrV1, PartnerV1ErrorItem } from '@storige/types';

/**
 * v1 표준 예외 — errorCode(ERR_* 카탈로그) + errors[] + fieldErrors 를 실어
 * PartnerApiExceptionFilter 가 에러 봉투(§3.2)로 직렬화한다.
 *
 * v1 핸들러/가드/인터셉터는 가급적 이 예외(또는 하위 클래스)를 던진다.
 * 일반 HttpException 은 필터의 status→ERR_* 폴백 매핑을 탄다.
 */
export class PartnerApiException extends HttpException {
  constructor(
    readonly errorCode: ErrV1,
    status: number,
    message: string,
    readonly errorItems: PartnerV1ErrorItem[] = [],
    readonly fieldErrors: Record<string, string[]> | null = null,
  ) {
    super(message, status);
  }
}

/** 429 — Retry-After 헤더(초)를 필터가 부착 (설계서 §5.2) */
export class PartnerRateLimitedException extends PartnerApiException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      ErrV1.ERR_RATE_LIMITED,
      429,
      '요청 한도를 초과했습니다. Retry-After 헤더의 시간(초) 후 재시도하세요.',
    );
  }
}

/**
 * 멱등 재전달 신호 (예외가 아닌 제어 흐름).
 *
 * 인터셉터에서 최초 응답 스냅샷을 그대로 재전달해야 하는데, Nest 는
 * 인터셉터 반환값의 HTTP status 를 라우트 기본값으로 덮어쓴다 —
 * 그래서 필터까지 끌어올려 res 직접 제어(status + Idempotency-Replayed 헤더)한다.
 */
export class PartnerIdempotentReplaySignal extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: unknown,
  ) {
    super('IDEMPOTENT_REPLAY');
  }
}
