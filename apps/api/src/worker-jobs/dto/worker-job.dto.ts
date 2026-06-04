import { IsString, IsNotEmpty, IsObject, IsEnum, IsOptional, IsUUID, ValidateIf, IsNumber, IsIn, IsUrl, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerJobType, OutputFile } from '@storige/types';

export class CreateValidationJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '파일 ID (fileUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/file.pdf', description: '파일 URL (fileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.fileId)
  @IsString()
  @IsNotEmpty()
  fileUrl?: string;

  @ApiProperty({ example: 'cover', enum: ['cover', 'content', 'post_process'] })
  @IsString()
  @IsNotEmpty()
  fileType: 'cover' | 'content' | 'post_process';

  @ApiProperty({
    example: {
      size: { width: 210, height: 297 },
      pages: 4,
      binding: 'perfect',
      bleed: 3,
      paperThickness: 0.1,
      spineWidthMm: 1.0,
      wingEnabled: false,
      wingWidthMm: 0,
    },
  })
  @IsObject()
  @IsNotEmpty()
  orderOptions: {
    size: { width: number; height: number };
    pages: number;
    binding: 'perfect' | 'saddle' | 'spring';
    bleed: number;
    paperThickness?: number;
    /** 책등 폭(mm) — /products/spine/calculate 권위 값. 있으면 워커가 직접 사용(bindingMargin 포함) */
    spineWidthMm?: number;
    /** 날개(wing/flap) 사용 여부 — 표지 총너비 검증에 반영 */
    wingEnabled?: boolean;
    /** 날개 한쪽 폭(mm) */
    wingWidthMm?: number;
  };

  @ApiPropertyOptional({
    example: 'https://bookmoa.com/api/webhook/validation',
    description: '검증 완료/실패 시 콜백 URL (editSessionId 없이 서버 간 통신에 사용)',
  })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class CreateConversionJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '파일 ID (fileUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/file.pdf', description: '파일 URL (fileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.fileId)
  @IsString()
  @IsNotEmpty()
  fileUrl?: string;

  @ApiProperty({
    example: {
      addPages: true,
      applyBleed: true,
      targetPages: 4,
      bleed: 3,
    },
  })
  @IsObject()
  @IsNotEmpty()
  convertOptions: any;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class CreateSynthesisJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '표지 파일 ID (coverUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  coverFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover.pdf', description: '표지 URL (coverFileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.coverFileId)
  @IsString()
  @IsNotEmpty()
  coverUrl?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '내지 파일 ID (contentUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  contentFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/content.pdf', description: '내지 URL (contentFileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.contentFileId)
  @IsString()
  @IsNotEmpty()
  contentUrl?: string;

  @ApiProperty({ example: 3.5, description: '책등 폭 (mm)' })
  @IsNumber()
  @IsNotEmpty()
  spineWidth: number;

  @ApiPropertyOptional({ example: 'ORD-2024-12345', description: '북모아 주문 번호' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 'high', enum: ['high', 'normal', 'low'], description: '우선순위' })
  @IsOptional()
  @IsIn(['high', 'normal', 'low'])
  priority?: 'high' | 'normal' | 'low';

  @ApiPropertyOptional({ example: 'https://bookmoa.com/api/webhook/synthesis', description: '완료 시 콜백 URL' })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ApiPropertyOptional({
    enum: ['merged', 'separate'],
    default: 'merged',
    description: '출력 형식 (merged: 병합 PDF만, separate: 병합 + 표지/내지 분리)',
  })
  @IsOptional()
  @IsIn(['merged', 'separate'])
  outputFormat?: 'merged' | 'separate';

  @ApiPropertyOptional({
    enum: ['perfect', 'saddle', 'hardcover'],
    default: 'perfect',
    description: '제본 방식 (saddle: 중철 — 표지 펼침면 2-up 자동 합성)',
  })
  @IsOptional()
  @IsIn(['perfect', 'saddle', 'hardcover'])
  bindingType?: 'perfect' | 'saddle' | 'hardcover';

  /** Phase C — 호출 컨트롤러에서 자동 주입 (X-API-Key 사용 시 req.user.siteId) */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class UpdateJobStatusDto {
  @ApiPropertyOptional({ example: 'COMPLETED', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FIXABLE', 'FAILED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '출력 파일 ID' })
  @IsOptional()
  @IsUUID()
  outputFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/output.pdf' })
  @IsOptional()
  @IsString()
  outputFileUrl?: string;

  @ApiPropertyOptional({
    example: [
      { type: 'cover', url: '/storage/outputs/xxx/cover.pdf' },
      { type: 'content', url: '/storage/outputs/xxx/content.pdf' },
    ],
    description: '분리 출력 파일 목록 (separate 모드에서만)',
  })
  @IsOptional()
  @IsArray()
  outputFiles?: OutputFile[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  result?: any;

  @ApiPropertyOptional({ example: 'Processing failed: Invalid PDF' })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional({ example: '123', description: 'Bull queue job ID (디버깅용)' })
  @IsOptional()
  queueJobId?: string | number;
}
