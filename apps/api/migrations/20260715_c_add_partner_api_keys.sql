-- =====================================================================
-- 20260715_c_add_partner_api_keys.sql
-- Partner API v1 파트너 키 테이블 신설 (Stage 2 작업 1·4 — 키 보안 3종).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.1·§7.1~7.2
-- - 신규 테이블만(additive) — 기존 sites.editor_auth_code/worker_auth_code 무접촉.
-- - key_hash = SHA-256(원문) hex, 평문 컬럼 없음 (발급 1회 노출 + prefix 마스킹).
-- - 오버랩 회전: rotate 시 구 키 status='grace' + grace_until = now + 72h.
--   grace 만료분은 배치가 status='revoked' + revoked_at 스탬프.
-- - revoked_at 은 §2.1 DDL 대비 additive 추가 컬럼(폐기 시각 감사용).
-- - env(test|live) 스코프: v1 가드(PartnerApiKeyGuard) 폴백 조회에서만 사용 —
--   공용 ApiKeyGuard 무접촉(v1 키가 기존 external 표면으로 새는 것을 구조 차단).
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 → API 재배포 → nginx 재시작
--    순서 준수 (feedback_schema_change_deploy).
-- 롤백: DROP TABLE IF EXISTS partner_api_keys;
--       (v1 신규 키만 무효화 — sites 키 경로는 영향 없음. 발급분 재발급 필요)
-- =====================================================================

CREATE TABLE IF NOT EXISTS partner_api_keys (
  id             VARCHAR(36) PRIMARY KEY,
  site_id        VARCHAR(36) NOT NULL,                 -- sites.id 참조(논리 — FK 없음)
  env            ENUM('test','live') NOT NULL DEFAULT 'test',
  key_prefix     VARCHAR(16) NOT NULL,                 -- 표시/식별용 (예: 'sk_test_a1b2')
  key_hash       VARCHAR(128) NOT NULL,                -- SHA-256 hex (발급 1회 노출 — 평문 컬럼 없음)
  name           VARCHAR(100) NULL,                    -- 파트너가 붙이는 라벨
  scopes         JSON NULL,                            -- 예: ["books","webhooks"] (null=전체)
  status         ENUM('active','revoked','grace') NOT NULL DEFAULT 'active',
  grace_until    TIMESTAMP NULL,                       -- 오버랩 회전 유예(72h) 만료 시각
  revoked_at     TIMESTAMP NULL,                       -- 폐기 시각 (revoke/grace 만료 배치)
  last_used_at   TIMESTAMP NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_partner_api_keys_hash (key_hash),
  INDEX idx_partner_api_keys_site_env (site_id, env),
  INDEX idx_partner_api_keys_prefix (key_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW COLUMNS FROM partner_api_keys LIKE 'key_hash';
