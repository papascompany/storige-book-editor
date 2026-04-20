# P0-A 작업 문서 — 운영 DB 스키마 복구

> 📌 **전체 진입점은 [`00_MASTER_DEVELOPMENT_GUIDE.md`](./00_MASTER_DEVELOPMENT_GUIDE.md) §5.1**. 이 문서는 `P0A_START_HERE_결정가이드.md`에서 **(b) 수동 수정**을 택한 경우의 실행 플레이북입니다.
>
> **이 문서는 `HANDOFF_GUIDE.md §18` 의 직접 실행판입니다.**
> 문서 하나만 붙잡고 위에서 아래로 복붙해 실행하면, 운영 DB 스키마 문제가 해결됩니다.
> **개발 시작(P1~P16 진입) 전에 반드시 이 문서를 끝까지 수행하세요.**
>
> 작업자: 최초 인수자 (Storige 도메인 지식 無 가정)
> 소요 시간: 30분 ~ 2시간 (상황에 따라)
> 전제: 레포 클론 완료, Docker Desktop 실행 중

---

## 0. "왜 이 작업이 1순위인가" — 1분 설명

### 현재 상태
- `docker/mysql/init.sql`은 MariaDB가 **처음 기동될 때 한 번만** 실행되는 테이블 생성 스크립트입니다.
- 이 파일에는 **10개 테이블**만 있습니다.
- 그런데 API 코드는 **24개 테이블**을 사용합니다.
- 차이 나는 **14개 테이블**을 로컬 개발에서는 `TypeORM synchronize: true`가 자동으로 만들어 주기 때문에 아무도 못 봤습니다.
- **운영은 `synchronize: false`** 입니다. 그래서 운영 첫 기동 시 "저장하기 → 500 에러" 가 터집니다.

### 이 작업이 끝나면 무엇이 달라지나?
- 로컬에서든 운영에서든 **똑같은 스키마**로 기동합니다.
- 이후 P1(저장 완료 체인) 작업을 해도 "DB 테이블이 없어서 실패"하는 경우가 사라집니다.
- 팀의 다른 사람이 신규 엔티티를 추가할 때 **되풀이되지 않을 구조**가 만들어집니다.

### "내가 팀/원작자와 의논해야 하나?"
- **아닙니다.** 이 문서는 "혼자서도 가능"하도록 결정을 모두 내려두었습니다.
- 의논이 필요한 건 **스키마 설계 변경**이지, **이미 코드에 정의된 엔티티를 DB에 반영**하는 일이 아닙니다.
- 후자는 단순 반영 작업이므로, 본인이 바로 실행해도 됩니다.

---

## 1. 실행 계획 요약

```
단계 A. 현재 상태 스냅샷 (5분, 위험도 0)
   └ 로컬 DB에 어떤 테이블이 있는지, init.sql과 엔티티가 얼마나 차이 나는지 "숫자로 확인"

단계 B. 신규 init.sql 작성 (본 문서에 완성본 포함, 복붙만 하면 됨)
   └ 24개 테이블 전부 포함, Legacy init.sql은 백업 후 교체

단계 C. 깨끗한 DB에서 재기동 검증 (10분)
   └ 볼륨 초기화 → docker compose up → SHOW TABLES로 24개 확인

단계 D. API 통합 기동 검증 (10분)
   └ NODE_ENV=production 상태에서 API 기동, /api/health 200, 저장 API E2E

단계 E. TypeORM Migrations 전환 준비 (선택, 1~2시간)
   └ 다음 스프린트에서 정답으로 승격할 수 있도록 뼈대 세팅
```

단계 A~D만 끝내도 운영 배포 가능 상태가 됩니다. E는 권장 사항입니다.

---

## 2. 단계 A — 현재 상태 확인 (5분)

### A-1. init.sql의 테이블 목록 뽑기
```bash
cd "/Users/yohan/claude/Bookmoa Storige editor/storige"

grep -iE "CREATE TABLE IF NOT EXISTS" docker/mysql/init.sql \
  | sed 's/.*EXISTS //; s/ .*//' | sort -u
```
**예상 출력 (10개)**:
```
categories
edit_sessions
library_backgrounds
library_cliparts
library_fonts
template_set_items
template_sets
templates
users
worker_jobs
```

