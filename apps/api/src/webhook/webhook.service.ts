import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SynthesisWebhookPayload, ValidationWebhookPayload } from '@storige/types';

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

  /**
   * URL이 허용된 호스트인지 검증.
   * - allowedHosts가 빈 배열이면 (=`*`) 모든 URL 허용 (호환 모드)
   * - 그 외엔 hostname이 정확히 일치하거나 .서브도메인 매칭
   */
  private isAllowedCallbackUrl(callbackUrl: string): boolean {
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
    return this.allowedHosts.some(
      (allowed) =>
        host === allowed.toLowerCase() ||
        host.endsWith('.' + allowed.toLowerCase()),
    );
  }

  /**
   * 웹훅 콜백 전송
   */
  async sendCallback(callbackUrl: string, payload: WebhookPayload): Promise<boolean> {
    if (!callbackUrl) {
      this.logger.warn('No callback URL provided, skipping webhook');
      return false;
    }

    // Patch E (2026-05-03): SSRF 방어 — 허용 호스트 검증
    if (!this.isAllowedCallbackUrl(callbackUrl)) {
      this.logger.error(
        `[Webhook] Blocked callback URL not in allowlist: ${callbackUrl} (allowed: ${this.allowedHosts.join(', ')})`,
      );
      return false;
    }

    try {
      this.logger.log(`Sending webhook to ${callbackUrl}: ${payload.event}`);

      const response = await axios.post(callbackUrl, payload, {
        timeout: 10000, // 10초 타임아웃
        headers: {
          'Content-Type': 'application/json',
          'X-Storige-Event': payload.event,
          'X-Storige-Signature': this.generateSignature(payload),
        },
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
          headers: {
            'Content-Type': 'application/json',
            'X-Storige-Event': payload.event,
            'X-Storige-Retry': '1',
          },
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
   * 간단한 시그니처 생성 (실제 환경에서는 HMAC 등 사용)
   */
  private generateSignature(payload: WebhookPayload): string {
    // SynthesisWebhookPayload는 jobId 우선 (sessionId는 additive optional이므로 둘 다 존재 가능).
    // SessionWebhookPayload는 jobId 없음 → sessionId 사용. 기존 시그니처 동작 보존.
    const identifier =
      'jobId' in payload ? payload.jobId : payload.sessionId;
    const data = `${identifier}:${payload.event}:${payload.timestamp}`;
    return Buffer.from(data).toString('base64');
  }
}
