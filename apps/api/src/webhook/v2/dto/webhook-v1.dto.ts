import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '../../../partner-api/http/pagination';
import { WEBHOOK_V2_SUBSCRIBABLE_EVENTS } from '../webhook-v2.constants';

/**
 * Partner API v1 Webhooks DTO 모음 (설계서 §1.5 라우트 20~26).
 * 봉투/페이지네이션은 v1 코어 정본(@storige/types + partner-api/http) 사용.
 */

/** PUT /api/v1/webhooks/config 본문 */
export class PutWebhookConfigDto {
  @ApiProperty({
    example: 'https://partner.example.com/storige/webhook',
    description: '수신 URL — 허용 호스트(사이트 등록 도메인) 검증(422 ERR_WEBHOOK_URL_FORBIDDEN)',
  })
  @IsString()
  @MaxLength(500)
  url: string;

  @ApiPropertyOptional({
    example: ['synthesis.completed', 'synthesis.failed'],
    description: `구독 이벤트 목록(미지정/빈 배열=전체). 허용: ${WEBHOOK_V2_SUBSCRIBABLE_EVENTS.join(', ')}`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  events?: string[];

  @ApiPropertyOptional({
    description: '기존 설정의 secret 재발급(회전) — 신규 secret 은 이 응답 1회만 노출',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rotateSecret?: boolean;
}

/** GET /api/v1/webhooks/deliveries 쿼리 */
export class DeliveryListQueryDto {
  @ApiPropertyOptional({ example: 'synthesis.completed', description: '이벤트 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  event?: string;

  @ApiPropertyOptional({
    enum: ['PENDING', 'DELIVERED', 'RETRYING', 'EXHAUSTED'],
    description: '상태 필터',
  })
  @IsOptional()
  @IsIn(['PENDING', 'DELIVERED', 'RETRYING', 'EXHAUSTED'])
  status?: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'EXHAUSTED';

  @ApiPropertyOptional({
    example: '2026-07-01T00:00:00Z',
    description: '이후 생성분만 (ISO 8601) — 파싱 불가 값은 400',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  since?: string;

  @ApiPropertyOptional({ default: PAGINATION_DEFAULT_LIMIT, maximum: PAGINATION_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
