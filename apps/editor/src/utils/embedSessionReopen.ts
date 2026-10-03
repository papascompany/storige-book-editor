/**
 * 명시 sessionId 세션 재오픈 공용 유틸 — embed.tsx(EmbeddedEditor), EmbedView(templateSetId 도출),
 * EditorWorkflowControls(첨부 배지)가 같은 조회 순서와 실패 사유 매핑을 쓴다.
 * 주문별 세션 목록에서 고른 비회원 세션 항목의 열기({@link openGuestItemFromOrderList})와
 * 주문별 세션 목록이 비었을 때 같은 탭에서 기억한 비회원 초안 열기({@link openRememberedGuestDraft})도 여기 둔다.
 *
 * 조회 순서:
 *   1. 호스트가 이번 진입에 넘긴 게스트 토큰(fragment·EditorConfig.guestToken)으로 게스트 조회 경로
 *   2. 현재 탭에 기억된 게스트 토큰(1과 다를 때만)으로 게스트 조회 경로
 *   3. 기존 조회 경로(GET /edit-sessions/:id) 1회
 * 호스트가 넘긴 토큰은 검증 전이므로 여기서 기억하지 않는다(기억은 성공한 로드가 맡는다).
 *
 * ⚠️ `editSessionsApi` 는 반드시 '../api'(index)에서 가져온다 — 테스트 하네스가 './api'·'@/api' 를
 *    통째로 mock 하므로 하위 모듈을 직접 가져오면 mock 이 적용되지 않는다.
 * 토큰 값은 콘솔·모니터링으로 출력하지 않는다(오류 객체는 가린 뒤 던진다).
 */
import axios from 'axios'
import { editSessionsApi, type EditSessionResponse } from '../api'
import {
  forgetEmbedGuestDraft,
  forgetEmbedGuestToken,
  hasExpiredEmbedGuestToken,
  recallEmbedGuestToken,
  sameEmbedGuestDraftKey,
  type EmbedGuestDraftKey,
  type RememberedGuestDraft,
} from './embedGuestTokenStore'
import { redactGuestTokenInError } from './redactGuestToken'
import { apiErrorCodeOf, httpStatusOf } from './httpErrorFields'

/** SESSION_NOT_FOUND 사유 */
export type SessionNotFoundReason = 'not_found' | 'forbidden' | 'invalid_id' | 'guest_token_required'

export interface ReopenGuestTokens {
  /** 호스트가 이번 진입에 넘긴 게스트 토큰(검증 전) */
  presented?: string | null
  /** 현재 탭에 기억된 게스트 토큰 */
  remembered?: string | null
}

interface ReopenFailureContext {
  /** 호스트가 게스트 토큰을 넘겼는지 */
  presentedByHost: boolean
  /** 게스트 조회 경로가 400/403/404 로 거절했을 때의 응답 code(첫 값) */
  guestFailureCode: string | null
  /** 현재 탭에 기억된 게스트 토큰이 만료 시각이 지나 지워졌는지 */
  rememberedExpired: boolean
}

/** 기존 조회 경로에서 던진 오류 → 그 직전 게스트 조회 경로의 결과 */
const reopenFailureContext = new WeakMap<object, ReopenFailureContext>()

export { redactGuestTokenInError, apiErrorCodeOf, httpStatusOf }

/**
 * 명시 sessionId 세션 조회(재오픈). 게스트 토큰이 있으면 게스트 조회 경로를 먼저 쓰고,
 * 게스트 경로가 400/403/404 로 거절하거나 응답 없이 연결 단계에서 실패하면 다음 토큰, 그다음
 * 기존 조회 경로로 1회 폴백한다. 기억된 토큰이 거절되면 기록을 지운다.
 * 최종 판정은 기존 경로 결과를 따르고(사유 매핑은 {@link sessionNotFoundReasonOf}),
 * 그 밖의 오류는 토큰을 가린 뒤 그대로 던진다.
 */
export async function fetchSessionForReopen(
  id: string,
  tokens: ReopenGuestTokens = {},
): Promise<EditSessionResponse> {
  const presented = tokens.presented || null
  const remembered = tokens.remembered || null
  const candidates: Array<{ token: string; remembered: boolean }> = []
  if (presented) candidates.push({ token: presented, remembered: presented === remembered })
  if (remembered && remembered !== presented) candidates.push({ token: remembered, remembered: true })

  let guestFailureCode: string | null = null
  for (const candidate of candidates) {
    try {
      return await editSessionsApi.getGuest(id, candidate.token)
    } catch (err) {
      redactGuestTokenInError(err, candidate.token)
      if (!axios.isAxiosError(err)) throw err
      const status = err.response?.status
      if (status === 400 || status === 403 || status === 404) {
        if (candidate.remembered) forgetEmbedGuestToken(id)
        guestFailureCode = guestFailureCode ?? apiErrorCodeOf(err)
      } else if (!(err.response === undefined && err.code === 'ERR_NETWORK')) {
        throw err
      }
    }
  }

  try {
    return await editSessionsApi.get(id)
  } catch (err) {
    if (err !== null && typeof err === 'object') {
      reopenFailureContext.set(err, {
        presentedByHost: presented !== null,
        guestFailureCode,
        rememberedExpired: hasExpiredEmbedGuestToken(id),
      })
    }
    throw err
  }
}

