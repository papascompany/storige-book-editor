-- =====================================================================
-- Storige Database Initialization (Full Schema)
-- Generated to match TypeORM entities in apps/api/src
-- Target: MariaDB 11.2
-- Source: .cursor/plans/P0A_DB_SCHEMA_FIX.md (B-2 완성본)
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 0. Users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36) PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 1. Categories (template 카테고리, 3단계 계층)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         VARCHAR(36) PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(20) UNIQUE NOT NULL,
  parent_id  VARCHAR(36),
  level      TINYINT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE,
  INDEX idx_categories_parent (parent_id),
  INDEX idx_categories_level (level),
  INDEX idx_categories_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. Library Categories (background/shape/frame/clipart 공용 카테고리)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_categories (
  id         VARCHAR(36) PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  type       VARCHAR(20) NOT NULL,
  parent_id  VARCHAR(36),
  sort_order INT DEFAULT 0,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES library_categories(id) ON DELETE SET NULL,
  INDEX idx_libcat_type (type),
  INDEX idx_libcat_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. Library: Fonts / Backgrounds / Shapes / Frames / Cliparts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_fonts (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  file_url    VARCHAR(500) NOT NULL,
  file_format VARCHAR(50),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_libfont_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS library_backgrounds (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  file_url      VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  category      VARCHAR(100),
  category_id   VARCHAR(36),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES library_categories(id) ON DELETE SET NULL,
  INDEX idx_libbg_category (category),
  INDEX idx_libbg_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS library_shapes (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  file_url      VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  category_id   VARCHAR(36),
  tags          JSON,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES library_categories(id) ON DELETE SET NULL,
  INDEX idx_libshape_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS library_frames (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  file_url      VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  category_id   VARCHAR(36),
  tags          JSON,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES library_categories(id) ON DELETE SET NULL,
  INDEX idx_libframe_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS library_cliparts (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  file_url      VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  category      VARCHAR(100),
  category_id   VARCHAR(36),
  tags          JSON,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES library_categories(id) ON DELETE SET NULL,
  INDEX idx_libclipart_category (category),
  INDEX idx_libclipart_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. Templates & Template Sets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  thumbnail_url VARCHAR(500),
  type          VARCHAR(20) NOT NULL DEFAULT 'page',
  width         FLOAT NOT NULL DEFAULT 210,
  height        FLOAT NOT NULL DEFAULT 297,
  editable      BOOLEAN NOT NULL DEFAULT TRUE,
  deleteable    BOOLEAN NOT NULL DEFAULT TRUE,
  canvas_data   JSON NOT NULL,
  spread_config JSON,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  category_id   VARCHAR(36),
  edit_code     VARCHAR(50) UNIQUE,
  template_code VARCHAR(50) UNIQUE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_by    VARCHAR(36),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_template_type (type),
  INDEX idx_template_deleted (is_deleted),
  INDEX idx_template_category (category_id),
  INDEX idx_template_edit_code (edit_code),
  INDEX idx_template_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS template_sets (
  id               VARCHAR(36) PRIMARY KEY,
  name             VARCHAR(255) NOT NULL,
  thumbnail_url    VARCHAR(500),
  type             VARCHAR(20) NOT NULL DEFAULT 'book',
  width            FLOAT NOT NULL DEFAULT 210,
  height           FLOAT NOT NULL DEFAULT 297,
  can_add_page     BOOLEAN NOT NULL DEFAULT TRUE,
  page_count_range JSON NOT NULL,
  templates        JSON NOT NULL,
  editor_mode      VARCHAR(20) NOT NULL DEFAULT 'single',
  is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
  description      TEXT,
  category_id      VARCHAR(36),
  product_specs    JSON,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_template_set_type (type),
  INDEX idx_template_set_deleted (is_deleted),
  INDEX idx_template_set_category (category_id),
  INDEX idx_template_set_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS template_set_items (
  id              VARCHAR(36) PRIMARY KEY,
  template_set_id VARCHAR(36) NOT NULL,
  template_id     VARCHAR(36) NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  required        BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (template_set_id) REFERENCES template_sets(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
  INDEX idx_tsi_set (template_set_id),
  INDEX idx_tsi_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. Products & Product sizes & Product ↔ TemplateSet 매핑
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id               VARCHAR(36) PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  productId        VARCHAR(255),
  description      TEXT,
  template         JSON,
  editorTemplates  JSON,
  isActive         BOOLEAN NOT NULL DEFAULT TRUE,
  -- 옵션 C: 외부 쇼핑몰의 width/height URL 파라미터로 사이즈 override 허용 여부
  --   docs/BOOKMOA_INTEGRATION_DIFF.md §6-3 참조
  allowCustomSize  BOOLEAN NOT NULL DEFAULT FALSE,
  template_set_id  VARCHAR(36),
  createdAt        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_set_id) REFERENCES template_sets(id) ON DELETE SET NULL,
  INDEX idx_products_template_set (template_set_id),
  INDEX idx_products_productId (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_sizes (
  id          VARCHAR(36) PRIMARY KEY,
  productId   VARCHAR(36) NOT NULL,
  sizeNo      INT NOT NULL,
  sizeName    VARCHAR(100),
  width       FLOAT NOT NULL,
  height      FLOAT NOT NULL,
  cutSize     FLOAT NOT NULL DEFAULT 0,
  safeSize    FLOAT,
  nonStandard BOOLEAN NOT NULL DEFAULT FALSE,
  reqWidth    JSON,
  reqHeight   JSON,
  createdAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_sizes_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_template_sets (
  id               VARCHAR(36) PRIMARY KEY,
  sortcode         VARCHAR(20) NOT NULL,
  prdt_stan_seqno  INT,
  template_set_id  VARCHAR(36) NOT NULL,
  display_order    INT NOT NULL DEFAULT 0,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_set_id) REFERENCES template_sets(id) ON DELETE CASCADE,
  UNIQUE KEY uk_product_template (sortcode, prdt_stan_seqno, template_set_id),
  INDEX idx_pts_sortcode (sortcode),
  INDEX idx_pts_sortcode_stan (sortcode, prdt_stan_seqno),
  INDEX idx_pts_template_set (template_set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. Paper Types & Binding Types (책등 계산용)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paper_types (
  id         VARCHAR(36) PRIMARY KEY,
  code       VARCHAR(50) UNIQUE NOT NULL,
  name       VARCHAR(100) NOT NULL,
  thickness  DECIMAL(5,3) NOT NULL,
  category   VARCHAR(20) NOT NULL DEFAULT 'body',
  isActive   BOOLEAN NOT NULL DEFAULT TRUE,
  sortOrder  INT NOT NULL DEFAULT 0,
  createdAt  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_paper_active (isActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS binding_types (
  id            VARCHAR(36) PRIMARY KEY,
  code          VARCHAR(50) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  margin        DECIMAL(5,2) NOT NULL,
  minPages      INT,
  maxPages      INT,
  pageMultiple  INT,
  isActive      BOOLEAN NOT NULL DEFAULT TRUE,
  sortOrder     INT NOT NULL DEFAULT 0,
  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_binding_active (isActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. Files (Storige/Bookmoa 공용 파일 메타)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id             VARCHAR(36) PRIMARY KEY,
  file_name      VARCHAR(255) NOT NULL,
  original_name  VARCHAR(255) NOT NULL,
  file_path      VARCHAR(500) NOT NULL,
  file_url       VARCHAR(500) NOT NULL,
  thumbnail_url  VARCHAR(500),
  file_size      BIGINT NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  file_type      VARCHAR(20) NOT NULL,
  order_seqno    BIGINT,
  member_seqno   BIGINT,
  metadata       JSON,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     TIMESTAMP NULL,
  INDEX idx_files_file_type (file_type),
  INDEX idx_files_order_seqno (order_seqno),
  INDEX idx_files_member_seqno (member_seqno)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. Edit Sessions — 두 종류 공존
--    (a) edit_sessions       : 캔버스 편집/검토/이력 모델
--    (b) file_edit_sessions  : 주문/파일/워커 상태 중심 모델
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edit_sessions (
  id               VARCHAR(36) PRIMARY KEY,
  order_id         VARCHAR(36),
  pages            JSON,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft',
  locked_at        DATETIME,
  locked_by        VARCHAR(36),
  modified_at      DATETIME,
  modified_by      VARCHAR(36),
  canvas_data      JSON,
  order_options    JSON,
  user_id          VARCHAR(36),
  template_id      VARCHAR(36),
  template_set_id  VARCHAR(36),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)         REFERENCES users(id)          ON DELETE SET NULL,
  FOREIGN KEY (locked_by)       REFERENCES users(id)          ON DELETE SET NULL,
  FOREIGN KEY (modified_by)     REFERENCES users(id)          ON DELETE SET NULL,
  FOREIGN KEY (template_id)     REFERENCES templates(id)      ON DELETE SET NULL,
  FOREIGN KEY (template_set_id) REFERENCES template_sets(id)  ON DELETE SET NULL,
  INDEX idx_edit_session_status (status),
  INDEX idx_edit_session_user   (user_id),
  INDEX idx_edit_session_order  (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS edit_histories (
  id          VARCHAR(36) PRIMARY KEY,
  session_id  VARCHAR(36) NOT NULL,
  user_id     VARCHAR(36),
  user_name   VARCHAR(100),
  action      VARCHAR(100) NOT NULL,
  details     TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES edit_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)         ON DELETE SET NULL,
  INDEX idx_edit_history_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_edit_sessions (
  id                VARCHAR(36) PRIMARY KEY,
  order_seqno       BIGINT NOT NULL,
  member_seqno      BIGINT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
  mode              VARCHAR(20) NOT NULL,
  cover_file_id     VARCHAR(36),
  content_file_id   VARCHAR(36),
  template_set_id   VARCHAR(36),
  canvas_data       JSON,
  metadata          JSON,
  completed_at      TIMESTAMP NULL,
  worker_status     VARCHAR(20),
  worker_error      TEXT,
  callback_url      VARCHAR(500),
  -- 인쇄 워크플로우 v1 Phase 4 (2026-05-19) — 고객 첨부 내지 PDF
  content_pdf_file_id           VARCHAR(36),
  content_pdf_page_count        INT,
  content_pdf_validation_result JSON,
  -- P0-2 (2026-06-02) — 첨부 모드: replace(PDF만/배타) | underlay(PDF 배경+편집)
  content_pdf_mode              VARCHAR(16),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP NULL,
  FOREIGN KEY (cover_file_id)   REFERENCES files(id)         ON DELETE SET NULL,
  FOREIGN KEY (content_file_id) REFERENCES files(id)         ON DELETE SET NULL,
  INDEX idx_fes_order (order_seqno),
  INDEX idx_fes_member (member_seqno),
  INDEX idx_fes_status (status),
  INDEX idx_fes_worker_status (worker_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 9. Worker Jobs (file_edit_sessions ManyToOne)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_jobs (
  id                VARCHAR(36) PRIMARY KEY,
  job_type          VARCHAR(30) NOT NULL,
  status            VARCHAR(20) NOT NULL,
  edit_session_id   VARCHAR(36),
  file_id           VARCHAR(36),
  input_file_url    VARCHAR(500),
  output_file_url   VARCHAR(500),
  output_file_id    VARCHAR(36),
  options           JSON,
  result            JSON,
  error_message     TEXT,
  session_id        VARCHAR(36),
  pdf_file_id       VARCHAR(36),
  request_id        VARCHAR(36),
  error_code        VARCHAR(50),
  error_detail      JSON,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at      TIMESTAMP NULL,
  FOREIGN KEY (edit_session_id) REFERENCES file_edit_sessions(id) ON DELETE SET NULL,
  UNIQUE KEY idx_worker_jobs_idempotency (session_id, pdf_file_id, request_id),
  INDEX idx_worker_jobs_status (status),
  INDEX idx_worker_jobs_type (job_type),
  INDEX idx_worker_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 10. Editor Contents / Editor Designs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editor_contents (
  id            VARCHAR(36) PRIMARY KEY,
  type          VARCHAR(20) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  image_url     VARCHAR(500),
  design_url    VARCHAR(500),
  cut_line_url  VARCHAR(500),
  tags          JSON NOT NULL,
  metadata      JSON NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_editor_contents_type (type),
  INDEX idx_editor_contents_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editor_designs (
  id         VARCHAR(36) PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  image_url  VARCHAR(500),
  media_url  VARCHAR(500) NOT NULL,
  metadata   JSON NOT NULL,
  user_id    VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_editor_designs_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 11. Seed: 기본 관리자 계정
--    초기 비밀번호: admin123 (첫 로그인 직후 즉시 변경할 것)
-- ---------------------------------------------------------------------
INSERT INTO users (id, email, password_hash, role) VALUES
  ('admin-001', 'admin@storige.com',
   '$2a$10$AJFvBK7rl9fuepsVAtnvAOP65fYW57zpBlGnByGTWvDsR5drscvEe',
   'ADMIN')
ON DUPLICATE KEY UPDATE email = email;

SET FOREIGN_KEY_CHECKS = 1;
