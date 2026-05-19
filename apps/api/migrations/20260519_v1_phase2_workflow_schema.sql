-- ============================================================
-- Migration: 2026-05-19 — 인쇄 워크플로우 v1 Phase 2 스키마 확장
-- ============================================================
-- 사유: 면지(EndPaper) / 표지 편집 토글 / 레더 커버 미리보기 / 고객 PDF 첨부 / 게스트 토큰
--       을 위한 컬럼 추가 + 24시간 자동 삭제 EVENT 등록.
--
-- 관련 문서:
--   - .cursor/plans/RESUME_PROMPT_2026-05-19.md §4.4 (결정사항 6건 — 권장안 전체 확정)
--   - .tmp_claude_phase1_2_prompt.md §3 (Phase 2 명세)
--
-- 관련 코드:
--   - packages/types/src/index.ts (TemplateType.ENDPAPER, EndpaperConfig, TemplateSet 확장, EditSession 확장)
--   - apps/api/src/templates/entities/template.entity.ts (TemplateTypeEnum.ENDPAPER)
--   - apps/api/src/templates/entities/template-set.entity.ts (endpaperConfig, coverEditable, coverPreviewImage)
--   - apps/api/src/edit-sessions/entities/edit-session.entity.ts (contentPdf*, guest*)
--
-- 적용 대상: 운영 / 스테이징 DB (dev 는 TypeORM synchronize=true 로 자동).
--
-- 적용 방법 (RESUME_PROMPT §7.1):
--   scp apps/api/migrations/20260519_v1_phase2_workflow_schema.sql \
--     deploy@158.247.235.202:/tmp/m.sql
--   ssh deploy@158.247.235.202 'source ~/storige/.env && \
--     docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige < /tmp/m.sql'
--
-- 안전성:
--   * 모든 ALTER 는 `ADD COLUMN IF NOT EXISTS` — 중복 실행 안전 (MariaDB 10.5+).
--   * 인덱스도 `IF NOT EXISTS`.
--   * EVENT 는 `CREATE EVENT IF NOT EXISTS` (재실행 안전). 일정 변경 시 DROP 후 재생성.
--   * templates.type 은 운영에서 VARCHAR(20) 이므로 ENUM 변경 불필요 — 새 값 'endpaper' 그대로 사용 가능.
--   * 기존 행 default:
--       - endpaper_config: NULL (면지 없음)
--       - cover_editable: TRUE (기존 동작 유지 — 모두 편집 가능)
--       - cover_preview_image: NULL
--       - content_pdf_*: NULL
--       - guest_token / guest_expires_at: NULL (회원 세션은 영향 없음)
--   * 롤백:
--       ALTER TABLE template_sets
--         DROP COLUMN endpaper_config,
--         DROP COLUMN cover_editable,
--         DROP COLUMN cover_preview_image;
--       ALTER TABLE file_edit_sessions
--         DROP INDEX idx_edit_sessions_guest_expires_at,
--         DROP INDEX idx_edit_sessions_guest_token,
--         DROP COLUMN guest_expires_at,
--         DROP COLUMN guest_token,
--         DROP COLUMN content_pdf_validation_result,
--         DROP COLUMN content_pdf_page_count,
--         DROP COLUMN content_pdf_file_id;
--       DROP EVENT IF EXISTS evt_purge_expired_guest_sessions;
-- ============================================================

-- 1) template_sets — 면지 / 표지 편집 / 레더 커버 미리보기
ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS endpaper_config JSON NULL DEFAULT NULL
    COMMENT '면지 구성 {frontCount, backCount, frontEditable, backEditable} (Phase 2)',
  ADD COLUMN IF NOT EXISTS cover_editable TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '표지 편집 가능 여부 (레더커버=0, 일반책=1, Phase 2)',
  ADD COLUMN IF NOT EXISTS cover_preview_image VARCHAR(500) NULL DEFAULT NULL
    COMMENT '레더 커버 미리보기 storage URL (Phase 2)';

-- 2) file_edit_sessions — 고객 PDF 첨부 + 게스트 토큰
ALTER TABLE file_edit_sessions
  ADD COLUMN IF NOT EXISTS content_pdf_file_id VARCHAR(36) NULL DEFAULT NULL
    COMMENT '고객 첨부 내지 PDF file_id (Phase 2, 결정 3-3 배타적)',
  ADD COLUMN IF NOT EXISTS content_pdf_page_count INT NULL DEFAULT NULL
    COMMENT 'PDF 페이지수 (자동 페이지 확장 계산용)',
  ADD COLUMN IF NOT EXISTS content_pdf_validation_result JSON NULL DEFAULT NULL
    COMMENT '워커 검증 결과 캐시 — 결정 3-4 검증 실패 시 거부 UI 노출용',
  ADD COLUMN IF NOT EXISTS guest_token VARCHAR(64) NULL DEFAULT NULL
    COMMENT '게스트 식별자 — 결정 3-1 24h 자동 삭제 대상',
  ADD COLUMN IF NOT EXISTS guest_expires_at TIMESTAMP NULL DEFAULT NULL
    COMMENT '게스트 작업 자동 삭제 시점 (NOW + 24h)';

-- 3) 인덱스 — 게스트 token 조회 / 만료 스캔 가속
ALTER TABLE file_edit_sessions
  ADD INDEX IF NOT EXISTS idx_edit_sessions_guest_token (guest_token),
  ADD INDEX IF NOT EXISTS idx_edit_sessions_guest_expires_at (guest_expires_at);

-- 4) EVENT — 24시간 후 게스트 세션 자동 삭제 (결정 3-1)
--    NOTE: event_scheduler 가 OFF 면 등록만 되고 실행 안 됨. 운영 적용 후 별도 검증.
CREATE EVENT IF NOT EXISTS evt_purge_expired_guest_sessions
  ON SCHEDULE EVERY 1 HOUR
  STARTS CURRENT_TIMESTAMP
  COMMENT '게스트 세션 24h 자동 삭제 (Phase 2, 결정 3-1)'
  DO
    DELETE FROM file_edit_sessions
    WHERE guest_token IS NOT NULL
      AND guest_expires_at IS NOT NULL
      AND guest_expires_at < NOW();

-- ============================================================
-- 적용 후 검증 SQL (참고):
--   SHOW COLUMNS FROM template_sets WHERE Field IN
--     ('endpaper_config','cover_editable','cover_preview_image');
--   SHOW COLUMNS FROM file_edit_sessions WHERE Field IN
--     ('content_pdf_file_id','content_pdf_page_count','content_pdf_validation_result',
--      'guest_token','guest_expires_at');
--   SHOW INDEX FROM file_edit_sessions WHERE Key_name IN
--     ('idx_edit_sessions_guest_token','idx_edit_sessions_guest_expires_at');
--   SHOW EVENTS LIKE 'evt_purge_expired_guest_sessions';
--   SHOW VARIABLES LIKE 'event_scheduler';   -- 'ON' 확인. 'OFF' 면 별도 SET GLOBAL event_scheduler = ON;
-- ============================================================
