-- ============================================================
-- Migration: 2026-06-09 — TemplateSet PDF 출력 모드(①)
-- ============================================================
-- 사유: 단면/양면 인쇄물의 최종 PDF 생성 방식을 템플릿셋에서 설정.
--       'single'(단면 1p) | 'duplex-merged'(양면 1파일, 앞·뒤·앞·뒤…) |
--       'duplex-split'(앞/뒤 한 세트씩 개별 PDF, 각 2페이지).
--       책(spread) 셋은 기존 compose-mixed(표지+내지 분리) 경로가 우선이며,
--       이 옵션은 단일/낱장 상품 출력에 적용된다.
--
-- 관련 코드:
--   - packages/types/src/index.ts (PdfOutputMode, TemplateSet/Create/Update Input)
--   - apps/api/src/templates/entities/template-set.entity.ts (pdf_output_mode 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (pdfOutputMode 검증)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (PDF 생성 방식 Select)
--
-- 워커 적용: 워커가 이 값을 읽어 split/단일 출력을 분기하는 로직은 별도 적용(인쇄
--            출력 영향 → 스테이징/주문 테스트 후 라이브). 본 마이그레이션은 스키마만 추가.
-- ============================================================

ALTER TABLE `template_sets`
  ADD COLUMN `pdf_output_mode` VARCHAR(20) NOT NULL DEFAULT 'duplex-merged'
  COMMENT 'PDF 출력 모드: single | duplex-merged | duplex-split';