/**
 * 명시 sessionId 조회 실패 → SESSION_NOT_FOUND 사유. 해당하지 않는 실패(401·네트워크·5xx 등)는 null.
 *
 * - 404/410 → 'not_found', 400/422 → 'invalid_id'
 * - 403: 게스트 조회 경로가 GUEST_SESSION_EXPIRED 였으면 'not_found', GUEST_TOKEN_MISMATCH 였으면
 *   'forbidden'. 호스트가 게스트 토큰을 넘기지 않았고 기존 조회 경로 응답 code 가
 *   GUEST_TOKEN_REQUIRED 이면, 현재 탭에 기억된 토큰이 만료로 지워진 경우 'not_found',
 *   그 밖에는 'guest_token_required'. 나머지 403 은 'forbidden'.
 */
export function sessionNotFoundReasonOf(err: unknown, status: number | undefined): SessionNotFoundReason | null {
  if (status === 404 || status === 410) return 'not_found'
  if (status === 400 || status === 422) return 'invalid_id'
  if (status !== 403) return null
  const ctx = err !== null && typeof err === 'object' ? reopenFailureContext.get(err) : undefined
  if (ctx?.guestFailureCode === 'GUEST_SESSION_EXPIRED') return 'not_found'
  if (ctx?.guestFailureCode === 'GUEST_TOKEN_MISMATCH') return 'forbidden'
  if (!ctx?.presentedByHost && apiErrorCodeOf(err) === 'GUEST_TOKEN_REQUIRED') {
    return ctx?.rememberedExpired ? 'not_found' : 'guest_token_required'
  }
  return 'forbidden'
}

/**
 * 주문별 세션 목록 항목이 게스트 토큰 없이 실린 비회원 세션인지.
 * 비회원 세션은 guestExpiresAt 이 있고, 회원 세션은 guestExpiresAt 이 null 이다.
 */
export function isTokenlessGuestItem(s: Pick<EditSessionResponse, 'guestToken' | 'guestExpiresAt'>): boolean {
  return !s.guestToken && s.guestExpiresAt != null
}

/** {@link openGuestItemFromOrderList} 결과 — 열었으면 세션, 열 수 없으면 SESSION_NOT_FOUND 사유 */
export type OrderListGuestOpenResult =
  | { kind: 'opened'; session: EditSessionResponse }
  | { kind: 'not_opened'; reason: SessionNotFoundReason }

/** 게스트 조회 경로 거절(응답 있음) → SESSION_NOT_FOUND 사유. 해당하지 않으면 null. */
function guestRejectionReasonOf(status: number | undefined, code: string | null): SessionNotFoundReason | null {
  if (status === 404 || status === 410) return 'not_found'
  if (status === 400 || status === 422) return 'invalid_id'
  if (status === 403) return code === 'GUEST_SESSION_EXPIRED' ? 'not_found' : 'forbidden'
  return null
}

/**
 * 주문별 세션 목록에서 고른, 게스트 토큰 없이 실린 비회원 세션 항목을 연다.
 * 현재 탭에 기억된 게스트 토큰으로 게스트 조회 경로만 1회 쓰고, 기존 조회 경로·세션 생성은 쓰지 않는다.
 *
 * - 기억된 토큰 없음: 기억 기록이 만료로 지워졌거나 항목 guestExpiresAt 이 지났으면 'not_found',
 *   그 밖에는 'guest_token_required'.
 * - 게스트 조회 경로 거절: 404/410 → 'not_found', 403 GUEST_SESSION_EXPIRED → 'not_found',
 *   그 밖의 403 → 'forbidden', 400/422 → 'invalid_id'. 거절된 기억 기록은 지운다.
 * - 그 밖의 오류(5xx·타임아웃·연결 실패 등)는 토큰을 가린 뒤 그대로 던진다.
 */
export async function openGuestItemFromOrderList(
  item: Pick<EditSessionResponse, 'id' | 'guestExpiresAt'>,
  now: Date = new Date(),
): Promise<OrderListGuestOpenResult> {
  const token = recallEmbedGuestToken(item.id, now)
  if (!token) {
    const itemExpiresAtMs = item.guestExpiresAt ? Date.parse(item.guestExpiresAt) : Number.NaN
    const itemExpired = !Number.isNaN(itemExpiresAtMs) && itemExpiresAtMs <= now.getTime()
    const expired = hasExpiredEmbedGuestToken(item.id) || itemExpired
    return { kind: 'not_opened', reason: expired ? 'not_found' : 'guest_token_required' }
  }

  try {
    return { kind: 'opened', session: await editSessionsApi.getGuest(item.id, token) }
  } catch (err) {
    redactGuestTokenInError(err, token)
    if (!axios.isAxiosError(err)) throw err
    const reason = guestRejectionReasonOf(err.response?.status, apiErrorCodeOf(err))
    if (reason === null) throw err
    forgetEmbedGuestToken(item.id)
    return { kind: 'not_opened', reason }
  }
}

