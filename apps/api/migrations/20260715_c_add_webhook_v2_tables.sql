-- =====================================================================
-- 20260715_c_add_webhook_v2_tables.sql
-- 웹훅 v2 테이블 2종 신설 (Stage 2 작업 5 — 신규 파트너 전용 opt-in).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.7·§2.8
-- - 신규 테이블만(additive) — 기존 테이블 컬럼 변경 0.
-- - webhook_configs: 사이트·env별 v2 설정. secret_enc 는 AES-256-GCM at-rest
--   암호화(키 = env WEBHOOK_CONFIG_ENC_KEY, 64자 hex). 해시 보관 불가(서명에
--   원문 필요) — 평문 컬럼 금지 원칙. 응답 노출은 발급/회전 1회뿐.
-- - webhook_deliveries: 발송 이력(delivery store). uid='whd_...' =
--   X-Storige-Delivery 헤더값. payload 는 발송 당시 바이트 스냅샷(재시도 동일 바이트).
-- - ⚠️ 절대 불변: config 행이 없는 사이트(기존 파트너 전원)는 기존 v1(base64)
--   발신 경로 그대로 — 이 테이블 생성만으로는 어떤 발신 동작도 바뀌지 않는다.
--   (v2 활성은 WEBHOOK_CONFIG_ENC_KEY 주입 + 파트너가 v1 API 로 config 등록 시에만)
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 → API 재배포 → nginx 재시작
--    순서 준수 (feedback_schema_change_deploy).
-- 롤백: DROP TABLE IF EXISTS webhook_deliveries; DROP TABLE IF EXISTS webhook_configs;
--       (신규 표면 전용 — 기존 발신 경로 참조 없음. 드롭 시 v1 API webhooks
--        라우트만 500/404 로 죽고 기존 파트너 웹훅은 무영향)
-- =====================================================================

CREATE TABLE IF NOT EXISTS webhook_configs (
  id              VARCHAR(36) PRIMARY KEY,
  site_id         VARCHAR(36) NOT NULL,
  env             ENUM('test','live') NOT NULL DEFAULT 'live',
  url             VARCHAR(500) NOT NULL,
  secret_enc      VARCHAR(256) NOT NULL,               -- AES-256-GCM `v1:<iv>:<tag>:<ct>` (hex)
  secret_prefix   VARCHAR(12) NOT NULL,                -- 표시용 마스킹 (예: 'whsec_ab12cd')
  events          JSON NOT NULL,                       -- 구독 이벤트 배열(빈 배열=전체)
  status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_configs_site_env (site_id, env)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               VARCHAR(36) PRIMARY KEY,
  uid              VARCHAR(40) NOT NULL,               -- 'whd_...' (X-Storige-Delivery 헤더값)
  config_id        VARCHAR(36) NULL,                   -- webhook_configs.id (v1 발신)
  site_id          VARCHAR(36) NOT NULL,
  env              ENUM('test','live') NOT NULL,
  event            VARCHAR(60) NOT NULL,
  is_test          BOOLEAN NOT NULL DEFAULT FALSE,
  payload          MEDIUMTEXT NOT NULL,                -- 발송 당시 바이트 스냅샷
  status           ENUM('PENDING','DELIVERED','RETRYING','EXHAUSTED') NOT NULL DEFAULT 'PENDING',
  attempts         INT NOT NULL DEFAULT 0,
  last_status_code INT NULL,
  last_response    TEXT NULL,                          -- 응답 본문 앞 N자 절삭 저장
  next_retry_at    TIMESTAMP NULL,
  delivered_at     TIMESTAMP NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_deliveries_uid (uid),
  INDEX idx_webhook_deliveries_site (site_id, env, event, created_at),
  INDEX idx_webhook_deliveries_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW COLUMNS FROM webhook_configs LIKE 'secret_enc';
--   SHOW COLUMNS FROM webhook_deliveries LIKE 'next_retry_at';
