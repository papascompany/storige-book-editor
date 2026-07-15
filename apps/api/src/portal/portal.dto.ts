import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateIf,
} from 'class-validator';
import { PartnerEnv } from '../partner-api/partner-api.constants';

/**
 * 파트너 포털 v0 DTO (S2-4 — D-7a 보수 스코프).
 *
 * PATCH 셀프 설정은 로드맵 §6 Stage 2 작업 2의 3항목(allowedOrigins /
 * uploadCallbackUrl / webhookUrl)만 허용한다. 현행 스키마에서 site 단일
 * webhookUrl == uploadCallbackUrl(webhook-config.entity 주석 참조 — v2 config 는
 * v1 Partner API 가 정본)이므로 필드는 2개다. 그 밖의 site 필드(키 재발급·
 * frameAncestors·status 등)는 운영자 전용 표면(PUT /api/sites)에만 남는다 —
 * forbidNonWhitelisted 전역 파이프가 초과 필드를 400 으로 차단.
 */
export class UpdatePortalSiteDto {
  @ApiPropertyOptional({
    description:
      'CORS 허용 origin 목록 — http(s) origin 형식만(path 금지). 예: https://app.example.com',
    example: ['https://app.example.com'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    description:
      '업로드 콜백(웹훅) URL — null 로 해제. 사설/내부 주소는 셀프서브로 등록 불가.',
    example: 'https://api.example.com/storige/webhook',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdatePortalSiteDto) => o.uploadCallbackUrl !== null)
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @Length(1, 500)
  uploadCallbackUrl?: string | null;
}

/**
 * test 키 셀프 발급 요청 — env 는 생략 가능(서버가 'test' 강제).
 * 'live' 를 명시하면 400 이 아니라 **403** 으로 거부한다(스코프 계약:
 * live 발급은 운영자 승인 큐 전용) — 검증은 통과시키고 서비스에서 차단.
 */
export class PortalIssueTestKeyDto {
  @ApiPropertyOptional({
    enum: ['test', 'live'],
    description: "생략 시 'test'. 'live' 는 403 (운영자 승인 큐 전용)",
  })
  @IsOptional()
  @IsIn(['test', 'live'])
  env?: PartnerEnv;

  @ApiPropertyOptional({ example: 'staging integration', description: '키 라벨' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}
