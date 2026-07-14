-- =====================================================================
-- 20260714_add_format_presets.sql
-- 판형 프리셋(format_presets) 테이블 신규 + 표준 7종 시드.
--
-- - 인쇄물 규격(재단 사이즈 mm)의 저작측 정본 — templateSet 생성 시 값을
--   복사 주입한다(templateSet 에 presetId 컬럼 없음, 무스키마).
-- - 세로형(portrait) 기준 1행 저장. 방향 토글은 UI 에서 W↔H 스왑.
-- - 하드 삭제 금지: FormatPresetSeedService(OnModuleInit) 가 code 기준
--   멱등 시드로 부활시켜 충돌 — is_active 소프트 토글만 사용.
-- - 멱등: CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE
--   (재실행 안전, 운영자가 수정한 기존 행은 덮어쓰지 않음).
--
-- ⚠️ prod 는 synchronize=false → 본 SQL 수동 실행 후 API 재배포 순서 준수.
--    (feedback_schema_change_deploy)
-- =====================================================================

CREATE TABLE IF NOT EXISTS format_presets (
  id             VARCHAR(36) PRIMARY KEY,
  code           VARCHAR(50) UNIQUE NOT NULL,        -- 시드 멱등 키
  name           VARCHAR(100) NOT NULL,
  trim_width_mm  FLOAT NOT NULL,                     -- 재단 폭 mm (세로형 기준)
  trim_height_mm FLOAT NOT NULL,                     -- 재단 높이 mm (세로형 기준)
  bleed_mm       FLOAT NOT NULL DEFAULT 3,           -- 사방 블리드. 작업 = 재단 + 2×bleed
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,      -- 소프트 토글 (하드 삭제 금지)
  site_id        VARCHAR(36) NULL,                   -- null = 전역 프리셋
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_format_presets_active (is_active),
  INDEX idx_format_presets_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 표준 판형 7종 시드 (세로형 기준, bleed 3mm)
-- code UNIQUE 충돌 시 no-op → 운영자 수정분 보존.
INSERT INTO format_presets
  (id, code, name, trim_width_mm, trim_height_mm, bleed_mm, sort_order)
VALUES
  (UUID(), 'a4',        'A4',     210, 297, 3, 10),
  (UUID(), 'a5',        'A5',     148, 210, 3, 20),
  (UUID(), 'b5',        'B5',     182, 257, 3, 30),
  (UUID(), 'baepan46',  '46배판', 188, 257, 3, 40),
  (UUID(), 'jeol16',    '16절',   190, 260, 3, 50),
  (UUID(), 'b6',        'B6',     128, 182, 3, 60),
  (UUID(), 'square210', '정사각', 210, 210, 3, 70)
ON DUPLICATE KEY UPDATE code = code;

-- 적용 확인:
--   SHOW COLUMNS FROM format_presets LIKE 'trim_width_mm';
--   SELECT code, name, trim_width_mm, trim_height_mm FROM format_presets ORDER BY sort_order;
