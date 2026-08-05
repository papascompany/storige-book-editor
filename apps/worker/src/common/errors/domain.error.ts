/**
 * DomainError - Worker 에러 표준화 클래스
 *
 * 모든 Worker 에러는 이 클래스를 통해 표준화됨:
 * - code: 에러 식별 코드 (예: 'PAGE_COUNT_MISMATCH')
 * - message: 사람이 읽을 수 있는 메시지
 * - detail: 추가 정보 (expected, got, index, cause, phase, target 등)
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: Record<string, any>,
  ) {
    super(message);
    this.name = 'DomainError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
    };
  }
}

/**
 * 에러 코드 상수
 */
export const ErrorCodes = {
  // 파일 관련
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_DOWNLOAD_FAILED: 'FILE_DOWNLOAD_FAILED',
  PDF_LOAD_FAILED: 'PDF_LOAD_FAILED',
  PDF_NOT_FROM_EDITOR: 'PDF_NOT_FROM_EDITOR',

  // 세션/검증 관련
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_FILE_MISMATCH: 'SESSION_FILE_MISMATCH',
  EMPTY_SESSION_PAGES: 'EMPTY_SESSION_PAGES',
  INVALID_SORT_ORDER: 'INVALID_SORT_ORDER',

  // 옵션 관련
  INVALID_OUTPUT_OPTIONS: 'INVALID_OUTPUT_OPTIONS',

  // 페이지 타입 관련
  PAGE_COUNT_MISMATCH: 'PAGE_COUNT_MISMATCH',
  PAGETYPEMAP_INCOMPLETE: 'PAGETYPEMAP_INCOMPLETE',
  PAGETYPEMAP_INVALID_VALUE: 'PAGETYPEMAP_INVALID_VALUE',
  NO_COVER_PAGES: 'NO_COVER_PAGES',
  NO_CONTENT_PAGES: 'NO_CONTENT_PAGES',

  // 분리 검증 관련
  SPLIT_VERIFICATION_FAILED: 'SPLIT_VERIFICATION_FAILED',
  EMPTY_OUTPUT_FILE: 'EMPTY_OUTPUT_FILE',

  // 스프레드 관련
  SPREAD_SNAPSHOT_MISSING: 'SPREAD_SNAPSHOT_MISSING',
  SPREAD_SNAPSHOT_INVALID: 'SPREAD_SNAPSHOT_INVALID',
  SPREAD_PDF_INVALID_PAGE_COUNT: 'SPREAD_PDF_INVALID_PAGE_COUNT',
  SPREAD_PDF_SIZE_MISMATCH: 'SPREAD_PDF_SIZE_MISMATCH',

  // 컷아웃(배경제거) 관련 — 2026-08-05, S-P2A-B 샤드2.
  // 편집기가 errorMessage 문자열 매칭 없이 재시도 가부를 판정할 수 있게 코드로 분류한다.
  CUTOUT_DISABLED: 'CUTOUT_DISABLED',
  CUTOUT_INPUT_TOO_LARGE: 'CUTOUT_INPUT_TOO_LARGE',
  CUTOUT_UNSUPPORTED_FORMAT: 'CUTOUT_UNSUPPORTED_FORMAT',

  // 시스템 관련
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
