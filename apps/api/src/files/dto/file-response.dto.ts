import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FileType } from '../entities/file.entity';

export class FileResponseDto {
  @ApiProperty({ description: '파일 ID (UUID)' })
  id: string;

  @ApiProperty({ description: '저장된 파일명' })
  fileName: string;

  @ApiProperty({ description: '원본 파일명' })
  originalName: string;

  @ApiProperty({ description: '파일 URL' })
  fileUrl: string;

  @ApiProperty({ description: '파일 시스템 경로' })
  filePath: string;

  @ApiPropertyOptional({ description: '썸네일 URL' })
  thumbnailUrl: string | null;

  @ApiProperty({ description: '파일 크기 (bytes)' })
  fileSize: number;

  @ApiProperty({ description: 'MIME 타입' })
  mimeType: string;

  @ApiProperty({ description: '파일 타입', enum: FileType })
  fileType: FileType;

  @ApiPropertyOptional({ description: 'bookmoa 주문 번호' })
  orderSeqno: number | null;

  @ApiPropertyOptional({ description: 'bookmoa 회원 번호' })
  memberSeqno: number | null;

  @ApiPropertyOptional({ description: '추가 메타데이터' })
  metadata: Record<string, any> | null;

  @ApiPropertyOptional({ description: '저장 백엔드 (local|s3)', enum: ['local', 's3'] })
  storageBackend?: 'local' | 's3';

  @ApiPropertyOptional({ description: '보존 만료 시각 (null=영구보관)' })
  expiresAt?: Date | null;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;
}

export class FileListResponseDto {
  @ApiProperty({ description: '파일 목록', type: [FileResponseDto] })
  files: FileResponseDto[];

  @ApiProperty({ description: '전체 개수' })
  total: number;
}
