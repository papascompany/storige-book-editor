import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookService } from './webhook.service';
import { WebhookConfig } from './entities/webhook-config.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { webhookV2ConfigProvider } from './v2/webhook-v2.config';
import { WebhookConfigService } from './v2/webhook-config.service';
import {
  WebhookDeliveryService,
  webhookDeliveryBackoffMs,
} from './v2/webhook-delivery.service';
import { WebhookDeliveryProcessor } from './v2/webhook-delivery.processor';
import {
  WEBHOOK_DELIVERY_BACKOFF,
  WEBHOOK_DELIVERY_QUEUE,
} from './v2/webhook-v2.constants';

/**
 * 웹훅 모듈 — 기존 v1 발신(WebhookService) + v2 opt-in(Stage 2 작업 5).
 *
 * v2 는 전용 Bull 큐(webhook-delivery)를 신설한다 — 기존 3큐
 * (pdf-validation/conversion/synthesis) 무접촉. 커스텀 backoff 전략으로
 * 재시도 1분/5분/30분 스케줄을 구현(잡 옵션 backoff.type 참조).
 *
 * WEBHOOK_CONFIG_ENC_KEY 미설정 시 v2 는 전체 비활성(부팅 경고 1회) —
 * 기존 v1 발신 경로는 바이트/헤더/타이밍 불변.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookConfig, WebhookDelivery]),
    BullModule.registerQueue({
      name: WEBHOOK_DELIVERY_QUEUE,
      settings: {
        backoffStrategies: {
          [WEBHOOK_DELIVERY_BACKOFF]: (attemptsMade: number) =>
            webhookDeliveryBackoffMs(attemptsMade),
        },
      },
    }),
  ],
  providers: [
    WebhookService,
    webhookV2ConfigProvider,
    WebhookConfigService,
    WebhookDeliveryService,
    WebhookDeliveryProcessor,
  ],
  exports: [WebhookService],
})
export class WebhookModule {}
