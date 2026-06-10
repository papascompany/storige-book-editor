-- ============================================================
-- Migration: 2026-06-10 — TemplateSet 블리드 / 재단선 / 사이즈 검증 허용오차
-- ============================================================
-- 사유: 상품(템플릿셋)별로 인쇄 작업사이즈/재단선/업로드 검증 허용오차를 설정.
--       - bleed_mm: 사방(per-edge) 블리드 mm. 작업사이즈 = 재단 + bleed_mm*2.
--         0이면 블리드 없음. 기본 3.
--       - crop_mark_enabled: 재단선(crop mark) 마커 표기 ON/OFF 토글.
--         블리드와 별개의 명시 스위치. 기본 0(off).
--       - size_tolerance_mm: 고객 업로드 PDF 사이즈 검증 허용오차(mm). 기본 0.2.
--
-- ⚠️ P1 단계 = '필드 저장 + 전달'만. 워커의 검증(validatePageSize)·변환(convert)
--    실제 동작 변경은 P4에서. 워커는 새 필드를 받기만(optional) 하고 사용하지 않음.
--    편집기/PDF 출력 동작도 무변경(P2/P3).
--
-- 배선: edit-sessions(createValidationJobs)가 session.templateSetId로 TemplateSet을
--       조회해 orderOptions에 bleedMm/cropMarkEnabled/sizeToleranceMm + 재단(trim=판형)
--       /작업(work=재단+bleedMm*2) 사이즈를 주입. worker-jobs(mergeSiteWorkerDefaults)는
--       bleedMm/sizeToleranceMm를 누락 시에만 전역 기본값으로 채움.
--
-- 관련 코드:
--   - apps/api/src/templates/entities/template-set.entity.ts
--     (bleed_mm / crop_mark_enabled / size_tolerance_mm 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (Create/Update 검증)
--   - apps/api/src/templates/template-sets.service.ts (create 매핑, update Object.assign)
--   - apps/api/src/edit-sessions/edit-sessions.service.ts (createValidationJobs 배선)
--   - apps/api/src/worker-jobs/worker-jobs.service.ts (mergeSiteWorkerDefaults 머지)
--   - apps/api/src/worker-jobs/dto/worker-job.dto.ts (orderOptions optional 필드)
-- ============================================================

ALTER TABLE `template_sets`
  ADD COLUMN IF NOT EXISTS `bleed_mm` FLOAT NOT NULL DEFAULT 3
    COMMENT '사방(per-edge) 블리드 mm. 작업사이즈=재단+bleed_mm*2. 0=없음',
  ADD COLUMN IF NOT EXISTS `crop_mark_enabled` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '재단선 마커 표기 ON/OFF (블리드와 별개 스위치)',
  ADD COLUMN IF NOT EXISTS `size_tolerance_mm` FLOAT NOT NULL DEFAULT 0.2
    COMMENT '업로드 PDF 사이즈 검증 허용오차 mm';
