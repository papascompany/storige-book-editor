import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * 상품-템플릿셋 연결 생성 DTO
 */
export class CreateProductTemplateSetDto {
  @ApiProperty({ example: '001001001', description: '파트너 쇼핑몰 카테고리(상품) 코드' })
  @IsString()
  @IsNotEmpty()
  sortcode: string;

  @ApiPropertyOptional({ example: 1, description: '파트너 쇼핑몰 규격 번호 (선택, NULL이면 전체 규격)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  prdtStanSeqno?: number;

  @ApiProperty({ example: 'ts-001', description: '템플릿셋 ID' })
  @IsString()
  @IsNotEmpty()
  templateSetId: string;

  @ApiPropertyOptional({ example: 0, description: '표시 순서 (낮을수록 먼저)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  displayOrder?: number;

  @ApiPropertyOptional({ example: true, description: '기본 템플릿 여부' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * 상품-템플릿셋 연결 수정 DTO
 */
export class UpdateProductTemplateSetDto {
  @ApiPropertyOptional({ example: 1, description: '표시 순서' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  displayOrder?: number;

  @ApiPropertyOptional({ example: true, description: '기본 템플릿 여부' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: true, description: '활성화 상태' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * 상품-템플릿셋 일괄 연결 DTO
 */
export class BulkCreateProductTemplateSetDto {
  @ApiProperty({ example: '001001001', description: '파트너 쇼핑몰 카테고리(상품) 코드' })
  @IsString()
  @IsNotEmpty()
  sortcode: string;

  @ApiPropertyOptional({ example: 1, description: '파트너 쇼핑몰 규격 번호 (선택)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  prdtStanSeqno?: number;

  @ApiProperty({
    example: ['ts-001', 'ts-002', 'ts-003'],
    description: '템플릿셋 ID 목록',
  })
  @IsArray()
  @IsString({ each: true })
  templateSetIds: string[];
}

/**
 * 상품별 템플릿셋 조회 쿼리 DTO (외부용)
 */
export class ProductTemplateSetQueryDto {
  @ApiProperty({ example: '001001001', description: '파트너 쇼핑몰 카테고리(상품) 코드' })
  @IsString()
  @IsNotEmpty()
  sortcode: string;

  @ApiPropertyOptional({ example: 1, description: '파트너 쇼핑몰 규격 번호' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  stanSeqno?: number;
}

/**
 * 관리자용 목록 조회 쿼리 DTO
 */
export class ProductTemplateSetListQueryDto {
  @ApiPropertyOptional({ example: '001001001', description: '파트너 쇼핑몰 카테고리(상품) 코드' })
  @IsOptional()
  @IsString()
  sortcode?: string;

  @ApiPropertyOptional({ example: 'ts-001', description: '템플릿셋 ID' })
  @IsOptional()
  @IsString()
  templateSetId?: string;

  @ApiPropertyOptional({ example: true, description: '활성화 상태 필터' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: '페이지 번호' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '페이지 크기' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  limit?: number;
}

/**
 * 상품-템플릿셋 응답 DTO
 */
export class ProductTemplateSetResponseDto {
  @ApiProperty({ example: 'uuid-1234-5678' })
  id: string;

  @ApiProperty({ example: '001001001' })
  sortcode: string;

  @ApiPropertyOptional({ example: '책자', description: '상품명 (파트너 쇼핑몰 카테고리명)' })
  categoryName: string | null;

  @ApiPropertyOptional({ example: 1 })
  prdtStanSeqno: number | null;

  @ApiProperty({ example: 'uuid-template-set' })
  templateSetId: string;

  @ApiProperty({ example: 0 })
  displayOrder: number;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ description: '연결된 템플릿셋 정보' })
  templateSet?: {
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    thumbnailUrl: string | null;
  };
}

/**
 * 외부용 템플릿셋 목록 응답 DTO
 */
export class TemplateSetsByProductResponseDto {
  @ApiProperty({ type: [Object] })
  templateSets: {
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    thumbnailUrl: string | null;
    isDefault: boolean;
  }[];

  @ApiProperty({ example: 3 })
  total: number;
}

/**
 * 목록 응답 DTO
 */
export class ProductTemplateSetListResponseDto {
  @ApiProperty({ type: [ProductTemplateSetResponseDto] })
  items: ProductTemplateSetResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
