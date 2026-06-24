import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsArray,
  IsIn,
  IsObject,
  ValidateNested,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TemplateSetType, TemplateRef, EditorMode, EditorMenuKey, ALL_EDITOR_MENU_KEYS, PdfOutputMode, ColorOutputMode } from '@storige/types';

/**
 * 면지 구성 DTO — 인쇄 워크플로우 v1 Phase 3 (2026-05-19).
 */
export class EndpaperConfigDto {
  @ApiProperty({ minimum: 0, maximum: 6, example: 2, description: '앞면지 개수 (0~6)' })
  @IsNumber()
  @Min(0)
  @Max(6)
  frontCount: number;

  @ApiProperty({ minimum: 0, maximum: 6, example: 1, description: '뒷면지 개수 (0~6)' })
  @IsNumber()
  @Min(0)
  @Max(6)
  backCount: number;

  @ApiProperty({ example: false, description: '앞면지 편집 가능 여부' })
  @IsBoolean()
  frontEditable: boolean;

  @ApiProperty({ example: false, description: '뒷면지 편집 가능 여부' })
  @IsBoolean()
  backEditable: boolean;
}

/**
 * 포토북 페이지 가변 가격 메타 DTO (Phase 2 §8).
 * storige 는 가격 계산을 하지 않는다 — 본 메타 + pageCount 를 파트너 장바구니에 emit 만 한다.
 */
export class PhotobookPricingDto {
  @ApiProperty({ minimum: 0, example: 16, description: '기본 포함 페이지' })
  @IsNumber()
  @Min(0)
  includedPages: number;

  @ApiProperty({ minimum: 0, example: 16, description: '최소 제작 페이지(삭제 가드)' })
  @IsNumber()
  @Min(0)
  minPages: number;

  @ApiProperty({ minimum: 1, example: 2, description: '증감 단위(펼침면=2)' })
  @IsNumber()
  @Min(1)
  pageStep: number;

  @ApiProperty({ minimum: 0, example: 1000, description: '초과 페이지당 단가' })
  @IsNumber()
  @Min(0)
  perPageUnit: number;
}

/**
 * 템플릿 참조 DTO
 */
