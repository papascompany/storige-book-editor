import { IsNumber, IsEnum, IsOptional, IsString, IsObject, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionMode } from '../entities/edit-session.entity';

export class CreateEditSessionDto {
  @ApiProperty({ example: 12345, description: '주문 번호' })
  @IsNumber()
  orderSeqno: number;

  @ApiPropertyOptional({ example: 123, description: '회원 번호 (JWT에서 자동 추출 가능)' })
  @IsOptional()
  @IsNumber()
  memberSeqno?: number;

  @ApiProperty({ example: 'both', enum: SessionMode, description: '편집 모드' })
  @IsEnum(SessionMode)
  mode: SessionMode;

  @ApiPropertyOptional({ example: 'uuid', description: '표지 파일 ID' })
  @IsOptional()
  @IsUUID()
  coverFileId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '내지 파일 ID' })
  @IsOptional()
  @IsUUID()
  contentFileId?: string;

  @ApiPropertyOptional({ example: 'ts-001', description: '템플릿 세트 ID' })
  @IsOptional()
  @IsString()
  templateSetId?: string;

  @ApiPropertyOptional({ description: '초기 캔버스 데이터' })
  @IsOptional()
  @IsObject()
  canvasData?: any;

  @ApiPropertyOptional({ description: '메타데이터 (제품 정보 등)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ example: 'https://shop.example.com/api/callback', description: 'Worker 완료 콜백 URL' })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  /** Phase C-2 — 호출 컨트롤러에서 JWT siteId 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}
