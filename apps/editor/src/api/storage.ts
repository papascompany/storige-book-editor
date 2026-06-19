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
  // 트랙 B-(c): presigned(R2) 업로드 파일은 nginx `/storage/*`(로컬 전용 alias)로는 표시 404 다.
  // → API 공개 스트리밍 엔드포인트 `/api/files/:id/raw` 로 src 를 빌드해야 >50MB 이미지가 표시된다.
  //   (res.url=`/storage/<key>` 은 더 이상 표시에 쓰지 않는다. fileId 단일출처로 구성.)
  // getDirectBaseUrl() 은 보통 '.../api' 로 끝나므로 그대로 '/files/:id/raw' 를 이어붙인다.
  // useImageStore.uploadVector 등이 url 을 fetch/이미지 src 로 쓰므로 절대 URL 정확성 필수.
  const base = apiClient.getDirectBaseUrl().replace(/\/+$/, '');
  const rawPath = `/files/${res.fileId}/raw`;
  const absUrl = `${base}${rawPath}`;
  return {
    success: true,
    data: {
      id: res.fileId,
      originalName: filename,
      filename,
      path: rawPath,
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
