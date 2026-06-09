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
import { TemplateSetType, TemplateRef, EditorMode, EditorMenuKey, ALL_EDITOR_MENU_KEYS, PdfOutputMode } from '@storige/types';

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

  @ApiProperty({ enum: ['book', 'leaflet'], example: 'book' })
  @IsEnum(['book', 'leaflet'])
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

  @ApiPropertyOptional({ enum: ['book', 'leaflet'], example: 'book' })
  @IsOptional()
  @IsEnum(['book', 'leaflet'])
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
}

/**
 * 템플릿셋 조회 쿼리 DTO
 */
export class TemplateSetQueryDto {
  @ApiPropertyOptional({ enum: ['book', 'leaflet'] })
  @IsOptional()
  @IsEnum(['book', 'leaflet'])
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
