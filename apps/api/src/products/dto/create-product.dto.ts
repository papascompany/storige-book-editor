import { IsString, IsOptional, IsBoolean, IsObject, IsArray, IsNumber, IsUUID } from 'class-validator';

/**
 * Product 생성 DTO
 *
 * 2026-05-03 v2 업데이트: Admin UI 호환 필드 추가 (name/code/categoryId/price/templateSetId).
 *
 * 두 가지 사용 시나리오 지원:
 *  1. **Bookmoa-style 상품 (Admin UI 사용)**: name + code + categoryId + price → 사용자 노출용 메타데이터
 *  2. **Storige-style 상품 (외부 wowpress 등)**: title + template + editorTemplates → 에디터 프리셋
 *
 * 두 모델은 호환 가능 — `title`이 없으면 `name`을 자동 매핑 (역도 마찬가지).
 */
export class CreateProductDto {
  // ─── Bookmoa-style 필드 (Admin UI / bookmoa 연동, 2026-05-03 추가) ───────

  /** 상품명 — Bookmoa-style. title 미설정 시 이 값으로 자동 매핑 */
  @IsOptional()
  @IsString()
  name?: string;

  /** 상품 코드 (예: BOOK-A4-20P) — Bookmoa 외부 쇼핑몰 매핑용 */
  @IsOptional()
  @IsString()
  code?: string;

  /** 카테고리 ID — Bookmoa 카테고리 트리 매핑용 */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** 가격 (원) */
  @IsOptional()
  @IsNumber()
  price?: number;

  /** 연결된 템플릿셋 ID */
  @IsOptional()
  @IsUUID()
  templateSetId?: string;

  // ─── Storige-style 필드 (기존 호환) ──────────────────────────────────

  /** 상품 제목 (Storige-style). name이 있으면 자동으로 name으로 fallback */
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  productId?: string; // External product ID (e.g., WowPress)

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  template?: {
    editorPreset?: {
      settings: {
        dpi?: number;
        guideline?: { cutLine?: boolean; safeLine?: boolean };
        page?: { count?: number; min?: number; max?: number; interval?: number };
        size?: { width?: number; height?: number; cutSize?: number; safeSize?: number };
        unit?: string;
        exportOption?: { colorMode?: 'RGB' | 'CMYK' };
        menu?: unknown[];
      };
      defaultTemplate?: { id: string } | null;
      editorTemplates?: Array<{
        id: string;
        name: string;
        sizeNo?: number;
        image?: { image?: { url?: string } };
        design?: { document?: { url?: string } };
      }> | null;
    } | null;
  };

  @IsOptional()
  @IsObject()
  wowPressProduct?: {
    prodname?: string;
    dlvygrpname?: string;
    sizeinfo?: Array<{ sizelist: Array<{
      sizeno?: number;
      width?: number;
      height?: number;
      non_standard?: boolean;
    }> }>;
    colorinfo?: Array<{ pagelist: unknown[] }>;
  };

  @IsOptional()
  @IsArray()
  editorTemplates?: Array<{
    id: string;
    name: string;
    sizeNo?: number;
    image?: { image?: { url?: string } };
    design?: { document?: { url?: string } };
  }>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * 옵션 C — 외부 쇼핑몰이 width/height URL 파라미터로 사이즈 override 허용 여부.
   */
  @IsOptional()
  @IsBoolean()
  allowCustomSize?: boolean;
}
