-- =====================================================================
-- 20261125_add_edit_session_purge_after.sql
-- file_edit_sessions 관리자 삭제 복구 기한(purge_after) additive 1컬럼 + 인덱스.
--
-- - purge_after(TIMESTAMP NULL): 관리자가 편집데이터관리에서 지운 세션만 삭제 시각 + 48h 로 채운다.
--   이 시각 전까지는 '삭제 리스트'에서 복구할 수 있고, 지나면 StaffDeletePurgeService(매시 23분)가
--   세션·잡·버전 행과 그 세션만 쓰던 파일(R2/로컬 객체 + files 행)을 영구 삭제한다.
-- - NULL = 활성 세션 또는 고객이 지운 세션 — 기한 없이 보관(자동 삭제 대상 아님). 기존 행 전부 NULL(비파괴).
-- - 멱등: ADD COLUMN IF NOT EXISTS / ADD INDEX IF NOT EXISTS (MariaDB) — 재실행 안전.
--
-- 관련 코드:
--   - apps/api/src/edit-sessions/entities/edit-session.entity.ts (purgeAfter)
--   - apps/api/src/staff-edit-data/staff-delete-window.ts (48h 규칙·RESTORE_WINDOW_CLOSED)
--   - apps/api/src/staff-edit-data/staff-edit-data.service.ts (remove·bulkRemove 가 purge_after 설정)
--   - apps/api/src/edit-sessions/edit-sessions.service.ts (restoreSession 기한 검사·NULL 복원)
--   - apps/api/src/staff-edit-data/staff-delete-purge.service.ts (기한 경과분 영구 삭제)
--   - docker/mysql/init.sql (file_edit_sessions 블록 동기)
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
-- =====================================================================

ALTER TABLE file_edit_sessions
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMP NULL DEFAULT NULL
  COMMENT '관리자 삭제 영구 삭제 시각(삭제+48h, NULL=기한 없음)';

ALTER TABLE file_edit_sessions
  ADD INDEX IF NOT EXISTS idx_edit_sessions_purge_after (purge_after);

-- 적용 확인:
--   SHOW COLUMNS FROM file_edit_sessions LIKE 'purge_after';
--   SHOW INDEX FROM file_edit_sessions WHERE Key_name = 'idx_edit_sessions_purge_after';
--
-- 롤백: 코드만 되돌린다(새 컬럼은 구 코드가 무시). 컬럼 DROP 은 불필요.
