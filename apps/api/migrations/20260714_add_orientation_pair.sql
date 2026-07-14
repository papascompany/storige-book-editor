-- =====================================================================
-- 20260714_add_orientation_pair.sql
-- template_sets 방향(orientation) 페어링 additive 2컬럼 (오너 승인 설계 2026-07-14).
--
-- - paired_template_set_id: 같은 재단 규격의 정확 W↔H 스왑(±0.01mm) 상대 세트 ID.
--   대칭 저장(양쪽 행이 서로를 가리킴, 서비스 트랜잭션) — 규칙 집행은
--   TemplateSetsService.pair/unpair/deriveOrientation (일반 PUT 경로 설정 불가).
-- - is_orientation_default: 짝 중 노출 기본 방향 플래그(정확히 1개 = 1,
--   한쪽 세팅 시 반대쪽 자동 해제). 비페어 세트는 1(자기 자신이 기본).
--   기존 행 전체 기본값 1 로 비파괴(additive).
-- - 멱등: ADD COLUMN IF NOT EXISTS (MariaDB) — 재실행 안전.
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy)
-- =====================================================================

ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS paired_template_set_id VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS is_orientation_default TINYINT(1) NOT NULL DEFAULT 1;

-- 적용 확인:
--   SHOW COLUMNS FROM template_sets LIKE 'paired_template_set_id';
--   SHOW COLUMNS FROM template_sets LIKE 'is_orientation_default';
--   SELECT id, name, paired_template_set_id, is_orientation_default FROM template_sets LIMIT 5;
