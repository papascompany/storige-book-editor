import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsSafeFileRef } from './is-safe-file-ref.validator';

/**
 * 내지 PDF 표시전용 가이드 래스터화 잡 DTO (2026-06-07).
 *
 * 첨부 내지 PDF 각 페이지를 이미지로 변환해 편집기 underlay 가이드로 사용.
 * 게스트 호출 가능(@Public). ⚠️ 표시 전용 — 최종 인쇄엔 미반영.
 */
export class CreateRenderPagesJobDto {
  @ApiPropertyOptional({ description: '편집 세션 ID (추적용)' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ description: '내지 PDF 파일 ID (fileId 또는 fileUrl 중 하나 필수)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ description: '내지 PDF URL (fileId 미제공 시)' })
  @IsOptional()
  @IsString()
  @IsSafeFileRef()
  fileUrl?: string;

  @ApiPropertyOptional({ description: '알려진 페이지 수(있으면 워커 추출 생략)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  pageCount?: number;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}
