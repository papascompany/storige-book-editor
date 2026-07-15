-- =====================================================================
-- 20260715_add_book_specs.sql
-- Partner API v1 Stage 1 — book_specs 판형 마스터 테이블 신설 (additive).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.3
-- 현재 판형 정보가 products/spine(paper_types·binding_types),
-- template_sets.productSpecs(자유입력 width/height), format_presets(저작측
-- 프리셋)에 분산돼 있는 것을 외부 대면 판형 마스터로 정규화 수집한다.
--
-- - 신규 테이블만 생성 — 기존 테이블 컬럼 변경 0 (additive-only).
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
-- - ⚠️ 시드 없음: 초기 행은 수집 스크립트(apps/api/src/book-specs/cli/
--   collect-book-specs.cli.ts) dry-run 산출물을 오너가 검토·승인한 후에만
--   수동 적용한다 (설계서 §9-6 — 자유입력 데이터라 자동 승인 불가).
-- - size_tolerance_mm 기본 1 = 워커 검증 폴백 상수 LEGACY_SIZE_TOLERANCE_MM
--   (apps/worker/src/config/validation.config.ts, 변경 절대 금지)과 정합하는
--   노출용 값. 검증측 로직/상수는 본 트랙에서 무접촉.
-- - FK 제약 없음(컬럼+인덱스만) — 기존 테이블 무접촉 원칙 + 소프트 삭제 정합.
-- - 하드 삭제 금지: is_active 소프트 토글만 사용 (format_presets 관행).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy: 마이그레이션 → API 재배포 → nginx 재시작)
-- =====================================================================

CREATE TABLE IF NOT EXISTS book_specs (
  id                   VARCHAR(36) PRIMARY KEY,
  uid                  VARCHAR(40) NOT NULL,             -- 외부 식별자 'bs_...'
  site_id              VARCHAR(36) NULL,                 -- null=전역 공개 판형
  name                 VARCHAR(100) NOT NULL,            -- 예: 'A4 무선 소프트커버'
  cover_type           VARCHAR(30) NOT NULL,             -- softcover|hardcover|...
  binding_type         VARCHAR(30) NOT NULL,             -- canonical 어휘 승계(가이드 §2.5)
  orientation          ENUM('portrait','landscape') NOT NULL DEFAULT 'portrait',
  inner_trim_width_mm  FLOAT NOT NULL,
  inner_trim_height_mm FLOAT NOT NULL,
  bleed_mm             FLOAT NOT NULL DEFAULT 3,
  size_tolerance_mm    FLOAT NOT NULL DEFAULT 1,         -- 워커 LEGACY_SIZE_TOLERANCE_MM 정합값(노출용 — 검증측 변경 금지)
  page_min             INT NOT NULL,
  page_max             INT NOT NULL,
  page_increment       INT NOT NULL DEFAULT 2,
  spine_formula        JSON NULL,                        -- SpineService 파라미터 참조(용지/제본 계수)
  default_paper_code   VARCHAR(30) NULL,
  template_set_id      VARCHAR(36) NULL,                 -- 기본 templateSet 연결(선택)
  pricing              JSON NULL,                        -- 과금 확정(§9-1) 전 null 운용
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,    -- 소프트 토글(하드 삭제 금지)
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_specs_uid (uid),
  INDEX idx_book_specs_site_active (site_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 적용 확인:
--   SHOW COLUMNS FROM book_specs LIKE 'inner_trim_width_mm';
--   SELECT COUNT(*) FROM book_specs;  -- 시드 전 0 이 정상
