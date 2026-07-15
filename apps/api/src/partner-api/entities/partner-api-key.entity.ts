import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PartnerEnv } from '../partner-api.constants';

/** 키 상태 — active(정상) / grace(회전 유예 중) / revoked(폐기) */
export type PartnerApiKeyStatus = 'active' | 'grace' | 'revoked';

/**
 * partner_api_keys — v1 파트너 키 (설계서 §2.1, Stage 2 작업 1·4).
 *
 * 현행 sites.editor_auth_code/worker_auth_code(평문·단일 env)는 **무접촉 유지** —
 * v1 키는 이 테이블에서만 발급한다. 조회 폴백은 v1 전용 PartnerApiKeyGuard 에만
 * 실장하고 공용 ApiKeyGuard 는 불변(§2.1/§7.1 — env 스코프 우회 차단, AD-1).
 *
 * 키 보안 3종:
 *  - 해시 저장: key_hash = SHA-256(원문) hex. 평문 컬럼 없음.
 *  - 1회 노출: 발급 응답에서만 원문 반환, 이후 key_prefix 마스킹 표시만.
 *  - 오버랩 회전: rotate 시 구 키 status='grace' + grace_until=now+72h,
 *    만료 배치(@Cron)가 grace 만료분을 revoked 로 승격.
 *
 * - FK 제약 없음(컬럼+인덱스만) — 기존 테이블 무접촉 원칙(§2 공통).
 * - prod 는 synchronize=false — migrations/20260715_c_add_partner_api_keys.sql 수동 실행.
 */
@Entity('partner_api_keys')
@Index('idx_partner_api_keys_site_env', ['siteId', 'env'])
@Index('idx_partner_api_keys_prefix', ['keyPrefix'])
export class PartnerApiKey {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** sites.id 참조(논리 — DB FK 없음) */
  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  /** 환경 스코프 — 키·멱등·감사·웹훅에 일관 적용(§7.3 논리 분리) */
  @Column({ type: 'enum', enum: ['test', 'live'], default: 'test' })
  env: PartnerEnv;

  /** 표시/식별용 접두 (예: 'sk_test_a1b2') — 목록/마스킹 응답에 사용 */
  @Column({ name: 'key_prefix', type: 'varchar', length: 16 })
  keyPrefix: string;

  /** SHA-256(원문) hex — 발급 1회 노출, 평문 컬럼 없음 */
  @Index('uq_partner_api_keys_hash', { unique: true })
  @Column({ name: 'key_hash', type: 'varchar', length: 128 })
  keyHash: string;

  /** 파트너가 붙이는 라벨 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  /** 스코프 목록 (예: ["books","webhooks"]) — null=전체 */
  @Column({ type: 'json', nullable: true })
  scopes: string[] | null;

  @Column({ type: 'enum', enum: ['active', 'revoked', 'grace'], default: 'active' })
  status: PartnerApiKeyStatus;

  /** 오버랩 회전 유예(72h) 만료 시각 — status='grace' 일 때만 의미 */
  @Column({ name: 'grace_until', type: 'timestamp', nullable: true })
  graceUntil: Date | null;

  /** 폐기 시각 — 명시 revoke 또는 grace 만료 배치가 스탬프 */
  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
