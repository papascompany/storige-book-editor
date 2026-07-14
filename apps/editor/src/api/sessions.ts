import { apiClient } from './client'
import type {
  EditSession,
  EditPage,
  EditStatus,
  CanvasData,
  PaginatedResponse,
} from '@storige/types'

/**
 * 세션 생성 요청 (새 세션 API용)
 */
export interface CreateSessionRequest {
  templateSetId: string
  orderId?: string
  userId?: string
}

/**
 * 세션 업데이트 요청 (새 세션 API용)
 */
export interface UpdateSessionRequest {
  pages?: EditPage[]
  status?: EditStatus
}

/**
 * 자동저장 요청
 */
export interface AutoSavePayload {
  pages?: EditPage[]
  currentPageIndex?: number
  /** BB-Phase 3 follow-up — 시점 스냅샷 썸네일 URL (없으면 null/생략) */
  thumbnailUrl?: string | null
}

/**
 * 페이지 추가 요청
 */
export interface AddPagePayload {
  position?: number
}

/**
 * 페이지 순서 변경 요청
 */
export interface ReorderPagesPayload {
  pageIds: string[]
}

/**
 * 상태 변경 요청
 */
export interface ChangeStatusPayload {
  status: 'draft' | 'review' | 'submitted'
  comment?: string
}

/**
 * 잠금 획득 요청
 */
export interface AcquireLockPayload {
  userId: string
}

/**
 * 템플릿 교체 요청
 */
export interface ReplaceTemplatePayload {
  newTemplateId: string
  pageId?: string
}

/**
 * 템플릿셋 교체 요청
 */
export interface ReplaceTemplateSetPayload {
  newTemplateSetId: string
}

/**
 * 세션 검증 결과 — GET /editor/sessions/:id/validate 응답 실물.
 *
 * ⚠️ 워커 PDF 검증 결과가 아니다. 이 엔드포인트는 API 의
 * editorService.validateSession(세션 구성 검증: 필수 페이지·내지 수량)이
 * `{valid, errors, warnings}` 를 그대로 반환한다(런타임 일치 확인, S-1 2026-07-15).
 * 워커 PDF 검증 결과의 정본 타입은 @storige/types 의
 * `WorkerValidationResult`({isValid, metadata}) — 혼동 금지.
 */
export interface ValidationResult {
  valid: boolean
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
}

/**
 * 세션 조회 쿼리
 */
export interface SessionQueryParams {
  userId?: string
  orderId?: string
  status?: EditStatus
  page?: number
  pageSize?: number
}

/**
 * 편집 세션 API
 */
