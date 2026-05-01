-- ============================================================
-- Migration: 2026-05-01 — products.allowCustomSize 컬럼 추가
-- ============================================================
-- 사유: 옵션 C(외부 쇼핑몰의 width/height URL 파라미터로 사이즈
--      override) 풀스택 구현. 자세한 내용:
--      - docs/BOOKMOA_INTEGRATION_DIFF.md §6-3
--      - apps/api/src/products/entities/product.entity.ts
--
-- 적용 대상: 기존에 init.sql 로 products 테이블이 생성된 환경
--           (production / staging). development 환경은 TypeORM
--           synchronize=true 로 자동 적용되므로 본 SQL 불필요.
--
-- 적용 방법:
--   docker-compose exec mysql mysql -uroot -p storige < \
--     apps/api/migrations/20260501_add_products_allowCustomSize.sql
--   (또는 동일 SQL 을 production DB 에 직접 실행)
--
-- 안전성:
--   • IF NOT EXISTS 로 중복 실행해도 오류 없음 (MariaDB 10.5+)
--   • DEFAULT FALSE 로 기존 모든 상품의 동작은 변경 없음
--   • 컬럼만 추가 — 기존 데이터/제약 수정 없음
--   • 롤백: ALTER TABLE products DROP COLUMN allowCustomSize;
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allowCustomSize BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT '외부 쇼핑몰의 width/height URL 파라미터로 사이즈 override 허용 여부';
