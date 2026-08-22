-- =====================================================================
-- 20260822_add_file_edit_session_versions.sql
-- P1-4 — file_edit_sessions(프로덕션 /embed 세션) canvasData 덮어쓰기 직전 스냅샷 (additive).
--
-- 정본: .cursor/plans/RESUME_PROMPT_2026-08-22.md §3 P1-4 /
--       apps/api/src/edit-sessions/entities/edit-session-version.entity.ts
--
-- 배경: 동화책 R2(2026-08-18) — 재진입 시드 반감 → 자동저장이 서버 canvasData 를 영구 덮어씀.
--   레거시 edit_sessions 에만 버전 테이블(edit_session_versions)이 있고 실제 프로덕션 세션
--   모델 file_edit_sessions 는 버전 이력이 없어(0행) 절단·오저장 복구가 불가능했다.
--
-- 정책: EditSessionsService.update() 가 canvasData 를 바꿀 때 **이전 값**을 저장.
--   세션당 debounce 60s(autosave) / page_count 감소(shrink)는 즉시 / 세션당 최근 10건
--   (shrink 는 최근 5건 보호) / 동일 내용은 저장 안 함. 실패해도 저장 무중단(로깅만).
--
-- ⚠️ 운영 적용 순서 (synchronize=false 이므로 수동):
--   1) 이 마이그레이션을 먼저 실행
--   2) 그 다음 API 컨테이너 재배포 (+ nginx 재시작)
--   순서를 바꾸면 update() 의 스냅샷 INSERT 가 실패하지만 try/catch 로 저장 자체는 계속된다.
--
-- 멱등: CREATE TABLE IF NOT EXISTS. 롤백: DROP TABLE file_edit_session_versions;
-- 용량: canvas_data JSON(세션당 수백KB~MB) × 세션당 ≤15건. 상한은 서비스가 트림한다.
-- =====================================================================

CREATE TABLE IF NOT EXISTS file_edit_session_versions (
  id               VARCHAR(36)  NOT NULL,
  session_id       VARCHAR(36)  NOT NULL,
  canvas_data      JSON         NOT NULL,
  page_count       INT          NOT NULL DEFAULT 0,
  next_page_count  INT          NULL,
  reason           VARCHAR(16)  NOT NULL DEFAULT 'autosave',
  session_status   VARCHAR(20)  NULL,
  created_by       BIGINT       NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_fesv_session_created (session_id, created_at),
  CONSTRAINT fk_fesv_session FOREIGN KEY (session_id)
    REFERENCES file_edit_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 적용 확인:
--   SHOW TABLES LIKE 'file_edit_session_versions';
--   SELECT COUNT(*) FROM file_edit_session_versions;  -- 0 정상
