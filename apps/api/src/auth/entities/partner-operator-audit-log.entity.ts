import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

/** 감사 detail JSON 값 — 2단계까지(스칼라 · 스칼라 배열 · 스칼라 객체) */
export type PartnerOperatorAuditScalar = string | number | boolean | null;
export type PartnerOperatorAuditValue =
  | PartnerOperatorAuditScalar
  | PartnerOperatorAuditScalar[]
  | { [key: string]: PartnerOperatorAuditScalar };
export type PartnerOperatorAuditDetail = { [key: string]: PartnerOperatorAuditValue };

/**
 * 운영자 대리 편집 감사 기록 (2026-09-29, ADDITIVE, append-only).
 *
 * FK 없음 — 세션 soft delete·비회원 세션 24h 퍼지 이후에도 기록이 남아야 한다.
 * 요청 본문·캔버스 데이터·토큰·키는 저장하지 않는다.
 *
 * action:
 *  - 'grant.mint' / 'grant.revoke'           : 권한 발급·취소
 *  - 'session.update' / 'session.complete' /
 *    'session.delete' / 'session.version_restore' : 상태 변경(변경 전에 기록, 기록 실패 시 변경 중단)
 *  - 'request'                                : 운영자 요청 1건(best-effort)
 */
@Entity('partner_operator_audit_logs')
@Index('idx_poal_site_created', ['siteId', 'createdAt'])
@Index('idx_poal_session_created', ['sessionId', 'createdAt'])
@Index('idx_poal_grant', ['grantId'])
export class PartnerOperatorAuditLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'grant_id', type: 'varchar', length: 36 })
  grantId: string;

  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  @Column({ name: 'session_id', type: 'varchar', length: 36, nullable: true })
  sessionId: string | null;

  @Column({ name: 'operator_id', type: 'varchar', length: 128 })
  operatorId: string;

  @Column({ name: 'operator_name', type: 'varchar', length: 100, nullable: true })
  operatorName: string | null;

  @Column({ type: 'varchar', length: 40 })
  action: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  route: string | null;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ type: 'json', nullable: true })
  detail: PartnerOperatorAuditDetail | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 3 })
  createdAt: Date;
}
