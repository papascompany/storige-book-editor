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
}

export class EditSessionListResponseDto {
  @ApiProperty({ type: [EditSessionResponseDto] })
  sessions: EditSessionResponseDto[];

  @ApiProperty()
  total: number;
}