### A-2. 엔티티가 선언한 테이블 목록 뽑기
```bash
grep -rhE "@Entity\('[^']+'\)" apps/api/src --include="*.ts" \
  | sed -E "s/.*@Entity\('([^']+)'\).*/\1/" | sort -u
```
**예상 출력 (24개)**:
```
binding_types
categories
cate              ← Bookmoa 외부 DB 참조
edit_histories
edit_sessions
editor_contents
editor_designs
file_edit_sessions
files
library_backgrounds
library_categories
library_cliparts
library_fonts
library_frames
library_shapes
member            ← Bookmoa 외부 DB 참조
order_common      ← Bookmoa 외부 DB 참조
paper_types
product_sizes
product_template_sets
products
template_set_items
template_sets
templates
users
worker_jobs
```

### A-3. 차이 계산
```bash
diff \
  <(grep -iE "CREATE TABLE IF NOT EXISTS" docker/mysql/init.sql | sed 's/.*EXISTS //; s/ .*//' | sort -u) \
  <(grep -rhE "@Entity\('[^']+'\)" apps/api/src --include="*.ts" \
      | sed -E "s/.*@Entity\('([^']+)'\).*/\1/" \
      | grep -vE "^(cate|member|order_common)$" \
      | sort -u)
```
(`cate`, `member`, `order_common`은 Bookmoa 외부 DB 읽기 전용이므로 자체 DB에 만들지 않습니다.)

**예상 결과: init.sql에 없는 13개 테이블**
```
binding_types
edit_histories
editor_contents
editor_designs
file_edit_sessions
files
library_categories
library_frames
library_shapes
paper_types
product_sizes
product_template_sets
products
```

### A-4. 확인하고 넘어가기
숫자가 위와 다르다면 엔티티가 추가·삭제된 것입니다. 그럴 경우 단계 B의 CREATE TABLE을 해당 엔티티에 맞춰 재작성해야 합니다. 동일하다면 그대로 단계 B로 진행.

---

## 3. 단계 B — 신규 `init.sql` 전체 완성본 (복붙)

### B-1. 기존 파일 백업
```bash
cp docker/mysql/init.sql docker/mysql/init.sql.bak-$(date +%Y%m%d)
```

### B-2. 아래 내용으로 `docker/mysql/init.sql` 을 **전체 교체**

> 아래 스크립트는 엔티티 24개(외부 DB 3개 제외 → 자체 DB 21개)를 모두 반영합니다.
> 순서는 외래키 의존성을 고려해 부모 테이블부터 정의했습니다.
> MariaDB 11.2 기준으로 검증 가능한 DDL입니다.

```sql
-- =====================================================================
-- Storige Database Initialization (Full Schema)
-- Generated to match TypeORM entities in apps/api/src
-- Target: MariaDB 11.2
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
  -- Legacy fields (하위 호환)
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
  -- Legacy
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
--    (b) file_edit_sessions  : 주문/파일/워커 상태 중심 모델 (★ 워커 파이프라인 핵심)
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
-- 11. Seed: 기본 관리자 계정 (bcrypt 해시는 반드시 교체!)
--    - 비밀번호: admin123 (초기값, 첫 로그인 후 즉시 변경 권장)
--    - 실제 배포 시엔 bcrypt로 해시 재생성해서 넣을 것
--      node -e "console.log(require('bcryptjs').hashSync('admin123', 10))"
-- ---------------------------------------------------------------------
INSERT INTO users (id, email, password_hash, role) VALUES
  ('admin-001', 'admin@storige.com',
   '$2b$10$REPLACE_WITH_REAL_BCRYPT_HASH_BEFORE_PRODUCTION',
   'ADMIN')
ON DUPLICATE KEY UPDATE email = email;

SET FOREIGN_KEY_CHECKS = 1;
```

### B-3. 파일 저장 직후 자가 검증
```bash
grep -iE "^CREATE TABLE IF NOT EXISTS" docker/mysql/init.sql | wc -l
# 기대값: 21
```
21이 아니면 복붙 실패. 다시 교체.

