-- ============================================================
-- Migration: 2026-06-09 — TemplateSet 색 처리 모드(B)
-- ============================================================
-- 사유: 상품에 따라 출력 PDF의 색공간을 템플릿셋에서 지정.
--       'rgb'(RGB 유지, 기본=현재 동작) | 'cmyk'(출력 시 CMYK 변환, 인쇄 색 정확도).
--       ※ 워커의 실제 색변환(Ghostscript ColorConversionStrategy/ICC)은 인쇄 출력
--          영향이라 별도(스테이징 검증 후) 적용. 본 마이그레이션은 스키마(의도 저장)만.
--
-- 관련 코드:
--   - packages/types/src/index.ts (ColorOutputMode, TemplateSet/Create/Update Input)
--   - apps/api/src/templates/entities/template-set.entity.ts (color_mode 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (colorMode 검증)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (색 처리 방식 Select)
-- ============================================================

ALTER TABLE `template_sets`
  ADD COLUMN IF NOT EXISTS `color_mode` VARCHAR(10) NOT NULL DEFAULT 'rgb'
  COMMENT '색 처리 모드: rgb | cmyk';
