import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Partner API v1 — 1-call 런처(P2-b, 2026-10-18) 입력 DTO.
 * 정본: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §8.1
 *
 * 대상: 캘린더·낱장(프로파일 세트 + NULL 세트) 세션. 사진인화 `items`/`externalPhotos` 는
 * metadata 기록만 한다(검증 없음 — 상한 500 개만 둔다).
 * 봉투는 v1 코어 인터셉터가 감싼다(수동 래핑 금지).
 */

/** 런처가 허용하는 세션 모드 — 편집기가 템플릿셋 임베드에서 만드는 세션과 같은 집합('template'/'spread' 거부). */
export const PARTNER_SESSION_LAUNCH_MODES = ['both', 'cover', 'content'] as const;
export type PartnerSessionLaunchMode = (typeof PARTNER_SESSION_LAUNCH_MODES)[number];

export class PartnerSessionLaunchMemberDto {
  @ApiProperty({ description: '호스트 회원 번호(양의 정수) — 세션 소유자·편집기 토큰 subject', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seqno: number;

  @ApiProperty({ description: '호스트 회원 식별자(이메일 등, 255자 이내)', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  id: string;

  @ApiProperty({ description: '회원 표시명(255자 이내)', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;
}

/** POST /api/v1/sessions/launch body */
export class PartnerSessionLaunchDto {
  @ApiProperty({ type: PartnerSessionLaunchMemberDto, description: '세션 소유 회원' })
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerSessionLaunchMemberDto)
  member: PartnerSessionLaunchMemberDto;

  @ApiProperty({
    description:
      '템플릿셋 id(UUID). 시스템 공유(site 없음) 또는 호출 사이트 소속·활성 셋만 허용 — 그 밖은 404 ERR_NOT_FOUND',
  })
  @IsUUID()
  templateSetId: string;

  @ApiPropertyOptional({ description: '호스트 주문 번호(양의 정수). 생략하면 0(주문 미연결)', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderSeqno?: number;

  @ApiPropertyOptional({
    enum: PARTNER_SESSION_LAUNCH_MODES,
    description: "세션 모드. 생략 시 'both'(편집기 템플릿셋 임베드 기본). 'template'/'spread' 는 거부",
  })
  @IsOptional()
  @IsIn(PARTNER_SESSION_LAUNCH_MODES as unknown as string[])
  mode?: PartnerSessionLaunchMode;

  @ApiPropertyOptional({
    description:
      '완료·합성 결과 콜백 URL(https 만). 사설/링크로컬/루프백 호스트는 422 ERR_WEBHOOK_URL_FORBIDDEN',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  callbackUrl?: string;

  @ApiPropertyOptional({ description: '주문 옵션(자유 JSON) — 세션 metadata.orderOptions 로 기록', type: Object })
  @IsOptional()
  @IsObject()
  orderOptions?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '사진인화 항목(≤500) — metadata.items 기록만(검증 없음)', type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  items?: unknown[];

  @ApiPropertyOptional({
    description: "캘린더 시작연월 — { startYm: 'YYYY-MM' }(설계안 §8.1) 또는 { startYear, startMonth }. startYm 은 서버가 startYear/startMonth 로 풀어 metadata.calendar 에 기록한다(편집기가 그 시작연월로 연다)",
    type: Object,
  })
  @IsOptional()
  @IsObject()
  calendar?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '외부 사진 참조(≤500) — metadata.externalPhotos 기록만(검증 없음)', type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  externalPhotos?: unknown[];
}

/** POST /api/v1/sessions/launch 응답 data */
export interface PartnerSessionLaunchView {
  sessionId: string;
  /** 편집기 shop 세션 JWT(1h) */
  accessToken: string;
  /** 리프레시 토큰(30d) */
  refreshToken: string;
  /** accessToken 만료(초) */
  expiresIn: number;
  /** 편집기 임베드 파라미터 — 그대로 전달 */
  embed: {
    sessionId: string;
    token: string;
    refreshToken: string;
    orderSeqno?: number;
  };
}
