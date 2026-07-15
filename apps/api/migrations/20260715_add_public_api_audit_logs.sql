-- =====================================================================
-- 20260715_add_public_api_audit_logs.sql
-- Partner API v1 호출 감사 로그 테이블 신설 (Stage 1 작업 1).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.9
-- - 신규 테이블만(additive) — 기존 테이블 컬럼 변경 0.
-- - request_id = v1 봉투 requestId 와 동일값(지원 문의 상호 참조 키).
-- - site_id/env 는 인증 실패 시 NULL.
-- - 본문/헤더는 저장하지 않음(PII·시크릿 유입 차단).
-- - api_key_id 는 Stage 2(partner_api_keys) 이후 채움.
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 → API 재배포 → nginx 재시작
--    순서 준수 (feedback_schema_change_deploy).
-- 롤백: DROP TABLE IF EXISTS public_api_audit_logs; (감사 로그 전용 — 참조자 없음)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public_api_audit_logs (
  id            VARCHAR(36) PRIMARY KEY,
  request_id    VARCHAR(40) NOT NULL,                   -- 봉투 requestId 와 동일값
  site_id       VARCHAR(36) NULL,                       -- 인증 실패 시 null
  env           ENUM('test','live') NULL,
  api_key_id    VARCHAR(36) NULL,                       -- partner_api_keys.id (Stage 2 이후)
  method        VARCHAR(8) NOT NULL,
  path          VARCHAR(300) NOT NULL,
  status_code   INT NOT NULL,
  error_code    VARCHAR(60) NULL,
  latency_ms    INT NOT NULL,
  ip            VARCHAR(64) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_site_time (site_id, created_at),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW COLUMNS FROM public_api_audit_logs LIKE 'request_id';
