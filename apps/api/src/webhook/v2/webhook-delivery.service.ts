import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { FindOptionsWhere, MoreThanOrEqual, Repository } from 'typeorm';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { ErrV1 } from '@storige/types';
import { WebhookConfig } from '../entities/webhook-config.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { isRemoteUrlPublic } from '../../common/helpers/ssrf.helper';
// type-only import — webhook.service ↔ v2 서비스 간 런타임 순환 참조 방지
// (webhook.service 가 v2 서비스를 value import 하므로 역방향은 타입만)
import type { WebhookPayload } from '../webhook.service';
import { PartnerApiException } from '../../partner-api/http/partner-api.exceptions';
import {
  NormalizedPagination,
} from '../../partner-api/http/pagination';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookV2Config } from './webhook-v2.config';
import {
  WEBHOOK_DELIVERY_BACKOFF,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_DELIVERY_UID_PREFIX,
  WEBHOOK_MANUAL_RETRY_STALE_MS,
  WEBHOOK_MAX_QUEUE_RETRIES,
  WEBHOOK_RESPONSE_SNIPPET_MAX,
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_V2_CONFIG,
  WebhookDeliveryStatus,
} from './webhook-v2.constants';
import { decryptWebhookSecret, signWebhookV2 } from './webhook-secret.crypto';

/**
 * 웹훅 v2 발신/재시도/이력 (Stage 2 작업 5 — 설계서 §1.5·§2.8).
 *
 * opt-in 경계: 진입점은 tryDispatchForSite — active config 가 없으면 null 을
 * 반환하고 호출측(WebhookService.sendCallback)이 기존 v1(base64) 경로로
 * 폴스루한다. **config 없는 사이트의 발신 바이트/헤더/타이밍은 불변.**
 *
 * 발송 규약(v2 = HMAC 전용 신규 표면):
 *  - Content-Type: application/json (payload 는 생성 시점 바이트 스냅샷 재전송)
 *  - X-Storige-Event: <event>
 *  - X-Storige-Delivery: <whd_...> (delivery uid — 수신측 dedupe 키)
 *  - X-Storige-Signature-HMAC: t=<unixsec>,v1=<hex> — WH-001 정본 형식,
 *    사이트별 secret. 레거시 base64 X-Storige-Signature 는 **미전송**(HMAC 전용).
 *
 * 재시도: 인라인 최초 1회 → 실패 시 전용 Bull 큐(webhook-delivery)로
 * 1분/5분/30분 백오프 3회(attempts:3 + 커스텀 backoff). delivery 단위 멱등
 * (DELIVERED 단락)이라 동일 jobId 재배달에도 안전. 3회 소진 → EXHAUSTED,
 * 수동 재발송(POST .../retry)으로 PENDING 재진입.
 */

export interface WebhookDeliveryJobData {
  deliveryId: string;
  /** 이 재시도 체인이 시작될 때의 누적 attempts — 소진 판정 기준점 */
  baseAttempts: number;
}

/**
 * [P2-1] 파트너 대면 마지막 실패 사유 코드 — 수신측 응답 **본문은 뷰에 절대
 * 포함하지 않는다**(SSRF 반출 채널 축소: 내부망 응답이 파트너 API 로 새는 것 차단).
 * 본문 원문(lastResponse)은 DB 에만 저장(운영 진단용).
 *  - HTTP_ERROR: 수신측이 비-2xx 상태코드로 응답 (lastStatusCode 참조)
 *  - REQUEST_FAILED: 요청 자체 실패(연결/타임아웃) 또는 서버측 발송 전제 미충족
 */
export type WebhookDeliveryFailureReason = 'HTTP_ERROR' | 'REQUEST_FAILED';

export interface WebhookDeliveryView {
  uid: string;
  event: string;
  env: 'test' | 'live';
  status: WebhookDeliveryStatus;
  isTest: boolean;
  attempts: number;
  lastStatusCode: number | null;
  /** [P2-1] 응답 본문 대신 간략 사유 코드만 노출 (성공/미시도 = null) */
  lastFailureReason: WebhookDeliveryFailureReason | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  /** 상세 조회에서만 — 발송 당시 페이로드(파싱 실패 시 원문 문자열) */
  payload?: unknown;
}

export interface DeliveryListFilter {
  event?: string;
  status?: WebhookDeliveryStatus;
  since?: Date;
}

