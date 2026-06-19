-- =====================================================================
-- 20260619_add_files_presigned_upload.sql
-- R2 presigned 직결 업로드 지원 — files 라이프사이클/멀티파트/크기/소유토큰 컬럼.
--
-- 배경: 대용량 PDF(>50MB)를 브라우저→R2 직결 PUT 으로 업로드. 서버는 presign
--   발급 + HeadObject 검증 + 레코드 등록만 담당. status 로 pending→ready 추적.
--
-- ⚠️ 운영 적용 순서 (synchronize=false 수동):
--   1) 이 마이그레이션 먼저 실행 (기존행 status='ready' 자동 → 무해)
--   2) 그 다음 API 컨테이너 재배포 (신규 코드는 컬럼 존재 전제)
--   (참고: feedback_schema_change_deploy)
--
-- 멱등: MariaDB 11.2 는 ADD COLUMN/INDEX IF NOT EXISTS 지원 → 재실행 안전.
-- =====================================================================

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ready' AFTER storage_key;

-- R2 멀티파트 UploadId 는 길다(실측 ~343자) → varchar(1024). (이미 255로 생성된 환경은 아래 MODIFY 가 정정)
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS multipart_upload_id VARCHAR(1024) NULL AFTER status;
ALTER TABLE files
  MODIFY COLUMN multipart_upload_id VARCHAR(1024) NULL;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS expected_size BIGINT NULL AFTER multipart_upload_id;

-- 업로드 세션 소유 토큰(IDOR 차단) — presign 발급 시 서버생성, ready/failed 시 NULL.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS upload_token VARCHAR(64) NULL AFTER expected_size;

ALTER TABLE files
  ADD INDEX IF NOT EXISTS idx_files_status (status);

-- 기존 레코드 백필: status 는 default 'ready' 로 채워짐 → 기존 다운로드/검증 동작 불변.
