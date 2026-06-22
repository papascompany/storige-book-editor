import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsSafeFileRef } from './is-safe-file-ref.validator';

/**
 * Compose-mixed 잡 생성 DTO — 인쇄 워크플로우 v1 Phase 5 (2026-05-19).
 *
 * 표지 + 앞면지 N + 내지(편집 또는 첨부 PDF) + 뒷면지 K 를 합본 PDF 로 생성.
 * 출력 순서: [표지, 앞면지 1..N, 내지, 뒷면지 1..K] (고정).
 */
export class CreateComposeMixedJobDto {
  @ApiPropertyOptional({ description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  // ── 표지 ──
  @ApiPropertyOptional({ description: '표지 PDF URL (coverEditable=true 일 때)' })
  @IsOptional()
  @IsString()
  @IsSafeFileRef()
  coverUrl?: string;

  @ApiPropertyOptional({ default: true, description: '표지 편집 가능 여부 (false=레더커버)' })
  @IsOptional()
  @IsBoolean()
  coverEditable?: boolean;

  @ApiPropertyOptional({ description: '표지 폭 (mm) — 빈 표지 생성 시 사용', example: 210 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  coverWidthMm?: number;

  @ApiPropertyOptional({ description: '표지 높이 (mm)', example: 297 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  coverHeightMm?: number;

  // ── 면지 ──
  @ApiPropertyOptional({
    description: '앞면지 URL 배열 (null 원소는 빈 면지 페이지)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsSafeFileRef({ each: true })
  frontEndpaperUrls?: (string | null)[];

  @ApiPropertyOptional({
    description: '뒷면지 URL 배열 (null 원소는 빈 면지 페이지)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsSafeFileRef({ each: true })
  backEndpaperUrls?: (string | null)[];

  // ── 내지 ──
  @ApiPropertyOptional({ description: '내지 PDF URL (편집 결과 또는 첨부 PDF)' })
  @IsOptional()
  @IsString()
  @IsSafeFileRef()
  contentPdfUrl?: string;

  @ApiPropertyOptional({ description: '내지 폭 (mm)', example: 210 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  contentWidthMm?: number;

  @ApiPropertyOptional({ description: '내지 높이 (mm)', example: 297 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  contentHeightMm?: number;

  @ApiPropertyOptional({
    description: '출력 모드: separate(표지+내지 분리), content-only(내지만), single(낱장 단일)',
    enum: ['separate', 'content-only', 'single'],
  })
  @IsOptional()
  @IsString()
  outputMode?: 'separate' | 'content-only' | 'single';

  @ApiPropertyOptional({ description: '완료 시 콜백 URL' })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ApiPropertyOptional({ description: '주문 번호 (선택)' })
  @IsOptional()
  @IsString()
  orderId?: string;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}
