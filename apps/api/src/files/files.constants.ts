/**
 * files 업로드(PDF) 크기 상한 — 100MB.
 *
 * multer `limits.fileSize`(files.controller upload·upload/external)와 FilesService.uploadFile
 * 재검증이 같은 값을 쓴다. env 로 조정하지 않는다.
 */
export const FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
