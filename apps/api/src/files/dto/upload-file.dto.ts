import { IsEnum, IsOptional, IsNumber, IsString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { FileType } from '../entities/file.entity';

export class UploadFileDto {
  @ApiProperty({
    description: '파일 타입',
    enum: FileType,
    example: FileType.COVER,
  })
  @IsEnum(FileType)
  type: FileType;

  @ApiPropertyOptional({
    description: 'bookmoa 주문 번호',
    example: 12345,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  orderSeqno?: number;

  @ApiPropertyOptional({
    description: 'bookmoa 회원 번호',
    example: 123,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  memberSeqno?: number;

  @ApiPropertyOptional({
    description: '파일 설명',
    example: '표지 파일',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: '추가 메타데이터',
    example: { pages: 100, binding: 'perfect' },
  })
  @IsOptional()
  // multipart/form-data 필드는 항상 문자열로 도착하므로, JSON 문자열을 객체로 파싱한다.
  // (편집기 filesApi.upload 는 metadata 를 JSON.stringify 로 전송 → @IsObject 통과 위해 선파싱 필요)
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value; // 파싱 실패 시 원본 유지 → @IsObject 가 명확히 거부
      }
    }
    return value;
  })
  @IsObject()
  metadata?: Record<string, any>;
}
