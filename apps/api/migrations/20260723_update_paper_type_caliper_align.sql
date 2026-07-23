-- =====================================================================
-- 20260723_update_paper_type_caliper_align.sql
-- R-55(bookmoa reply9 §1) — 무선 두께 미세 갱신 2건을 오너 caliper 기준으로 정합.
--
--  · 백모조 120g   : 0.069 → 0.070 /페이지 (caliper 140㎛ ÷2 — 양장 백색모조120과 정합)
--  · 뉴플러스백/미색 100g : 0.051 → 0.0505 /페이지 (caliper 101㎛ ÷2)
--  legacy thickness(mm/장, ×2 합성값)도 동반 정합(0.138→0.140 / 0.102→0.101).
--
-- 시드는 NULL-백필 전용(운영자 수정값 보존)이라 기존 값 갱신은 본 SQL이 담당.
-- 구값 가드(WHERE =)로 운영자가 이미 다른 값을 넣었다면 건드리지 않는다(멱등).
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
-- =====================================================================

UPDATE paper_types SET thicknessPerPageMm = 0.0700
  WHERE code = '백모조 120g' AND thicknessPerPageMm = 0.0690;
UPDATE paper_types SET thickness = 0.140
  WHERE code = '백모조 120g' AND thickness = 0.138;

UPDATE paper_types SET thicknessPerPageMm = 0.0505
  WHERE code IN ('뉴플러스백색 100g', '뉴플러스미색 100g') AND thicknessPerPageMm = 0.0510;
UPDATE paper_types SET thickness = 0.101
  WHERE code IN ('뉴플러스백색 100g', '뉴플러스미색 100g') AND thickness = 0.102;
