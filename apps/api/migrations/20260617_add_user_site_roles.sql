-- =====================================================================
-- 20260617_add_user_site_roles.sql
-- P1 멀티테넌시 — 사용자 ↔ 사이트 역할 매핑(다대다 조인).
--
-- 한 계정이 여러 site 를 서로 다른 역할(SITE_ADMIN/SITE_MANAGER)로 운영하게 한다.
-- 전역 관리자(users.role = SUPER_ADMIN | ADMIN)는 이 테이블에 행이 **없어도** 전역 접근
-- (dual-mode — 기존 admin@storige.com 무변경). 사이트 운영자(SITE_ADMIN/SITE_MANAGER)는
-- 여기 매핑된 site 에서만 권한을 가지며 TenantGuard 가 강제한다.
--
-- ✅ ADDITIVE — 신규 테이블만 생성, 기존 users/sites 테이블 미변경(비파괴, 무중단).
-- ⚠️ synchronize=false → 수동 실행 후 API 재배포 순서 준수. (feedback_schema_change_deploy)
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_site_roles (
  id          VARCHAR(36) PRIMARY KEY,
  user_id     VARCHAR(36) NOT NULL,
  site_id     VARCHAR(36) NOT NULL,
  role        VARCHAR(20) NOT NULL,                 -- 'SITE_ADMIN' | 'SITE_MANAGER'
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- 권한상승 방어: 사이트별 역할은 SITE_ADMIN/SITE_MANAGER 만 허용. 전역역할(SUPER_ADMIN/ADMIN)을
  -- 이 테이블에 넣어 site 운영자를 전역화하는 것을 DB 레벨에서 차단(MariaDB 11.2 CHECK enforced).
  CONSTRAINT chk_user_site_roles_role CHECK (role IN ('SITE_ADMIN', 'SITE_MANAGER')),
  UNIQUE KEY uq_user_site (user_id, site_id),       -- 한 user 는 한 site 에서 단일 역할
  KEY idx_user_site_roles_user_id (user_id),
  KEY idx_user_site_roles_site_id (site_id),
  CONSTRAINT fk_user_site_roles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_site_roles_site
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 기존 데이터 영향 없음: 신규 운영자 계정을 만들 때만 행을 추가한다.
-- 기존 admin@storige.com 은 user_site_roles 에 행이 없으므로 전역(dual-mode)으로 동작.
