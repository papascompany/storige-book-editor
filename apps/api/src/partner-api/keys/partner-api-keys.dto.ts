import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PartnerEnv } from '../partner-api.constants';
import {
  PartnerApiKey,
  PartnerApiKeyStatus,
} from '../entities/partner-api-key.entity';

/** 발급 요청 — env 필수(test|live), name 선택 라벨 */
export class IssuePartnerApiKeyDto {
  @ApiProperty({ enum: ['test', 'live'], description: '환경 스코프' })
  @IsIn(['test', 'live'])
  env: PartnerEnv;

  @ApiPropertyOptional({ example: 'bookmoa production', description: '키 라벨' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}

/**
 * 마스킹 응답 shape — key_hash·원문 미포함(1회 노출 원칙).
 * 목록/회전/폐기 응답의 표준 단위.
 */
export interface MaskedPartnerApiKey {
  id: string;
  siteId: string;
  env: PartnerEnv;
  keyPrefix: string;
  name: string | null;
  scopes: string[] | null;
  status: PartnerApiKeyStatus;
  graceUntil: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 엔티티 → 마스킹 응답 변환 (keyHash 제거 — 유일한 직렬화 경로로 사용할 것) */
export function toMaskedPartnerApiKey(row: PartnerApiKey): MaskedPartnerApiKey {
  return {
    id: row.id,
    siteId: row.siteId,
    env: row.env,
    keyPrefix: row.keyPrefix,
    name: row.name,
    scopes: row.scopes,
    status: row.status,
    graceUntil: row.graceUntil,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