export const sessionsApi = {
  /**
   * 세션 생성
   */
  create: async (payload: CreateSessionRequest): Promise<EditSession> => {
    const response = await apiClient.post<EditSession>('/editor/sessions', payload)
    return response.data
  },

  /**
   * 세션 목록 조회
   */
  list: async (params?: SessionQueryParams): Promise<PaginatedResponse<EditSession>> => {
    const response = await apiClient.get<PaginatedResponse<EditSession>>(
      '/editor/sessions',
      { params }
    )
    return response.data
  },

  /**
   * 세션 상세 조회
   */
  get: async (id: string): Promise<EditSession> => {
    const response = await apiClient.get<EditSession>(`/editor/sessions/${id}`)
    return response.data
  },

  /**
   * 세션 업데이트
   */
  update: async (
    id: string,
    payload: UpdateSessionRequest,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.put<EditSession>(
      `/editor/sessions/${id}`,
      payload,
      { headers }
    )
    return response.data
  },

  /**
   * 세션 삭제
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/editor/sessions/${id}`)
  },

  /**
   * 자동저장
   */
  autoSave: async (
    id: string,
    payload: AutoSavePayload,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.post<EditSession>(
      `/editor/sessions/${id}/auto-save`,
      payload,
      { headers }
    )
    return response.data
  },

  // BB-Phase 3 ─ 자동저장 시점 versions
  listVersions: async (
    id: string,
    userId?: string
  ): Promise<Array<{
    id: string
    savedAt: string
    pageCount: number
    createdBy: string | null
    thumbnailUrl: string | null
  }>> => {
    const headers: Record<string, string> = {}
    if (userId) headers['X-User-Id'] = userId
    const response = await apiClient.get(`/editor/sessions/${id}/versions`, { headers })
    return response.data
  },

  getVersion: async (
    id: string,
    versionId: string,
    userId?: string
  ): Promise<{ id: string; savedAt: string; pages: any[]; pageCount: number }> => {
    const headers: Record<string, string> = {}
    if (userId) headers['X-User-Id'] = userId
    const response = await apiClient.get(
      `/editor/sessions/${id}/versions/${versionId}`,
      { headers }
    )
    return response.data
  },

  restoreVersion: async (
    id: string,
    versionId: string,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) headers['X-User-Id'] = userId
    const response = await apiClient.post<EditSession>(
      `/editor/sessions/${id}/versions/${versionId}/restore`,
      {},
      { headers }
    )
    return response.data
  },

  /**
   * 페이지 추가
   */
  addPage: async (
    id: string,
    payload?: AddPagePayload,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.post<EditSession>(
      `/editor/sessions/${id}/pages`,
      payload || {},
      { headers }
    )
    return response.data
  },

  /**
   * 페이지 삭제
   */
  deletePage: async (
    id: string,
    pageId: string,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.delete<EditSession>(
      `/editor/sessions/${id}/pages/${pageId}`,
      { headers }
    )
    return response.data
  },

  /**
   * 페이지 순서 변경
   */
  reorderPages: async (
    id: string,
    payload: ReorderPagesPayload,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.put<EditSession>(
      `/editor/sessions/${id}/pages/reorder`,
      payload,
      { headers }
    )
    return response.data
  },

  /**
   * 잠금 획득
   */
  acquireLock: async (id: string, payload: AcquireLockPayload): Promise<EditSession> => {
    const response = await apiClient.post<EditSession>(
      `/editor/sessions/${id}/lock`,
      payload
    )
    return response.data
  },

  /**
   * 잠금 해제
   */
  releaseLock: async (id: string, userId: string): Promise<EditSession> => {
    const response = await apiClient.delete<EditSession>(
      `/editor/sessions/${id}/lock`,
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  /**
   * 상태 변경
   */
  changeStatus: async (
    id: string,
    payload: ChangeStatusPayload,
    userId: string
  ): Promise<EditSession> => {
    const response = await apiClient.put<EditSession>(
      `/editor/sessions/${id}/status`,
      payload,
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  /**
   * 이력 조회
   */
  getHistory: async (id: string): Promise<any[]> => {
    const response = await apiClient.get<any[]>(`/editor/sessions/${id}/history`)
    return response.data
  },

  /**
   * PDF 내보내기
   */
  exportPdf: async (
    sessionId: string,
    exportOptions?: any
  ): Promise<{ jobId: string }> => {
    const response = await apiClient.post<{ jobId: string }>('/editor/export', {
      sessionId,
      exportOptions,
    })
    return response.data
  },

  /**
   * 템플릿 교체 (사용자 요소 보존)
   */
  replaceTemplate: async (
    id: string,
    payload: ReplaceTemplatePayload,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.put<EditSession>(
      `/editor/sessions/${id}/template`,
      payload,
      { headers }
    )
    return response.data
  },

  /**
   * 템플릿셋 교체 (사용자 요소 보존)
   */
  replaceTemplateSet: async (
    id: string,
    payload: ReplaceTemplateSetPayload,
    userId?: string
  ): Promise<EditSession> => {
    const headers: Record<string, string> = {}
    if (userId) {
      headers['X-User-Id'] = userId
    }
    const response = await apiClient.put<EditSession>(
      `/editor/sessions/${id}/template-set`,
      payload,
      { headers }
    )
    return response.data
  },

  /**
   * 세션 검증
   */
  validate: async (id: string): Promise<ValidationResult> => {
    const response = await apiClient.get<ValidationResult>(
      `/editor/sessions/${id}/validate`
    )
    return response.data
  },
}

// 레거시 호환을 위한 editorApi export
export { sessionsApi as editorSessionsApi }
