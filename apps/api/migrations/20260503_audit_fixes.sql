-- ============================================================================
-- 2026-05-03 통합 검증 감사 결함 수정 마이그레이션
-- ============================================================================
-- 결함 #1: Product Entity에 Bookmoa-style 컬럼 추가 (code, categoryId, price)
-- 결함 #2: library_categories.type enum에 'font' 추가
-- 결함 #10: 옛 worker_jobs FAILED 잡 정리 (옵션, 별도 실행)
--
-- 실행 방법 (VPS):
--   ssh deploy@158.247.235.202
--   cd ~/storige
--   docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige < apps/api/migrations/20260503_audit_fixes.sql
--
-- 또는 docker compose 환경변수 사용:
--   source ~/storige/.env
--   docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
--     < apps/api/migrations/20260503_audit_fixes.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Patch #1: Product 테이블에 Bookmoa-style 컬럼 추가 (호환성 유지)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS code VARCHAR(100) NULL COMMENT 'Bookmoa 상품 코드 (예: BOOK-A4-20P)',
  ADD COLUMN IF NOT EXISTS category_id VARCHAR(36) NULL COMMENT 'Bookmoa 카테고리 ID',
  ADD COLUMN IF NOT EXISTS price INT NULL COMMENT '가격(원)';

-- 코드 검색 최적화 인덱스
ALTER TABLE products
  ADD INDEX IF NOT EXISTS idx_products_code (code),
  ADD INDEX IF NOT EXISTS idx_products_category_id (category_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Patch #2: library_categories.type을 enum/varchar 그대로 유지 (TypeORM이 코드에서 검증)
-- 별도 SQL 변경 불필요 — DTO/Entity의 TypeScript type만 'font' 추가
-- 단, 기존 데이터가 있을 경우 유효성 검증을 위한 노트:
-- 현재 type 컬럼: VARCHAR(20) — 'font' 5글자라 길이 충분
-- ─────────────────────────────────────────────────────────────────────────
-- (no-op for SQL — TypeScript enum extension covers it)

-- ─────────────────────────────────────────────────────────────────────────
-- Patch #10: 옛 worker_jobs FAILED 잡 정리 (옵션, 운영자가 선택적 실행)
-- 본 마이그레이션엔 미포함. 별도로 cleanup-old-jobs.sql 사용:
--   DELETE FROM worker_jobs
--   WHERE status = 'FAILED'
--     AND created_at < '2026-05-01'
--     AND result IS NULL;  -- 성공 결과 없는 옛 실패 잡만
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 검증 쿼리 (실행 후 결과 확인)
-- ─────────────────────────────────────────────────────────────────────────
-- SHOW COLUMNS FROM products LIKE 'code';
-- SHOW COLUMNS FROM products LIKE 'category_id';
-- SHOW COLUMNS FROM products LIKE 'price';
-- SELECT COUNT(*) AS old_failed_jobs FROM worker_jobs WHERE status = 'FAILED' AND created_at < '2026-05-01';
