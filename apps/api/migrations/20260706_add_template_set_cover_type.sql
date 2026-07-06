-- ============================================================
-- Migration: 2026-07-06 — TemplateSet 커버 3종 메타 (D-4, C-4 Track 3)
-- ============================================================
-- 사유: 포토북·책자상품 공통 커버 체계(D-4 오너 결정 2026-07-04).
--       커버 기본 3종 시드 코드(고정 enum 금지 — 상품 구성에 따라 코드 추가 가능):
--         - 'hardcover_wrap'           : 하드커버(싸바리). cover_config.caseBind 활성.
--         - 'softcover_variable_spine' : 책등가변 일반커버(소프트커버). 현행 SpreadSpec 경로.
--         - 'ready_made'               : 기성커버. 기존 cover_editable=false +
--                                        cover_preview_image 경로에 매핑(신규 동작 없음).
--
--       cover_type(VARCHAR 50): 커버 종류 코드. 자유 코드 확장 가능(enum 아님).
--       cover_config(JSON): 커버 종류별 부가 설정.
--         { caseBind?: { boardThicknessMm, turnInMm, wrapMm },   -- 싸바리 geometry
--           readyMade?: { previewImageUrl } }                    -- 기성커버 참조(옵션)
--       NULL = 커버 종류 메타 미사용 (기존 셋 전량 동작 비파괴).
--
-- ⚠️ additive nullable 만 — DROP/기존 컬럼 ALTER 0건. 기존 행은 NULL 유지.
--    storige 편집기 UX 는 TemplateSetType/coverType 으로 게이팅하지 않는다(공유 UX 원칙).
--
-- 배포 순서 (필수):
--   1) 이 마이그레이션을 프로덕션 DB 에 직접 실행
--      (ssh deploy@VPS → docker exec storige-mariadb mariadb ... < 이 파일)
--   2) API 재배포 (docker compose up -d --build api)
--   3) Worker 재배포 (docker compose build worker && docker compose up -d worker)
--   권장 트랙 순서: Track 3(서버, 본 변경) 선배포 → Track 1(에디터). 역순이어도
--   output 우선·total 폴백 설계라 차단 없음(SOFT 경고 로그만, SPREAD_SNAPSHOT_HARD_FAIL 미설정 전제).
--
-- 관련 코드:
--   - apps/api/src/templates/entities/template-set.entity.ts (coverType/coverConfig 컬럼)
--   - apps/api/src/templates/dto/template-set.dto.ts (CoverCaseBindDto/CoverConfigDto)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (커버 종류 입력 — pricing 폼 인접)
--   - apps/api/src/worker-jobs/worker-jobs.service.ts (metadata.spread.outputWidthMm 큐 push)
--   - apps/worker/src/processors/synthesis.processor.ts (output 우선·total 폴백 검증)
--   - packages/types 반영은 Track 1 통합 시(현재는 api/admin 로컬 인터페이스 사용)
-- ============================================================

ALTER TABLE `template_sets`
  ADD COLUMN IF NOT EXISTS `cover_type` VARCHAR(50) NULL
    COMMENT '커버 종류 코드(hardcover_wrap/softcover_variable_spine/ready_made + 자유 확장). NULL=미사용',
  ADD COLUMN IF NOT EXISTS `cover_config` JSON NULL
    COMMENT '커버 종류별 설정 {caseBind:{boardThicknessMm,turnInMm,wrapMm},readyMade:{previewImageUrl}}. NULL=미사용';
