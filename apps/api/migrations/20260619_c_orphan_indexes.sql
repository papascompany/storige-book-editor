-- =====================================================================
-- 20260619_c_orphan_indexes.sql
-- P1 고아 파일 cron(findOrphanCandidates) NOT EXISTS 서브쿼리 성능 인덱스.
-- 멱등(MariaDB 11.2 IF NOT EXISTS). 데이터 변경 없음(인덱스만).
-- =====================================================================

-- 후보 1차 필터: order_seqno IS NULL + status + created_at 범위 스캔.
ALTER TABLE files
  ADD INDEX IF NOT EXISTS idx_files_orphan_scan (order_seqno, status, created_at);

-- worker_jobs URL/id 역참조(NOT EXISTS) 가속.
ALTER TABLE worker_jobs
  ADD INDEX IF NOT EXISTS idx_wj_file_id (file_id);
ALTER TABLE worker_jobs
  ADD INDEX IF NOT EXISTS idx_wj_output_file_id (output_file_id);
ALTER TABLE worker_jobs
  ADD INDEX IF NOT EXISTS idx_wj_pdf_file_id (pdf_file_id);
ALTER TABLE worker_jobs
  ADD INDEX IF NOT EXISTS idx_wj_input_file_url (input_file_url);
ALTER TABLE worker_jobs
  ADD INDEX IF NOT EXISTS idx_wj_output_file_url (output_file_url);

-- file_edit_sessions 역참조(content_pdf_file_id 는 RelationId 아님 → 인덱스 명시).
ALTER TABLE file_edit_sessions
  ADD INDEX IF NOT EXISTS idx_fes_content_pdf_file_id (content_pdf_file_id);
-- cover_file_id / content_file_id 는 @JoinColumn FK 라 인덱스 존재 가능 → IF NOT EXISTS 로 멱등 보강.
ALTER TABLE file_edit_sessions
  ADD INDEX IF NOT EXISTS idx_fes_cover_file_id (cover_file_id);
ALTER TABLE file_edit_sessions
  ADD INDEX IF NOT EXISTS idx_fes_content_file_id (content_file_id);
