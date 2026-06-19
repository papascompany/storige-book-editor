import { apiClient } from './client';
import type { ApiResponse } from '@storige/types';
import { uploadViaPresigned, PresignedNotConfiguredError } from './presigned-upload';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

/** 이 크기 초과면 presigned 직결 폴백(이하는 기존 /storage/upload multer). multer 캡과 정렬. */
const PRESIGNED_THRESHOLD = 50 * 1024 * 1024; // 50MB

interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  url: string;
  mimetype: string;
  size: number;
}

/** presigned 완료 결과를 기존 UploadedFile(ApiResponse) 형태로 정규화. */
function toUploadedFileResponse(
  res: { fileId: string; url: string },
  file: File | Blob,
  filename: string,
): ApiResponse<UploadedFile> {
  // fileUrl 은 '/storage/...' 상대경로 → 직결 base 의 '/api' 접미 제거한 오리진으로 절대화.
  // (/storage/* 는 nginx 가 R2 프록시 — 앱 프록시 경로만 전환, /storage/* 는 불변)
  // useImageStore.uploadVector 가 url 을 fetch 하므로 절대 URL 정확성 필수.
  const absUrl = res.url.startsWith('http')
    ? res.url
    : `${apiClient.getDirectBaseUrl().replace(/\/api$/, '')}${res.url}`;
  return {
    success: true,
    data: {
      id: res.fileId,
      originalName: filename,
      filename,
      path: res.url,
      url: absUrl,
      mimetype: (file as File).type || 'application/octet-stream',
      size: (file as { size?: number }).size ?? 0,
    },
  } as ApiResponse<UploadedFile>;
}

export const storageApi = {
  uploadDesign: async (file: File | Blob, filename?: string) => {
    const size = (file as { size?: number }).size ?? 0;
    const name = filename ?? (file as File).name ?? 'design';

    // ── 대용량(>50MB): presigned 직결 (multer 50MB 캡 우회, 최대 2GB) ──
    // 디자인은 PDF/이미지 — uploadViaPresigned 가 file.type 으로 contentType 자동결정.
    if (size > PRESIGNED_THRESHOLD && file instanceof File) {
      try {
        const res = await uploadViaPresigned(file, { isPublic: true, type: 'content' });
        return toUploadedFileResponse(res, file, name);
      } catch (e) {
        // 서버가 s3 드라이버 아님(503) → 기존 multer 경로로 폴백(>50MB 면 거기서 413, 의도된 한계).
        if (!(e instanceof PresignedNotConfiguredError)) throw e;
      }
    }

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
    const size = (file as { size?: number }).size ?? 0;
    const name = (file as File).name ?? 'upload';

    // ── 대용량(>50MB): presigned 직결 (multer 50MB 캡 우회, 최대 2GB) ──
    if (size > PRESIGNED_THRESHOLD && file instanceof File) {
      try {
        const res = await uploadViaPresigned(file, { isPublic: true, type: 'content' });
        return toUploadedFileResponse(res, file, name);
      } catch (e) {
        // 서버가 s3 드라이버 아님(503) → 기존 multer 경로로 폴백(>50MB 면 거기서 413, 의도된 한계).
        if (!(e instanceof PresignedNotConfiguredError)) throw e;
      }
    }

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
