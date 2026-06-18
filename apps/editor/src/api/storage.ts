import { apiClient } from './client';
import type { ApiResponse } from '@storige/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  url: string;
  mimetype: string;
  size: number;
}

export const storageApi = {
  uploadDesign: async (file: File | Blob, filename?: string) => {
    const formData = new FormData();
    formData.append('file', file, filename);

    const response = await apiClient.post<ApiResponse<UploadedFile>>(
      '/storage/upload/designs',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // 임베드 호스트 프록시 우회 → Storige API 직결. 호스트가 base 를 자사 프록시
        // (예: Vercel 4.5MB 본문 한도)로 덮어쓴 경우 대용량 업로드가 413 나는 것을 방지.
        baseURL: apiClient.getDirectBaseUrl(),
      }
    );
    return response.data;
  },

  getDesignUrl: (filename: string) => {
    return `${API_BASE_URL}/storage/designs/${filename}`;
  },

  deleteDesign: async (filename: string) => {
    const response = await apiClient.delete<ApiResponse<void>>(
      `/storage/designs/${filename}`
    );
    return response.data;
  },

  // 일반 파일 업로드 (templates, library, uploads, temp)
  uploadFile: async (
    file: File | Blob,
    category: 'templates' | 'library' | 'uploads' | 'temp' = 'uploads'
  ) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<ApiResponse<UploadedFile>>(
      `/storage/upload?category=${category}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // 임베드 호스트 프록시 우회 → Storige API 직결. 호스트가 base 를 자사 프록시
        // (예: Vercel 4.5MB 본문 한도)로 덮어쓴 경우 대용량 업로드가 413 나는 것을 방지.
        baseURL: apiClient.getDirectBaseUrl(),
      }
    );
    return response.data;
  },

  /**
   * BB-Phase 3 follow-up — 시점 썸네일 업로드.
   * 전용 엔드포인트(/storage/upload/thumbnails) — @Public + 'thumbnails' 카테고리 고정.
   * 호출자: useAutoSaveThumbnail 훅 (TOUCH_ENV에선 호출되지 않음).
   */
  uploadThumbnail: async (file: File | Blob, filename = 'thumb.jpg'): Promise<UploadedFile> => {
    const formData = new FormData();
    formData.append('file', file, filename);
    const response = await apiClient.post<UploadedFile>(
      '/storage/upload/thumbnails',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // 임베드 호스트 프록시 우회 → Storige API 직결. 호스트가 base 를 자사 프록시
        // (예: Vercel 4.5MB 본문 한도)로 덮어쓴 경우 대용량 업로드가 413 나는 것을 방지.
        baseURL: apiClient.getDirectBaseUrl(),
      }
    );
    return response.data;
  },

  getFileUrl: (category: string, filename: string) => {
    return `${API_BASE_URL}/storage/files/${category}/${filename}`;
  },
};
