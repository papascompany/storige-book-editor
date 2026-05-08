import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsArray,
  IsIn,
  ValidateNested,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TemplateSetType, TemplateRef, EditorMode, EditorMenuKey, ALL_EDITOR_MENU_KEYS } from '@storige/types';

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
