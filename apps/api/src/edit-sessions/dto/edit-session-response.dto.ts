import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus, SessionMode } from '../entities/edit-session.entity';

export class FileInfoDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  originalName: string;

  @ApiPropertyOptional()
  thumbnailUrl?: string | null;

  @ApiProperty()
  fileSize: number;

  @ApiProperty()
  mimeType: string;
}

export class EditSessionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderSeqno: number;

  @ApiProperty()
  memberSeqno: number;

  @ApiProperty({ enum: SessionStatus })
  status: SessionStatus;

  @ApiProperty({ enum: SessionMode })
  mode: SessionMode;

  @ApiPropertyOptional()
  coverFileId?: string | null;

  @ApiPropertyOptional({ type: FileInfoDto })
  coverFile?: FileInfoDto | null;

  @ApiPropertyOptional()
  contentFileId?: string | null;

  @ApiPropertyOptional({ type: FileInfoDto })
  contentFile?: FileInfoDto | null;

  @ApiPropertyOptional()
  templateSetId?: string | null;

  @ApiPropertyOptional()
  canvasData?: any;

  @ApiPropertyOptional()
  metadata?: Record<string, any> | null;

  @ApiPropertyOptional()
  completedAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  /** Phase C — 사이트 컨텍스트 */
  @ApiPropertyOptional()
  siteId?: string | null;

  // ── 인쇄 워크플로우 v1 Phase 4 (2026-05-19) ──
  @ApiPropertyOptional({ description: '고객 첨부 내지 PDF file_id' })
  contentPdfFileId?: string | null;

  @ApiPropertyOptional({ description: 'PDF 페이지수' })
  contentPdfPageCount?: number | null;

  @ApiPropertyOptional({ description: '워커 검증 결과 캐시' })
  contentPdfValidationResult?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: '게스트 식별자 (24h 만료)' })
  guestToken?: string | null;

  @ApiPropertyOptional({ description: '게스트 만료 시점' })
  guestExpiresAt?: Date | null;
}

export class EditSessionListResponseDto {
  @ApiProperty({ type: [EditSessionResponseDto] })
  sessions: EditSessionResponseDto[];

  @ApiProperty()
  total: number;
}
