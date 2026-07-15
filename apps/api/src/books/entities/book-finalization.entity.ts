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
  type FinalizationPlan,
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
// [렌즈1 P2-2 / 렌즈2 P2-3] 동시 착수 원자화 — (book_id, attempt) 유니크로 무키·상이
//   Idempotency-Key 동시 2 POST 의 패자 INSERT 를 DB 레벨에서 차단(dup-key → 409).
//   attempt 는 항상 max+1 로 증분(§6.3 멱등)이라 정상 경로는 자연 만족, 경쟁 삽입만 충돌한다.
@Index('uq_book_finalizations_book_attempt', ['bookId', 'attempt'], { unique: true })
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

  /**
   * [P1-2] 워커 validate 를 건너뛰고 최종화한 표식 — book_spec 미연결 or pageCount
   * 미확정이라 대조 판형이 없어 조건부 validate 를 skip 했을 때 true(§6.3 조건부 계약).
   * BookFinalizationView·웹훅 payload 에 노출해 파트너가 미검증 FINALIZED 를 인지한다.
   */
  @Column({ name: 'validation_skipped', type: 'boolean', default: false })
  validationSkipped: boolean;

  /**
   * [렌즈2 P2-3] 착수 시점 자산 스냅샷(TOCTOU 방지) — validate/compose 가 재조회 없이
   * 이 스냅샷을 쓴다. 진행 중(VALIDATING/COMPOSING) 자산 교체와 무관하게 이번 attempt 는
   * 착수 시점 자산에 고정된다. 구 행(마이그레이션 이전)엔 null → 서비스가 resolvePlan 폴백.
   */
  @Column({ name: 'plan_snapshot', type: 'json', nullable: true })
  planSnapshot: FinalizationPlan | null;

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
