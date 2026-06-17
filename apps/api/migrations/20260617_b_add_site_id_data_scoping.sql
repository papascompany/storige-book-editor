-- =====================================================================
-- 20260617_b_add_site_id_data_scoping.sql
-- P2a 멀티테넌시 — 데이터 스코핑용 site_id 컬럼 추가(콘텐츠/소유 리소스).
--
-- 정책(설계 §2): 모두 nullable·additive.
--  - hybrid(NULL=시스템공유, 모든 site 노출): templates·template_sets·categories·
--    library_categories·library_frames/backgrounds/cliparts/shapes/fonts
--  - site-scoped(소유, NULL=레거시 미지정): product_template_sets·products·files
-- 기존 행은 전부 NULL 로 남겨 시스템공유/레거시로 간주 → **비파괴·무중단**(전역 조회 시 그대로 노출).
-- 실제 조회 격리는 P2b(QueryScope 라우터 적용)에서 활성화. 이 마이그레이션만으로는 동작 불변.
--
-- ✅ ADD COLUMN(nullable) = MariaDB INSTANT(메타데이터, lock 최소). CREATE INDEX = INPLACE(online).
-- ✅ 멱등성: 모든 ADD COLUMN/CREATE INDEX 에 IF NOT EXISTS — 부분실패 후 재실행해도 ERROR 1060/1061 없이 안전.
-- ⚠️ files/products 가 대형이면 인덱스 생성에 시간/부하 → 점검 윈도우 권장(런북 참조).
-- ⚠️ synchronize=false → 수동 실행 후 API 재배포 순서 준수. (feedback_schema_change_deploy)
-- 롤백: 컬럼은 nullable·미사용이라 API 만 직전 이미지로 롤백하면 그대로 inert(권장). 완전 제거는
--   ALTER TABLE <t> DROP COLUMN IF EXISTS site_id; (인덱스 동반 삭제) 를 12 테이블에 적용.
-- =====================================================================

-- 1) site_id 컬럼 추가 (전부 nullable, 기존 행 = NULL)
ALTER TABLE templates                       ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE template_sets                   ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE product_template_sets           ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE categories                      ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_categories              ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_frames                  ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_backgrounds             ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_cliparts                ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_shapes                  ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE library_fonts                   ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE products                        ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;
ALTER TABLE files                           ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) NULL;

-- 2) 인덱스 (조회 필터 site_id IN (...) 성능). 대형 테이블은 점검 윈도우에서.
CREATE INDEX IF NOT EXISTS idx_templates_site_id                ON templates(site_id);
CREATE INDEX IF NOT EXISTS idx_template_sets_site_id            ON template_sets(site_id);
CREATE INDEX IF NOT EXISTS idx_product_template_sets_site_id    ON product_template_sets(site_id);
CREATE INDEX IF NOT EXISTS idx_categories_site_id               ON categories(site_id);
CREATE INDEX IF NOT EXISTS idx_library_categories_site_id       ON library_categories(site_id);
CREATE INDEX IF NOT EXISTS idx_library_frames_site_id           ON library_frames(site_id);
CREATE INDEX IF NOT EXISTS idx_library_backgrounds_site_id      ON library_backgrounds(site_id);
CREATE INDEX IF NOT EXISTS idx_library_cliparts_site_id         ON library_cliparts(site_id);
CREATE INDEX IF NOT EXISTS idx_library_shapes_site_id           ON library_shapes(site_id);
CREATE INDEX IF NOT EXISTS idx_library_fonts_site_id            ON library_fonts(site_id);
CREATE INDEX IF NOT EXISTS idx_products_site_id                 ON products(site_id);
CREATE INDEX IF NOT EXISTS idx_files_site_id                    ON files(site_id);

-- 3) (선택) FK 제약: site_id → sites(id) ON DELETE SET NULL.
--    site 삭제 시 콘텐츠를 시스템공유(NULL)로 강등(데이터 보존). 대형테이블 FK 추가는 점검윈도우 권장.
--    P2a 에서는 컬럼+인덱스만, FK 는 P2b/운영 판단으로 분리(아래는 참고용, 기본 미적용).
-- ALTER TABLE files ADD CONSTRAINT fk_files_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

-- 기존 데이터 백필 없음(전부 NULL=시스템공유/레거시). 운영팀이 필요 시 특정 site 로 UPDATE.
