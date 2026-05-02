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
   * 웹훅 콜백 전송
   */
  async sendCallback(callbackUrl: string, payload: WebhookPayload): Promise<boolean> {
    if (!callbackUrl) {
      this.logger.warn('No callback URL provided, skipping webhook');
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
