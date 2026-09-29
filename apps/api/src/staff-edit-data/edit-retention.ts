import { ConflictException } from '@nestjs/common';

/**
 * 편집데이터 보관기간(Edit Retention) — 순수 계산 (2026-09-29, ADDITIVE).
 *
 * 설정: sites.edit_retention_days (INT NULL, 1..3650). 업로드 파일 자동삭제(sites.retention_days)와 별개.
 * 기준 시각(anchor): 세션 created_at — 관리자 편집·재완료로 연장되지 않는다.
 *  - days NULL 또는 <= 0 → until=null, state 'unset' (기한 제한 없음 · 보존 보장 없음)
 *  - days = N           → until = created_at + N×86400s
 *  - 비회원(게스트) 세션 → until = min(until ?? guest_expires_at, guest_expires_at) (24h 퍼지 불변)
 *  - state = now < until ? 'active' : 'expired'
 * NULL-site(레거시) 세션은 호출부가 days=null 로 넘긴다(항상 'unset', 게스트 상한만 적용).
 */

export type EditRetentionState = 'unset' | 'active' | 'expired';

export interface EditRetentionInfo {
  days: number | null;
  until: string | null;
  state: EditRetentionState;
  anchor: 'createdAt';
}

export interface EditRetentionSessionInput {
  createdAt: Date | string | null | undefined;
  isGuest: boolean;
  guestExpiresAt: Date | string | null | undefined;
}

const DAY_MS = 86_400_000;

function toTime(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 설정값 정규화 — 정수 1 이상만 유효, 그 외(null·0·음수·NaN)는 null(미설정) */
export function normalizeEditRetentionDays(days: unknown): number | null {
  const n = typeof days === 'string' ? Number(days) : days;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
}

/** 보관 종료 시각(ms) — 미설정이면 null */
export function computeEditRetentionUntilMs(
  session: EditRetentionSessionInput,
  days: number | null | undefined,
): number | null {
  const normalized = normalizeEditRetentionDays(days);
  const created = toTime(session.createdAt);
  let until: number | null =
    normalized !== null && created !== null ? created + normalized * DAY_MS : null;
  if (session.isGuest) {
    const guestUntil = toTime(session.guestExpiresAt);
    if (guestUntil !== null) {
      until = Math.min(until ?? guestUntil, guestUntil);
    }
  }
  return until;
}

export function computeEditRetention(
  session: EditRetentionSessionInput,
  days: number | null | undefined,
  now: Date = new Date(),
): EditRetentionInfo {
  const normalized = normalizeEditRetentionDays(days);
  const untilMs = computeEditRetentionUntilMs(session, normalized);
  if (untilMs === null) {
    return { days: normalized, until: null, state: 'unset', anchor: 'createdAt' };
  }
  return {
    days: normalized,
    until: new Date(untilMs).toISOString(),
    state: now.getTime() < untilMs ? 'active' : 'expired',
    anchor: 'createdAt',
  };
}

export function editRetentionExpired(retentionUntil: string | null): ConflictException {
  return new ConflictException({
    code: 'EDIT_RETENTION_EXPIRED',
    message: '편집데이터 보관기간이 지났습니다.',
    retentionUntil,
  });
}

/** 'expired' 면 409 EDIT_RETENTION_EXPIRED { retentionUntil } */
export function assertWithinRetention(info: EditRetentionInfo): void {
  if (info.state === 'expired') throw editRetentionExpired(info.until);
}

/** 사이트별 보호 cutoff — created_at > cutoff 인 세션이 보관기간 안이다 */
export interface EditRetentionCutoff {
  siteId: string;
  cutoff: Date;
}

export function buildEditRetentionCutoffs(
  rows: Array<{ id: string; days: unknown }>,
  now: Date = new Date(),
): EditRetentionCutoff[] {
  const out: EditRetentionCutoff[] = [];
  for (const r of rows) {
    const days = normalizeEditRetentionDays(r.days);
    if (typeof r.id !== 'string' || r.id.length === 0 || days === null) continue;
    out.push({ siteId: r.id, cutoff: new Date(now.getTime() - days * DAY_MS) });
  }
  return out;
}
