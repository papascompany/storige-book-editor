import { Body, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ErrV1 } from '@storige/types';
import { PartnerV1Controller } from '../../partner-api/partner-v1.decorator';
import {
  CurrentSite,
  CurrentSitePayload,
} from '../../auth/decorators/current-site.decorator';
import {
  PaginatedResult,
  normalizePaginationQuery,
} from '../../partner-api/http/pagination';
import { PartnerApiException } from '../../partner-api/http/partner-api.exceptions';
import { PartnerEnv } from '../../partner-api/partner-api.constants';
import {
  PartnerRequest,
  resolvePartnerEnv,
} from '../../partner-api/http/request-context';
import { WebhookConfigService, WebhookConfigView } from './webhook-config.service';
import {
  WebhookDeliveryService,
  WebhookDeliveryView,
} from './webhook-delivery.service';
import { DeliveryListQueryDto, PutWebhookConfigDto } from './dto/webhook-v1.dto';

/**
 * Partner API v1 — Webhooks (설계서 §1.5 라우트 20~26).
 *
 * @PartnerV1Controller 조합 데코레이터가 Stage 1 표준 스택을 일괄 바인딩:
 * @Public+PartnerApiKeyGuard(Bearer/X-API-Key)+RateLimit+에러필터(§3.2)
 * +감사→멱등(POST+Idempotency-Key 자동)→봉투(§3.1). 핸들러는 순수 데이터만
 * 반환(이중 래핑 금지). 신규 v1 컨트롤러 — partner-v1-guarded.spec 의
 * V1_CONTROLLERS 목록에 등재됨(미등재 시 red 게이트).
 *
 * v1 웹훅 = v2 서명(HMAC 사이트별 secret) 전용 신규 표면 — 기존 v1(base64)
 * 발신 경로·바이트는 불변(동결). 기존 파트너 전환은 D-7c 게이트 선행.
 *
 * env: S2-1 파트너 키 env 모델과 통합 — resolvePartnerEnv(req.user) 로
 * 인증 키의 env 를 그대로 스코프한다(sites 레거시 키·미스탬프 구간=live).
 * test 키로 등록한 config/발송 이력은 env='test' 로 완전 격리된다.
 */
@ApiTags('partner-v1')
@ApiSecurity('api-key')
@PartnerV1Controller('webhooks')
export class PartnerWebhooksController {
  constructor(
    private readonly configService: WebhookConfigService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  /** 인증 키의 env 스코프 — PartnerApiKeyGuard 가 스탬프한 req.user.env (없으면 live) */
  private env(req: PartnerRequest): PartnerEnv {
    return resolvePartnerEnv(req.user);
  }

  // ── config (라우트 20~22) ─────────────────────────────────────────────

  @Put('config')
  @ApiOperation({
    summary: '웹훅 설정 upsert — secret 은 생성/회전(rotateSecret) 응답에서만 1회 노출',
  })
  @ApiResponse({ status: 200, description: '설정 저장(생성 시 secret 포함 — 재조회 불가)' })
  @ApiResponse({ status: 422, description: 'ERR_WEBHOOK_URL_FORBIDDEN — 허용되지 않는 URL' })
  @ApiResponse({ status: 503, description: 'ERR_SERVICE_UNAVAILABLE — 서버 암호화 키 미설정' })
  async putConfig(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
    @Body() dto: PutWebhookConfigDto,
  ): Promise<WebhookConfigView> {
    return this.configService.upsert(site.siteId, this.env(req), {
      url: dto.url,
      events: dto.events,
      rotateSecret: dto.rotateSecret,
    });
  }

  @Get('config')
  @ApiOperation({ summary: '웹훅 설정 조회 (secret 은 prefix 마스킹)' })
  @ApiResponse({ status: 404, description: 'ERR_WEBHOOK_CONFIG_NOT_FOUND' })
  async getConfig(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
  ): Promise<WebhookConfigView> {
    return this.configService.get(site.siteId, this.env(req));
  }

  @Delete('config')
  @ApiOperation({ summary: '웹훅 설정 삭제 (발송 중지 — 이력은 보존)' })
  @ApiResponse({ status: 404, description: 'ERR_WEBHOOK_CONFIG_NOT_FOUND' })
  async deleteConfig(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
  ): Promise<{ deleted: true }> {
    return this.configService.remove(site.siteId, this.env(req));
  }

  // ── test (라우트 23) ─────────────────────────────────────────────────

  @Post('test')
  @ApiOperation({
    summary: '테스트 이벤트 발송 (isTest=true, 구독 목록 무관) — 멱등(Idempotency-Key)',
  })
  @ApiResponse({ status: 404, description: 'ERR_WEBHOOK_CONFIG_NOT_FOUND' })
  async sendTest(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
  ): Promise<WebhookDeliveryView> {
    return this.deliveryService.sendTest(site.siteId, this.env(req));
  }

  // ── deliveries (라우트 24~26) ────────────────────────────────────────

  @Get('deliveries')
  @ApiOperation({ summary: '발송 이력 목록 (페이지네이션 + event/status/since 필터)' })
  async listDeliveries(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
    @Query() query: DeliveryListQueryDto,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    const page = normalizePaginationQuery({
      limit: query.limit,
      offset: query.offset,
    });
    const since = this.parseSince(query.since);
    const { items, total } = await this.deliveryService.listDeliveries(
      site.siteId,
      this.env(req),
      { event: query.event, status: query.status, since },
      page,
    );
    return PaginatedResult.of(items, total, page);
  }

  @Get('deliveries/:uid')
  @ApiOperation({ summary: '발송 이력 상세 (payload/상태코드·실패사유코드/attempts/nextRetryAt)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 없음/타 사이트' })
  async getDelivery(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
    @Param('uid') uid: string,
  ): Promise<WebhookDeliveryView> {
    return this.deliveryService.getDelivery(site.siteId, this.env(req), uid);
  }

  @Post('deliveries/:uid/retry')
  @ApiOperation({
    summary: '수동 재발송 (EXHAUSTED 또는 10분 이상 stale 한 PENDING/RETRYING) — 멱등(Idempotency-Key)',
  })
  @ApiResponse({ status: 409, description: 'ERR_DELIVERY_NOT_RETRYABLE — 재시도 불가 상태' })
  async retryDelivery(
    @CurrentSite() site: CurrentSitePayload,
    @Req() req: PartnerRequest,
    @Param('uid') uid: string,
  ): Promise<WebhookDeliveryView> {
    return this.deliveryService.manualRetry(site.siteId, this.env(req), uid);
  }

  // ── 내부 ────────────────────────────────────────────────────────────

  private parseSince(raw: string | undefined): Date | undefined {
    if (raw === undefined || raw === '') return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new PartnerApiException(
        ErrV1.ERR_VALIDATION_FAILED,
        400,
        '요청 검증에 실패했습니다',
        [],
        { since: ['since 는 ISO 8601 날짜여야 합니다'] },
      );
    }
    return parsed;
  }
}
