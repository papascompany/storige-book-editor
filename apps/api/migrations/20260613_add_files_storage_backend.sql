-- =====================================================================
-- 20260613_add_files_storage_backend.sql
-- 파일 저장계층 R2(객체스토리지) 보강 + 보존정책 컬럼 추가.
--
-- 배경: bookmoa·ShareSnap·100p_books 인쇄 백엔드 일원화. 앱-프록시 PDF 경로
--   (/files/upload(/external), /files/:id/download(/external)) 를 STORAGE_DRIVER=s3 시
--   R2 로 저장/서빙하도록 백엔드별 라우팅 + 보존정책(expires_at) 도입.
--
-- ⚠️ 운영 적용 순서 (synchronize=false 이므로 수동):
--   1) 이 마이그레이션을 먼저 실행 (컬럼 추가, 기존 레코드는 storage_backend='local' 자동)
--   2) 그 다음 API 컨테이너 재배포 (신규 코드는 컬럼 존재를 전제)
--   순서 지키면 무중단. (참고: feedback_schema_change_deploy)
--
-- 멱등: IF NOT EXISTS 미지원 MariaDB 버전 대비 — 이미 있으면 ERROR 1060 무시 가능.
-- =====================================================================

ALTER TABLE files
  ADD COLUMN storage_backend VARCHAR(16) NOT NULL DEFAULT 'local' AFTER file_url;

ALTER TABLE files
  ADD COLUMN storage_key VARCHAR(500) NULL AFTER storage_backend;

ALTER TABLE files
  ADD COLUMN expires_at TIMESTAMP NULL AFTER storage_key;

ALTER TABLE files
  ADD INDEX idx_files_expires_at (expires_at);

-- 기존 레코드 백필: 모두 로컬 파일 → storage_backend 는 default 'local' 로 채워짐.
-- storage_key 는 NULL 유지(레거시). getFileBuffer 가 local+NULL 이면 file_path 로 폴백하므로 안전.
