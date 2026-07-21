-- =====================================================================
-- 20260721_add_paper_type_spine_v2.sql
-- R-44 책등(세네카) 공식 v2 — paper_types 두께 컬럼 additive 확장.
--
-- - thicknessPerPageMm : 무선(perfect) 공식용 mm/페이지 (youshindang 표 이식)
-- - thicknessPerSheetMm: 양장(hardcover) 공식용 mm/장 (mybookmake 표 이식)
-- - aliases            : 외부 파트너 라벨 별칭 JSON 배열(bookmoa innerPaper 흡수)
--
-- 값 시드는 SpineSeedService(OnModuleInit, code 기준 멱등 insert)가 수행 —
-- 이 SQL 은 스키마만 추가한다(NULL 허용, 기존 8코드 행은 NULL = v1 공식 유지).
-- ⚠️ paper_types 는 camelCase 컬럼 관례(isActive/sortOrder) — 동일하게 맞춘다.
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy)
-- =====================================================================

ALTER TABLE paper_types
  ADD COLUMN IF NOT EXISTS thicknessPerPageMm  DECIMAL(6,3) NULL AFTER thickness,
  ADD COLUMN IF NOT EXISTS thicknessPerSheetMm DECIMAL(6,3) NULL AFTER thicknessPerPageMm,
  ADD COLUMN IF NOT EXISTS aliases             TEXT NULL AFTER thicknessPerSheetMm;
