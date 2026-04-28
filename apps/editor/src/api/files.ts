import { apiClient } from './client'

/**
 * 파일 타입 (백엔드 FileType enum과 일치)
 * apps/api/src/files/entities/file.entity.ts:11
 */
export type FileType = 'cover' | 'content' | 'template' | 'other'

/**
 * 파일 응답 DTO
 */
export interface FileResponse {
  id: string
  fileName: string
  originalName: string
  filePath: string
  mimeType: string
  fileSize: number
  fileType: FileType
  status: 'uploaded' | 'validated' | 'processed' | 'failed'
  orderSeqno?: number
  memberSeqno?: number
  thumbnailUrl?: string
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
}

/**
 * 파일 업로드 요청
 */
export interface UploadFileRequest {
  file: Blob
  type: FileType
  orderSeqno?: number
  memberSeqno?: number
  metadata?: Record<string, any>
}

/**
 * Files API
 */
export const filesApi = {
  /**
   * PDF 파일 업로드
   */
  upload: async (request: UploadFileRequest): Promise<FileResponse> => {
    const formData = new FormData()
    formData.append('file', request.file, `${request.type}.pdf`)
    formData.append('type', request.type)

    if (request.orderSeqno) {
      formData.append('orderSeqno', String(request.orderSeqno))
    }
    if (request.memberSeqno) {
      formData.append('memberSeqno', String(request.memberSeqno))
    }
    if (request.metadata) {
      formData.append('metadata', JSON.stringify(request.metadata))
    }

    const response = await apiClient.post<FileResponse>('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },

  /**
   * 파일 정보 조회
   */
  get: async (id: string): Promise<FileResponse> => {
    const response = await apiClient.get<FileResponse>(`/files/${id}`)
    return response.data
  },

  /**
   * 파일 삭제
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<{ success: boolean }>(`/files/${id}`)
    return response.data
  },
}
