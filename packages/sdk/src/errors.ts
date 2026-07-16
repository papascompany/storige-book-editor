/**
 * v1 에러 코드 카탈로그 + SDK 에러 타입.
 *
 * 서버 정본: apps/api/src/partner-api/http/error-envelope.ts +
 * @storige/types ErrV1(29종). 여기서 재선언하는 이유는 src/index.ts 상단 참조.
 * 드리프트는 types-parity.spec.ts 가 키집합 대조로 감시한다.
 */

/**
 * Partner API v1 에러 코드 29종.
 *
 * TS enum 대신 const object + union 으로 선언한다 — enum 은 런타임 객체를
 * 방출해 트리셰이킹을 막고, isolatedModules/erasableSyntaxOnly 환경(번들러·
 * Node --experimental-strip-types)에서 파트너 빌드를 깨뜨린다. 값은 서버
 * ErrV1 과 1:1 동일하다.
 *
 * ## 계약 원칙
 * 분기는 **errorCode 로만** 한다. message 문자열 파싱 금지 — 메시지는 예고 없이
 * 개선된다(설계서 §3.2).
 *
 * ## additive-only 성장
 * 코드 추가는 허용, 기존 코드의 의미/HTTP status 변경·삭제는 v1 내 금지.
 * 따라서 SDK 는 **미지 코드를 관용**해야 한다 — 아래 ErrorCode 타입이
 * `(string & {})` 을 포함하는 이유(알려진 코드 자동완성 + 신규 코드 수용).
 */
export const ErrorCode = {
  // 공통 (8)
  /** 401 — 키 누락/무효, 또는 Bearer 와 X-API-Key 값 불일치(모호성 거부) */
  ERR_UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  /** 403 */
  ERR_FORBIDDEN: 'ERR_FORBIDDEN',
  /** 403 — test 키로 live 전용 라우트 호출 */
  ERR_ENV_MISMATCH: 'ERR_ENV_MISMATCH',
  /** 404 — 없음/타 site/타 env(존재 은닉) */
  ERR_NOT_FOUND: 'ERR_NOT_FOUND',
  /** 400 */
  ERR_VALIDATION_FAILED: 'ERR_VALIDATION_FAILED',
  /** 429 — Retry-After 헤더 동반 */
  ERR_RATE_LIMITED: 'ERR_RATE_LIMITED',
  /** 500 */
  ERR_INTERNAL: 'ERR_INTERNAL',
  /** 503 */
  ERR_SERVICE_UNAVAILABLE: 'ERR_SERVICE_UNAVAILABLE',

  // 멱등성 (2)
  /** 422 — 동일 키 + 다른 body hash */
  ERR_IDEMPOTENCY_KEY_MISMATCH: 'ERR_IDEMPOTENCY_KEY_MISMATCH',
  /** 409 — 동일 키 처리 중. 짧은 백오프 후 재시도 대상 */
  ERR_IDEMPOTENCY_IN_PROGRESS: 'ERR_IDEMPOTENCY_IN_PROGRESS',

  // 업로드/파일 (4)
  /** 413 — 직접 업로드 100MB 초과 */
  ERR_FILE_TOO_LARGE: 'ERR_FILE_TOO_LARGE',
  /** 415 — 직접 업로드는 PDF 만 */
  ERR_UNSUPPORTED_CONTENT_TYPE: 'ERR_UNSUPPORTED_CONTENT_TYPE',
  /** 503 */
  ERR_STORAGE_NOT_S3: 'ERR_STORAGE_NOT_S3',
  /** 409 — presigned complete 전 fileId 참조 */
  ERR_FILE_NOT_READY: 'ERR_FILE_NOT_READY',

  // BookSpecs (2)
  /** 404 */
  ERR_BOOK_SPEC_NOT_FOUND: 'ERR_BOOK_SPEC_NOT_FOUND',
  /** 422 — pageMin/pageMax/pageIncrement 위반 */
  ERR_PAGE_COUNT_OUT_OF_RANGE: 'ERR_PAGE_COUNT_OUT_OF_RANGE',

  // Books/자산/최종화 (8)
  /** 409 — FINALIZED 도서에 자산 변경 시도 */
  ERR_BOOK_NOT_DRAFT: 'ERR_BOOK_NOT_DRAFT',
  /** 409 — POST 인데 이미 존재(교체는 PUT) */
  ERR_ASSET_ALREADY_EXISTS: 'ERR_ASSET_ALREADY_EXISTS',
  /** 404 — PUT 인데 교체 대상 없음(신규는 POST) */
  ERR_ASSET_NOT_FOUND: 'ERR_ASSET_NOT_FOUND',
  /** 422 — creationType × assetType 호환 매트릭스 위반 */
  ERR_ASSET_INCOMPATIBLE: 'ERR_ASSET_INCOMPATIBLE',
  /** 422 — 최종화 착수에 필요한 자산 누락 */
  ERR_ASSETS_INCOMPLETE: 'ERR_ASSETS_INCOMPLETE',
  /** 409 — 최종화 진행 중 재착수 */
  ERR_FINALIZATION_IN_PROGRESS: 'ERR_FINALIZATION_IN_PROGRESS',
  /** 422 */
  ERR_PDF_VALIDATION_FAILED: 'ERR_PDF_VALIDATION_FAILED',
  /** 409 */
  ERR_SESSION_NOT_PROMOTABLE: 'ERR_SESSION_NOT_PROMOTABLE',

  // Webhooks (3)
  /** 404 */
  ERR_WEBHOOK_CONFIG_NOT_FOUND: 'ERR_WEBHOOK_CONFIG_NOT_FOUND',
  /** 422 — 허용 호스트 외 URL */
  ERR_WEBHOOK_URL_FORBIDDEN: 'ERR_WEBHOOK_URL_FORBIDDEN',
  /** 409 — 재시도 불가 상태 */
  ERR_DELIVERY_NOT_RETRYABLE: 'ERR_DELIVERY_NOT_RETRYABLE',

  // Orders/Credits (2) — 서버 Stage 6(오너 게이트). 카탈로그에는 이미 존재.
  /** 409 */
  ERR_ORDER_NOT_CANCELLABLE: 'ERR_ORDER_NOT_CANCELLABLE',
  /** 402 */
  ERR_INSUFFICIENT_CREDIT: 'ERR_INSUFFICIENT_CREDIT',
} as const;

