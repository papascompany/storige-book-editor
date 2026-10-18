import { Body, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { PartnerV1Controller } from '../partner-api/partner-v1.decorator';
import { PartnerRateLimitBucket } from '../partner-api/guards/partner-rate-limit.decorator';
import { PartnerRequest, ensureRequestId } from '../partner-api/http/request-context';
import { PartnerSessionsService } from './partner-sessions.service';
import { PartnerSessionLaunchDto, PartnerSessionLaunchView } from './dto/partner-session-launch.dto';
import {
  PartnerSessionDeliverablesView,
  PartnerSessionSynthesizeView,
} from './dto/partner-session-deliverables.dto';

/**
 * Partner API v1 — 1-call 런처(P2-b, 2026-10-18) 컨트롤러.
 * 정본: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §8.1
 * 글로벌 prefix 'api' → 최종 경로 /api/v1/sessions/* (v1 모듈 배치 규약).
 *
 * v1 표준 스택 — @PartnerV1Controller 조합 데코레이터가 일괄 바인딩:
 *   @Public + PartnerApiKeyGuard(Bearer/X-API-Key) + PartnerRateLimitGuard(per-Key) + 에러 필터
 *   + 감사→멱등(POST + Idempotency-Key)→봉투 인터셉터. 핸들러는 data 만 반환(봉투 수동 래핑 금지).
 *
 * 등재: partner-v1-guarded.spec V1_CONTROLLERS · scripts/partner-openapi-surface.ts(컨트롤러·스텁·REQUIRED_PATHS).
 * 파일명은 `*.controller.ts` 규약을 지킨다(testing/v1-controller-scan 전수 스캔 대상).
 */
@ApiTags('partner-v1')
@ApiSecurity('api-key')
@PartnerV1Controller('sessions')
export class PartnerSessionsController {
  constructor(private readonly partnerSessionsService: PartnerSessionsService) {}

  @Post('launch')
  @PartnerRateLimitBucket('heavy')
  @ApiOperation({
    summary: '1-call 런처 — 편집 세션 생성 + 편집기 토큰 발급(캘린더·낱장)',
    description:
      '템플릿셋(시스템 공유 또는 자기 사이트·활성)으로 세션을 만들고 편집기 임베드용 shop 세션 JWT 를 돌려준다. ' +
      '사이트 편집기 키만 호출 가능. test 키로 만든 세션은 test 키로만 조회·재합성된다(env 스코프).',
  })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — {sessionId, accessToken, refreshToken, expiresIn, embed}' })
  @ApiResponse({ status: 400, description: 'ERR_VALIDATION_FAILED — member/templateSetId 누락·형식 오류·허용되지 않는 mode' })
  @ApiResponse({ status: 403, description: 'ERR_FORBIDDEN — 사이트 편집기 키가 아님(worker 키 등)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 템플릿셋 없음/비활성/타 사이트' })
  @ApiResponse({ status: 422, description: 'ERR_WEBHOOK_URL_FORBIDDEN — callbackUrl 이 공개 https 호스트가 아님' })
  @ApiResponse({ status: 503, description: 'ERR_SERVICE_UNAVAILABLE — PARTNER_SESSION_LAUNCH_ENABLED=off' })
  async launch(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
    @Body() dto: PartnerSessionLaunchDto,
  ): Promise<PartnerSessionLaunchView> {
    return this.partnerSessionsService.launch(site, dto, ensureRequestId(req));
  }

  @Get(':id/deliverables')
  @ApiOperation({
    summary: '세션 산출물 조회 — 상태·회차·파일(편집기 PDF/썸네일 api-key, 잡 산출물 서명 URL)·상품 요약',
  })
  @ApiResponse({ status: 200, description: '{success,message,data} 봉투 — {sessionId,status,revision,orderSeqno,product,calendar,files,production?}' })
  @ApiResponse({ status: 403, description: 'ERR_FORBIDDEN — 사이트 편집기 키가 아님' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 없음/타 사이트/런처 세션 아님/env 불일치' })
  @ApiResponse({ status: 503, description: 'ERR_SERVICE_UNAVAILABLE — 킬스위치 off 또는 서명 URL 시크릿 미설정' })
  async getDeliverables(
    @CurrentSite() site: CurrentSitePayload,
    @Param('id') id: string,
  ): Promise<PartnerSessionDeliverablesView> {
    return this.partnerSessionsService.getDeliverables(site, id);
  }

  @Post(':id/synthesize')
  @PartnerRateLimitBucket('heavy')
  @ApiOperation({
    summary: 'duplex-split 재합성 요청 — revision +1, 완료 웹훅 payload 에 revision 포함',
  })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — {jobId, revision}' })
  @ApiResponse({ status: 403, description: 'ERR_FORBIDDEN — 사이트 편집기 키가 아님' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 없음/타 사이트/런처 세션 아님/env 불일치' })
  @ApiResponse({ status: 409, description: 'ERR_SESSION_NOT_COMPLETE — 편집 미완료 또는 편집기 산출 PDF 없음' })
  @ApiResponse({ status: 422, description: "ERR_OUTPUT_MODE_UNSUPPORTED — 템플릿셋 pdfOutputMode 가 'duplex-split' 아님" })
  @ApiResponse({ status: 503, description: 'ERR_SERVICE_UNAVAILABLE — PARTNER_SESSION_LAUNCH_ENABLED=off' })
  async synthesize(
    @CurrentSite() site: CurrentSitePayload,
    @Param('id') id: string,
  ): Promise<PartnerSessionSynthesizeView> {
    return this.partnerSessionsService.synthesize(site, id);
  }
}