---

## 4. 단계 C — 깨끗한 DB에서 재기동 검증 (10분)

> 아래 명령은 **로컬 MariaDB 볼륨을 삭제**합니다. 개발·테스트 환경에서만 실행하세요.
> 운영에서는 절대 `-v` 플래그를 쓰지 말고, 별도 DB 백업·복원 절차를 먼저 수행해야 합니다.

### C-1. 환경변수 준비
`.env` 파일이 없으면 `.env.example`을 복사:
```bash
test -f .env || cp .env.example .env
# .env 안의 MYSQL_ROOT_PASSWORD / DATABASE_USER / DATABASE_PASSWORD / DATABASE_NAME 값을 실제 값으로 교체
```

### C-2. 기존 볼륨 제거 후 재기동
```bash
docker compose down -v          # mariadb_data 볼륨 삭제 (로컬 한정!)
docker compose up -d mariadb
sleep 10                        # healthcheck 통과 대기
```

### C-3. 테이블 생성 확인
```bash
docker compose exec mariadb mariadb \
  -u root -p"${MYSQL_ROOT_PASSWORD}" "${DATABASE_NAME:-storige}" \
  -e "SHOW TABLES"
```
**기대 출력 (21개 테이블)**:
```
binding_types
categories
edit_histories
edit_sessions
editor_contents
editor_designs
file_edit_sessions
files
library_backgrounds
library_categories
library_cliparts
library_fonts
library_frames
library_shapes
paper_types
product_sizes
product_template_sets
products
template_set_items
template_sets
templates
users
worker_jobs
```
> 숫자가 다르면 init.sql에 구문 오류가 있습니다. MariaDB 로그 확인:
> `docker compose logs mariadb | grep -i error | tail -50`

### C-4. 핵심 테이블 컬럼 샘플 점검
```bash
docker compose exec mariadb mariadb -u root -p"${MYSQL_ROOT_PASSWORD}" "${DATABASE_NAME:-storige}" \
  -e "DESCRIBE file_edit_sessions; DESCRIBE worker_jobs; DESCRIBE files;"
```
예상 컬럼이 모두 나오는지 눈으로 확인.

---

## 5. 단계 D — API 기동 + E2E 저장 검증 (10분)

### D-1. `NODE_ENV=production` 로 API 기동
```bash
cd apps/api
# 앱별 .env가 있으면 그걸, 없으면 루트 .env 참고
NODE_ENV=production pnpm dev
# 또는 빌드 후:
pnpm build && NODE_ENV=production node dist/main.js
```
로그에 `ER_NO_SUCH_TABLE` 또는 `Table 'xxx' doesn't exist` 가 **없어야 합니다.**

### D-2. 헬스 체크
```bash
curl -s http://localhost:4000/api/health | jq .
# { "status": "ok", ... } 형식 기대
```

### D-3. 스모크 테스트 (저장 엔드포인트)
```bash
# 로그인으로 JWT 획득 (seed 어드민)
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@storige.com","password":"admin123"}' \
  | jq -r '.accessToken // .access_token // .token')

echo "TOKEN=$TOKEN"

# 편집 세션 조회(빈 목록이어도 200이어야 함 = 테이블 존재 증명)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/edit-sessions | head -c 500; echo
```
200이 오면 테이블 존재 확정. 500/에러면 로그의 SQL 에러 메시지로 역추적.

### D-4. 완료 체크리스트 (이 4개가 전부 OK여야 P1 진입)
- [ ] `docker compose down -v && up -d` 직후 MariaDB 로그에 에러 없음
- [ ] `SHOW TABLES` 결과 21개
- [ ] `NODE_ENV=production pnpm dev` 로그에 `ER_NO_SUCH_TABLE` 없음
- [ ] `GET /api/edit-sessions` HTTP 200

---

## 6. 단계 E — TypeORM Migrations 전환 준비 (선택, 1~2시간)

> 단계 D까지만 끝내도 "즉시 운영 가능"합니다.
> 다만 **앞으로 엔티티가 바뀔 때마다 init.sql을 손으로 고치는 구조는 지속 불가**합니다.
> 다음 스프린트에서 아래 뼈대를 놓으세요. 지금 당장은 건너뛰어도 됩니다.