/** Bull 커스텀 backoff — attemptsMade(큐 실패 횟수) 1→5분, 2→30분 */
export function webhookDeliveryBackoffMs(attemptsMade: number): number {
  const idx = Math.min(
    Math.max(attemptsMade, 0),
    WEBHOOK_RETRY_DELAYS_MS.length - 1,
  );
  return WEBHOOK_RETRY_DELAYS_MS[idx];
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
    @InjectRepository(WebhookConfig)
    private readonly configRepository: Repository<WebhookConfig>,
    private readonly configService: WebhookConfigService,
    @Inject(WEBHOOK_V2_CONFIG) private readonly v2Config: WebhookV2Config,
    @Optional()
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue?: Queue<WebhookDeliveryJobData>,
  ) {}

  // ── opt-in 진입점 (WebhookService.sendCallback 에서 호출) ──────────────

  /**
   * active config 가 있는 사이트만 v2 발신. 없으면 null — 호출측이 기존
   * v1 경로로 폴스루(기존 파트너 무영향 불변식).
   */
  async tryDispatchForSite(
    siteId: string,
    env: 'test' | 'live',
    payload: WebhookPayload,
  ): Promise<{ delivered: boolean } | null> {
    const config = await this.configService.findActiveConfigCached(siteId, env);
    if (!config) return null;

    // 구독 필터 — opt-in 사이트는 구독 목록이 발송 범위를 결정한다(빈 배열=전체).
    // 미구독 이벤트는 발송/이력 생성 없이 스킵(레거시 폴백 없음 — config 가 정본).
    if (config.events.length > 0 && !config.events.includes(payload.event)) {
      this.logger.log(
        `[v2] 미구독 이벤트 스킵 — site=${siteId} event=${payload.event}`,
      );
      return { delivered: false };
    }

    // env 통합(S2-1 정합화): test env 로 도달한 발신은 delivery.isTest 플래그와
    // 페이로드 `isTest: true` 를 함께 반영 — 수신측이 test/live 를 페이로드만으로
    // 구분 가능. live env 페이로드 바이트는 현행 그대로(불변식) 유지.
    // (잡 완료 발신 경로는 env 컨텍스트가 없어 live 고정 — worker-jobs 주석 참조)
    const isTest = env === 'test';
    const dispatchPayload: unknown = isTest
      ? { ...payload, isTest: true as const }
      : payload;
    const delivery = await this.dispatch(
      config,
      payload.event,
      dispatchPayload,
      isTest,
    );
    return { delivered: delivery.status === 'DELIVERED' };
  }

  /** active config 존재 여부 — callbackUrl 부재 시 발신 스킵 판정 보조(캐시 경유) */
  async hasActiveConfig(siteId: string, env: 'test' | 'live'): Promise<boolean> {
    return (await this.configService.findActiveConfigCached(siteId, env)) !== null;
  }

  // ── 발송 코어 ─────────────────────────────────────────────────────────

  /**
   * delivery 행 생성(payload 바이트 스냅샷 고정) → 인라인 최초 발송 →
   * 실패 시 재시도 체인(1/5/30분) 인큐.
   */
  async dispatch(
    config: WebhookConfig,
    event: string,
    payload: unknown,
    isTest: boolean,
  ): Promise<WebhookDelivery> {
    const uid = `${WEBHOOK_DELIVERY_UID_PREFIX}${randomUUID().replace(/-/g, '')}`;
    const delivery = this.deliveryRepository.create({
      id: randomUUID(),
      uid,
      configId: config.id,
      siteId: config.siteId,
      env: config.env,
      event,
      isTest,
      payload: JSON.stringify(payload),
      status: 'PENDING' as const,
      attempts: 0,
      lastStatusCode: null,
      lastResponse: null,
      nextRetryAt: null,
      deliveredAt: null,
    });
    await this.deliveryRepository.save(delivery);

    const success = await this.attemptHttp(delivery, config);
    delivery.attempts += 1;

    if (success) {
      delivery.status = 'DELIVERED';
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = null;
    } else {
      await this.armRetryChain(delivery);
    }
    await this.deliveryRepository.save(delivery);
    return delivery;
  }

  /** 실패한 delivery 를 RETRYING 으로 전이하고 전용 큐에 재시도 체인 인큐 */
  private async armRetryChain(delivery: WebhookDelivery): Promise<void> {
    delivery.status = 'RETRYING';
    delivery.nextRetryAt = new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[0]);
    if (!this.deliveryQueue) {
      // 큐 미주입(단위 테스트 등) — 이력은 남기고 재시도만 생략
      this.logger.warn(
        `[v2] delivery ${delivery.uid} 재시도 큐 미주입 — RETRYING 상태만 기록`,
      );
      return;
    }
    // [P1-2] 인큐 실패(Redis 순단 등)가 dispatch 전체를 터뜨리면 호출측의
    // 마지막 save 가 스킵돼 delivery 행이 미완 상태로 남는다 — 여기서 삼켜
    // RETRYING 행 저장을 보장한다. 죽은 체인은 stale 판정(manualRetry)으로 복구.
    try {
      await this.deliveryQueue.add(
        { deliveryId: delivery.id, baseAttempts: delivery.attempts },
        {
          delay: WEBHOOK_RETRY_DELAYS_MS[0],
          attempts: WEBHOOK_MAX_QUEUE_RETRIES,
          backoff: { type: WEBHOOK_DELIVERY_BACKOFF },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      this.logger.error(
        `[v2] delivery ${delivery.uid} 재시도 인큐 실패 — RETRYING 행만 기록(수동 retry 로 복구 가능): ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * 큐 재시도 1회 처리 (processor 진입점).
   * - DELIVERED 단락: delivery 단위 멱등 — 동일 jobId 재배달/중복 소비 안전.
   * - 미최종 실패: RETRYING 유지 + throw → Bull 커스텀 backoff(5분/30분)가 재예약.
   * - 재시도 3회 소진: EXHAUSTED 확정 후 throw(잡도 failed 로 정직하게 종결).
   */
  async processQueueAttempt(data: WebhookDeliveryJobData): Promise<void> {
    const delivery = await this.deliveryRepository.findOne({
      where: { id: data.deliveryId },
    });
    if (!delivery) return; // 행 삭제됨 — 체인 종료
    if (delivery.status === 'DELIVERED') return; // 멱등 단락

    const config = delivery.configId
      ? await this.configRepository.findOne({
          where: { id: delivery.configId, status: 'active' },
        })
      : null;
    if (!config) {
      // config 삭제/비활성 = 발송 중지 — 체인 종료(수동 retry 로만 재진입)
      delivery.status = 'EXHAUSTED';
      delivery.nextRetryAt = null;
      delivery.lastResponse = this.snippet(
        'webhook config 삭제/비활성으로 재시도 중지',
      );
      await this.deliveryRepository.save(delivery);
      return;
    }

    const success = await this.attemptHttp(delivery, config);
    delivery.attempts += 1;

    if (success) {
      delivery.status = 'DELIVERED';
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = null;
      await this.deliveryRepository.save(delivery);
      return;
    }

    const retriesUsed = delivery.attempts - data.baseAttempts;
    if (retriesUsed >= WEBHOOK_MAX_QUEUE_RETRIES) {
      delivery.status = 'EXHAUSTED';
      delivery.nextRetryAt = null;
      await this.deliveryRepository.save(delivery);
      this.logger.warn(
        `[v2] delivery ${delivery.uid} 재시도 ${WEBHOOK_MAX_QUEUE_RETRIES}회 소진 — EXHAUSTED`,
      );
      throw new Error(`webhook delivery ${delivery.uid} exhausted`);
    }

    delivery.status = 'RETRYING';
    delivery.nextRetryAt = new Date(
      Date.now() + webhookDeliveryBackoffMs(retriesUsed),
    );
    await this.deliveryRepository.save(delivery);
    // throw → Bull 이 backoff(type=WEBHOOK_DELIVERY_BACKOFF) 로 재예약
    throw new Error(
      `webhook delivery ${delivery.uid} attempt failed (retry ${retriesUsed}/${WEBHOOK_MAX_QUEUE_RETRIES})`,
    );
  }

  /**
   * HTTP 발송 1회 — payload 는 저장된 바이트 스냅샷 그대로, 서명은 시도 시각의
   * 새 t 로 재서명(사이트별 secret). 성공 = 2xx.
   */
  private async attemptHttp(
    delivery: WebhookDelivery,
    config: WebhookConfig,
  ): Promise<boolean> {
    if (!this.v2Config.enabled || !this.v2Config.encKey) {
      delivery.lastResponse = this.snippet(
        'WEBHOOK_CONFIG_ENC_KEY 미설정 — 발송 불가',
      );
      return false;
    }

    let secret: string;
    try {
      secret = decryptWebhookSecret(config.secretEnc, this.v2Config.encKey);
    } catch {
      // 키 회전 등으로 복호화 불가 — secret 값/원인 상세는 로그 금지
      delivery.lastResponse = this.snippet(
        'secret 복호화 실패 — config secret 재발급(rotateSecret) 필요',
      );
      this.logger.error(
        `[v2] delivery ${delivery.uid} secret 복호화 실패 — site=${delivery.siteId}`,
      );
      return false;
    }

    // HMAC identifier — WH-001 데이터 규약 승계(jobId ?? sessionId), 테스트/무식별
    // 페이로드는 delivery uid 폴백(수신측 문서화: X-Storige-Delivery 와 동일값).
    let identifier = delivery.uid;
    let timestamp = '';
    try {
      const parsed = JSON.parse(delivery.payload) as {
        jobId?: string;
        sessionId?: string;
        timestamp?: string;
      };
      identifier = parsed.jobId ?? parsed.sessionId ?? delivery.uid;
      timestamp = parsed.timestamp ?? '';
    } catch {
      // 스냅샷이 JSON 이 아닐 수 없지만(생성측 통제) 방어적 폴백
    }

    const t = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Storige-Event': delivery.event,
      'X-Storige-Delivery': delivery.uid,
      'X-Storige-Signature-HMAC': signWebhookV2(
        secret,
        identifier,
        delivery.event,
        timestamp,
        t,
      ),
    };

    // SSRF 2선 방어(정본): 발신 직전 실 IP 해석 후 사설/링크로컬/메타데이터 대역 차단.
    // config.url 은 v1 파트너 API(파트너키 인증)로 등록되나, 등록 시점 리터럴 검사만으로는
    // DNS 이름→내부 IP 리바인딩·IPv4-mapped 를 못 막으므로 발신 시점에 재해석한다.
    // (webhook.service 레거시 경로와 동일 유틸 — 방어선 일원화)
    if (!(await isRemoteUrlPublic(config.url))) {
      delivery.lastResponse = this.snippet(
        '발신 대상이 사설/내부 대역으로 해석됨 — SSRF 차단',
      );
      this.logger.error(
        `[v2] delivery ${delivery.uid} SSRF 차단 — 발신 대상 비공개 대역 site=${delivery.siteId}`,
      );
      return false;
    }

    try {
      this.logger.log(
        `[v2] delivery ${delivery.uid} 발송 — event=${delivery.event} site=${delivery.siteId}`,
      );
      const response = await axios.post(config.url, delivery.payload, {
        timeout: WEBHOOK_DELIVERY_TIMEOUT_MS,
        headers,
      });
      delivery.lastStatusCode = response.status;
      delivery.lastResponse = this.snippet(this.stringifyBody(response.data));
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      const err = error as {
        message?: string;
        response?: { status?: number; data?: unknown };
      };
      delivery.lastStatusCode = err.response?.status ?? null;
      delivery.lastResponse = this.snippet(
        err.response
          ? this.stringifyBody(err.response.data)
          : `요청 실패: ${err.message ?? 'unknown error'}`,
      );
      this.logger.warn(
        `[v2] delivery ${delivery.uid} 발송 실패 — status=${delivery.lastStatusCode ?? 'n/a'}`,
      );
      return false;
    }
  }

  // ── v1 API 표면 (조회/테스트/수동 재발송) ─────────────────────────────

  /** POST /api/v1/webhooks/test — isTest=true delivery 로 테스트 이벤트 발송 */
  async sendTest(
    siteId: string,
    env: 'test' | 'live',
  ): Promise<WebhookDeliveryView> {
    if (!this.configService.enabled) {
      throw new PartnerApiException(
        ErrV1.ERR_SERVICE_UNAVAILABLE,
        503,
        '웹훅 기능이 비활성 상태입니다 (서버에 WEBHOOK_CONFIG_ENC_KEY 미설정)',
      );
    }
    const config = await this.configService.findActiveConfigCached(siteId, env);
    if (!config) {
      throw new PartnerApiException(
        ErrV1.ERR_WEBHOOK_CONFIG_NOT_FOUND,
        404,
        '웹훅 설정이 없습니다 — PUT /api/v1/webhooks/config 로 먼저 등록하세요',
      );
    }
    // 테스트 이벤트는 구독 목록과 무관하게 발송. HMAC identifier = deliveryUid
    // (payload 에 동봉 — 수신측 검증 재현용).
    const uid = `${WEBHOOK_DELIVERY_UID_PREFIX}${randomUUID().replace(/-/g, '')}`;
    const payload = {
      event: WEBHOOK_TEST_EVENT,
      deliveryUid: uid,
      isTest: true as const,
      message: 'Storige 웹훅 테스트 발송입니다',
      timestamp: new Date().toISOString(),
    };
    const delivery = await this.dispatchWithUid(config, uid, payload);
    return this.toView(delivery, true);
  }

  /** 테스트 발송용 — uid 를 payload 에 선동봉하기 위해 uid 지정 dispatch */
  private async dispatchWithUid(
    config: WebhookConfig,
    uid: string,
    payload: unknown,
  ): Promise<WebhookDelivery> {
    const delivery = this.deliveryRepository.create({
      id: randomUUID(),
      uid,
      configId: config.id,
      siteId: config.siteId,
      env: config.env,
      event: WEBHOOK_TEST_EVENT,
      isTest: true,
      payload: JSON.stringify(payload),
      status: 'PENDING' as const,
      attempts: 0,
      lastStatusCode: null,
      lastResponse: null,
      nextRetryAt: null,
      deliveredAt: null,
    });
    await this.deliveryRepository.save(delivery);

    const success = await this.attemptHttp(delivery, config);
    delivery.attempts += 1;
    if (success) {
      delivery.status = 'DELIVERED';
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = null;
    } else {
      await this.armRetryChain(delivery);
    }
    await this.deliveryRepository.save(delivery);
    return delivery;
  }

  /** GET /api/v1/webhooks/deliveries — 자기 사이트·env 스코프 목록 */
  async listDeliveries(
    siteId: string,
    env: 'test' | 'live',
    filter: DeliveryListFilter,
    page: NormalizedPagination,
  ): Promise<{ items: WebhookDeliveryView[]; total: number }> {
    const where: FindOptionsWhere<WebhookDelivery> = { siteId, env };
    if (filter.event) where.event = filter.event;
    if (filter.status) where.status = filter.status;
    if (filter.since) where.createdAt = MoreThanOrEqual(filter.since);

    const [rows, total] = await this.deliveryRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return { items: rows.map((row) => this.toView(row, false)), total };
  }

  /** GET /api/v1/webhooks/deliveries/:uid — 상세(payload 포함). 타 사이트 = 404 */
  async getDelivery(
    siteId: string,
    env: 'test' | 'live',
    uid: string,
  ): Promise<WebhookDeliveryView> {
    const delivery = await this.findScoped(siteId, env, uid);
    return this.toView(delivery, true);
  }

  /**
   * POST /api/v1/webhooks/deliveries/:uid/retry — 수동 재발송.
   *
   * 재진입 허용(§1.5 + P1-2 stale 복구):
   *  - EXHAUSTED (기존 규약)
   *  - PENDING/RETRYING 인데 stale — 예정 재시도 시각(nextRetryAt, PENDING 은
   *    createdAt)에서 10분 이상 경과. 인큐 실패/프로세스 중단으로 체인이 죽은
   *    행의 복구 경로. 진행 중 정상 행(미경과)은 여전히 409.
   * 그 외 409 ERR_DELIVERY_NOT_RETRYABLE.
   *
   * [렌즈2 P2-1] 이중 POST race 원자화 — 관측 상태 조건부 UPDATE(CAS,
   * WHERE id+status)로 재진입을 선점한다. 동시 요청 중 한쪽만 affected=1.
   */
  async manualRetry(
    siteId: string,
    env: 'test' | 'live',
    uid: string,
  ): Promise<WebhookDeliveryView> {
    const delivery = await this.findScoped(siteId, env, uid);
    if (!this.isManuallyRetryable(delivery)) {
      throw new PartnerApiException(
        ErrV1.ERR_DELIVERY_NOT_RETRYABLE,
        409,
        `재발송은 EXHAUSTED 또는 10분 이상 정지(stale)된 발송만 가능합니다 (현재: ${delivery.status})`,
      );
    }
    const config = await this.configService.findActiveConfigCached(siteId, env);
    if (!config) {
      throw new PartnerApiException(
        ErrV1.ERR_WEBHOOK_CONFIG_NOT_FOUND,
        404,
        '웹훅 설정이 없거나 비활성입니다 — 재발송 전 config 를 등록하세요',
      );
    }

    // PENDING 재진입(§1.5) — 관측 상태 CAS 로 선점 후 인라인 1회 + 실패 시 새 체인.
    // config 재생성(새 id) 대비 최신 config 로 갱신.
    const claimed = await this.deliveryRepository.update(
      { id: delivery.id, status: delivery.status },
      { status: 'PENDING' as const, configId: config.id, nextRetryAt: null },
    );
    // 관측 상태가 PENDING 인 stale 행은 CAS 로 값이 안 바뀌어 DB 드라이버의
    // changed-rows 의미론에서 affected=0 일 수 있다 — 그 경우 경합 패자와 구분
    // 불가하지만 결과 상태가 동일(PENDING)하고 delivery uid 로 수신측 dedupe
    // 가 가능하므로 진행한다. 상태가 바뀌는 전이(EXHAUSTED/RETRYING→PENDING)만
    // affected 게이트를 적용.
    if (delivery.status !== 'PENDING' && (claimed.affected ?? 0) === 0) {
      throw new PartnerApiException(
        ErrV1.ERR_DELIVERY_NOT_RETRYABLE,
        409,
        '동시 재발송 요청과 경합했습니다 — 이미 재발송이 진행 중입니다',
      );
    }
    delivery.status = 'PENDING';
    delivery.configId = config.id;
    delivery.nextRetryAt = null;

    const success = await this.attemptHttp(delivery, config);
    delivery.attempts += 1;
    if (success) {
      delivery.status = 'DELIVERED';
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = null;
    } else {
      await this.armRetryChain(delivery);
    }
    await this.deliveryRepository.save(delivery);
    return this.toView(delivery, true);
  }

  // ── 내부 ─────────────────────────────────────────────────────────────

  /**
   * [P1-2] 수동 재발송 허용 판정 — EXHAUSTED 또는 stale PENDING/RETRYING.
   * stale 기준: 예정 재시도 시각 + WEBHOOK_MANUAL_RETRY_STALE_MS 경과.
   * (엔티티에 updatedAt 컬럼이 없어 PENDING(nextRetryAt=null)은 createdAt 폴백 —
   * PENDING 이 10분 넘게 남아 있다는 것 자체가 dispatch 중단의 증거)
   */
  private isManuallyRetryable(delivery: WebhookDelivery): boolean {
    if (delivery.status === 'EXHAUSTED') return true;
    if (delivery.status !== 'PENDING' && delivery.status !== 'RETRYING') {
      return false; // DELIVERED — 재발송 불가
    }
    const anchor = delivery.nextRetryAt ?? delivery.createdAt;
    return anchor.getTime() + WEBHOOK_MANUAL_RETRY_STALE_MS <= Date.now();
  }

  private async findScoped(
    siteId: string,
    env: 'test' | 'live',
    uid: string,
  ): Promise<WebhookDelivery> {
    // 테넌트 격리 — uid 가 실재해도 siteId/env 불일치면 존재 자체를 숨긴다(404)
    const delivery = await this.deliveryRepository.findOne({
      where: { uid, siteId, env },
    });
    if (!delivery) {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        '해당 발송 이력이 없습니다',
      );
    }
    return delivery;
  }

  private toView(
    delivery: WebhookDelivery,
    includePayload: boolean,
  ): WebhookDeliveryView {
    const view: WebhookDeliveryView = {
      uid: delivery.uid,
      event: delivery.event,
      env: delivery.env,
      status: delivery.status,
      isTest: delivery.isTest,
      attempts: delivery.attempts,
      lastStatusCode: delivery.lastStatusCode,
      // [P2-1] lastResponse(수신측 응답 본문)는 파트너 뷰 비노출 — 사유 코드만.
      // DB 저장 자체는 유지(운영 진단용).
      lastFailureReason: this.deriveFailureReason(delivery),
      nextRetryAt: delivery.nextRetryAt,
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt,
    };
    if (includePayload) {
      try {
        view.payload = JSON.parse(delivery.payload);
      } catch {
        view.payload = delivery.payload;
      }
    }
    return view;
  }

  /** [P2-1] 마지막 실패의 간략 사유 코드 — 성공(DELIVERED)/미시도 = null */
  private deriveFailureReason(
    delivery: WebhookDelivery,
  ): WebhookDeliveryFailureReason | null {
    if (delivery.status === 'DELIVERED') return null;
    if (delivery.attempts === 0 && delivery.lastResponse === null) return null;
    return delivery.lastStatusCode !== null ? 'HTTP_ERROR' : 'REQUEST_FAILED';
  }

  private stringifyBody(data: unknown): string {
    if (data === undefined || data === null) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  private snippet(text: string): string {
    return text.slice(0, WEBHOOK_RESPONSE_SNIPPET_MAX);
  }
}
