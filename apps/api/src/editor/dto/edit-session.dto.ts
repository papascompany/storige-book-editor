import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type { CanvasData, EditPage, TemplateType } from '@storige/types';
import { EditSessionStatus } from '../entities/edit-session.entity';

/**
 * 편집 페이지 DTO
 */
export class EditPageDto implements EditPage {
  @ApiProperty({ example: 'page-id-123' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 'template-id-123' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiProperty({ enum: ['wing', 'cover', 'spine', 'page'] })
  @IsEnum(['wing', 'cover', 'spine', 'page'])
  templateType: TemplateType;

  @ApiProperty()
  @IsObject()
  canvasData: CanvasData;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(0)
  sortOrder: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  required: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  deleteable: boolean;
}

/**
 * 세션 생성 DTO (새 버전)
 */
export class CreateEditSessionDto {
  @ApiProperty({ example: 'template-set-id-123', description: '템플릿셋 ID' })
  @IsString()
  @IsNotEmpty()
  templateSetId: string;

  @ApiPropertyOptional({ example: 'order-id-123' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 'user-uuid-here' })
  @IsOptional()
  @IsString()
  userId?: string;

  // Legacy fields
  @ApiPropertyOptional({ example: 'template-uuid-here' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  canvasData?: CanvasData;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  orderOptions?: any;
}

/**
 * 세션 업데이트 DTO
 */
export class UpdateEditSessionDto {
  @ApiPropertyOptional({
    type: [EditPageDto],
    description: '페이지 데이터',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditPageDto)
  pages?: EditPageDto[];

  @ApiPropertyOptional({ example: 'COMPLETED', enum: EditSessionStatus })
  @IsOptional()
  @IsEnum(EditSessionStatus)
  status?: EditSessionStatus;

  // Legacy fields
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  canvasData?: CanvasData;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  orderOptions?: any;
}

/**
 * 자동 저장 DTO
 */
export class AutoSaveDto {
  @ApiPropertyOptional({
    type: [EditPageDto],
    description: '페이지 데이터',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditPageDto)
  pages?: EditPageDto[];

  @ApiPropertyOptional({ example: 0, description: '현재 페이지 인덱스' })
  @IsOptional()
  @IsNumber()
  currentPageIndex?: number;

  @ApiPropertyOptional({
    description: 'BB-Phase 3 follow-up — 시점 스냅샷 썸네일 URL (editor에서 fabric.toDataURL 캡처 후 /storage/upload/thumbnails로 업로드한 URL). 모바일에선 미사용 (TOUCH_ENV 가드).',
    example: '/storage/files/thumbnails/abc.jpg',
  })
  @IsOptional()
  thumbnailUrl?: string;
}

/**
 * 페이지 추가 DTO
 */
export class AddPageDto {
  @ApiPropertyOptional({
    example: 5,
    description: '삽입 위치 (기본: 마지막 내지 뒤)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  position?: number;
}

/**
 * 페이지 순서 변경 DTO
 */
export class ReorderPagesDto {
  @ApiProperty({
    type: [String],
    description: '새로운 페이지 ID 순서',
  })
  @IsArray()
  @IsString({ each: true })
  pageIds: string[];
}

/**
 * 템플릿 교체 DTO
 */
export class ReplaceTemplateDto {
  @ApiProperty({ example: 'new-template-id-123' })
  @IsString()
  @IsNotEmpty()
  newTemplateId: string;

  @ApiPropertyOptional({
    example: 'page-id-123',
    description: '특정 페이지만 교체 (없으면 전체 교체)',
  })
  @IsOptional()
  @IsString()
  pageId?: string;
}

/**
 * 템플릿셋 교체 DTO
 */
export class ReplaceTemplateSetDto {
  @ApiProperty({ example: 'new-template-set-id-123' })
  @IsString()
  @IsNotEmpty()
  newTemplateSetId: string;
}

/**
 * 상태 변경 DTO
 */
export class ChangeStatusDto {
  @ApiProperty({ enum: ['draft', 'review', 'submitted'] })
  @IsEnum(['draft', 'review', 'submitted'])
  status: 'draft' | 'review' | 'submitted';

  @ApiPropertyOptional({ example: '수정 완료' })
  @IsOptional()
  @IsString()
  comment?: string;
}

/**
 * 편집 잠금 획득 DTO
 */
export class AcquireLockDto {
  @ApiProperty({ example: 'user-id-123' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

/**
 * PDF 내보내기 DTO
 */
export class ExportPdfDto {
  @ApiProperty({ example: 'session-uuid-here' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiPropertyOptional({
    example: {
      format: 'A4',
      orientation: 'portrait',
      quality: 'high',
    },
  })
  @IsOptional()
  @IsObject()
  exportOptions?: any;
}

/**
 * 세션 조회 쿼리 DTO
 */
export class SessionQueryDto {
  @ApiPropertyOptional({ example: 'user-id-123' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: 'order-id-123' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ enum: ['draft', 'review', 'submitted'] })
  @IsOptional()
  @IsEnum(['draft', 'review', 'submitted'])
  status?: string;

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
