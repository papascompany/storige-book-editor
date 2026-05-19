-- ============================================================
-- Migration: 2026-05-19 — storage URL 의 잘못된 /files/ 접두사 제거
-- ============================================================
-- 사유:
--   storageService.saveFile() 가 URL 을 `/storage/files/<cat>/<file>` 로 생성했으나,
--   디스크에는 `<storagePath>/<cat>/<file>` 로 저장 + 운영 nginx 도 같은 경로 매핑.
--   결과: 새로 업로드된 파일이 admin/editor 에서 404 로 깨져 보임.
--
--   코드 fix: storage.service.ts 의 URL 생성에서 `/files/` 제거.
--   이 마이그레이션: 이미 DB 에 저장된 row 의 URL 정리.
--
-- 영향 대상 (사전 조사):
--   • templates.thumbnail_url:        1건 (sample-spread-cover-8x8 의 사용자 저장 썸네일)
--   • editor_designs.image_url/media_url: 0건
--   • template_sets.thumbnail_url:    0건
--
-- 적용:
--   docker exec -i storige-mariadb mariadb -ustorige -p storige < \
--     apps/api/migrations/20260519_fix_storage_url_files_prefix.sql
--
-- 안전성:
--   • UPDATE 만 — 새 row 추가/삭제 없음
--   • REPLACE() 가 정확히 `/storage/files/` → `/storage/` 만 치환 (다른 `/files/` 영향 없음)
--   • 롤백 (필요시):
--     UPDATE templates SET thumbnail_url = REPLACE(thumbnail_url, '/storage/', '/storage/files/')
--       WHERE thumbnail_url LIKE '/storage/designs/%' AND updated_at >= '2026-05-19';
-- ============================================================

-- 1. templates.thumbnail_url
UPDATE templates
SET thumbnail_url = REPLACE(thumbnail_url, '/storage/files/', '/storage/')
WHERE thumbnail_url LIKE '/storage/files/%';

-- 2. editor_designs (image_url, media_url) — 현재 0건이지만 미래 안전망
UPDATE editor_designs
SET image_url = REPLACE(image_url, '/storage/files/', '/storage/')
WHERE image_url LIKE '/storage/files/%';

UPDATE editor_designs
SET media_url = REPLACE(media_url, '/storage/files/', '/storage/')
WHERE media_url LIKE '/storage/files/%';

-- 3. template_sets.thumbnail_url
UPDATE template_sets
SET thumbnail_url = REPLACE(thumbnail_url, '/storage/files/', '/storage/')
WHERE thumbnail_url LIKE '/storage/files/%';
