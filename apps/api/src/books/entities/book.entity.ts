import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  BOOK_CREATION_TYPES,
  BOOK_STATUSES,
  type BookCreationType,
  type BookStatus,
} from '../books.constants';

/**
 * 도서 aggregate 엔티티 (Partner API v1 Stage 3).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4
 * 마이그레이션: apps/api/migrations/20260716_add_books_core.sql
 *
 * - books 는 기존 files/file_edit_sessions/worker_jobs 를 대체하지 않는 파사드 —
 *   내부 오케스트레이션만 하고 기존 모듈 시맨틱은 무접촉(§6.1 AD-2, AD-1).
 * - uid('bk_...')만 외부 노출, 내부 UUID(id)는 비노출(§2.0 접두 체계).
 * - 전 리소스 site_id NOT NULL — v1 은 처음부터 site 스탬프 강제(§7.1).
 * - status 는 DRAFT/FINALIZED 2종(§6.2 AD-3). FINALIZED→DRAFT 되돌림은 v1 범위 밖.
 * - book_spec_id 는 NULLABLE (설계서 초안 NOT NULL 정정) — book_specs 시드가 오너
 *   승인 대기(§9-6)라 시드 없이도 DRAFT 생성이 가능해야 한다. finalization 페이지
 *   규칙은 W3 에서 book_spec 연결 시에만 적용.
 * - edit_session_id 는 file_edit_sessions(EditSession @Entity('file_edit_sessions'))
 *   참조 — EDITOR_SESSION 승격 원본. 조회+참조만(AD-1: 상태 변경 금지).
 */
@Entity('books')
@Index('idx_books_site_env_status', ['siteId', 'env', 'status'])
@Index('idx_books_session', ['editSessionId'])
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 외부 식별자 'bk_...' */
  @Column({ length: 40, unique: true })
  uid: string;

  /** 소유 site (NULL 금지 — v1 전 리소스 site 스탬프) */
  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  /** 인증 컨텍스트 env — test|live (Stage 2 환경 모델). sites 키 인증은 항상 live. */
  @Column({ type: 'enum', enum: ['test', 'live'], default: 'live' })
  env: 'test' | 'live';

  /** 생성 유형 4종 (§6.1) */
  @Column({
    name: 'creation_type',
    type: 'enum',
    enum: BOOK_CREATION_TYPES as unknown as string[],
  })
  creationType: BookCreationType;

  /** book_specs.id — NULLABLE(시드 게이트). 연결 시 finalization 페이지 규칙 근거(W3) */
  @Column({ name: 'book_spec_id', type: 'varchar', length: 36, nullable: true })
  bookSpecId: string | null;

  /** DRAFT(자산 투입/교체 가능) / FINALIZED(편집 불가·주문 가능) */
  @Column({ type: 'enum', enum: BOOK_STATUSES as unknown as string[], default: 'DRAFT' })
  status: BookStatus;

  /** finalization 시 확정되는 총 페이지 수 */
  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  /** EDITOR_SESSION 승격 원본 file_edit_sessions.id (조회+참조만) */
  @Column({ name: 'edit_session_id', type: 'varchar', length: 36, nullable: true })
  editSessionId: string | null;

  /** 파트너측 자체 참조 ID(자유) */
  @Column({ name: 'partner_ref', type: 'varchar', length: 100, nullable: true })
  partnerRef: string | null;

  @Column({ name: 'finalized_at', type: 'timestamp', nullable: true })
  finalizedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
