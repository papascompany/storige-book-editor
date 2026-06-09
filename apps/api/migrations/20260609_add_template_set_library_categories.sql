-- ============================================================
-- Migration: 2026-06-09 — 템플릿셋 ↔ 라이브러리 카테고리 연결(④)
-- ============================================================
-- 사유: 상품/템플릿셋별로 노출할 에셋(배경/도형/클립아트/프레임/폰트)을
--       '카테고리 단위'로 큐레이션. 조인 테이블 + 카테고리 단위 + "연결 없으면 전역".
--
-- 관련 코드:
--   - apps/api/src/templates/entities/template-set-library-category.entity.ts
--   - apps/api/src/templates/template-sets.service.ts (upsert/populate)
--   - apps/api/src/library/library.service.ts (templateSetId 필터 — Phase 2)
--   - apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx (카테고리 멀티셀렉트)
-- ============================================================

CREATE TABLE IF NOT EXISTS `template_set_library_categories` (
  `id` VARCHAR(36) NOT NULL,
  `template_set_id` VARCHAR(36) NOT NULL,
  `library_category_id` VARCHAR(36) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tslc` (`template_set_id`, `library_category_id`),
  KEY `idx_tslc_set` (`template_set_id`),
  CONSTRAINT `fk_tslc_set` FOREIGN KEY (`template_set_id`)
    REFERENCES `template_sets` (`id`) ON DELETE CASCADE
-- ⚠️ template_sets.id 가 utf8mb4_unicode_ci 라 FK 형성을 위해 동일 collation 필수
--    (MariaDB 11.2 의 utf8mb4 기본 collation utf8mb4_uca1400_ai_ci 와 불일치 시 errno 150).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
