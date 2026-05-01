-- ============================================================
-- Migration: 2026-05-01 — edit_session_versions 테이블 추가
-- ============================================================
-- 사유: BB-Phase 3 (트랙 BB-Phase 3 풀 스택, b366042) — 자동저장
--      시점 versions LRU 보관용 신규 테이블.
--      자세한 내용:
--      - apps/api/src/editor/entities/edit-session-version.entity.ts
--      - .cursor/plans/_RESUME_EDITOR_TRACKS.md (BB-Phase 3)
--      - .cursor/plans/v2/NEW_DEV_GUIDE.html §15
--
-- 적용 대상: 기존에 init.sql 로 edit_sessions 테이블이 생성된 환경
--           (production / staging). development 환경은 TypeORM
--           synchronize=true 로 자동 적용되므로 본 SQL 불필요.
--
-- 적용 방법:
--   docker-compose exec mysql mysql -uroot -p storige < \
--     apps/api/migrations/20260501_add_edit_session_versions.sql
--   (또는 동일 SQL 을 production DB 에 직접 실행)
--
-- 적용 확인:
--   SHOW TABLES LIKE 'edit_session_versions';
--   DESCRIBE edit_session_versions;
--   SELECT COUNT(*) FROM edit_session_versions;  -- 0 정상
--
-- 안전성:
--   • IF NOT EXISTS 로 중복 실행해도 오류 없음
--   • 신규 테이블만 추가 — 기존 데이터/제약 영향 없음
--   • CASCADE: edit_sessions 삭제 시 해당 시점도 자동 삭제
--   • 롤백: DROP TABLE edit_session_versions;
--
-- 데이터 폭증 정책:
--   • debounce 1분 (apps/api/src/editor/editor.service.ts VERSION_DEBOUNCE_MS)
--   • LRU 20개 (VERSION_LRU_LIMIT) — 초과분은 자동 삭제
-- ============================================================

CREATE TABLE IF NOT EXISTS edit_session_versions (
  id           VARCHAR(36)  NOT NULL,
  session_id   VARCHAR(36)  NOT NULL,
  saved_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  pages        JSON         NOT NULL,
  page_count   INT          NOT NULL DEFAULT 0,
  created_by   VARCHAR(36)  NULL,
  thumbnail_url VARCHAR(500) NULL,
  PRIMARY KEY (id),
  INDEX idx_edit_session_version_session (session_id),
  INDEX idx_edit_session_version_saved_at (saved_at),
  CONSTRAINT fk_edit_session_version_session
    FOREIGN KEY (session_id) REFERENCES edit_sessions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='BB-Phase 3: 자동저장 시점 versions (LRU 20)';
