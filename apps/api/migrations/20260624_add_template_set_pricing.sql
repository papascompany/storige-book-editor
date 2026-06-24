-- ============================================================
-- Migration: 2026-06-24 — TemplateSet 포토북 페이지 가변 가격 메타 (Phase 2)
-- ============================================================
-- 사유: 포토북(PHOTOBOOK)은 페이지 수가 가변이며, 추가 페이지에 단가가 붙는다.
--       storige 는 가격을 계산하지 않는다 — 이 메타를 템플릿셋에 저장하고,
--       편집기가 편집완료 시 현재 총 pageCount 와 함께 emit 하면
--       파트너(bookmoa-mobile 등) 장바구니가 실제 가/감 가격을 계산한다.
--       (설계 §3-4·§8 — 가격 계산 주체=파트너)
--
--       pricing(JSON): { includedPages, minPages, pageStep, perPageUnit }
--         - includedPages: 기본 포함 페이지 (예: 16). 이 수까지는 추가 단가 없음.
--         - minPages:      최소 제작 페이지 (이하 삭제 차단 가드용 메타).
--         - pageStep:      증감 단위 (펼침면=2 등).
--         - perPageUnit:   초과 페이지당 단가 (통화·세금은 파트너 책임).
--       NULL = 가변 가격 미사용 (BOOK/LEAFLET 등 기존 동작 비파괴).
--
-- ⚠️ additive nullable = 비파괴. 기존 행은 NULL(미사용)로 유지.
--    storige 는 메타 저장 + emit 만 — 가격 계산/검증 로직 변경 없음.
--
-- 관련 코드:
--   - packages/types/src/index.ts (PhotobookPricing, TemplateSet/Create/Update Input)
--   - apps/api/src/templates/entities/template-set.entity.ts (pricing 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (pricing 검증 — 후속 배선 필요)
--   - apps/api/src/templates/template-sets.service.ts (create 매핑 — 후속 배선 필요)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (PHOTOBOOK 가격 입력)
--   - apps/editor/src/embed.tsx (editor.complete 시 pageCount + pricing emit)
-- ============================================================

ALTER TABLE `template_sets`
  ADD COLUMN IF NOT EXISTS `pricing` JSON NULL
    COMMENT '포토북 페이지 가변 가격 메타 {includedPages,minPages,pageStep,perPageUnit}. NULL=미사용';
