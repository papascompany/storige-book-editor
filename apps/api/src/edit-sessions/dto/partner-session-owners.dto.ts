import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { SessionStatus } from '../entities/edit-session.entity';

/** 한 번에 조회할 수 있는 세션 id 최대 개수(중복 포함 입력 길이 기준) */
export const PARTNER_OWNERS_MAX = 50;

/** 소문자 UUID 만 허용한다(대문자는 정규화하지 않고 400). */
export const LOWER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * POST /partner/edit-sessions/owners 요청 본문.
 * 응답은 입력 원소마다 1개(순서·길이 동일)이므로 중복 제거 변환을 두지 않는다.
 */
export class PartnerSessionOwnersRequestDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: PARTNER_OWNERS_MAX,
    description: '조회할 편집 세션 id 목록(소문자 UUID, 1~50개). 응답은 같은 순서·길이.',
    example: ['0b8f2c1e-3d4a-4f5b-9c6d-7e8f9a0b1c2d'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARTNER_OWNERS_MAX)
  @IsString({ each: true })
  @Matches(LOWER_UUID_RE, { each: true, message: 'sessionIds 는 소문자 UUID 여야 합니다.' })
  sessionIds!: string[];
}

export type PartnerSessionOwnerStatus = `${SessionStatus}`;

/** 세션 1건의 소유자 조회 결과(입력 id 마다 1개). */
export class PartnerSessionOwnerDto {
  @ApiProperty({ description: '요청한 세션 id(입력값 그대로)' })
  sessionId!: string;

  @ApiProperty({ description: '호출 사이트 소속의 삭제되지 않은 세션이면 true' })
  found!: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: '회원 세션의 회원 번호. 게스트 세션·found:false 는 null',
  })
  memberSeqno!: number | null;

  @ApiProperty({ description: '게스트 세션이면 true(found:false 는 false)' })
  guest!: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: '세션 주문 번호. 게스트 세션의 주문 번호 없음(0)·found:false 는 null',
  })
  orderSeqno!: number | null;

  @ApiProperty({
    nullable: true,
    enum: SessionStatus,
    description: '세션 상태. found:false 는 null',
  })
  status!: PartnerSessionOwnerStatus | null;
}
