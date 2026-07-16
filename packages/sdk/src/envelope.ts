/**
 * v1 응답 봉투 (§3.1 성공 / §3.2 에러) + 페이지네이션(§5.1) 재선언 + 언랩 헬퍼.
 *
 * 서버 정본: apps/api/src/partner-api/http/partner-envelope.interceptor.ts,
 * error-envelope.ts, pagination.ts. 봉투는 런타임 인터셉터 소관이라 OpenAPI 에
 * 나타나지 않는다 — SDK 가 계약을 손으로 들고 있는 핵심 이유.
 */

import type { ErrorCode, ErrorItem } from './errors';

/** v1 목록 응답 pagination 메타 */
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

/** v1 성공 봉투 — 필드 4종 고정 */
export interface SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
  /** 목록 라우트만 채워진다. 단건은 null */
  pagination: Pagination | null;
}

/**
 * v1 에러 봉투 — 필드 6종 고정.
 *
 * requestId 는 계약상 string 이나 스트림 중단 경로만 null 을 보낸다 —
 * StorigeApiError.requestId 주석 참조.
 */
export interface ErrorEnvelope {
  success: false;
  errorCode: ErrorCode;
  message: string;
  errors: ErrorItem[];
  fieldErrors: Record<string, string[]> | null;
  requestId: string | null;
}

/** 성공/에러 봉투 union */
export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * 목록 응답 — 봉투에서 풀어낸 파트너 대면 shape.
 *
 * 서버는 data=items[] + pagination 을 따로 싣지만, SDK 는 둘을 한 객체로 묶어
 * 반환한다(호출측이 봉투를 몰라도 되게).
 */
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

/** 런타임 값이 v1 에러 봉투인가 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { success?: unknown; errorCode?: unknown };
  return candidate.success === false && typeof candidate.errorCode === 'string';
}

/** 런타임 값이 v1 성공 봉투인가 */
export function isSuccessEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  if (value === null || typeof value !== 'object') return false;
  return (value as { success?: unknown }).success === true;
}

/**
 * 성공 봉투에서 pagination 을 Page 로 결합.
 *
 * 목록 라우트인데 pagination 이 없으면(서버 계약 위반) 빈 메타로 폴백하지 않고
 * 호출측이 알 수 있도록 items 길이 기준 메타를 만든다 — 조용한 오해석 방지.
 */
export function toPage<T>(envelope: SuccessEnvelope<T[]>): Page<T> {
  const items = envelope.data;
  const pagination: Pagination = envelope.pagination ?? {
    total: items.length,
    limit: items.length,
    offset: 0,
    hasNext: false,
  };
  return { items, pagination };
}
