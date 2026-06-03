import { IsString, IsNumber, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateShopSessionDto {
  @ApiProperty({ description: 'bookmoa 회원 번호', example: 123 })
  @IsNumber()
  memberSeqno: number;

  @ApiProperty({ description: '회원 ID (이메일)', example: 'user@example.com' })
  @IsString()
  memberId: string;

  @ApiProperty({ description: '회원 이름', example: '홍길동' })
  @IsString()
  memberName: string;

  @ApiPropertyOptional({ description: 'PHP session_id()', example: 'abc123...' })
  @IsOptional()
  @IsString()
  phpSessionId?: string;

  /**
   * 주문 컨텍스트 (선택, 2026-05-03 Patch D 도입)
   *
   * 전달되면 JWT 페이로드에 포함되어 EditSession 생성 시 추가 검증에 활용.
   * - 단일 주문 시나리오: orderSeqno 한 개
   * - 복수 주문 (장바구니): allowedOrderSeqnos 배열
   * - 둘 다 없으면 기존 동작 유지 (DTO 값 신뢰, 호환성 보장)
   *
   * 권장: PHP 측에서 사용자가 진입한 주문 컨텍스트가 명확하면 전달.
   */
  @ApiPropertyOptional({ description: '단일 주문 번호 — JWT 포함', example: 12345 })
  @IsOptional()
  @IsNumber()
  orderSeqno?: number;

  @ApiPropertyOptional({
    description: '복수 주문 번호 목록 — JWT 포함 (장바구니/관리자)',
    example: [12345, 12346],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  allowedOrderSeqnos?: number[];

  @ApiPropertyOptional({
    description: '권한 목록',
    example: ['edit', 'upload', 'validate'],
    default: ['edit', 'upload', 'validate'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class ShopSessionMemberDto {
  @ApiProperty({ description: '회원 번호' })
  seqno: number;

  @ApiProperty({ description: '회원 ID' })
  id: string;

  @ApiProperty({ description: '회원 이름' })
  name: string;
}

export class ShopSessionResponseDto {
  @ApiProperty({ description: '성공 여부' })
  success: boolean;

  @ApiProperty({ description: 'Access Token (JS 번들에서 사용)' })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh Token(30d). 임베드 편집기 사일런트 리프레시용 — 호스트가 /embed?refreshToken= 로 전달',
    required: false,
  })
  refreshToken?: string;

  @ApiProperty({ description: 'accessToken 만료 시간(초)' })
  expiresIn: number;

  @ApiProperty({ description: '회원 정보', type: ShopSessionMemberDto })
  member: ShopSessionMemberDto;
}
