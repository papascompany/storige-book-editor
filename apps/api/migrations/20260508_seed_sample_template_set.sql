-- ============================================================
-- Seed: 2026-05-08 — 샘플 8×8 inch 책 템플릿셋 + 표지 스프레드 + 내지
-- ============================================================
-- 사유: 편집기를 URL 파라미터 없이 진입했을 때 100×100mm 빈 캔버스 대신
--      "8×8 inch 책(24p)" 샘플 템플릿셋을 자동 로드해 표지부터 순서대로
--      편집할 수 있게 하기 위한 기본 데이터.
--
-- ID 고정 (idempotent):
--   - templates: sample-spread-cover-8x8, sample-page-8x8
--   - template_sets: sample-8x8-book-24p
--   ※ EditorView 가 이 ID 를 직접 참조하므로 변경 금지.
--
-- 적용 방법:
--   docker-compose exec mysql mariadb -ustorige -p storige < \
--     apps/api/migrations/20260508_seed_sample_template_set.sql
--
-- 안전성:
--   • INSERT ... ON DUPLICATE KEY UPDATE 로 재실행 안전
--   • 다른 데이터에 영향 없음 (id 고정 신규 row 만 추가/갱신)
--   • 롤백:
--     DELETE FROM template_sets WHERE id = 'sample-8x8-book-24p';
--     DELETE FROM templates WHERE id IN ('sample-spread-cover-8x8','sample-page-8x8');
-- ============================================================

-- ----------------------------------------------------------------
-- 1. 표지 스프레드 템플릿 (앞표지 + 책등 + 뒤표지)
--    크기: (203.2 × 2) + 1.7 (책등 24p 무선제본) = 408.1 mm × 203.2 mm
--    빈 canvasData → 에디터가 SpreadPlugin 으로 가이드/워크스페이스 동적 생성
-- ----------------------------------------------------------------
INSERT INTO templates (
  id, name, thumbnail_url, type, width, height,
  editable, deleteable, canvas_data, spread_config, is_deleted, is_active
) VALUES (
  'sample-spread-cover-8x8',
  '샘플 표지 (8×8 inch · 펼침면)',
  NULL,
  'spread',
  408.1,
  203.2,
  TRUE, FALSE,
  JSON_OBJECT(
    'version', '5.3.1',
    'objects', JSON_ARRAY(),
    'width', 408.1,
    'height', 203.2
  ),
  JSON_OBJECT(
    'version', 1,
    'spec', JSON_OBJECT(
      'coverWidthMm', 203.2,
      'coverHeightMm', 203.2,
      'spineWidthMm', 1.7,
      'wingEnabled', FALSE,
      'wingWidthMm', 0,
      'cutSizeMm', 3,
      'safeSizeMm', 3,
      'dpi', 150
    ),
    'regions', JSON_ARRAY(),
    'totalWidthMm', 408.1,
    'totalHeightMm', 203.2
  ),
  FALSE, TRUE
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  width = VALUES(width),
  height = VALUES(height),
  canvas_data = VALUES(canvas_data),
  spread_config = VALUES(spread_config),
  is_deleted = FALSE,
  is_active = TRUE;

-- ----------------------------------------------------------------
-- 2. 내지 템플릿 (8×8 inch = 203.2 × 203.2 mm)
--    빈 canvasData → 에디터가 빈 워크스페이스로 초기화
-- ----------------------------------------------------------------
INSERT INTO templates (
  id, name, thumbnail_url, type, width, height,
  editable, deleteable, canvas_data, spread_config, is_deleted, is_active
) VALUES (
  'sample-page-8x8',
  '샘플 내지 (8×8 inch)',
  NULL,
  'page',
  203.2,
  203.2,
  TRUE, TRUE,
  JSON_OBJECT(
    'version', '5.3.1',
    'objects', JSON_ARRAY(),
    'width', 203.2,
    'height', 203.2
  ),
  NULL,
  FALSE, TRUE
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  width = VALUES(width),
  height = VALUES(height),
  canvas_data = VALUES(canvas_data),
  is_deleted = FALSE,
  is_active = TRUE;

-- ----------------------------------------------------------------
-- 3. 템플릿셋 — 책모드(BOOK editor mode), 표지 1 + 내지 24
--    pageCountRange: [8, 24, 48] (사용자가 추후 페이지 수 조정 가능)
--    enabled_menus: NULL (모든 도구 노출)
-- ----------------------------------------------------------------
INSERT INTO template_sets (
  id, name, thumbnail_url, type, width, height,
  can_add_page, page_count_range, templates, editor_mode, enabled_menus,
  is_deleted, is_active
) VALUES (
  'sample-8x8-book-24p',
  '샘플 8×8 inch 책 (24p)',
  NULL,
  'book',
  203.2,
  203.2,
  TRUE,
  JSON_ARRAY(8, 24, 48),
  JSON_ARRAY(
    -- 표지 스프레드 (1) — required
    JSON_OBJECT('templateId', 'sample-spread-cover-8x8', 'required', TRUE),
    -- 내지 24장 — 같은 templateId 반복 (각 페이지가 독립 캔버스로 로드됨)
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE),
    JSON_OBJECT('templateId', 'sample-page-8x8', 'required', FALSE)
  ),
  'book',
  NULL,
  FALSE, TRUE
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  width = VALUES(width),
  height = VALUES(height),
  can_add_page = VALUES(can_add_page),
  page_count_range = VALUES(page_count_range),
  templates = VALUES(templates),
  editor_mode = VALUES(editor_mode),
  is_deleted = FALSE,
  is_active = TRUE;
