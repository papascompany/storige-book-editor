-- =====================================================================
-- 20260716_add_books_core.sql
-- Partner API v1 Stage 3 — books / book_assets / book_finalizations 신설 (additive).
--
-- 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4~2.6
-- books = 도서 aggregate(파사드). 기존 files/file_edit_sessions/worker_jobs 를
-- 대체하지 않고 내부 오케스트레이션만 한다(§6.1 AD-2).
--
-- - 신규 테이블 3종만 생성 — 기존 테이블 컬럼 변경 0 (additive-only).
-- - 멱등: CREATE TABLE IF NOT EXISTS (재실행 안전).
-- - FK 제약 없음(컬럼+인덱스만) — 기존 테이블 무접촉 원칙 + 소프트 삭제 파일과의
--   정합(§2.4 FK 주). 참조 무결성은 애플리케이션 계층에서 강제.
-- - 전 리소스 site_id NOT NULL — v1 은 처음부터 site 스탬프 강제(§7.1, NULL-siteId 금지).
--
-- ⚠️ 설계서 §2.4 정정 반영:
--   1) books.book_spec_id 는 NULLABLE (설계서 초안 NOT NULL 에서 정정).
--      book_specs 시드가 오너 승인 대기(§9-6)라 시드 없이도 DRAFT book 생성이
--      가능해야 한다. finalization 페이지 규칙(pageMin/Max/Increment)은 W3 에서
--      book_spec 이 연결된 경우에만 적용한다.
--   2) edit_session_id 는 file_edit_sessions(EditSession 엔티티 @Entity('file_edit_sessions'))
--      를 참조한다 — 설계서 문서의 'edit_sessions' 표기는 실제 테이블명으로 정정.
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy: 마이그레이션 → API 재배포 → nginx 재시작)
-- =====================================================================

-- ── §2.4 books — 도서 aggregate ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS books (
  id              VARCHAR(36) PRIMARY KEY,
  uid             VARCHAR(40) NOT NULL,                 -- 외부 식별자 'bk_...'
  site_id         VARCHAR(36) NOT NULL,                 -- NULL 금지 — v1 전 리소스 site 스탬프 필수
  env             ENUM('test','live') NOT NULL DEFAULT 'live',
  creation_type   ENUM('PDF_UPLOAD','TEMPLATE','MIX_COVER_TEMPLATE','EDITOR_SESSION') NOT NULL,
  book_spec_id    VARCHAR(36) NULL,                     -- book_specs.id (정정: NULLABLE — 시드 게이트)
  status          ENUM('DRAFT','FINALIZED') NOT NULL DEFAULT 'DRAFT',
  page_count      INT NULL,                             -- finalization 시 확정
  title           VARCHAR(200) NULL,
  edit_session_id VARCHAR(36) NULL,                     -- EDITOR_SESSION 승격 원본(file_edit_sessions 참조)
  partner_ref     VARCHAR(100) NULL,                    -- 파트너측 자체 참조 ID(자유)
  finalized_at    TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_books_uid (uid),
  INDEX idx_books_site_env_status (site_id, env, status),
  INDEX idx_books_session (edit_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── §2.5 book_assets — 자산(표지/내지/사진/바인딩) ──────────────────
-- POST=신규(active 단수 유형은 기존재 시 409 ERR_ASSET_ALREADY_EXISTS)
-- PUT=교체(기존 row status='replaced' 전환 + 신규 'active' — 이력 보존)
-- 파일 실체는 기존 files 계층 재사용, 삭제·보존도 기존 retention 정책 승계.
CREATE TABLE IF NOT EXISTS book_assets (
  id               VARCHAR(36) PRIMARY KEY,
  book_id          VARCHAR(36) NOT NULL,                -- books.id
  asset_type       ENUM('pdf_cover','pdf_contents','photo','cover_binding','contents_binding') NOT NULL,
  file_id          VARCHAR(36) NULL,                    -- files.id 참조(업로드형)
  template_set_id  VARCHAR(36) NULL,                    -- 바인딩형(W4)
  binding_params   JSON NULL,                           -- 템플릿 파라미터(Stage 5 schema 정합)
  sort_order       INT NOT NULL DEFAULT 0,              -- photo 다건 순서
  status           ENUM('active','replaced') NOT NULL DEFAULT 'active',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_book_assets_book (book_id, asset_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── §2.6 book_finalizations — 최종화 이력/산출물 고정 ──────────────────
-- 오케스트레이션 실행 상태머신은 W3. 본 배치는 테이블/엔티티만 신설.
CREATE TABLE IF NOT EXISTS book_finalizations (
  id                VARCHAR(36) PRIMARY KEY,
  uid               VARCHAR(40) NOT NULL,               -- 외부 식별자 'fin_...'
  book_id           VARCHAR(36) NOT NULL,               -- books.id
  attempt           INT NOT NULL DEFAULT 1,             -- 실패 후 재시도 이력
  status            ENUM('PENDING','VALIDATING','COMPOSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  validate_job_id   VARCHAR(36) NULL,                   -- worker_jobs.id (검증)
  compose_job_id    VARCHAR(36) NULL,                   -- worker_jobs.id (합성)
  output_file_id    VARCHAR(36) NULL,                   -- files.id (최종 PDF)
  page_count        INT NULL,                           -- 확정 페이지 수
  error_code        VARCHAR(60) NULL,                   -- 실패 시 ERR_* (§3 카탈로그)
  error_detail      JSON NULL,                          -- 검증 errors/warnings 스냅샷
  started_at        TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_finalizations_uid (uid),
  INDEX idx_book_finalizations_book (book_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 적용 확인:
--   SHOW TABLES LIKE 'book%';
--   SELECT COUNT(*) FROM books;  -- 신설 직후 0 이 정상
