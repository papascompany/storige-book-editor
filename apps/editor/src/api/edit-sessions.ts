import axios from 'axios'
import { apiClient, type RetryableRequestConfig } from './client'
import { redactGuestTokenInError } from '../utils/redactGuestToken'
import { describeError } from '../utils/safeErrorLog'
import { classifyRequestFailure } from '../utils/embedFailurePolicy'

/** 회원 세션 생성 요청 — 429 일 때만 자동 재시도한다. */
const MEMBER_CREATE_CONFIG: RetryableRequestConfig = { __retryStatuses: [429] }

/** 회원 세션 생성이 408·5xx 로 실패한 뒤 주문 목록 조회로도 세션을 찾지 못했을 때 다시 보내기 전 대기(ms) */
export const MEMBER_CREATE_RESEND_DELAY_MS = 1000

/** 주문 목록 조회로 복구를 시도할 회원 세션 생성 실패 — 408·5xx 응답 */
function isRecoverableCreateFailure(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  const status = err.response?.status
  return typeof status === 'number' && (status === 408 || status >= 500)
}

/** 주문 목록 항목이 이번 생성 요청과 같은 주문·mode·templateSetId 의 회원 세션인지 */
function matchesMemberCreate(s: EditSessionResponse, payload: CreateEditSessionRequest, orderSeqno: number): boolean {
  if (s.guestToken || s.guestExpiresAt != null) return false
  return (
    Number(s.orderSeqno) === orderSeqno &&
    s.mode === payload.mode &&
    (s.templateSetId || null) === (payload.templateSetId || null)
  )
}

/** 게스트 토큰을 싣는 호출 — 실패 오류의 요청 설정에서 토큰 원문을 가린 뒤 같은 오류를 던진다. */
async function withGuestTokenRedacted<T>(guestToken: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    redactGuestTokenInError(err, guestToken)
    throw err
  }
}

/**
 * Edit Session 상태 (bookmoa 연동용)
 */
export type SessionStatus = 'draft' | 'editing' | 'complete'

/**
 * Edit Session 모드
 */
export type SessionMode = 'cover' | 'content' | 'both' | 'template'

/**
 * File 정보 DTO
 */
export interface FileInfoDto {
  id: string
  fileName: string
  originalName: string
  thumbnailUrl?: string | null
  fileSize: number
  mimeType: string
}

/**
 * Edit Session 응답 DTO
 */
export interface EditSessionResponse {
  id: string
  orderSeqno: number
  memberSeqno: number
  status: SessionStatus
  mode: SessionMode
  coverFileId?: string | null
  coverFile?: FileInfoDto | null
  contentFileId?: string | null
  contentFile?: FileInfoDto | null
  templateSetId?: string | null
  canvasData?: any
  metadata?: Record<string, any> | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  // 인쇄 워크플로우 v1 Phase 4 (2026-05-19)
  contentPdfFileId?: string | null
  contentPdfPageCount?: number | null
  contentPdfValidationResult?: Record<string, any> | null
  guestToken?: string | null
  guestExpiresAt?: string | null
}

/**
 * Edit Session 생성 요청 DTO
 */
export interface CreateEditSessionRequest {
  orderSeqno?: number
  mode: SessionMode
  coverFileId?: string
  contentFileId?: string
  templateSetId?: string
  canvasData?: any
  metadata?: Record<string, any>
  /** Worker 완료 시 콜백 URL (bookmoa 웹훅 수신용) */
  callbackUrl?: string
  /** 인쇄 워크플로우 v1 Phase 4 — 게스트 모드 진입 */
  asGuest?: boolean
}

/**
 * Edit Session 업데이트 요청 DTO
 */
export interface UpdateEditSessionRequest {
  status?: SessionStatus
  coverFileId?: string
  contentFileId?: string | null
  templateSetId?: string
  canvasData?: any
  metadata?: Record<string, any>
  // 인쇄 워크플로우 v1 Phase 4 (2026-05-19)
  contentPdfFileId?: string | null
  contentPdfPageCount?: number | null
  contentPdfValidationResult?: Record<string, any> | null
  /** 내지 PDF 첨부 모드 — 표시전용 (2026-06-08): 'replace' | 'underlay' */
  contentPdfMode?: 'replace' | 'underlay' | null
}

/**
 * P1-4 (2026-08-22) — 세션 canvasData 스냅샷(서버 버전 이력) 항목.
 * 서버 `file_edit_session_versions` 의 경량 목록 필드(canvasData 제외).
 *  - reason: autosave(60s debounce 보존) | shrink(페이지 수 감소 직전 즉시 보존) | restore(복원 직전 상태 보존)
 *  - pageCount: 스냅샷에 담긴(=덮어쓰이기 직전) 페이지 수, nextPageCount: 그때 덮어쓴 새 페이지 수
 */
