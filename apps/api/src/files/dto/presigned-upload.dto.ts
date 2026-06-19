import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FileType } from '../entities/file.entity';

export class PresignUploadDto {
  @IsEnum(FileType)
  @IsOptional()
  type?: FileType;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @IsOptional()
  @IsInt()
  orderSeqno?: number;

  @IsOptional()
  @IsInt()
  memberSeqno?: number;
}

export class CompleteUploadDto {
  /** presign 발급 시 받은 소유 토큰 — IDOR 차단(보유자만 complete). */
  @IsString()
  uploadToken: string;
}

export class MultipartInitDto extends PresignUploadDto {}

export class MultipartSignDto {
  @IsString()
  fileId: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  /** init 시 받은 소유 토큰 — IDOR 차단(보유자만 파트 서명). */
  @IsString()
  uploadToken: string;
}

class UploadedPartDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;

  @IsString()
  etag: string;
}

export class MultipartCompleteDto {
  @IsString()
  fileId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts: UploadedPartDto[];

  /** init 시 받은 소유 토큰 — IDOR 차단(보유자만 complete). */
  @IsString()
  uploadToken: string;
}

export class MultipartAbortDto {
  @IsString()
  fileId: string;

  /** init 시 받은 소유 토큰 — IDOR 차단(보유자만 abort). */
  @IsString()
  uploadToken: string;
}
