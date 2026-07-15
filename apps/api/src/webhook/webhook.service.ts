import { Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import { createHmac } from 'crypto';
import { SynthesisWebhookPayload, ValidationWebhookPayload } from '@storige/types';
import { SitesService } from '../sites/sites.service';
import { PARTNER_ENV_LIVE } from '../partner-api/partner-api.constants';
import { WebhookDeliveryService } from './v2/webhook-delivery.service';

export { SynthesisWebhookPayload, ValidationWebhookPayload };

export interface SessionWebhookPayload {
  event: 'session.validated' | 'session.failed';
  sessionId: string;
  orderSeqno: number;
  status: 'validated' | 'failed';
  fileType?: 'cover' | 'content';
  errorMessage?: string;
  result?: any;
  timestamp: string;
}

// WebhookPayload: 모든 웹훅 페이로드 유형의 합집합
export type WebhookPayload = SessionWebhookPayload | SynthesisWebhookPayload | ValidationWebhookPayload;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  /**
   * 허용된 webhook 호스트 목록 (Patch E, 2026-05-03)
   *
   * 환경변수 `WEBHOOK_ALLOWED_HOSTS` (콤마 구분) 우선, 없으면 기본값 사용.
   * SSRF 방어 — 임의 URL로 webhook 전송 금지.
   * 빈 문자열로 명시적 비활성화 가능 (`WEBHOOK_ALLOWED_HOSTS=*` — 호환 모드).
   *
   * Phase 1-2 (2026-05-16): env 매칭에 실패해도 `SitesService.isWebhookHostAllowed()`
   * 로 한 번 더 확인 → 새 외부 사이트는 Admin 에서 등록만 하면 자동 허용.
   */
  private readonly allowedHosts: string[] = (() => {
    const env = process.env.WEBHOOK_ALLOWED_HOSTS;
    if (env === '*') return []; // 와일드카드 = 검증 비활성화
    if (env && env.length > 0) {
      return env.split(',').map((s) => s.trim()).filter(Boolean);
    }
    // 기본값: 운영/스테이징/로컬
    return [
      'papascompany.co.kr',
      'bookmoa.com',
      'localhost',
      '127.0.0.1',
      'host.docker.internal',
    ];
  })();

  // Phase 1-2 — SitesService 는 webhook 모듈이 cyclic 의존을 피할 수 있도록 @Optional.
  // 주입 안 되어도 (예: 부팅 초기) 기존 allowedHosts 만으로 동작.
  // Stage 2 — WebhookDeliveryService(v2 opt-in)도 @Optional: 미주입 시(기존
  // 단위 테스트의 `new WebhookService()` 포함) v2 분기 자체가 없어 현행과 동일.
  constructor(
    @Optional() private readonly sitesService?: SitesService,
    @Optional() private readonly webhookDeliveryService?: WebhookDeliveryService,
  ) {}

  /**
   * [Stage 2] 사이트에 v2 active config 가 있는지 (webhook_configs opt-in).
   * WEBHOOK_CONFIG_ENC_KEY 미설정(v2 비활성)이면 DB 조회 없이 false —
   * 기존 파트너/기존 배포의 타이밍에 영향 0. 호출측(worker-jobs)이
   * callbackUrl 부재 시 발신 스킵 판정을 보강하는 용도.
   */
  async hasV2Config(siteId?: string | null): Promise<boolean> {
    if (!siteId || !this.webhookDeliveryService) return false;
    return this.webhookDeliveryService.hasActiveConfig(siteId, PARTNER_ENV_LIVE);
  }

  /**
   * URL이 허용된 호스트인지 검증.
   * - allowedHosts가 빈 배열이면 (=`*`) 모든 URL 허용 (호환 모드)
   * - env / 기본값 매칭에 실패하면 sitesService (있으면) 동적 매칭으로 폴백
   */
  private async isAllowedCallbackUrl(callbackUrl: string): Promise<boolean> {
    if (this.allowedHosts.length === 0) return true; // 와일드카드 모드

    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      return false;
    }

    // 프로토콜 제한: http/https만
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const host = url.hostname.toLowerCase();
    const staticMatch = this.allowedHosts.some(
      (allowed) =>
        host === allowed.toLowerCase() ||
        host.endsWith('.' + allowed.toLowerCase()),
    );
    if (staticMatch) return true;

    // Phase 1-2: env 매칭 실패 시 DB sites 기반 동적 매칭
    if (this.sitesService) {
      try {
        return await this.sitesService.isWebhookHostAllowed(callbackUrl);
      } catch (err) {
        this.logger.error(`sites-based webhook host check failed: ${(err as Error).message}`);
        return false;
      }
    }
    return false;
  }

  /**
   * 웹훅 콜백 전송
   *
   * [Stage 2] context.siteId 가 주어지고 해당 사이트에 v2 active config
   * (webhook_configs 행)가 있으면 v2 경로(사이트별 HMAC secret + delivery store +
   * 1/5/30분 재시도)로 발송하고 여기서 반환한다 — **config 가 없는 사이트
   * (기존 파트너 전원)는 아래 기존 경로를 바이트/헤더/타이밍 그대로 탄다.**
   * v2 비활성(WEBHOOK_CONFIG_ENC_KEY 미설정) 시엔 config 조회조차 없다.
   * 기존 파트너의 v2 전환(D-7c 게이트)은 파트너가 v1 API 로 config 를 직접
   * 등록할 때만 일어난다 — 코드가 전환을 강제하는 경로 없음.
   */
  async sendCallback(
    callbackUrl: string,
    payload: WebhookPayload,
    context?: { siteId?: string | null; env?: 'test' | 'live' },
  ): Promise<boolean> {
    if (context?.siteId && this.webhookDeliveryService) {
      // env 규약(S2-1 정합화): context.env 는 v1 라우트 경유 발신에서만
      // resolvePartnerEnv(req.user) 값이 전달된다. 잡 완료 발신(worker-jobs)은
      // 요청 컨텍스트가 없어 env 를 넘기지 않으며 live 로 폴백(현행 유지).
      const v2 = await this.webhookDeliveryService.tryDispatchForSite(
        context.siteId,
        context.env ?? PARTNER_ENV_LIVE,
        payload,
      );
      if (v2) return v2.delivered; // v2 opt-in 사이트 — 레거시 경로 미진입
    }

    if (!callbackUrl) {
      this.logger.warn('No callback URL provided, skipping webhook');
      return false;
    }

    // Patch E (2026-05-03) + Phase 1-2 (2026-05-16):
    // SSRF 방어 — env allowlist 우선, 실패 시 DB sites 동적 매칭.
    if (!(await this.isAllowedCallbackUrl(callbackUrl))) {
      this.logger.error(
        `[Webhook] Blocked callback URL not in allowlist: ${callbackUrl} (env-allowed: ${this.allowedHosts.join(', ')})`,
      );
      return false;
    }

    try {
      this.logger.log(`Sending webhook to ${callbackUrl}: ${payload.event}`);

      const response = await axios.post(callbackUrl, payload, {
        timeout: 10000, // 10초 타임아웃
        headers: this.buildHeaders(payload),
      });

      if (response.status >= 200 && response.status < 300) {
        this.logger.log(`Webhook sent successfully: ${response.status}`);
        return true;
      } else {
        this.logger.warn(`Webhook returned non-success status: ${response.status}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to send webhook: ${error.message}`);

      // 재시도 로직 (간단한 1회 재시도)
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        const retryResponse = await axios.post(callbackUrl, payload, {
          timeout: 10000,
          // WH-001: 재시도 경로도 서명 헤더를 포함(기존엔 누락돼 수신측 검증 불가했음).
          headers: { ...this.buildHeaders(payload), 'X-Storige-Retry': '1' },
        });
        if (retryResponse.status >= 200 && retryResponse.status < 300) {
          this.logger.log('Webhook retry succeeded');
          return true;
        }
      } catch (retryError) {
        this.logger.error(`Webhook retry failed: ${retryError.message}`);
      }

      return false;
    }
  }

  /**
   * 공통 웹훅 헤더 구성. 기존 base64 서명(X-Storige-Signature)은 그대로 유지하고(계약 호환),
   * WEBHOOK_SECRET 이 설정된 경우에만 위조 불가한 HMAC 서명(X-Storige-Signature-HMAC)을
   * 추가로 함께 보낸다(WH-001, 비파괴). 수신측은 HMAC 헤더로 점진 전환 가능.
   */
  private buildHeaders(payload: WebhookPayload): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Storige-Event': payload.event,
      'X-Storige-Signature': this.generateSignature(payload),
    };
    const hmac = this.generateHmacSignature(payload);
    if (hmac) headers['X-Storige-Signature-HMAC'] = hmac;
    return headers;
  }

  /**
   * 간단한 시그니처 생성 (레거시 — 비밀키 미사용 base64, 위조 가능).
   * ⚠️ 보안 검증용으로 신뢰 금지. 무결성 검증은 generateHmacSignature(HMAC) 사용.
   * 기존 수신측 계약 호환을 위해 헤더는 계속 전송한다.
   */
  private generateSignature(payload: WebhookPayload): string {
    // SynthesisWebhookPayload는 jobId 우선 (sessionId는 additive optional이므로 둘 다 존재 가능).
    // SessionWebhookPayload는 jobId 없음 → sessionId 사용. 기존 시그니처 동작 보존.
    const identifier =
      'jobId' in payload ? payload.jobId : payload.sessionId;
    const data = `${identifier}:${payload.event}:${payload.timestamp}`;
    return Buffer.from(data).toString('base64');
  }

  /**
   * WH-001 — HMAC-SHA256(WEBHOOK_SECRET) 위조 불가 서명. 포맷 `t=<unixsec>,v1=<hex>`
   * (Stripe 호환 스타일, PLATFORM_WORKER_INTEGRATION 문서 규약과 정합).
   * WEBHOOK_SECRET 미설정 시 undefined → 헤더 미전송(현행 동작 100% 보존, 비파괴).
   * 수신측 검증: 동일 `t.payloadIdentifier:event:timestamp` 를 같은 비밀키로 HMAC 후 비교.
   */
  private generateHmacSignature(payload: WebhookPayload): string | undefined {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return undefined;
    const identifier =
      'jobId' in payload ? payload.jobId : payload.sessionId;
    const t = Math.floor(Date.now() / 1000);
    const data = `${t}.${identifier}:${payload.event}:${payload.timestamp}`;
    const v1 = createHmac('sha256', secret).update(data).digest('hex');
    return `t=${t},v1=${v1}`;
  }
}
