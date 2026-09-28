-- =====================================================================
-- 20260928_add_template_set_pad_to_page_step.sql
-- template_sets 첨부 내지 PDF 빈 페이지 배수 채움(pad_to_page_step) additive 1컬럼.
--
-- - pad_to_page_step: underlay 첨부 내지 PDF 쪽수가 page_step 배수가 아니면 첨부 시
--   인쇄 내지 끝에 빈 페이지를 붙여 배수로 올린다. page_step NULL 이면 무의미.
--   DEFAULT FALSE = 기존 행 전체 비활성(비파괴, additive).
-- - 멱등: ADD COLUMN IF NOT EXISTS (MariaDB) — 재실행 안전.
--
-- 관련 코드:
--   - packages/types/src/index.ts (TemplateSet/Create/Update Input.padToPageStep)
--   - apps/api/src/templates/entities/template-set.entity.ts (pad_to_page_step 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (padToPageStep 검증)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (설정 체크박스)
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
-- =====================================================================

ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS pad_to_page_step BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT '첨부 내지 PDF 쪽수를 page_step 배수로 빈 페이지 채움';

-- 적용 확인:
--   SHOW COLUMNS FROM template_sets LIKE 'pad_to_page_step';
--   SELECT id, name, page_step, pad_to_page_step FROM template_sets LIMIT 5;
