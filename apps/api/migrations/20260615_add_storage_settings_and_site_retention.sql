-- =====================================================================
-- 20260615_add_storage_settings_and_site_retention.sql
-- admin 관리형 저장계층/보존정책 설정 + 사이트별 보존기간.
--
-- 1) storage_settings (단일행 id=1) — admin UI 에서 저장 백엔드(local|s3=R2) 토글 +
--    R2 키 입력으로 즉시 활성, 보존 cron on/off·관찰모드 관리. DB값이 env 보다 우선.
-- 2) sites.retention_days — 사이트가 업로드한 파일을 N일 후 자동삭제(retention cron).
--
-- ⚠️ synchronize=false → 수동 실행 후 API 재배포 순서 준수. (feedback_schema_change_deploy)
-- =====================================================================

-- 사이트별 보존기간 (null/0 = 영구보관)
ALTER TABLE sites
  ADD COLUMN retention_days INT NULL AFTER status;

-- 저장계층/보존정책 설정 (단일행)
CREATE TABLE IF NOT EXISTS storage_settings (
  id                    INT PRIMARY KEY,
  driver                VARCHAR(16)  NOT NULL DEFAULT 'local',  -- 'local' | 's3'
  s3_endpoint           VARCHAR(500),
  s3_region             VARCHAR(64),
  s3_bucket             VARCHAR(200),
  s3_access_key_id      VARCHAR(200),
  s3_secret_access_key  VARCHAR(500),   -- 시크릿: API 조회 시 마스킹(평문 미반환)
  s3_force_path_style   BOOLEAN NOT NULL DEFAULT TRUE,
  retention_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  retention_dry_run     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 기본 행 시드 (없으면). driver=local → 기존 동작 유지(비파괴).
INSERT INTO storage_settings (id, driver) VALUES (1, 'local')
  ON DUPLICATE KEY UPDATE id = id;
