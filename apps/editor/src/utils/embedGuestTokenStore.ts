/**
 * 임베드 게스트 세션 토큰 — 탭 단위 기억 저장소 (2026-09-30).
 *
 * 게스트 세션을 같은 탭에서 다시 열 때(`/embed?sessionId=`) 게스트 조회 경로
 * (GET /edit-sessions/guest/:id)를 먼저 쓰기 위해, 세션을 불러오거나 만든 직후
 * 응답의 guestToken 을 sessionId 별로 기억한다.
 *
 * - 저장소는 `sessionStorage` 만 쓴다(탭을 닫으면 소멸). localStorage 에는 두지 않는다.
 * - 관리자 편집 탭(adminEdit=session)에서는 기록·조회하지 않는다.
 * - 만료 시각(expiresAt)이 지났거나 레코드 형식이 맞지 않으면 조회 시 지우고 null.
 * - 모든 Storage 접근은 try/catch — 비공개 모드·저장소 파티셔닝 예외는 삼킨다.
 * - 토큰 값은 콘솔·모니터링으로 출력하지 않는다.
 */
import { isAdminEditTab } from './authTokenStorage'

const KEY_PREFIX = 'storige_embed_guest_v1:'

interface StoredGuestRecord {
  guestToken: string
  expiresAt: string | null
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function keyOf(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`
}

function parseRecord(raw: string): StoredGuestRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const rec = parsed as { guestToken?: unknown; expiresAt?: unknown }
  if (typeof rec.guestToken !== 'string' || rec.guestToken.length === 0) return null
  if (rec.expiresAt !== null && rec.expiresAt !== undefined && typeof rec.expiresAt !== 'string') return null
  return { guestToken: rec.guestToken, expiresAt: typeof rec.expiresAt === 'string' ? rec.expiresAt : null }
}

/** 세션의 게스트 토큰을 현재 탭에 기억한다. 빈 값·관리자 편집 탭이면 아무것도 하지 않는다. */
export function rememberEmbedGuestToken(sessionId: string, guestToken: string, expiresAt: string | null): void {
  if (!sessionId || !guestToken) return
  if (isAdminEditTab()) return
  try {
    const record: StoredGuestRecord = { guestToken, expiresAt: expiresAt ?? null }
    sessionStore()?.setItem(keyOf(sessionId), JSON.stringify(record))
  } catch {
    /* 저장소 접근 불가 — 무시(기억하지 못하면 기존 조회 경로를 쓴다) */
  }
}

/** 세션의 기억된 게스트 토큰 기록을 지운다. */
export function forgetEmbedGuestToken(sessionId: string): void {
  if (!sessionId) return
  try {
    sessionStore()?.removeItem(keyOf(sessionId))
  } catch {
    /* 저장소 접근 불가 — 무시 */
  }
}

/**
 * 기억된 게스트 토큰을 돌려준다. 없음·관리자 편집 탭·형식 불일치·만료이면 null.
 * 형식 불일치·만료 레코드는 이 호출에서 지운다.
 */
export function recallEmbedGuestToken(sessionId: string, now: Date = new Date()): string | null {
  if (!sessionId) return null
  if (isAdminEditTab()) return null
  let raw: string | null
  try {
    raw = sessionStore()?.getItem(keyOf(sessionId)) ?? null
  } catch {
    return null
  }
  if (raw === null) return null

  const record = parseRecord(raw)
  if (!record) {
    forgetEmbedGuestToken(sessionId)
    return null
  }
  if (record.expiresAt !== null) {
    const expiresAtMs = Date.parse(record.expiresAt)
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
      forgetEmbedGuestToken(sessionId)
      return null
    }
  }
  return record.guestToken
}
