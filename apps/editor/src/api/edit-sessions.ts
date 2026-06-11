import { apiClient } from './client'

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
 * Edit Sessions API (bookmoa 연동용)
 */
export const editSessionsApi = {
  /**
   * 편집 세션 생성
   */
  create: async (payload: CreateEditSessionRequest): Promise<EditSessionResponse> => {
    const response = await apiClient.post<EditSessionResponse>('/edit-sessions', payload)
    return response.data
  },

  /**
   * 편집 세션 조회
   */
  get: async (id: string): Promise<EditSessionResponse> => {
    const response = await apiClient.get<EditSessionResponse>(`/edit-sessions/${id}`)
    return response.data
  },

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
   */
  createGuest: async (payload: CreateEditSessionRequest): Promise<EditSessionResponse> => {
    const response = await apiClient.post<EditSessionResponse>('/edit-sessions/guest', {
      ...payload,
      asGuest: true,
    })
    return response.data
  },

  /**
   * 게스트 세션 업데이트 — 토큰 동봉 (쿼리 파라미터로 안전 전송).
   */
  updateGuest: async (
    id: string,
    guestToken: string,
    payload: UpdateEditSessionRequest,
  ): Promise<EditSessionResponse> => {
    const response = await apiClient.patch<EditSessionResponse>(
      `/edit-sessions/guest/${id}?guestToken=${encodeURIComponent(guestToken)}`,
      payload,
    )
    return response.data
  },
}
