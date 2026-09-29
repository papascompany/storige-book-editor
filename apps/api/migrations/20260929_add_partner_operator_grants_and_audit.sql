-- =====================================================================
-- 20260929_add_partner_operator_grants_and_audit.sql
-- 운영자 대리 편집(Partner Operator Grant) — 권한 행 + 감사 기록 (ADDITIVE).
--
-- 정본: apps/api/src/auth/entities/partner-operator-grant.entity.ts
--       apps/api/src/auth/entities/partner-operator-audit-log.entity.ts
--       apps/api/src/auth/partner-operator/partner-operator-grant.service.ts
--
-- 배경: 파트너 관리자 화면의 '편집 열기'(운영자 재편집)가 고객 세션을 운영자 본인 회원 토큰으로
--   열어 owner 불일치(SESSION_NOT_FOUND forbidden)로 중단됐다. 파트너 서버가 사이트 키로
--   단기·세션 범위 한정·취소 가능한 운영자 토큰을 발급받도록 한다
--   (POST /auth/partner-operator-session, revoke, audit).
--
-- 변경 범위: **새 테이블 2개만 추가**. 기존 테이블은 변경하지 않는다.
--   - partner_operator_grants     : 발급된 운영자 권한(사이트·운영자·세션 범위·만료·취소·키 지문)
--   - partner_operator_audit_logs : append-only 감사 기록(발급·취소·상태 변경·운영자 요청)
--   FK 는 의도적으로 두지 않는다 — 감사 기록은 세션 삭제(soft)·비회원 세션 24h 퍼지(hard DELETE)
--   이후에도 남아야 한다.
--
-- ⚠️ 운영 적용 순서 (synchronize=false 이므로 수동):
--   1) 이 마이그레이션을 먼저 실행
--   2) 그 다음 API 컨테이너 재배포
--   미적용 상태로 배포하면 발급(POST /auth/partner-operator-session)만 503
--   PARTNER_OPERATOR_UNAVAILABLE 을 반환하고, 그 외 기존 흐름은 아무것도 바뀌지 않는다.
--
-- 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
-- 롤백: DROP TABLE partner_operator_audit_logs; DROP TABLE partner_operator_grants;
--   ⚠️ 롤백하면 감사 기록이 사라진다(권장하지 않음 — 코드만 되돌리면 테이블은 비활성으로 남는다).
-- =====================================================================

CREATE TABLE IF NOT EXISTS partner_operator_grants (
  id                         VARCHAR(36)  NOT NULL,
  site_id                    VARCHAR(36)  NOT NULL,
  operator_id                VARCHAR(128) NOT NULL,
  operator_name              VARCHAR(100) NULL,
  session_ids                JSON         NOT NULL,
  capabilities               VARCHAR(64)  NOT NULL DEFAULT 'edit',
  order_ref                  VARCHAR(100) NULL,
  reason                     VARCHAR(200) NULL,
  on_behalf_of_member_seqno  BIGINT       NULL,
  key_fp                     CHAR(16)     NOT NULL,
  expires_at_unix            BIGINT       NOT NULL,
  revoked_at                 DATETIME     NULL,
  created_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pog_site_created (site_id, created_at),
  INDEX idx_pog_site_revoked (site_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_operator_audit_logs (
  id             VARCHAR(36)  NOT NULL,
  grant_id       VARCHAR(36)  NOT NULL,
  site_id        VARCHAR(36)  NOT NULL,
  session_id     VARCHAR(36)  NULL,
  operator_id    VARCHAR(128) NOT NULL,
  operator_name  VARCHAR(100) NULL,
  action         VARCHAR(40)  NOT NULL,
  method         VARCHAR(8)   NULL,
  route          VARCHAR(200) NULL,
  status_code    INT          NULL,
  detail         JSON         NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_poal_site_created (site_id, created_at),
  INDEX idx_poal_session_created (session_id, created_at),
  INDEX idx_poal_grant (grant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW TABLES LIKE 'partner_operator_grants';
--   SHOW TABLES LIKE 'partner_operator_audit_logs';
--   SELECT COUNT(*) FROM partner_operator_grants;      -- 0 정상
--   SELECT COUNT(*) FROM partner_operator_audit_logs;  -- 0 정상