/** 알려진 v1 에러 코드 union */
export type KnownErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * 에러 코드 — 알려진 29종 + 미지 코드(additive 성장 수용).
 *
 * `string & {}` 은 union 이 `string` 으로 넓어지는 것을 막아 알려진 코드의
 * 자동완성을 유지하면서도 신규 서버 코드를 타입 에러 없이 받는다.
 *
 * 위 const `ErrorCode` 와 같은 이름의 타입 — 값/타입 네임스페이스가 분리된
 * TS 선언 병합이다(enum 과 동일한 사용감: `ErrorCode.ERR_X` 값 + `ErrorCode` 타입).
 */
export type ErrorCode = KnownErrorCode | (string & {});

/** 알려진 v1 코드인지 판정(미지 코드 관용 분기용) */
export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return Object.prototype.hasOwnProperty.call(ErrorCode, code);
}

/** v1 에러 봉투의 errors[] 도메인 상세 항목 */
export interface ErrorItem {
  code: string;
  message: string;
}

/** SDK 가 던지는 모든 에러의 기저 타입 */
export class StorigeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // ES5 타깃 트랜스파일 환경에서도 instanceof 가 성립하도록 프로토타입 복원
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 서버가 v1 에러 봉투(§3.2)로 응답했을 때 던지는 에러.
 *
 * 분기는 `errorCode` 로 한다 — `message` 는 사람용이며 예고 없이 바뀐다.
 *
 * @example
 * try {
 *   await client.books.startFinalization(uid);
 * } catch (err) {
 *   if (err instanceof StorigeApiError && err.errorCode === ErrorCode.ERR_ASSETS_INCOMPLETE) {
 *     // 자산 보강 후 재시도
 *   }
 * }
 */
export class StorigeApiError extends StorigeError {
  /** v1 카탈로그 코드. 미지 코드도 그대로 보존한다(additive 관용) */
  readonly errorCode: ErrorCode;
  /** HTTP status */
  readonly status: number;
  /**
   * 서버 추적 ID — 문의 시 전달.
   *
   * ⚠️ 계약상 string 이지만 GET /books/:uid/pdf 스트림 중단 경로만 null 을
   *    보낸다(books.controller.ts 스트림 error 핸들러). 타입은 방어적으로
   *    `string | null`.
   */
  readonly requestId: string | null;
  /** 도메인 상세 항목(예: ERR_PAGE_COUNT_OUT_OF_RANGE 의 세부 위반) */
  readonly errors: readonly ErrorItem[];
  /** 필드별 검증 위반(ERR_VALIDATION_FAILED). 없으면 null */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>> | null;
  /** 429 응답의 Retry-After(초). 그 외 null */
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    errorCode: ErrorCode;
    status: number;
    message: string;
    requestId?: string | null;
    errors?: readonly ErrorItem[];
    fieldErrors?: Readonly<Record<string, readonly string[]>> | null;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.errorCode = init.errorCode;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.errors = init.errors ?? [];
    this.fieldErrors = init.fieldErrors ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

/** 네트워크 실패·타임아웃 등 응답 봉투를 얻지 못한 경우 */
export class StorigeConnectionError extends StorigeError {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** SDK 사용법 위반(잘못된 인자 등) — 요청 발신 전에 던진다 */
export class StorigeUsageError extends StorigeError {}
