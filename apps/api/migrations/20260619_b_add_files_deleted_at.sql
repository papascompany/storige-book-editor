-- =====================================================================
-- 20260619_b_add_files_deleted_at.sql
-- files.deleted_at (소프트삭제) 컬럼 명시화 — 보존삭제 2단계(softDelete→48h→hardDelete) 전제.
--
-- 배경: FileEntity 는 @DeleteDateColumn deleted_at 을 선언하나(softDelete/restore/
--   findSoftDeletedOlderThan 가 의존), 이를 추가하는 ALTER 마이그레이션이 없었다.
--   현 prod 는 초기 synchronize=on 시절 컬럼이 남아 동작하지만, 신규 테넌트 DB·재해복구·
--   CI 테스트 DB(마이그레이션만으로 재구축)는 컬럼 부재 → 'Unknown column deleted_at' 크래시.
--   → 멱등 ALTER 로 모든 환경 정합화(현 prod 는 IF NOT EXISTS 로 무중단 no-op).
--
-- 멱등: MariaDB 11.2 ADD COLUMN/INDEX IF NOT EXISTS.
-- =====================================================================

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- purge 쿼리(findSoftDeletedOlderThan)가 deleted_at 으로 필터·정렬.
ALTER TABLE files
  ADD INDEX IF NOT EXISTS idx_files_deleted_at (deleted_at);
