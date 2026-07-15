-- =====================================================================
-- 20260716_b_add_finalization_validation_skipped.sql
-- Partner API v1 Stage 3 — book_finalizations.validation_skipped 표식 (additive).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §6.3 (조건부-validate 계약)
--
-- 배경(적대 리뷰 P1-2 — 계약/거버넌스):
--   finalization 은 book_spec 연결 + pageCount 확정 시에만 워커 validate(판형 대조)를
--   수행하고, 미연결/미확정이면 대조 판형이 없어 validate 를 skip 한 채 바로 합성/완료로
--   진행한다(pdf-validator 가 size/pages 를 널가드 없이 요구하기 때문). 종전엔 이 skip 이
--   book_finalizations 어디에도 남지 않아 파트너가 "미검증 FINALIZED" 를 인지할 수 없었다.
--   → validate 를 건너뛴 attempt 에 validation_skipped=1 표식을 남겨 BookFinalizationView·
--     웹훅 payload(validationSkipped)로 노출한다. 미검증 FINALIZED 허용은 오너 결정 D-9
--     (orders 자동진입 전 차단 게이트, §9)로 분리돼 있다.
--
-- ⚠️ 20260716_add_books_core.sql(book_finalizations CREATE)이 이미 배포된 환경 정합용 —
--    CREATE 아닌 ADD COLUMN(additive). 신규 환경은 add_books_core → 본 ALTER 를 파일명 순서로
--    적용해 컬럼을 얻는다(book_finalizations 는 마이그레이션 전용 — init.sql 미포함).
--
-- ⚠️ 운영 적용 순서 (synchronize=false 이므로 수동):
--   1) 이 마이그레이션을 먼저 실행 (validation_skipped 컬럼 추가, 기존 행 = 0)
--   2) 그 다음 API 컨테이너 재배포 (엔티티/서비스가 컬럼 전제)
--   순서 지키면 무중단. (참고: feedback_schema_change_deploy)
--
-- 멱등: MariaDB 11.2 ADD COLUMN IF NOT EXISTS (구버전이면 ERROR 1060 무시 가능).
-- =====================================================================

ALTER TABLE book_finalizations
  ADD COLUMN IF NOT EXISTS validation_skipped TINYINT(1) NOT NULL DEFAULT 0
  AFTER page_count;

-- 적용 확인:
--   SHOW COLUMNS FROM book_finalizations LIKE 'validation_skipped';
--   -- 기존 행은 전부 0(=검증 수행 가정), 이후 skip attempt 만 1.