export type EditSessionVersionReason = 'autosave' | 'shrink' | 'restore' | 'staff-baseline'

export interface EditSessionVersionSummary {
  id: string
  createdAt: string
  pageCount: number
  nextPageCount: number | null
  reason: EditSessionVersionReason
  sessionStatus: string | null
}

/**
 * Edit Sessions API (bookmoa 연동용)
 */
export const editSessionsApi = {
  /**
   * 편집 세션 생성
   *
   * 429 일 때만 자동 재시도한다. orderSeqno 가 있는 요청이 408·5xx 로 실패하면 주문별 세션 목록을 한 번
   * 조회해 같은 mode·templateSetId 의 회원 세션이 있으면 그 세션을 돌려주고, 없으면 1초 뒤 한 번만 다시
   * 보낸다. 목록 조회가 401 로 실패하면 그 조회 오류를, 그 밖의 이유로 실패하면 원래 생성 오류를 던진다.
   * 응답이 없는 실패와 그 밖의 응답은 바로 호출측으로 넘긴다.
   */
  create: async (payload: CreateEditSessionRequest): Promise<EditSessionResponse> => {
    try {
      const response = await apiClient.post<EditSessionResponse>('/edit-sessions', payload, MEMBER_CREATE_CONFIG)
      return response.data
    } catch (createErr) {
      const orderSeqno = payload.orderSeqno
      if (typeof orderSeqno !== 'number' || !(orderSeqno > 0) || !isRecoverableCreateFailure(createErr)) {
        throw createErr
      }

      let sessions: EditSessionResponse[]
      try {
        sessions = (await editSessionsApi.findByOrder(orderSeqno)).sessions ?? []
      } catch (lookupErr) {
        console.warn('[editSessionsApi] Order lookup after create failure failed:', describeError(lookupErr))
        // 401 은 인증 만료 처리(리스너 알림·화면 처리)를 따르도록 조회 오류를 그대로 던진다.
        if (classifyRequestFailure(lookupErr).kind === 'auth') throw lookupErr
        throw createErr
      }
      const existing = sessions.find((s) => matchesMemberCreate(s, payload, orderSeqno))
      if (existing) {
        console.log('[editSessionsApi] Using order session found after create failure:', existing.id)
        return existing
      }

      await new Promise<void>((resolve) => setTimeout(resolve, MEMBER_CREATE_RESEND_DELAY_MS))
      const response = await apiClient.post<EditSessionResponse>('/edit-sessions', payload, MEMBER_CREATE_CONFIG)
      return response.data
    }
  },

  /**
   * 편집 세션 조회
   */
  get: async (id: string): Promise<EditSessionResponse> => {
    const response = await apiClient.get<EditSessionResponse>(`/edit-sessions/${id}`)
    return response.data
  },

  /**
   * 게스트 세션 조회 — 게스트 토큰 필수(검증은 updateGuest 대상 PATCH guest/:id 와 동일).
   * 토큰은 `x-guest-token` 헤더로만 보낸다(URL·쿼리에 싣지 않음). 실패 오류의 토큰 원문은 가린다.
   */
  getGuest: async (id: string, guestToken: string): Promise<EditSessionResponse> =>
    withGuestTokenRedacted(guestToken, async () => {
      const response = await apiClient.get<EditSessionResponse>(`/edit-sessions/guest/${id}`, {
        headers: { 'x-guest-token': guestToken },
      })
      return response.data
    }),

  /**
   * 주문별 세션 목록 조회
   */
  findByOrder: async (orderSeqno: number): Promise<{ sessions: EditSessionResponse[]; total: number }> => {
    const response = await apiClient.get<{ sessions: EditSessionResponse[]; total: number }>(
      '/edit-sessions',
      { params: { orderSeqno } }
    )
    return response.data
  },

  /**
   * 편집 세션 업데이트
   */
  update: async (id: string, payload: UpdateEditSessionRequest): Promise<EditSessionResponse> => {
    const response = await apiClient.patch<EditSessionResponse>(`/edit-sessions/${id}`, payload)
    return response.data
  },

  /**
   * 편집 세션 완료 처리
   */
  complete: async (id: string): Promise<EditSessionResponse> => {
    const response = await apiClient.patch<EditSessionResponse>(`/edit-sessions/${id}/complete`, {})
    return response.data
  },

  /**
   * 편집 세션 삭제
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<{ success: boolean }>(`/edit-sessions/${id}`)
    return response.data
  },

  /**
   * 내 세션 목록 조회 (현재 사용자 기준)
   *
   * GET /edit-sessions/my — 서버측 updatedAt DESC 정렬·게스트 세션 제외·200건 캡(findMyRecent).
   * summary=1 은 곧 배포될 경량 응답(canvasData 제외) 요청 — 구 API 가 무시하고
   * full 응답을 반환해도 클라이언트(WorkspaceModal)는 canvasData 를 사용하지 않으므로 양쪽 모두 동작.
   */
  getMySessions: async (): Promise<{ sessions: EditSessionResponse[]; total: number }> => {
    const response = await apiClient.get<{ sessions: EditSessionResponse[]; total: number }>(
      '/edit-sessions/my',
      { params: { summary: 1 } }
    )
    return response.data
  },

  /**
   * 게스트 편집 세션 생성 — 인쇄 워크플로우 v1 Phase 4 (2026-05-19).
   * 응답의 guestToken 을 sessionStorage 에 저장하고 이후 updateGuest 호출 시 토큰 동봉.
   * 클라이언트 기본 재시도(408·429·5xx)를 쓴다 — 응답으로 받은 토큰의 세션을 이어 연다.
   */
  createGuest: async (payload: CreateEditSessionRequest): Promise<EditSessionResponse> => {
    const response = await apiClient.post<EditSessionResponse>('/edit-sessions/guest', {
      ...payload,
      asGuest: true,
    })
    return response.data
  },

  /**
   * P1-4 — 세션 스냅샷 목록(회원: 소유자/staff). 게스트 세션은 listGuestVersions 사용.
   */
  listVersions: async (id: string): Promise<EditSessionVersionSummary[]> => {
    const response = await apiClient.get<EditSessionVersionSummary[]>(`/edit-sessions/${id}/versions`)
    return Array.isArray(response.data) ? response.data : []
  },

  /**
   * P1-4 — 스냅샷 복원(회원). 서버가 복원 직전 현재 상태를 reason='restore' 로 보존한 뒤
   * canvasData 를 교체하고 갱신된 세션(canvasData 포함)을 돌려준다.
   */
  restoreVersion: async (id: string, versionId: string): Promise<EditSessionResponse> => {
    const response = await apiClient.post<EditSessionResponse>(
      `/edit-sessions/${id}/versions/${versionId}/restore`,
      {},
      // 비멱등(매 호출 restore 스냅샷 생성) — 5xx 자동 재시도 금지(10건 캡 안의 옛 시점을 밀어낼 수 있음)
      { __noRetry: true },
    )
    return response.data
  },

  /**
   * P1-4 — 게스트 세션 스냅샷 목록. 토큰은 `x-guest-token` 헤더로만 보낸다(URL·쿼리에 싣지 않음).
   * 실패 오류의 토큰 원문은 가린다.
   */
  listGuestVersions: async (id: string, guestToken: string): Promise<EditSessionVersionSummary[]> =>
    withGuestTokenRedacted(guestToken, async () => {
      const response = await apiClient.get<EditSessionVersionSummary[]>(
        `/edit-sessions/guest/${id}/versions`,
        { headers: { 'x-guest-token': guestToken } },
      )
      return Array.isArray(response.data) ? response.data : []
    }),

  /**
   * P1-4 — 게스트 세션 스냅샷 복원. 응답 세션에는 guestToken 이 없을 수 있으므로 호출측이 보존한다.
   * 토큰은 `x-guest-token` 헤더로만 보낸다(URL·쿼리에 싣지 않음). 실패 오류의 토큰 원문은 가린다.
   */
  restoreGuestVersion: async (
    id: string,
    guestToken: string,
    versionId: string,
  ): Promise<EditSessionResponse> =>
    withGuestTokenRedacted(guestToken, async () => {
      const response = await apiClient.post<EditSessionResponse>(
        `/edit-sessions/guest/${id}/versions/${versionId}/restore`,
        {},
        { __noRetry: true, headers: { 'x-guest-token': guestToken } },
      )
      return response.data
    }),

  /**
   * 게스트 세션 업데이트 — 토큰은 `x-guest-token` 헤더로만 보낸다(URL·쿼리에 싣지 않음).
   * 실패 오류의 토큰 원문은 가린다.
   */
  updateGuest: async (
    id: string,
    guestToken: string,
    payload: UpdateEditSessionRequest,
  ): Promise<EditSessionResponse> =>
    withGuestTokenRedacted(guestToken, async () => {
      const response = await apiClient.patch<EditSessionResponse>(`/edit-sessions/guest/${id}`, payload, {
        headers: { 'x-guest-token': guestToken },
      })
      return response.data
    }),
}
