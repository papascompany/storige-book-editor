import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrV1, PartnerV1ErrorEnvelope, PartnerV1ErrorItem } from '@storige/types';
import { PartnerApiException } from './partner-api.exceptions';

/**
 * 예외 → v1 에러 봉투(§3.2) 직렬화 헬퍼.
 *
 * PartnerApiExceptionFilter(응답)와 멱등 인터셉터(결정적 4xx 스냅샷 저장)가
 * 공유한다 — 두 경로의 봉투 바이트가 항상 동일하도록 단일 구현.
 */

/** status → ERR_* 폴백 매핑 (v1 코드가 PartnerApiException 을 안 던진 경우의 안전망) */
function fallbackErrorCode(status: number): ErrV1 {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ErrV1.ERR_UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrV1.ERR_FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrV1.ERR_NOT_FOUND;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ErrV1.ERR_FILE_TOO_LARGE;
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return ErrV1.ERR_UNSUPPORTED_CONTENT_TYPE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrV1.ERR_RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ErrV1.ERR_SERVICE_UNAVAILABLE;
    default:
      // 그 외 4xx 는 검증 실패로 수렴(카탈로그 additive 성장 시 세분).
      // 5xx 는 아래 buildErrorEnvelope 에서 ERR_INTERNAL 로 처리.
      return status >= 400 && status < 500
        ? ErrV1.ERR_VALIDATION_FAILED
        : ErrV1.ERR_INTERNAL;
  }
}

/**
 * class-validator 기본 메시지("pageCount must be ...")의 선두 토큰이 식별자
 * 형태이면 fieldErrors 로 그룹핑, 아니면 errors[] 로 수용.
 */
function classifyValidationMessages(messages: string[]): {
  errors: PartnerV1ErrorItem[];
  fieldErrors: Record<string, string[]> | null;
} {
  const fieldErrors: Record<string, string[]> = {};
  const errors: PartnerV1ErrorItem[] = [];
  for (const message of messages) {
    const firstToken = message.split(' ', 1)[0] ?? '';
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(firstToken)) {
      (fieldErrors[firstToken] ??= []).push(message);
    } else {
      errors.push({ code: 'VALIDATION', message });
    }
  }
  return {
    errors,
    fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : null,
  };
}

export interface BuiltErrorEnvelope {
  status: number;
  envelope: PartnerV1ErrorEnvelope;
}

export function buildErrorEnvelope(
  exception: unknown,
  requestId: string,
): BuiltErrorEnvelope {
  // 1) v1 표준 예외 — 실은 값 그대로
  if (exception instanceof PartnerApiException) {
    return {
      status: exception.getStatus(),
      envelope: {
        success: false,
        errorCode: exception.errorCode,
        message: exception.message,
        errors: exception.errorItems,
        fieldErrors: exception.fieldErrors,
        requestId,
      },
    };
  }

  // 2) 일반 HttpException (ValidationPipe BadRequest 포함) — status 폴백 매핑
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    let message = exception.message;
    let errors: PartnerV1ErrorItem[] = [];
    let fieldErrors: Record<string, string[]> | null = null;

    if (typeof response === 'object' && response !== null) {
      const body = response as { message?: string | string[]; error?: string };
      if (Array.isArray(body.message)) {
        // ValidationPipe: message = string[] (필드별 제약 위반 목록)
        const classified = classifyValidationMessages(body.message);
        errors = classified.errors;
        fieldErrors = classified.fieldErrors;
        message = '요청 검증에 실패했습니다';
      } else if (typeof body.message === 'string' && body.message) {
        message = body.message;
      }
    }

    return {
      status,
      envelope: {
        success: false,
        errorCode:
          status === HttpStatus.BAD_REQUEST
            ? ErrV1.ERR_VALIDATION_FAILED
            : fallbackErrorCode(status),
        message,
        errors,
        fieldErrors,
        requestId,
      },
    };
  }

  // 3) 미분류 예외 — 내부 상세 비노출(메시지 누출 금지), requestId 로 추적
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    envelope: {
      success: false,
      errorCode: ErrV1.ERR_INTERNAL,
      message: '일시적인 서버 오류가 발생했습니다. requestId 로 문의해 주세요.',
      errors: [],
      fieldErrors: null,
      requestId,
    },
  };
}
