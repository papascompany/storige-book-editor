import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import {
  WebhookDeliveryJobData,
  WebhookDeliveryService,
} from './webhook-delivery.service';
import { WEBHOOK_DELIVERY_QUEUE } from './webhook-v2.constants';

/**
 * webhook-delivery 큐 컨슈머 — v2 재시도 체인 전용 (기존 3큐 무접촉).
 *
 * 잡 데이터 = { deliveryId, baseAttempts }. 판정/상태 전이는 전부
 * WebhookDeliveryService.processQueueAttempt 가 소유:
 *  - 미최종 실패 throw → Bull 커스텀 backoff(5분/30분)로 재예약
 *  - 3회 소진 시 EXHAUSTED 확정 후 throw(잡 failed 종결 — 더 이상 재시도 없음)
 *  - DELIVERED/행 삭제/config 삭제 시 정상 반환(체인 종료)
 */
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly deliveryService: WebhookDeliveryService) {}

  @Process()
  async handleRetry(job: Job<WebhookDeliveryJobData>): Promise<void> {
    this.logger.log(
      `[v2] 재시도 처리 — delivery=${job.data.deliveryId} (queue attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );
    await this.deliveryService.processQueueAttempt(job.data);
  }
}