/**
 * 같은 탭에서 기억한 비회원 초안({@link recallEmbedGuestDraft} 결과)을 게스트 조회 경로로 1회 연다.
 * 기존 조회 경로·세션 생성은 쓰지 않는다.
 *
 * - 성공: 응답 세션의 id·주문번호·mode·templateSetId 가 매핑 키와 맞으면 세션을 돌려준다. 맞지 않으면
 *   주문 초안 매핑만 지우고 null(토큰 기록은 그 세션의 명시 sessionId 재오픈용으로 남긴다).
 * - 게스트 조회 경로 거절(400/403/404/410/422): 그 세션의 토큰 기록과 주문 초안 매핑을 지우고 null
 *   (호출자는 이 매핑 없이 진행한다).
 * - 그 밖의 오류(5xx·타임아웃·연결 실패 등)는 토큰을 가린 뒤 그대로 던진다(기록 유지).
 */
export async function openRememberedGuestDraft(
  key: EmbedGuestDraftKey,
  draft: RememberedGuestDraft,
): Promise<EditSessionResponse | null> {
  let session: EditSessionResponse
  try {
    session = await editSessionsApi.getGuest(draft.sessionId, draft.guestToken)
  } catch (err) {
    redactGuestTokenInError(err, draft.guestToken)
    if (!axios.isAxiosError(err)) throw err
    if (guestRejectionReasonOf(err.response?.status, apiErrorCodeOf(err)) === null) throw err
    forgetEmbedGuestToken(draft.sessionId)
    forgetEmbedGuestDraft(key)
    return null
  }
  const sessionKey: EmbedGuestDraftKey = {
    orderSeqno: session?.orderSeqno,
    mode: session?.mode,
    templateSetId: session?.templateSetId ?? null,
    hostOrigin: key.hostOrigin,
    siteId: key.siteId,
  }
  if (session?.id !== draft.sessionId || !sameEmbedGuestDraftKey(sessionKey, key)) {
    forgetEmbedGuestDraft(key)
    return null
  }
  return session
}

/** 인증 토큰(JWT) 페이로드에서 읽은 회원 여부·사이트 id. 서명은 검증하지 않는다(화면 경로 선택용). */
export interface EmbedAccessTokenScope {
  /** 토큰의 회원 번호(sub)가 양의 정수인지 — API 의 회원 판정과 같은 규칙 */
  member: boolean
  /** 토큰의 사이트 id(없으면 null) */
  siteId: string | null
}

function decodeBase64Url(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * 인증 토큰의 회원 여부·사이트 id. JWT 형식이 아니거나 해석할 수 없으면 비회원·사이트 없음으로 본다.
 * 토큰 값은 출력하지 않는다.
 */
export function embedAccessTokenScopeOf(token: string | null | undefined): EmbedAccessTokenScope {
  const none: EmbedAccessTokenScope = { member: false, siteId: null }
  if (!token) return none
  const parts = token.split('.')
  if (parts.length !== 3) return none
  const json = decodeBase64Url(parts[1])
  if (json === null) return none
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return none
  }
  if (payload === null || typeof payload !== 'object') return none
  const { sub, siteId } = payload as { sub?: unknown; siteId?: unknown }
  const subText = typeof sub === 'string' || typeof sub === 'number' ? String(sub) : ''
  return {
    member: /^[1-9][0-9]*$/.test(subText),
    siteId: typeof siteId === 'string' && siteId !== '' ? siteId : null,
  }
}

/** SESSION_NOT_FOUND 사유별 고객 안내 문구 */
export function sessionNotFoundMessage(reason: SessionNotFoundReason): string {
  switch (reason) {
    case 'not_found':
      return '저장된 편집 작업을 찾을 수 없습니다. 삭제되었거나 보관 기간이 지난 작업일 수 있습니다.'
    case 'forbidden':
      return '이 계정으로 열 수 없는 편집 작업입니다. 다른 계정으로 만든 작업이거나, 비회원으로 만든 작업은 24시간이 지나 만료되었을 수 있습니다.'
    case 'guest_token_required':
      return '비회원으로 만든 편집 작업입니다. 처음 편집하던 화면이나 주문하신 쇼핑몰에서 다시 열어 주세요.'
    case 'invalid_id':
      return '편집 작업 식별자가 올바르지 않습니다.'
  }
}
