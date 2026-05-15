-- ============================================================
-- Migration: 2026-05-15 — 더미 템플릿 청소 + 샘플 templates thumbnail 적용
-- ============================================================
-- 사유:
--   admin 의 라이브러리/템플릿셋/템플릿 페이지에서 모든 썸네일이 깨져 보임.
--   원인 진단 결과 (storige fix d81b544 + 5b44825 후):
--   • 라이브러리(Frame/Clipart/Background): /storage/* 경로 fix 후 정상
--   • Template / TemplateSet: thumbnail_url 자체가 NULL — 시드 데이터가
--     디자인 없이 만들어졌고 useTemplateSave 의 자동 썸네일 생성 경로를
--     거치지 않아 한 번도 생성된 적 없음.
--
--   세 그룹의 시드 정체:
--   • tpl-cover, tpl-page-1~4 (2026-04-27 시드, canvas_data.objects 0개)
--     → 순수 더미 (의미 없음). 운영에서 안 쓰이면 소프트 삭제.
--   • sample-page-8x8, sample-spread-cover-8x8 (2026-05-09 시드)
--     → 샘플 자동 진입용. placeholder SVG 를 thumbnail 로 부여.
--   • A4 사철제본/무선제본/3단 리플렛/A5 스프링제본 등 (2026-05-03)
--     → 운영 후보 — admin 에서 직접 편집·저장하면 useTemplateSave 가
--       자동 캡쳐. 본 마이그레이션은 손대지 않음 (운영자 결정 보존).
--
-- 적용:
--   docker-compose exec mysql mariadb -ustorige -p storige < \
--     apps/api/migrations/20260515_cleanup_dummy_templates_and_seed_thumbnails.sql
--
-- 안전성:
--   • 더미 청소는 isDeleted=TRUE 소프트 삭제 — DB row 보존, admin 목록
--     에서만 숨김 (template_sets.service.findAll 이 isDeleted=false 필터).
--   • 롤백:
--     UPDATE templates SET is_deleted=FALSE WHERE id IN
--       ('tpl-cover','tpl-page-1','tpl-page-2','tpl-page-3','tpl-page-4');
--     UPDATE templates SET thumbnail_url=NULL WHERE id IN
--       ('sample-page-8x8','sample-spread-cover-8x8');
-- ============================================================

-- 1. 더미 templates 소프트 삭제 (2026-04-27 시드, canvas 비어있음)
UPDATE templates
SET is_deleted = TRUE,
    is_active = FALSE
WHERE id IN ('tpl-cover','tpl-page-1','tpl-page-2','tpl-page-3','tpl-page-4');

-- 2. 샘플 시드 templates 의 thumbnail_url 적용
--    파일: storige/storage/library/template-samples/ (deploy@VPS 에 미리 업로드)
--    nginx 가 /storage/* 직접 서빙 → admin 의 resolveStorageUrl 이 절대 URL 변환.
UPDATE templates
SET thumbnail_url = '/storage/library/template-samples/sample-page-8x8.svg'
WHERE id = 'sample-page-8x8';

UPDATE templates
SET thumbnail_url = '/storage/library/template-samples/sample-spread-cover-8x8.svg'
WHERE id = 'sample-spread-cover-8x8';

-- 3. 샘플 templateSet 의 thumbnail_url 적용
--    (TemplateSet 자체 썸네일 — 목록에서 그룹 대표 이미지로 노출)
UPDATE template_sets
SET thumbnail_url = '/storage/library/template-samples/sample-spread-cover-8x8.svg'
WHERE id = 'sample-8x8-book-24p';
