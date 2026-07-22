-- =====================================================================
-- 20260722_widen_paper_type_per_page_scale.sql
-- R-44 후속(bookmoa reply3 §5) — thicknessPerPageMm 정밀도 확장 DECIMAL(6,3)→(7,4).
--
-- 오너 실측 caliper 회신분의 무선 환산값(caliper÷2)에 소수 4자리가 등장:
--   아르떼105 = 0.0775 mm/페이지, 뉴플러스(백/미)80 = 0.0405 mm/페이지.
-- scale 3 반올림(0.078/0.041) 시 200p 기준 bookmoa 모달과 0.1mm 어긋나
-- "모달↔서버 동일값" 계약이 깨진다. 기존 3자리 값은 무손실 보존(확장만).
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
-- =====================================================================

ALTER TABLE paper_types
  MODIFY thicknessPerPageMm DECIMAL(7,4) NULL;
