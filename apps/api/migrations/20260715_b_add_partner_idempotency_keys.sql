-- =====================================================================
-- 20260715_b_add_partner_idempotency_keys.sql
-- Partner API v1 멱등 캐시 테이블 신설 (Stage 1 작업 2).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.2·§4
-- - 신규 테이블만(additive) — 기존 테이블 컬럼 변경 0.
-- - scope UNIQUE (site_id, env, method, path, idempotency_key):
--   INSERT 선점 원자 연산 — 동시 요청/재시도 경쟁에서 이중 실행 차단.
-- - request_hash = SHA-256(canonical body). 동일 키+다른 hash = 422.
-- - response_snapshot: 2xx·결정적 4xx 봉투 전체(5xx 는 행 삭제 — 재시도 허용).
-- - expires_at = created_at + 24h. idx_idem_expires 로 일 1회 sweep cron.
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 → API 재배포 → nginx 재시작
--    순서 준수 (feedback_schema_change_deploy).
-- 롤백: DROP TABLE IF EXISTS partner_idempotency_keys; (캐시 전용 — 참조자 없음.
--       드롭 시 멱등 보호만 사라지고 라우트는 통과 동작)
-- =====================================================================

CREATE TABLE IF NOT EXISTS partner_idempotency_keys (
  id                VARCHAR(36) PRIMARY KEY,
  site_id           VARCHAR(36) NOT NULL,
  env               ENUM('test','live') NOT NULL,
  method            VARCHAR(8) NOT NULL,
  path              VARCHAR(300) NOT NULL,             -- 정규화 경로(경로 파라미터 실값 포함)
  idempotency_key   VARCHAR(128) NOT NULL,             -- 파트너 제공 헤더값
  request_hash      VARCHAR(64) NOT NULL,              -- SHA-256(canonical body)
  status            ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  response_status   INT NULL,                          -- 완료 시 HTTP status
  response_snapshot MEDIUMTEXT NULL,                   -- 완료 시 응답 본문(봉투 전체)
  expires_at        TIMESTAMP NOT NULL,                -- created_at + 24h
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem_scope (site_id, env, method, path, idempotency_key),
  INDEX idx_idem_expires (expires_at)                  -- TTL sweep cron
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW COLUMNS FROM partner_idempotency_keys LIKE 'request_hash';
