import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WebhookConfigStatus } from '../v2/webhook-v2.constants';

/**
 * webhook_configs — 사이트·env별 웹훅 v2 설정 (설계서 §2.7).
 *
 * 현행 전역 단일 WEBHOOK_SECRET·site 단일 webhookUrl(uploadCallbackUrl)은 무접촉 —
 * v1 Partner API config 는 이 테이블이 정본이다.
 *
 * - secret_enc: HMAC 서명용 secret 의 **at-rest 암호화**(AES-256-GCM,
 *   키 = env WEBHOOK_CONFIG_ENC_KEY). 서명 계산에 원문이 필요해 해시 보관 불가.
 *   평문 컬럼 금지 원칙 — 응답 노출은 발급/회전 1회뿐(webhook-secret.crypto.ts).
 * - env: Stage 1 은 전 요청 'live' 고정(PARTNER_ENV_LIVE) — S2-1 env 모델 도입 시
 *   인증 컨텍스트의 env 로 대체(additive).
 * - prod 는 synchronize=false — migrations/20260715_c_add_webhook_v2_tables.sql 수동 실행.
 */
@Entity('webhook_configs')
@Index('uq_webhook_configs_site_env', ['siteId', 'env'], { unique: true })
export class WebhookConfig {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  @Column({ type: 'enum', enum: ['test', 'live'], default: 'live' })
  env: 'test' | 'live';

  @Column({ type: 'varchar', length: 500 })
  url: string;

  /** AES-256-GCM 암호문 `v1:<iv hex>:<tag hex>:<ct hex>` — 평문/로그 금지 */
  @Column({ name: 'secret_enc', type: 'varchar', length: 256 })
  secretEnc: string;

  /** 표시용 마스킹 (예: 'whsec_ab12cd') — GET config 응답은 이 값만 노출 */
  @Column({ name: 'secret_prefix', type: 'varchar', length: 12 })
  secretPrefix: string;

  /** 구독 이벤트 배열(빈 배열 = 전체 구독) — WEBHOOK_V2_SUBSCRIBABLE_EVENTS 부분집합 */
  @Column({ type: 'json' })
  events: string[];

  @Column({ type: 'enum', enum: ['active', 'disabled'], default: 'active' })
  status: WebhookConfigStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
