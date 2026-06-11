import { axiosInstance } from '../lib/axios';

export type SessionStatus = 'draft' | 'completed';
export type SessionMode = 'upload' | 'editor';

export interface FileInfo {
  id: string;
  fileName: string;
  originalName: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  mimeType: string;
}

export interface EditSessionResponse {
  id: string;
  orderSeqno: number;
  memberSeqno: number;
  status: SessionStatus;
  mode: SessionMode;
  coverFileId?: string | null;
  coverFile?: FileInfo | null;
  contentFileId?: string | null;
  contentFile?: FileInfo | null;
  templateSetId?: string | null;
  canvasData?: any;
  metadata?: Record<string, any> | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Phase C-2 — 사이트 컨텍스트 (자동 주입)
  siteId?: string | null;
  // 삭제 리스트 (2026-06-11) — GET /edit-sessions/deleted 응답 전용
  deletedAt?: string | null;
  templateSetName?: string | null;
  thumbnailUrl?: string | null;
}

export interface EditSessionListResponse {
  sessions: EditSessionResponse[];
  total: number;
}

export interface EditSessionQueryParams {
  orderSeqno?: number;
  memberSeqno?: number;
  status?: SessionStatus;
  /** Phase C-3 — 사이트별 필터 */
  siteId?: string;
  page?: number;
  limit?: number;
}

export const editSessionsApi = {
  getAll: async (params?: EditSessionQueryParams): Promise<EditSessionListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.orderSeqno) searchParams.append('orderSeqno', String(params.orderSeqno));
    if (params?.memberSeqno) searchParams.append('memberSeqno', String(params.memberSeqno));
    if (params?.siteId) searchParams.append('siteId', params.siteId); // Phase C-3
    const response = await axiosInstance.get<EditSessionListResponse>(
      `/edit-sessions?${searchParams.toString()}`
    );
    return response.data;
  },

  getById: async (id: string): Promise<EditSessionResponse> => {
    const response = await axiosInstance.get<EditSessionResponse>(`/edit-sessions/${id}`);
    return response.data;
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await axiosInstance.delete<{ success: boolean }>(`/edit-sessions/${id}`);
    return response.data;
  },

  complete: async (id: string): Promise<EditSessionResponse> => {
    const response = await axiosInstance.patch<EditSessionResponse>(`/edit-sessions/${id}/complete`);
    return response.data;
  },

  /** 삭제 리스트 (2026-06-11) — 고객이 삭제(soft delete)한 세션 누적 조회 (admin 전용) */
  getDeleted: async (
    params?: EditSessionQueryParams
  ): Promise<EditSessionListResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.orderSeqno) searchParams.append('orderSeqno', String(params.orderSeqno));
    if (params?.memberSeqno) searchParams.append('memberSeqno', String(params.memberSeqno));
    if (params?.siteId) searchParams.append('siteId', params.siteId);
    if (params?.page) searchParams.append('page', String(params.page));
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const response = await axiosInstance.get<EditSessionListResponse>(
      `/edit-sessions/deleted?${searchParams.toString()}`
    );
    return response.data;
  },

  /** 삭제된 세션 복구 (admin 전용, 멱등) — 고객 실수 삭제 복원 요구 대응 */
  restore: async (id: string): Promise<EditSessionResponse> => {
    const response = await axiosInstance.post<EditSessionResponse>(`/edit-sessions/${id}/restore`);
    return response.data;
  },
};