export class TemplateRefDto implements TemplateRef {
  @ApiProperty({ example: 'template-id-123' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiProperty({ example: false, description: '필수 페이지 여부' })
  @IsBoolean()
  required: boolean;
}

/**
 * 템플릿셋 생성 DTO
 */
export class CreateTemplateSetDto {
  @ApiProperty({ example: 'A4 책자 기본 세트' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'https://example.com/thumbnail.jpg' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ enum: TemplateSetType, example: 'book' })
  @IsEnum(TemplateSetType)
  type: TemplateSetType;

  @ApiProperty({ example: 210, description: '판형 가로 (mm)' })
  @IsNumber()
  @Min(1)
  width: number;

  @ApiProperty({ example: 297, description: '판형 세로 (mm)' })
  @IsNumber()
  @Min(1)
  height: number;

  @ApiPropertyOptional({ example: true, description: '내지 추가 가능 여부' })
  @IsOptional()
  @IsBoolean()
  canAddPage?: boolean;

  @ApiPropertyOptional({
    example: [10, 20, 30, 40],
    description: '내지 수량 범위',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  pageCountRange?: number[];

  @ApiPropertyOptional({
    type: [TemplateRefDto],
    description: '템플릿 구성 (순서 포함)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateRefDto)
  templates?: TemplateRefDto[];

  @ApiPropertyOptional({
    enum: ['single', 'book'],
    example: 'single',
    description: '에디터 모드: single(개별 캔버스) | book(스프레드)',
  })
  @IsOptional()
  @IsEnum(['single', 'book'])
  editorMode?: EditorMode;

  @ApiPropertyOptional({ example: 'category-id-123' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: ALL_EDITOR_MENU_KEYS,
    example: ['UPLOAD', 'TEXT', 'IMAGE', 'BACKGROUND'],
    description:
      '에디터 좌측 도구 메뉴 노출 화이트리스트. null=모두 노출(기본), 빈 배열=모두 숨김.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_EDITOR_MENU_KEYS, { each: true })
  enabledMenus?: EditorMenuKey[] | null;

  // ── 인쇄 워크플로우 v1 Phase 3 (2026-05-19) ──
  @ApiPropertyOptional({ type: EndpaperConfigDto, description: '면지 구성 (null=면지 없음)', nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EndpaperConfigDto)
  endpaperConfig?: EndpaperConfigDto | null;

  // ── 포토북 가격 메타 (Phase 2 §8) — PHOTOBOOK 전용, storige 는 emit 만 ──
  @ApiPropertyOptional({ type: PhotobookPricingDto, description: '포토북 페이지 가변 가격 메타 (null=미사용)', nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotobookPricingDto)
  pricing?: PhotobookPricingDto | null;

  @ApiPropertyOptional({ example: true, description: '표지 편집 가능 여부 (기본 true, 레더커버=false)' })
  @IsOptional()
  @IsBoolean()
  coverEditable?: boolean;

  @ApiPropertyOptional({ description: '레더커버 미리보기 storage URL (coverEditable=false 일 때만 의미)', nullable: true })
  @IsOptional()
  @IsString()
  coverPreviewImage?: string | null;

  @ApiPropertyOptional({ example: true, description: '내지 PDF 첨부 파일 편집 가능 여부 (기본 true, false=가이드만·편집차단)' })
  @IsOptional()
  @IsBoolean()
  contentPdfEditable?: boolean;

  @IsOptional()
  @IsIn(['single', 'duplex-merged', 'duplex-split'])
  pdfOutputMode?: PdfOutputMode;

  @IsOptional()
  @IsIn(['rgb', 'cmyk'])
  colorMode?: ColorOutputMode;

  // ── 블리드 / 재단선 / 사이즈 검증 허용오차 (2026-06-10) ──
  @ApiPropertyOptional({ example: 3, minimum: 0, maximum: 50, description: '사방 블리드 mm (0=없음, 기본 3)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  bleedMm?: number;

  @ApiPropertyOptional({ example: false, description: '재단선 마커 표기 ON/OFF (기본 false)' })
  @IsOptional()
  @IsBoolean()
  cropMarkEnabled?: boolean;

  @ApiPropertyOptional({ example: 0.2, minimum: 0, maximum: 10, description: '업로드 PDF 사이즈 검증 허용오차 mm (기본 0.2)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  sizeToleranceMm?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  libraryCategoryIds?: string[];
}

/**
 * 템플릿셋 수정 DTO
 */
export class UpdateTemplateSetDto {
  @ApiPropertyOptional({ example: 'A4 책자 프리미엄 세트' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/thumbnail.jpg' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ enum: TemplateSetType, example: 'book' })
  @IsOptional()
  @IsEnum(TemplateSetType)
  type?: TemplateSetType;

  @ApiPropertyOptional({ example: 210, description: '판형 가로 (mm)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  width?: number;

  @ApiPropertyOptional({ example: 297, description: '판형 세로 (mm)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  height?: number;

  @ApiPropertyOptional({ example: true, description: '내지 추가 가능 여부' })
  @IsOptional()
  @IsBoolean()
  canAddPage?: boolean;

  @ApiPropertyOptional({
    example: [10, 20, 30, 40],
    description: '내지 수량 범위',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  pageCountRange?: number[];

  @ApiPropertyOptional({
    type: [TemplateRefDto],
    description: '템플릿 구성 (순서 포함)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateRefDto)
  templates?: TemplateRefDto[];

  @ApiPropertyOptional({
    enum: ['single', 'book'],
    example: 'single',
    description: '에디터 모드: single(개별 캔버스) | book(스프레드)',
  })
  @IsOptional()
  @IsEnum(['single', 'book'])
  editorMode?: EditorMode;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    enum: ALL_EDITOR_MENU_KEYS,
    example: ['UPLOAD', 'TEXT', 'IMAGE', 'BACKGROUND'],
    description:
      '에디터 좌측 도구 메뉴 노출 화이트리스트. null=모두 노출(기본), 빈 배열=모두 숨김.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_EDITOR_MENU_KEYS, { each: true })
  enabledMenus?: EditorMenuKey[] | null;

  // ── 인쇄 워크플로우 v1 Phase 3 (2026-05-19) ──
  @ApiPropertyOptional({ type: EndpaperConfigDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EndpaperConfigDto)
  endpaperConfig?: EndpaperConfigDto | null;

  // 포토북 가격 메타 (Phase 2 §8) — 수정 시에도 영속되도록 UpdateDto 에 포함
  @ApiPropertyOptional({ type: PhotobookPricingDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotobookPricingDto)
  pricing?: PhotobookPricingDto | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  coverEditable?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  coverPreviewImage?: string | null;

  @ApiPropertyOptional({ example: true, description: '내지 PDF 첨부 파일 편집 가능 여부 (기본 true)' })
  @IsOptional()
  @IsBoolean()
  contentPdfEditable?: boolean;

  @IsOptional()
  @IsIn(['single', 'duplex-merged', 'duplex-split'])
  pdfOutputMode?: PdfOutputMode;

  @IsOptional()
  @IsIn(['rgb', 'cmyk'])
  colorMode?: ColorOutputMode;

  // ── 블리드 / 재단선 / 사이즈 검증 허용오차 (2026-06-10) ──
  @ApiPropertyOptional({ example: 3, minimum: 0, maximum: 50, description: '사방 블리드 mm (0=없음, 기본 3)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  bleedMm?: number;

  @ApiPropertyOptional({ example: false, description: '재단선 마커 표기 ON/OFF (기본 false)' })
  @IsOptional()
  @IsBoolean()
  cropMarkEnabled?: boolean;

  @ApiPropertyOptional({ example: 0.2, minimum: 0, maximum: 10, description: '업로드 PDF 사이즈 검증 허용오차 mm (기본 0.2)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  sizeToleranceMm?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  libraryCategoryIds?: string[];
}

/**
 * 템플릿셋 조회 쿼리 DTO
 */
export class TemplateSetQueryDto {
  @ApiPropertyOptional({ enum: TemplateSetType })
  @IsOptional()
  @IsEnum(TemplateSetType)
  type?: TemplateSetType;

  @ApiPropertyOptional({ example: 210, description: '판형 가로 (mm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  width?: number;

  @ApiPropertyOptional({ example: 297, description: '판형 세로 (mm)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  height?: number;

  @ApiPropertyOptional({ example: 'category-id-123' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ example: false, description: '삭제된 항목 포함' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeDeleted?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  pageSize?: number;
}

/**
 * 템플릿 추가 DTO
 */
export class AddTemplateDto {
  @ApiProperty({ example: 'template-id-123' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiPropertyOptional({ example: false, description: '필수 페이지 여부' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ example: 5, description: '삽입 위치 (0부터 시작)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}

/**
 * 템플릿 순서 변경 DTO
 */
export class ReorderTemplatesDto {
  @ApiProperty({
    type: [TemplateRefDto],
    description: '새로운 템플릿 순서',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateRefDto)
  templates: TemplateRefDto[];
}
