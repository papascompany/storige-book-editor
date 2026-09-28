-- =====================================================================
-- 20260928_add_template_set_page_step.sql
-- template_sets 내지 페이지 증감 단위(page_step) additive 1컬럼 (S8).
--
-- - page_step: 물리 내지 페이지 수가 이 값의 배수여야 함(예: 2 = 짝수 페이지만).
--   에디터가 이 단위로 내지를 추가/삭제하고, 배수가 아니면 편집 완료를 차단.
--   NULL = 제약 없음(기존 1장 단위 동작) — 기존 행 전체 NULL 로 비파괴(additive).
-- - 검증: API DTO @IsInt @Min(1) (null 허용).
-- - 멱등: ADD COLUMN IF NOT EXISTS (MariaDB) — 재실행 안전.
--
-- 관련 코드:
--   - packages/types/src/index.ts (TemplateSet/Create/Update Input.pageStep)
--   - apps/api/src/templates/entities/template-set.entity.ts (page_step 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (pageStep 검증)
--   - apps/editor/src/stores/useEditorStore.ts (단위 추가/삭제 + 완료 차단)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (내지 증감 단위 입력)
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy)
-- =====================================================================

ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS page_step INT NULL
  COMMENT '내지 페이지 증감 단위(배수 제약). NULL=제약 없음';

-- 적용 확인:
--   SHOW COLUMNS FROM template_sets LIKE 'page_step';
--   SELECT id, name, page_count_range, page_step FROM template_sets LIMIT 5;
