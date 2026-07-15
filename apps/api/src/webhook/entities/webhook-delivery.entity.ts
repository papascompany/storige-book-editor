import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { WebhookDeliveryStatus } from '../v2/webhook-v2.constants';

/**
 * webhook_deliveries — v2 발송 이력(delivery store, 설계서 §2.8).
 *
 * 상태 흐름(§1.5):
 *   PENDING ─2xx→ DELIVERED
 *      └─실패→ RETRYING ─(백오프 1/5/30분, 최대 3회)→ DELIVERED
 *                  └─3회 소진→ EXHAUSTED ─(수동 retry API)→ PENDING(재진입)
 *
 * - uid: 'whd_...' — 발송 헤더 X-Storige-Delivery 값. 파트너 대면 식별자.
 * - payload: 발송 당시 JSON 바이트 스냅샷 — 재시도는 항상 동일 바이트 재전송
 *   (delivery 단위 멱등 — 재시도 안전).
 * - prod 는 synchronize=false — migrations/20260715_c_add_webhook_v2_tables.sql 수동 실행.
 */
@Entity('webhook_deliveries')
@Index('uq_webhook_deliveries_uid', ['uid'], { unique: true })
@Index('idx_webhook_deliveries_site', ['siteId', 'env', 'event', 'createdAt'])
@Index('idx_webhook_deliveries_retry', ['status', 'nextRetryAt'])
export class WebhookDelivery {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 'whd_...' — X-Storige-Delivery 헤더값 */
  @Column({ type: 'varchar', length: 40 })
  uid: string;

  /** webhook_configs.id (v1 발신) — config 삭제 후에도 이력은 남는다 */
  @Column({ name: 'config_id', type: 'varchar', length: 36, nullable: true })
  configId: string | null;

  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  @Column({ type: 'enum', enum: ['test', 'live'] })
  env: 'test' | 'live';

  @Column({ type: 'varchar', length: 60 })
  event: string;

  @Column({ name: 'is_test', type: 'boolean', default: false })
  isTest: boolean;

  /** 발송 당시 바이트 스냅샷(JSON 문자열) — 모든 재시도가 이 바이트를 그대로 보낸다 */
  @Column({ type: 'mediumtext' })
  payload: string;

  @Column({
    type: 'enum',
    enum: ['PENDING', 'DELIVERED', 'RETRYING', 'EXHAUSTED'],
    default: 'PENDING',
  })
  status: WebhookDeliveryStatus;

  /** 누적 HTTP 시도 횟수(수동 retry 재진입 포함 총계) */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_status_code', type: 'int', nullable: true })
  lastStatusCode: number | null;

  /** 응답 본문 앞 N자 절삭 저장 (WEBHOOK_RESPONSE_SNIPPET_MAX) */
  @Column({ name: 'last_response', type: 'text', nullable: true })
  lastResponse: string | null;

  @Column({ name: 'next_retry_at', type: 'timestamp', nullable: true })
  nextRetryAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
