-- =====================================================================
-- 20260930_add_edit_retention_and_staff_grant_origin.sql
-- Storige 관리자 편집데이터 관리 — 사이트별 편집데이터 보관기간 + 관리자 발급 편집 권한/감사 구분 (ADDITIVE).
--
-- 선행 조건: 20260929_add_partner_operator_grants_and_audit.sql 이 먼저 적용되어 있어야 한다.
-- 변경:
--   1) sites.edit_retention_days INT NULL — NULL = 미설정(기한 제한 없음·현행 동작). 기존 retention_days(업로드 파일 만료)와 별개.
--   2) partner_operator_grants: origin('partner'|'staff', 기본 'partner'), issued_by_user_id, key_fp NULL 허용(관리자 발급분은 키 지문 없음).
--   3) partner_operator_audit_logs: origin, actor_user_id 추가, grant_id·site_id NULL 허용(관리자 직접 작업·사이트 설정 변경).
--   기존 행은 모두 origin='partner' 로 채워져 파트너 동작 불변. 삭제·데이터 변경 없음.
-- 운영 적용 순서: 20260929 → 이 파일 → (master push: 편집기·admin) → API 재생성 + nginx 재시작.
-- 멱등: ADD COLUMN IF NOT EXISTS / MODIFY / CREATE INDEX IF NOT EXISTS (재실행 안전). MariaDB 10.5+ (운영 11.2 가정).
-- 콜레이션: MODIFY 대상 컬럼은 테이블 기본(utf8mb4_unicode_ci)을 그대로 따른다(20260929 DDL 과 동일).
-- 롤백: 코드만 되돌린다(새 컬럼은 구 코드가 무시). 스키마·감사 행은 삭제하지 않는다.
-- =====================================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS edit_retention_days INT NULL
    COMMENT '편집데이터 보관기간(일). NULL=미설정. 세션 created_at 기준. 만료 후 자동삭제 없음'
    AFTER retention_days;

ALTER TABLE partner_operator_grants
  ADD COLUMN IF NOT EXISTS origin VARCHAR(16) NOT NULL DEFAULT 'partner' AFTER site_id,
  ADD COLUMN IF NOT EXISTS issued_by_user_id VARCHAR(36) NULL AFTER origin,
  MODIFY COLUMN key_fp CHAR(16) NULL;

ALTER TABLE partner_operator_audit_logs
  ADD COLUMN IF NOT EXISTS origin VARCHAR(16) NOT NULL DEFAULT 'partner' AFTER grant_id,
  ADD COLUMN IF NOT EXISTS actor_user_id VARCHAR(36) NULL AFTER operator_name,
  MODIFY COLUMN grant_id VARCHAR(36) NULL,
  MODIFY COLUMN site_id VARCHAR(36) NULL;

CREATE INDEX IF NOT EXISTS idx_pog_origin_site ON partner_operator_grants (origin, site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_poal_origin_site_created ON partner_operator_audit_logs (origin, site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_poal_actor_created ON partner_operator_audit_logs (actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_poal_origin_session_action ON partner_operator_audit_logs (origin, session_id, action, created_at);

-- 적용 확인(읽기 전용):
--   SHOW COLUMNS FROM sites LIKE 'edit_retention_days';                  -- 1행, Null=YES
--   SELECT COUNT(*) FROM sites WHERE edit_retention_days IS NOT NULL;     -- 0 정상(기본 미설정)
--   SHOW COLUMNS FROM partner_operator_grants LIKE 'origin';
--   SHOW COLUMNS FROM partner_operator_grants LIKE 'key_fp';              -- Null=YES
--   SHOW COLUMNS FROM partner_operator_audit_logs LIKE 'actor_user_id';
--   SHOW COLUMNS FROM partner_operator_audit_logs LIKE 'grant_id';        -- Null=YES
--   SELECT origin, COUNT(*) FROM partner_operator_grants GROUP BY origin;  -- 'partner' 만(또는 0행)
--   -- 배포 전 참고(읽기 전용): 업로드 파일 자동삭제가 켜진 사이트 — 완료 세션 파일 만료 가능 대상
--   SELECT id, name, retention_days FROM sites WHERE retention_days IS NOT NULL;
--
-- 롤백 정책: 스키마·행을 지우지 않는다. 이전 API 이미지로 되돌리면 새 컬럼은 무시되고
--   staff 권한 토큰은 구 코드(또는 권한 기능 없는 이전 이미지)에서 401 로 실패(fail-closed)한다.
--   스키마 원복이 꼭 필요하면 오너 승인 + 두 테이블 사전 export 후 별도 스크립트로만 수행한다.
