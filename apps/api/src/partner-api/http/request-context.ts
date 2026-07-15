import { randomUUID } from 'crypto';
import { Request } from 'express';

/**
 * v1 요청 컨텍스트 헬퍼.
 *
 * requestId 는 "가드 → 인터셉터 → 필터" 어느 지점에서든 최초 접근 시 생성되고
 * 이후 동일 값이 재사용된다(봉투 requestId == public_api_audit_logs.request_id).
 * 가드 실패(401 등)도 필터에서 ensureRequestId 로 동일 규약을 보장한다.
 */

/** ApiKeyGuard 가 req.user 에 세팅하는 shape (공용 가드 무수정 — 읽기 전용 미러 타입) */
export interface PartnerAuthUser {
  apiKey: string;
  source: string;
  siteId: string;
  siteName: string;
  role: 'editor' | 'worker';
  retentionDays?: number | null;
}

export interface PartnerRequest extends Request {
  partnerRequestId?: string;
  partnerStartedAt?: number;
  user?: PartnerAuthUser;
}

/** requestId 발급/재사용 — `req_` prefix + uuid 24자 (설계서 §3.2) */
export function ensureRequestId(req: PartnerRequest): string {
  if (typeof req.partnerRequestId === 'string' && req.partnerRequestId) {
    return req.partnerRequestId;
  }
  const id = `req_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  req.partnerRequestId = id;
  return id;
}

/** 최초 접근 시각 기록 — 감사 로그 latency_ms 산출용 */
export function ensureStartedAt(req: PartnerRequest): number {
  if (typeof req.partnerStartedAt === 'number') return req.partnerStartedAt;
  req.partnerStartedAt = Date.now();
  return req.partnerStartedAt;
}

/** 쿼리스트링 제거한 실경로 (경로 파라미터 실값 포함 — 설계서 §2.2 path 규약) */
export function requestPath(req: PartnerRequest): string {
  const url = req.originalUrl || req.url || '';
  const qIndex = url.indexOf('?');
  return (qIndex >= 0 ? url.slice(0, qIndex) : url).slice(0, 300);
}
