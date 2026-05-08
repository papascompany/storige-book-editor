-- ============================================================
-- Migration: 2026-05-08 — template_sets.enabled_menus 컬럼 추가
-- ============================================================
-- 사유: 템플릿셋(상품) 단위로 에디터 좌측 도구 메뉴 노출 화이트리스트
--      을 저장하기 위한 컬럼 추가.
--      - null: 모든 메뉴 노출 (legacy/기본값)
--      - JSON 배열: 배열에 포함된 키만 노출 (예: ['UPLOAD','TEXT','IMAGE'])
--      - 빈 배열 []: 모든 도구 메뉴 숨김 (※ 업로드만 별도 옵션)
--      관련 코드:
--      - packages/types/src/index.ts (EditorMenuKey / EDITOR_MENU_DEFS)
--      - apps/api/src/templates/entities/template-set.entity.ts
--      - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx
--      - apps/editor/src/components/editor/ToolBar.tsx
--
-- 적용 대상: 기존 production / staging DB.
--           development 는 TypeORM synchronize=true 로 자동 적용.
--
-- 적용 방법:
--   docker-compose exec mysql mariadb -uroot -p storige < \
--     apps/api/migrations/20260508_add_template_sets_enabledMenus.sql
--
-- 안전성:
--   • IF NOT EXISTS 로 중복 실행 안전 (MariaDB 10.5+)
--   • DEFAULT NULL 로 기존 템플릿셋은 모든 메뉴 노출 유지 (동작 변경 없음)
--   • JSON 컬럼 — 추가 도구가 들어와도 스키마 변경 불필요
--   • 롤백: ALTER TABLE template_sets DROP COLUMN enabled_menus;
-- ============================================================

ALTER TABLE template_sets
  ADD COLUMN IF NOT EXISTS enabled_menus JSON NULL DEFAULT NULL
  COMMENT '에디터 도구 메뉴 노출 화이트리스트 (null=모두 노출, []=모두 숨김)';
