import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsUUID,
  IsISO8601,
  Length,
  Matches,
  MaxLength,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PartnerOperatorAuditDetail } from '../entities/partner-operator-audit-log.entity';
import {
  MAX_SCOPE,
  OPERATOR_ID_MAX,
  OPERATOR_ID_PATTERN,
  OPERATOR_NAME_MAX,
  TTL_DEFAULT,
  TTL_MAX,
  TTL_MIN,
} from '../partner-operator/partner-operator.types';

/** 배열이면 순서를 유지한 채 중복 제거, 배열이 아니면 그대로(검증기가 거부) */
function dedupeArray({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) return value;
  return Array.from(new Set(value));
}

/**
 * POST /auth/partner-operator-session 요청 (서버 간 전용, X-API-Key).
 *
 * sessionIds 가 없거나 비어 있으면 서비스가 400 PARTNER_OPERATOR_SCOPE_REQUIRED 를 반환한다
 * (코드가 있는 오류를 주기 위해 최소 개수는 검증기가 아니라 서비스에서 확인한다).
 */
export class CreatePartnerOperatorSessionDto {
  @ApiProperty({
    description: `파트너 측 운영자 식별자(1~${OPERATOR_ID_MAX}자, 영숫자와 ._:-). 불투명 id 를 사용하고 이메일은 넣지 않는다.`,
    example: 'admin-7f3c2a',
  })
  @IsString()
  @Length(1, OPERATOR_ID_MAX)
  @Matches(OPERATOR_ID_PATTERN)
  operatorId: string;

  @ApiPropertyOptional({ description: '감사 기록 표시용 라벨', example: '운영팀 김OO' })
  @IsOptional()
  @IsString()
  @MaxLength(OPERATOR_NAME_MAX)
  operatorName?: string;

  @ApiProperty({
    description: `편집할 세션 id(UUID, 1~${MAX_SCOPE}개). 발급 시점에 고정된다.`,
    type: [String],
    example: ['11111111-1111-4111-8111-111111111111'],
  })
  @IsOptional()
  @Transform(dedupeArray)
  @IsArray()
  @ArrayMaxSize(MAX_SCOPE)
  @IsUUID('all', { each: true })
  sessionIds?: string[];

  @ApiPropertyOptional({ description: 'true 일 때만 삭제 권한 포함', default: false })
  @IsOptional()
  @IsBoolean()
  allowDelete?: boolean;

  @ApiPropertyOptional({
    description: `권한 전체 유효 시간(초, ${TTL_MIN}~${TTL_MAX}). 갱신해도 연장되지 않는다.`,
    default: TTL_DEFAULT,
  })
  @IsOptional()
  @IsInt()
  @Min(TTL_MIN)
  @Max(TTL_MAX)
  ttlSeconds?: number;

  @ApiPropertyOptional({ description: '파트너 주문 식별자(문자열) — 감사용, 권한 판단에 쓰지 않음' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  orderRef?: string;

  @ApiPropertyOptional({ description: '감사 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** POST /auth/partner-operator-session/revoke 요청 — grantId 또는 all:true 중 정확히 하나 */
export class RevokePartnerOperatorSessionDto {
  @ApiPropertyOptional({ description: '취소할 권한 id' })
  @IsOptional()
  @IsUUID('all')
  grantId?: string;

  @ApiPropertyOptional({ description: 'true 면 호출 사이트의 미취소 권한 전부 취소' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

/** GET /auth/partner-operator-session/audit 쿼리 */
export class PartnerOperatorAuditQueryDto {
  @ApiPropertyOptional({ description: '세션 id 필터' })
  @IsOptional()
  @IsUUID('all')
  sessionId?: string;

  @ApiPropertyOptional({ description: '권한 id 필터' })
  @IsOptional()
  @IsUUID('all')
  grantId?: string;

  @ApiPropertyOptional({ description: '최대 건수(1~200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '이 시각 이전 기록만(ISO 8601, 페이지 커서)' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}

export class PartnerOperatorIdentityDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;
}

export class PartnerOperatorScopeDto {
  @ApiProperty({ type: [String] })
  sessionIds: string[];
}

export class PartnerOperatorSessionResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ description: '액세스 토큰(최대 15분)' })
  accessToken: string;

  @ApiProperty({ description: '리프레시 토큰(권한 만료 시각까지)' })
  refreshToken: string;

  @ApiProperty({ description: '액세스 토큰 만료(초)' })
  expiresIn: number;

  @ApiProperty()
  grantId: string;

  @ApiProperty({ description: '권한 만료 시각(ISO)' })
  grantExpiresAt: string;

  @ApiProperty({ type: [String], example: ['edit'] })
  capabilities: string[];

  @ApiProperty({ type: PartnerOperatorIdentityDto })
  operator: PartnerOperatorIdentityDto;

  @ApiProperty({ type: PartnerOperatorScopeDto })
  scope: PartnerOperatorScopeDto;

  @ApiProperty({ nullable: true, type: String })
  orderRef: string | null;
}

export class PartnerOperatorRevokeResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ description: '취소된 권한 수(다른 사이트의 권한은 0)' })
  revoked: number;
}

export class PartnerOperatorAuditItemDto {
  @ApiProperty() id: string;
  @ApiProperty() grantId: string;
  @ApiProperty({ nullable: true, type: String }) sessionId: string | null;
  @ApiProperty() operatorId: string;
  @ApiProperty({ nullable: true, type: String }) operatorName: string | null;
  @ApiProperty() action: string;
  @ApiProperty({ nullable: true, type: String }) method: string | null;
  @ApiProperty({ nullable: true, type: String }) route: string | null;
  @ApiProperty({ nullable: true, type: Number }) statusCode: number | null;
  @ApiProperty({ nullable: true, type: Object }) detail: PartnerOperatorAuditDetail | null;
  @ApiProperty() createdAt: Date;
}

export class PartnerOperatorAuditResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [PartnerOperatorAuditItemDto] })
  items: PartnerOperatorAuditItemDto[];
}
