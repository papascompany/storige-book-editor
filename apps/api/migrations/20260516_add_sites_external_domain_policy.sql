-- ============================================================
-- Migration: 2026-05-16 — sites 외부 도메인 보안 정책 컬럼 추가
-- ============================================================
-- 사유: 외부사이트 플랫폼 연동(Phase 1-1) — 환경변수 기반 CORS / iframe / webhook
--      정책을 DB sites 기반 동적 정책으로 전환. 컬럼은 추가만 하며 기존 컬럼/데이터
--      는 건드리지 않는다 (PHP 영향 0 보장).
--
-- 관련 문서:
--   - docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md
--   - Bookmoa_platform_Plan.md (Phase 1-1)
-- 관련 코드:
--   - apps/api/src/sites/entities/site.entity.ts
--   - apps/api/src/sites/dto/site.dto.ts
--   - apps/api/src/main.ts (Phase 1-2 CORS callback 전환)
--   - apps/api/src/webhook/webhook.service.ts (Phase 1-2 host 검증)
--
-- 적용 대상: 기존 production / staging DB.
--           development 는 TypeORM synchronize=true 로 자동 적용.
--
-- 적용 방법:
--   docker-compose exec mariadb mariadb -uroot -p storige < \
--     apps/api/migrations/20260516_add_sites_external_domain_policy.sql
--
-- 안전성:
--   • IF NOT EXISTS 로 중복 실행 안전 (MariaDB 10.5+)
--   • allowed_origins / frame_ancestors 는 JSON NULL 기본 → 기존 사이트 동작 변경 없음
--     (Phase 1-2 CORS callback 이 NULL 일 때 환경변수/패턴 fallback 처리)
--   • editor_launch_mode 는 'inline' 단일 기본 (Phase 0 결정 D-1)
--   • 롤백:
--       ALTER TABLE sites
--         DROP COLUMN allowed_origins,
--         DROP COLUMN frame_ancestors,
--         DROP COLUMN editor_launch_mode,
--         DROP COLUMN editor_bundle_url,
--         DROP COLUMN editor_css_url,
--         DROP COLUMN editor_version;
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS allowed_origins JSON NULL DEFAULT NULL
    COMMENT 'CORS allowlist (외부 사이트 브라우저 origin 목록). NULL 시 env CORS_ORIGIN + 정적 패턴 fallback',
  ADD COLUMN IF NOT EXISTS frame_ancestors JSON NULL DEFAULT NULL
    COMMENT 'iframe embed parent origin allowlist (CSP frame-ancestors 합성용). NULL 시 self 만',
  ADD COLUMN IF NOT EXISTS editor_launch_mode VARCHAR(20) NOT NULL DEFAULT 'inline'
    COMMENT '편집기 실행 모드 — Phase 0 결정 D-1: inline embed 단일',
  ADD COLUMN IF NOT EXISTS editor_bundle_url VARCHAR(500) NULL DEFAULT NULL
    COMMENT 'Editor IIFE 번들 URL (외부 자체 CDN 호스팅 시)',
  ADD COLUMN IF NOT EXISTS editor_css_url VARCHAR(500) NULL DEFAULT NULL
    COMMENT 'Editor CSS URL',
  ADD COLUMN IF NOT EXISTS editor_version VARCHAR(50) NULL DEFAULT NULL
    COMMENT 'Editor 버전 라벨';

-- 적용 확인 쿼리:
-- SHOW COLUMNS FROM sites WHERE Field IN
--   ('allowed_origins','frame_ancestors','editor_launch_mode',
--    'editor_bundle_url','editor_css_url','editor_version');
