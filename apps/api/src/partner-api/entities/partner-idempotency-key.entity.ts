import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * partner_idempotency_keys — v1 멱등 캐시 (설계서 §2.2·§4).
 *
 * scope = (site_id, env, method, path, idempotency_key) UNIQUE —
 * INSERT 선점이 원자 연산이 되어 동시 요청 경쟁에서 이중 실행을 차단한다.
 *
 * - request_hash: canonical JSON(키 정렬) SHA-256
 * - response_snapshot: 완료 시 봉투 전체(2xx·결정적 4xx만 — 5xx 는 행 삭제로 재시도 허용)
 * - expires_at: created_at + 24h (일 1회 sweep cron)
 * - prod 는 synchronize=false — migrations/20260715_b_add_partner_idempotency_keys.sql 수동 실행.
 */
@Entity('partner_idempotency_keys')
@Index('uq_idem_scope', ['siteId', 'env', 'method', 'path', 'idempotencyKey'], {
  unique: true,
})
@Index('idx_idem_expires', ['expiresAt'])
export class PartnerIdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  @Column({ type: 'enum', enum: ['test', 'live'] })
  env: 'test' | 'live';

  @Column({ type: 'varchar', length: 8 })
  method: string;

  /** 정규화 경로(경로 파라미터 실값 포함) */
  @Column({ type: 'varchar', length: 300 })
  path: string;

  /** 파트너 제공 Idempotency-Key 헤더값 (1~128자) */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  /** SHA-256(canonical body) hex */
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ type: 'enum', enum: ['in_progress', 'completed'], default: 'in_progress' })
  status: 'in_progress' | 'completed';

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus: number | null;

  /** 완료 시 응답 본문(봉투 전체) JSON 문자열 */
  @Column({ name: 'response_snapshot', type: 'mediumtext', nullable: true })
  responseSnapshot: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
