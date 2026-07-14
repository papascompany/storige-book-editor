import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/**
 * 판형 프리셋 DTO (2026-07-14)
 * - 세로형 기준 1행 저장(방향 토글은 UI 에서 W↔H 스왑) — trim 값은 mm.
 * - siteId 는 DTO 로 받지 않는다(현재 전역 프리셋만 저작 — forbidNonWhitelisted 로 차단).
 * - 삭제 없음: isActive 소프트 토글만 (하드 삭제는 멱등 시드가 부활시켜 충돌).
 */
export class CreateFormatPresetDto {
  @ApiProperty({ example: 'a4', description: '프리셋 코드(UNIQUE, 시드 멱등 키)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  code: string;

  @ApiProperty({ example: 'A4', description: '표시명' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @ApiProperty({ example: 210, description: '재단 폭 mm (세로형 기준)' })
  @IsNumber()
  @Min(1)
  @Max(2000)
  trimWidthMm: number;

  @ApiProperty({ example: 297, description: '재단 높이 mm (세로형 기준)' })
  @IsNumber()
  @Min(1)
  @Max(2000)
  trimHeightMm: number;

  @ApiPropertyOptional({ example: 3, description: '사방 블리드 mm (작업 = 재단 + 2×bleed). 기본 3' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  bleedMm?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateFormatPresetDto extends PartialType(CreateFormatPresetDto) {}
