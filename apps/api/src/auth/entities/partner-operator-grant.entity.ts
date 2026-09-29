import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Index,
  ValueTransformer,
} from 'typeorm';

/** BIGINT ↔ number (드라이버가 문자열로 돌려주는 경우 대비). null 은 그대로 둔다. */
export const bigintToNumber: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
};

/**
 * 운영자 대리 편집 권한 (2026-09-29, ADDITIVE — migrations/20260929_add_partner_operator_grants_and_audit.sql).
 *
 * 파트너 서버가 사이트 편집기 키(X-API-Key)로 `POST /auth/partner-operator-session` 을 호출해 발급한다.
 * 발급된 토큰은 요청·갱신마다 이 행을 다시 읽어 확인한다(취소·만료·사이트 운영중지·키 교체 즉시 반영).
 *
 * - id 는 앱이 randomUUID() 로 부여한다.
 * - capabilities: 'edit' 또는 'edit,delete' (쉼표 구분).
 * - key_fp: 발급에 쓰인 사이트 키의 sha256 hex 앞 16자. 키 원문은 저장하지 않는다.
 */
@Entity('partner_operator_grants')
@Index('idx_pog_site_created', ['siteId', 'createdAt'])
@Index('idx_pog_site_revoked', ['siteId', 'revokedAt'])
export class PartnerOperatorGrantEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  @Column({ name: 'operator_id', type: 'varchar', length: 128 })
  operatorId: string;

  @Column({ name: 'operator_name', type: 'varchar', length: 100, nullable: true })
  operatorName: string | null;

  /** 발급 시점에 고정된 세션 id 목록(1~20) */
  @Column({ name: 'session_ids', type: 'json' })
  sessionIds: string[];

  @Column({ type: 'varchar', length: 64, default: 'edit' })
  capabilities: string;

  /** 파트너 주문 식별자 — 감사용, 권한 판단에 쓰지 않는다 */
  @Column({ name: 'order_ref', type: 'varchar', length: 100, nullable: true })
  orderRef: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  /** 범위 세션이 모두 같은 회원(memberSeqno>0)일 때만 기록 — 업로드 소유 스탬프 전용 */
  @Column({
    name: 'on_behalf_of_member_seqno',
    type: 'bigint',
    nullable: true,
    transformer: bigintToNumber,
  })
  onBehalfOfMemberSeqno: number | null;

  @Column({ name: 'key_fp', type: 'char', length: 16 })
  keyFp: string;

  /** 권한 만료 시각(unix 초) */
  @Column({ name: 'expires_at_unix', type: 'bigint', transformer: bigintToNumber })
  expiresAtUnix: number;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
