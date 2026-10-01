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
 *
 * 주문 초안 매핑: 게스트 토큰을 기억할 때 세션의 주문번호(0 이 아님)·mode·templateSetId 와 호스트 범위
 * (부모 출처·인증 토큰의 사이트) 조합 → sessionId 를 함께 기억한다. sessionId 없이 같은 조합으로 다시 열 때
 * 주문별 세션 목록이 비어 있으면 이 매핑으로 같은 탭의 비회원 초안을 찾는다. 호스트 범위가 다르면
 * 다른 키다. 매핑 값에는 토큰을 두지 않고, 조회 시 sessionId 의 토큰 기록이 없거나 만료면 매핑도 지우고 null.
 */
import { isAdminEditTab } from './authTokenStorage'

const KEY_PREFIX = 'storige_embed_guest_v1:'

interface StoredGuestRecord {
  guestToken: string
  expiresAt: string | null
}

/** 주문 초안 매핑(값은 sessionId — 토큰 값은 두지 않는다) */
const DRAFT_KEY_PREFIX = 'storige_embed_guest_draft_v1:'

/**
 * 주문 초안 매핑 키 재료. orderSeqno 가 비었거나 0 이거나 mode 가 비면 매핑하지 않는다.
 * templateSetId·hostOrigin·siteId 는 없음·빈 값·null 을 같은 값으로 본다.
 */
export interface EmbedGuestDraftKey {
  orderSeqno: number | string | null | undefined
  mode: string | null | undefined
  templateSetId?: string | null
  /** 호스트 범위 — 임베드를 연 부모 출처(parentOrigin) */
  hostOrigin?: string | null
  /** 호스트 범위 — 인증 토큰의 사이트 id */
  siteId?: string | null
}

/** {@link recallEmbedGuestDraft} 결과 */
export interface RememberedGuestDraft {
  sessionId: string
  guestToken: string
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

function draftKeyOf(key: EmbedGuestDraftKey): string | null {
  const orderSeqno = key.orderSeqno === null || key.orderSeqno === undefined ? '' : String(key.orderSeqno).trim()
  if (orderSeqno === '' || /^0+$/.test(orderSeqno)) return null
  const mode = (key.mode ?? '').trim()
  if (mode === '') return null
  const templateSetId = (key.templateSetId ?? '').trim()
  const hostOrigin = (key.hostOrigin ?? '').trim()
  const siteId = (key.siteId ?? '').trim()
  return `${DRAFT_KEY_PREFIX}${[orderSeqno, mode, templateSetId, hostOrigin, siteId].map(encodeURIComponent).join(':')}`
}

/** 두 키 재료가 같은 매핑 키인지(둘 다 매핑 불가 키면 false). */
export function sameEmbedGuestDraftKey(a: EmbedGuestDraftKey, b: EmbedGuestDraftKey): boolean {
  const ka = draftKeyOf(a)
  return ka !== null && ka === draftKeyOf(b)
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

/**
 * 세션의 게스트 토큰을 현재 탭에 기억한다. 빈 값·관리자 편집 탭이면 아무것도 하지 않는다.
 * draftKey 가 매핑 가능한 값(주문번호 0 아님·mode 있음)이면 토큰 기록에 성공한 뒤 주문 초안 매핑도 기억한다.
 */
export function rememberEmbedGuestToken(
  sessionId: string,
  guestToken: string,
  expiresAt: string | null,
  draftKey?: EmbedGuestDraftKey,
): void {
  if (!sessionId || !guestToken) return
  if (isAdminEditTab()) return
  try {
    const record: StoredGuestRecord = { guestToken, expiresAt: expiresAt ?? null }
    const store = sessionStore()
    if (!store) return
    store.removeItem(expiredKeyOf(sessionId))
    store.setItem(keyOf(sessionId), JSON.stringify(record))
    const draftStorageKey = draftKey ? draftKeyOf(draftKey) : null
    if (draftStorageKey) store.setItem(draftStorageKey, sessionId)
  } catch {
    /* 저장소 접근 불가 — 무시(기억하지 못하면 기존 조회 경로를 쓴다) */
  }
}

/**
 * 같은 주문·mode·templateSetId·호스트 범위로 현재 탭에서 기억한 비회원 세션과 그 게스트 토큰.
 * 매핑 없음·매핑 불가 키·관리자 편집 탭·저장소 접근 불가이면 null. 매핑된 세션의 토큰 기록이 없거나
 * 만료·형식 불일치면 매핑을 지우고 null(만료 판정은 {@link recallEmbedGuestToken} 과 같다).
 */
export function recallEmbedGuestDraft(key: EmbedGuestDraftKey, now: Date = new Date()): RememberedGuestDraft | null {
  if (isAdminEditTab()) return null
  const draftStorageKey = draftKeyOf(key)
  if (!draftStorageKey) return null
  let sessionId: string | null
  try {
    sessionId = sessionStore()?.getItem(draftStorageKey) ?? null
  } catch {
    return null
  }
  if (!sessionId) return null
  const guestToken = recallEmbedGuestToken(sessionId, now)
  if (!guestToken) {
    forgetEmbedGuestDraft(key)
    return null
  }
  return { sessionId, guestToken }
}

/** 주문 초안 매핑을 지운다(토큰 기록은 건드리지 않는다). */
export function forgetEmbedGuestDraft(key: EmbedGuestDraftKey): void {
  const draftStorageKey = draftKeyOf(key)
  if (!draftStorageKey) return
  try {
    sessionStore()?.removeItem(draftStorageKey)
  } catch {
    /* 저장소 접근 불가 — 무시 */
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
