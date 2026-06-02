import { IsNumber, IsEnum, IsOptional, IsString, IsObject, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionMode } from '../entities/edit-session.entity';

export class CreateEditSessionDto {
  @ApiPropertyOptional({ example: 12345, description: '주문 번호 (게스트는 0 또는 미전송 — Phase 4)' })
  @IsOptional()
  @IsNumber()
  orderSeqno?: number;

  @ApiPropertyOptional({ example: 123, description: '회원 번호 (JWT에서 자동 추출 가능)' })
  @IsOptional()
  @IsNumber()
  memberSeqno?: number;

  /**
   * 인쇄 워크플로우 v1 Phase 4 (2026-05-19) — 게스트 세션 진입 플래그.
   * true 면 API 측에서 guestToken (uuid) + guestExpiresAt (NOW + 24h) 자동 발급.
   * 결정 3-1: 24시간 후 EVENT evt_purge_expired_guest_sessions 가 자동 DELETE.
   */
  @ApiPropertyOptional({ example: true, description: '게스트 세션 진입 — Phase 4' })
  @IsOptional()
  @IsBoolean()
  asGuest?: boolean;

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

  // 단일 페이지는 객체, 멀티페이지(책자/스프레드)는 배열. @IsObject() 는 배열을 거부하므로 미사용 (2026-06-02).
  @ApiPropertyOptional({ description: '초기 캔버스 데이터 (단일 객체 또는 멀티페이지 배열)' })
  @IsOptional()
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
