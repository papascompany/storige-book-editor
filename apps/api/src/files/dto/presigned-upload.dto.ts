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

  /**
   * 업로드 파일 MIME (presigned 서명 ContentType 바인딩).
   * 미지정 시 서버가 application/pdf 로 기본 처리. 화이트리스트 외 값은 400.
   * @example image/jpeg
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contentType?: string;
}

export class CompleteUploadDto {
  /** presign 발급 시 받은 소유 토큰 — IDOR 차단(보유자만 complete). */
  @IsString()
  uploadToken: string;

  /** 상품별 보존기간(일). null/0=영구, >0=N일. 인증 라우트에서만 신뢰(게스트 무시). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  retentionDays?: number;
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

  /** 상품별 보존기간(일). null/0=영구, >0=N일. 인증 라우트에서만 신뢰(게스트 무시). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  retentionDays?: number;
}

export class MultipartAbortDto {
  @IsString()
  fileId: string;

  /** init 시 받은 소유 토큰 — IDOR 차단(보유자만 abort). */
  @IsString()
  uploadToken: string;
}
