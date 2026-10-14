/**
 * storage 업로드(레거시·공개) 크기 상한 — 50MB.
 *
 * multer `limits.fileSize`(storage.controller)와 StorageService 재검증이 같은 값을 쓴다.
 * env 로 조정하지 않는다 — 경로별 multer 상한과 항상 같아야 한다.
 */
export const STORAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
