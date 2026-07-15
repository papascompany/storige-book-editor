-- =====================================================================
-- 20260716_c_add_finalization_concurrency_snapshot.sql
-- Partner API v1 Stage 3 — finalization 동시성 원자화 + 자산 스냅샷 (additive).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §6.3
--
-- 배경(적대 리뷰 렌즈1 P2-2 + 렌즈2 P2-3 — 동시성/TOCTOU):
--   ① 동시 착수: 진행 중 재호출 게이트는 latestFinalization 조회 기반이라 순차 재호출만
--      막고, 무키·상이 Idempotency-Key 로 동시 2 POST 가 오면 둘 다 "진행 중 없음" 을 읽고
--      각각 PENDING 을 INSERT → 이중 finalization(잡·산출물 중복). (book_id, attempt) 유니크로
--      패자 INSERT 를 DB 레벨에서 차단(dup-key → 409 ERR_FINALIZATION_IN_PROGRESS). attempt 는
--      항상 max+1 로 증분(§6.3 멱등)이라 정상 경로는 자연 만족하고 경쟁 삽입만 충돌한다.
--   ② 진행 중 자산 변이: assertDraft 는 FINALIZED 만 차단하므로 VALIDATING/COMPOSING 중에도
--      book 이 DRAFT 라 자산 POST/PUT 이 열려 있다 → validate=구자산, compose=신자산(미검증)
--      불일치 가능. plan_snapshot 에 착수 시점 자산(mode/validateFileId/coverFileId/
--      contentFileId)을 고정하고 validate/compose 가 재조회 없이 이 스냅샷을 쓴다 → 진행 중
--      자산 교체와 무관하게 이번 attempt 는 착수 시점 자산에 고정된다.
--
-- ⚠️ 20260716_add_books_core.sql(book_finalizations CREATE)이 이미 배포된 환경 정합용 —
--    CREATE 아닌 ADD COLUMN/INDEX(additive). 신규 환경은 add_books_core → b → 본 ALTER 를
--    파일명 순서로 적용한다(book_finalizations 는 마이그레이션 전용 — init.sql 미포함).
--
-- ⚠️ 유니크 인덱스 추가 전제: 기존 데이터에 중복 (book_id, attempt) 가 없어야 한다. book_
--    finalizations 는 Stage 3 신설 테이블이고 서비스가 항상 attempt 를 증분하므로 정상
--    환경엔 중복이 없다. 만약(과거 경쟁 삽입으로) 중복이 있으면 ADD UNIQUE 가 ERROR 1062 로
--    실패하니, 먼저 중복 attempt 행을 정리(최신 1건만 보존)한 뒤 재실행한다.
--
-- ⚠️ 운영 적용 순서 (synchronize=false 이므로 수동):
--   1) 이 마이그레이션을 먼저 실행 (plan_snapshot 컬럼 + 유니크 인덱스)
--   2) 그 다음 API 컨테이너 재배포 (서비스가 스냅샷/CAS 를 전제)
--   순서 지키면 무중단. (참고: feedback_schema_change_deploy)
--
-- 멱등: MariaDB 11.2 ADD COLUMN/INDEX IF NOT EXISTS (구버전이면 ERROR 1060/1061 무시 가능).
-- =====================================================================

-- ① 착수 시점 자산 스냅샷(TOCTOU 방지) — validate/compose 공용 재조회 금지 원천.
ALTER TABLE book_finalizations
  ADD COLUMN IF NOT EXISTS plan_snapshot JSON NULL
  AFTER validation_skipped;

-- ② 동시 착수 원자화 — (book_id, attempt) 유니크 CAS(패자 dup-key → 409).
ALTER TABLE book_finalizations
  ADD UNIQUE INDEX IF NOT EXISTS uq_book_finalizations_book_attempt (book_id, attempt);

-- 적용 확인:
--   SHOW COLUMNS FROM book_finalizations LIKE 'plan_snapshot';
--   SHOW INDEX FROM book_finalizations WHERE Key_name = 'uq_book_finalizations_book_attempt';
