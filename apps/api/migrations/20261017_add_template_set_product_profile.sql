-- =====================================================================
-- 20261017_add_template_set_product_profile.sql
-- template_sets 상품별 편집 모드 프로파일(product_profile) additive 1컬럼 (P1 캘린더).
--
-- - product_profile(JSON): 상품의 편집 방식을 선언하는 프로파일 한 속성
--   (packages/types/src/product-profile.ts `ProductProfile`, version 1, kind 'sheet'|'calendar').
--   편집기·API·admin 은 `resolveProductProfile()` 결과가 null 이면 기존(legacy) 경로를 그대로 쓴다.
--   NULL = 기존 동작 — 기존 행 전체 NULL 로 비파괴(additive). EditorMode·type 등 기존 컬럼 불변.
-- - 검증: API DTO ProductProfileDto(중첩 class + 교차 필드 검증은 types `validateProductProfile` 단일 출처).
-- - 멱등: ADD COLUMN IF NOT EXISTS (MariaDB) — 재실행 안전.
--
-- 관련 코드:
--   - packages/types/src/product-profile.ts (ProductProfile·validateProductProfile·resolveProductProfile)
--   - packages/types/src/index.ts (TemplateSet/Create/Update Input.productProfile)
--   - apps/api/src/templates/entities/template-set.entity.ts (product_profile 컬럼)
--   - apps/api/src/templates/dto/product-profile.dto.ts (ProductProfileDto 검증)
--   - apps/api/src/templates/template-sets.service.ts (create/copy/deriveOrientation 매핑)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (상품 프로파일 JSON 섹션 + 캘린더 프리셋)
--   - docker/mysql/init.sql (template_sets 블록 동기)
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy)
-- =====================================================================

ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS product_profile JSON NULL
  COMMENT '상품별 편집 모드 프로파일(P1 캘린더, NULL=기존 동작)';

-- 적용 확인:
--   SHOW COLUMNS FROM template_sets LIKE 'product_profile';
--   SELECT id, name, editor_mode, product_profile FROM template_sets WHERE product_profile IS NOT NULL LIMIT 5;
--
-- 롤백: 코드만 되돌린다(새 컬럼은 구 코드가 무시). 컬럼 DROP 은 불필요.
