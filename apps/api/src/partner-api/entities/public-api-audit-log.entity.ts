import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * public_api_audit_logs — v1 호출 감사 (설계서 §2.9).
 *
 * - 본문/헤더는 저장하지 않는다(PII·시크릿 유입 차단).
 * - request_id 는 봉투 requestId 와 동일값 — 지원 문의 상호 참조 키.
 * - site_id/env 는 인증 실패 시 null.
 * - prod 는 synchronize=false — migrations/20260715_add_partner_api_v1_core.sql 수동 실행.
 */
@Entity('public_api_audit_logs')
@Index('idx_audit_site_time', ['siteId', 'createdAt'])
@Index('idx_audit_request', ['requestId'])
export class PublicApiAuditLog {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'request_id', type: 'varchar', length: 40 })
  requestId: string;

  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @Column({ type: 'enum', enum: ['test', 'live'], nullable: true })
  env: 'test' | 'live' | null;

  /** partner_api_keys.id — Stage 2 이후 채움 */
  @Column({ name: 'api_key_id', type: 'varchar', length: 36, nullable: true })
  apiKeyId: string | null;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 300 })
  path: string;

  @Column({ name: 'status_code', type: 'int' })
  statusCode: number;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode: string | null;

  @Column({ name: 'latency_ms', type: 'int' })
  latencyMs: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
