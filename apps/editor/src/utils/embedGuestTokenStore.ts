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
 *   만료로 지운 세션은 토큰 값 없이 만료 표시만 남기고 {@link hasExpiredEmbedGuestToken} 으로 알린다.
 * - 모든 Storage 접근은 try/catch — 비공개 모드·저장소 파티셔닝 예외는 삼킨다.
 * - 토큰 값은 콘솔·모니터링으로 출력하지 않는다.
 */
import { isAdminEditTab } from './authTokenStorage'

const KEY_PREFIX = 'storige_embed_guest_v1:'

interface StoredGuestRecord {
  guestToken: string
  expiresAt: string | null
}

/** 만료로 지운 기록의 표시(값은 '1' — 토큰 값은 두지 않는다) */
const EXPIRED_KEY_PREFIX = 'storige_embed_guest_expired_v1:'

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

function expiredKeyOf(sessionId: string): string {
  return `${EXPIRED_KEY_PREFIX}${sessionId}`
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
    const store = sessionStore()
    store?.removeItem(expiredKeyOf(sessionId))
    store?.setItem(keyOf(sessionId), JSON.stringify(record))
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
    if (Number.isNaN(expiresAtMs)) {
      forgetEmbedGuestToken(sessionId)
      return null
    }
    if (expiresAtMs <= now.getTime()) {
      forgetEmbedGuestToken(sessionId)
      try {
        sessionStore()?.setItem(expiredKeyOf(sessionId), '1')
      } catch {
        /* 저장소 접근 불가 — 무시(만료 표시 없이 진행) */
      }
      return null
    }
  }
  return record.guestToken
}

/**
 * 현재 탭에서 이 세션의 기억된 게스트 토큰이 만료 시각이 지나 지워졌는지.
 * 같은 세션의 토큰을 다시 기억하면 false 로 돌아간다. 관리자 편집 탭이면 false.
 */
export function hasExpiredEmbedGuestToken(sessionId: string): boolean {
  if (!sessionId) return false
  if (isAdminEditTab()) return false
  try {
    return sessionStore()?.getItem(expiredKeyOf(sessionId)) === '1'
  } catch {
    return false
  }
}

/** 호스트가 게스트 세션 재오픈에 쓰는 URL fragment 키(`#guestToken=` 또는 `#guest_token=`) */
const GUEST_TOKEN_FRAGMENT_KEYS: readonly string[] = ['guestToken', 'guest_token']

function parseFragment(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

/**
 * URL fragment 에서 게스트 토큰을 읽는다(`#guestToken=..` 우선, `#guest_token=..` 허용).
 * 값이 없거나 비어 있으면 null. 쿼리(`?guestToken=`)는 읽지 않는다.
 */
export function readGuestTokenFragment(hash: string | null | undefined): string | null {
  if (!hash) return null
  const params = parseFragment(hash)
  for (const key of GUEST_TOKEN_FRAGMENT_KEYS) {
    const value = params.get(key)
    if (value) return value
  }
  return null
}

/**
 * href 의 fragment 에서 게스트 토큰 키만 지운다. 쿼리와 다른 fragment 키는 유지하고,
 * 남는 것이 없으면 '#' 도 지운다. 해당 키가 없으면 입력을 그대로 돌려준다.
 */
export function stripGuestTokenFragment(href: string): string {
  const hashIdx = href.indexOf('#')
  if (hashIdx < 0) return href
  const base = href.slice(0, hashIdx)
  const params = parseFragment(href.slice(hashIdx))
  if (!GUEST_TOKEN_FRAGMENT_KEYS.some((k) => params.has(k))) return href
  for (const k of GUEST_TOKEN_FRAGMENT_KEYS) params.delete(k)
  const rest = params.toString()
  return rest ? `${base}#${rest}` : base
}
