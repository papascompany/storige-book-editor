/**
 * 명시 sessionId 세션 재오픈 공용 유틸 — embed.tsx(EmbeddedEditor), EmbedView(templateSetId 도출),
 * EditorWorkflowControls(첨부 배지)가 같은 조회 순서와 실패 사유 매핑을 쓴다.
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
import { forgetEmbedGuestToken, hasExpiredEmbedGuestToken } from './embedGuestTokenStore'
import { redactGuestTokenInError } from './redactGuestToken'

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

export { redactGuestTokenInError }

/** 응답 본문의 `code` 문자열(없으면 null) */
export function apiErrorCodeOf(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null
  const data: unknown = err.response?.data
  if (data !== null && typeof data === 'object') {
    const code = (data as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return null
}

/** HTTP 상태(응답이 없으면 undefined). 정규화된 오류 객체({ status })도 받는다. */
export function httpStatusOf(err: unknown): number | undefined {
  if (axios.isAxiosError(err)) return err.response?.status
  if (err !== null && typeof err === 'object') {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

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