### E-1. TypeORM 데이터소스 정의
`apps/api/src/database/data-source.ts` 신규 작성:
```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';

export default new DataSource({
  type: 'mariadb',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME ?? 'storige',
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  migrationsRun: false,
  logging: ['error', 'warn', 'migration'],
});
```

### E-2. `apps/api/package.json` 스크립트 추가
```json
{
  "scripts": {
    "typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
    "migration:generate": "pnpm typeorm migration:generate src/database/migrations/Auto",
    "migration:run": "pnpm typeorm migration:run",
    "migration:revert": "pnpm typeorm migration:revert"
  }
}
```

### E-3. 첫 마이그레이션 생성 방법
```bash
# (a) init.sql 그대로 적용된 DB에 연결
# (b) 엔티티와 DB 차이를 마이그레이션 파일로 추출 (변화가 없으면 빈 파일)
cd apps/api && pnpm migration:generate
# src/database/migrations/<timestamp>-Auto.ts 생성 확인
```
이후부터는 엔티티 수정 → `pnpm migration:generate` → `pnpm migration:run` 표준 흐름.

### E-4. 운영에 넘기는 순서 (당장은 실행 X)
1. 새 환경 구축 시 `init.sql`은 seed 데이터만 남긴다.
2. CI 또는 배포 스크립트에서 `pnpm migration:run` 을 서비스 기동 전에 돌린다.
3. 이 시점에 docker-compose의 `synchronize: false`가 "정답"이 된다.

---

## 7. 롤백 계획 (문제 생겼을 때)

### 7-1. init.sql 교체 자체를 되돌리기
```bash
cp docker/mysql/init.sql.bak-YYYYMMDD docker/mysql/init.sql
docker compose down -v
docker compose up -d mariadb
```

### 7-2. 운영 DB에 데이터가 이미 있는 상태라면?
- **절대 `down -v` 금지.**
- 대신: 단계 B의 CREATE TABLE 중 "누락된 13개"만 개별 SQL 파일로 추출하고, 운영 DBA가 `mariadb -u ... < missing_tables.sql` 로 추가 적용.
- 기존 10개 테이블은 건드리지 않는다.
- 이 경로는 본 문서 범위를 벗어나므로, **운영 DBA와 반드시 동행** 하세요.

---

## 8. 자주 하는 실수

1. **`DATABASE_NAME` 오타** — `.env`의 값이 MariaDB 컨테이너와 다르면 SHOW TABLES가 빈 결과. `docker compose exec mariadb mariadb -u root -p"${MYSQL_ROOT_PASSWORD}" -e "SHOW DATABASES;"`로 실제 생성된 DB명 확인.
2. **bcrypt 해시 방치** — init.sql 맨 아래 seed admin의 `password_hash`를 교체하지 않으면 로그인 불가. `node -e "console.log(require('bcryptjs').hashSync('admin123', 10))"`로 재생성.
3. **`down` 만 실행** — `down`은 볼륨을 유지합니다. 스키마 변경은 `down -v`가 필요(로컬에서만).
4. **엔티티가 추가되었는데 init.sql 갱신 누락** — 단계 E(migrations)가 도입되기 전까지는, 엔티티 변경 시 **반드시 init.sql도 손봐야** 합니다. `grep -rhE "@Entity\('" apps/api/src` 로 24개인지 상시 확인.
5. **외부 Bookmoa 테이블을 자체 DB에 만드는 실수** — `cate`, `member`, `order_common`은 **외부 DB**입니다. 자체 DB에 만들지 마세요. (본 init.sql은 이미 제외되어 있음)

---

## 9. 한 줄 결론

> `docker compose down -v && docker compose up -d mariadb` 뒤 `SHOW TABLES`가 21개를 보여주고,
> `NODE_ENV=production`으로 API를 띄웠을 때 `ER_NO_SUCH_TABLE`이 하나도 안 뜨면, P0-A는 끝입니다.
> 그때부터 P1(`useWorkSave.ts` 저장 완료 체인)로 진입하세요.
