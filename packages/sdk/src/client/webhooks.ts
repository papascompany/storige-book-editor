/**
 * Webhooks 리소스 — 설정 3 + 테스트 1 + 이력 3 = 7라우트 (설계서 §1.5).
 *
 * 전부 general 버킷(300/min).
 *
 * ⚠️ 이 리소스는 웹훅 **관리** 표면이다(설정/발송이력). 수신 측 서명 검증
 *    유틸리티는 별도 subpath(`@storige/sdk/webhook`)로 후속 단계에서 제공한다.
 *
 * env 스코프: config·발송 이력은 키의 env(test/live)로 완전 격리된다 —
 * test 키로 등록한 설정은 live 조회에 나타나지 않는다.
 */

import type { Page } from '../index';
import type {
  PutWebhookConfigInput,
  WebhookConfigView,
  WebhookDeliveryListQuery,
  WebhookDeliveryView,
} from '../types';
import type { HttpClient, RequestOptions } from './http';

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  // ── config ────────────────────────────────────────────────────────────

  /**
   * PUT /api/v1/webhooks/config — 설정 upsert.
   *
   * ⚠️ 응답의 `secret` 은 **생성/회전 시 1회만** 노출된다 — 재조회 불가.
   *    받은 즉시 안전한 저장소에 보관해야 한다(이후 getConfig 는 secretPrefix
   *    마스킹만 준다).
   *
   * PUT 이라 서버 멱등 인터셉터(POST 전용) 대상이 아니다 — 자연 멱등.
   *
   * @throws StorigeApiError ERR_WEBHOOK_URL_FORBIDDEN(422) — 허용 호스트 외 URL
   * @throws StorigeApiError ERR_SERVICE_UNAVAILABLE(503) — 서버 암호화 키 미설정
   */
  async putConfig(
    input: PutWebhookConfigInput,
    options?: RequestOptions,
  ): Promise<WebhookConfigView> {
    return this.http.request<WebhookConfigView>({
      method: 'PUT',
      path: '/webhooks/config',
      json: input,
      options,
    });
  }

  /**
   * GET /api/v1/webhooks/config — 설정 조회(secret 은 prefix 마스킹).
   *
   * @throws StorigeApiError ERR_WEBHOOK_CONFIG_NOT_FOUND(404)
   */
  async getConfig(options?: RequestOptions): Promise<WebhookConfigView> {
    return this.http.request<WebhookConfigView>({
      method: 'GET',
      path: '/webhooks/config',
      options,
    });
  }

  /**
   * DELETE /api/v1/webhooks/config — 설정 삭제(발송 중지, 이력은 보존).
   *
   * @throws StorigeApiError ERR_WEBHOOK_CONFIG_NOT_FOUND(404)
   */
  async deleteConfig(options?: RequestOptions): Promise<{ deleted: true }> {
    return this.http.request<{ deleted: true }>({
      method: 'DELETE',
      path: '/webhooks/config',
      options,
    });
  }

  // ── test ──────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/webhooks/test — 테스트 이벤트 발송(isTest=true, 구독 목록 무관).
   *
   * 본문이 없어 Idempotency-Key 가 자동 부여된다.
   *
   * @throws StorigeApiError ERR_WEBHOOK_CONFIG_NOT_FOUND(404)
   */
  async sendTest(options?: RequestOptions): Promise<WebhookDeliveryView> {
    return this.http.request<WebhookDeliveryView>({
      method: 'POST',
      path: '/webhooks/test',
      options,
    });
  }

  // ── deliveries ────────────────────────────────────────────────────────

  /** GET /api/v1/webhooks/deliveries — 발송 이력 목록(event/status/since 필터). */
  async listDeliveries(
    query: WebhookDeliveryListQuery = {},
    options?: RequestOptions,
  ): Promise<Page<WebhookDeliveryView>> {
    return this.http.requestPage<WebhookDeliveryView>({
      method: 'GET',
      path: '/webhooks/deliveries',
      query: {
        event: query.event,
        status: query.status,
        // Date 는 http 계층이 ISO 문자열로 직렬화한다(서버는 ISO 8601 만 수용)
        since: query.since,
        limit: query.limit,
        offset: query.offset,
      },
      options,
    });
  }

  /**
   * GET /api/v1/webhooks/deliveries/{uid} — 발송 이력 상세(payload 포함).
   *
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 없음/타 사이트
   */
  async getDelivery(uid: string, options?: RequestOptions): Promise<WebhookDeliveryView> {
    return this.http.request<WebhookDeliveryView>({
      method: 'GET',
      path: `/webhooks/deliveries/${encodeURIComponent(uid)}`,
      options,
    });
  }

  /**
   * POST /api/v1/webhooks/deliveries/{uid}/retry — 수동 재발송.
   *
   * 대상: EXHAUSTED 또는 10분 이상 stale 한 PENDING/RETRYING.
   * 본문이 없어 Idempotency-Key 가 자동 부여된다.
   *
   * @throws StorigeApiError ERR_DELIVERY_NOT_RETRYABLE(409) — 재시도 불가 상태
   */
  async retryDelivery(uid: string, options?: RequestOptions): Promise<WebhookDeliveryView> {
    return this.http.request<WebhookDeliveryView>({
      method: 'POST',
      path: `/webhooks/deliveries/${encodeURIComponent(uid)}/retry`,
      options,
    });
  }
}
