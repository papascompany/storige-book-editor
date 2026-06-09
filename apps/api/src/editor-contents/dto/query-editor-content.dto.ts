import { IsString, IsOptional, IsBoolean, IsArray, IsEnum, IsNumber } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EditorContentType } from '@storige/types';

export class QueryEditorContentDto {
  @IsOptional()
  @IsEnum(['template', 'frame', 'image', 'background', 'element'])
  type?: EditorContentType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  tags?: string[];

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  // 템플릿셋별 에셋 큐레이션(2026-06-09): 지정 시 해당 템플릿셋에 연결된 라이브러리
  // 카테고리의 에셋만 반환. 연결이 없으면 전역(전체) — 미지정 시와 동일(하위호환).
  @IsOptional()
  @IsString()
  templateSetId?: string;

  @IsOptional()
  @IsEnum(['name', 'createdAt', 'updatedAt'])
  sortField?: 'name' | 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pageSize?: number;
}
