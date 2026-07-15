import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import {
  BOOK_FINALIZATION_STATUSES,
  type BookFinalizationStatus,
} from '../books.constants';

/**
 * 최종화 이력/산출물 고정 엔티티 — Partner API v1 Stage 3.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.6·§6.3
 * 마이그레이션: apps/api/migrations/20260716_add_books_core.sql
 *
 * ⚠️ 본 배치(W1+W2)는 테이블/엔티티만 신설한다. 실행 상태머신
 *    (PENDING→VALIDATING→COMPOSING→COMPLETED/FAILED)과 워커 validate/
 *    synthesize/compose-mixed 오케스트레이션·output_file_id 고정·웹훅
 *    book.finalization.completed 발송은 W3 finalization 오케스트레이터가 구현한다.
 * - validate_job_id/compose_job_id 는 worker_jobs.id 참조(조회+참조만, AD-1).
 * - FAILED 후 재호출은 attempt+1 새 행(§6.3 멱등 규약).
 */
@Entity('book_finalizations')
@Index('idx_book_finalizations_book', ['bookId', 'status'])
export class BookFinalization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 외부 식별자 'fin_...' */
  @Column({ length: 40, unique: true })
  uid: string;

  /** books.id */
  @Column({ name: 'book_id', type: 'varchar', length: 36 })
  bookId: string;

  /** 실패 후 재시도 이력 */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  @Column({
    type: 'enum',
    enum: BOOK_FINALIZATION_STATUSES as unknown as string[],
    default: 'PENDING',
  })
  status: BookFinalizationStatus;

  /** worker_jobs.id (검증) */
  @Column({ name: 'validate_job_id', type: 'varchar', length: 36, nullable: true })
  validateJobId: string | null;

  /** worker_jobs.id (합성) */
  @Column({ name: 'compose_job_id', type: 'varchar', length: 36, nullable: true })
  composeJobId: string | null;

  /** files.id (최종 PDF) */
  @Column({ name: 'output_file_id', type: 'varchar', length: 36, nullable: true })
  outputFileId: string | null;

  /** 확정 페이지 수 */
  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount: number | null;

  /** 실패 시 ERR_* (§3 카탈로그) */
  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode: string | null;

  /** 검증 errors/warnings 스냅샷 */
  @Column({ name: 'error_detail', type: 'json', nullable: true })
  errorDetail: Record<string, unknown> | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
