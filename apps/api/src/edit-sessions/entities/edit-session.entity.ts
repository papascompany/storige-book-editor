import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  RelationId,
  Index,
} from 'typeorm';
import { FileEntity } from '../../files/entities/file.entity';

export enum SessionStatus {
  DRAFT = 'draft',
  EDITING = 'editing',
  COMPLETE = 'complete',
}

export enum SessionMode {
  COVER = 'cover',
  CONTENT = 'content',
  BOTH = 'both',
  TEMPLATE = 'template',
  SPREAD = 'spread',
}

export enum WorkerStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  VALIDATED = 'validated',
  FAILED = 'failed',
}

@Entity('file_edit_sessions')
export class EditSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_seqno', type: 'bigint' })
  orderSeqno: number;

  @Column({ name: 'member_seqno', type: 'bigint' })
  memberSeqno: number;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.DRAFT,
  })
  status: SessionStatus;

  @Column({
    type: 'enum',
    enum: SessionMode,
  })
  mode: SessionMode;

  @ManyToOne(() => FileEntity, { nullable: true })
  @JoinColumn({ name: 'cover_file_id' })
  coverFile: FileEntity | null;

  @RelationId((session: EditSessionEntity) => session.coverFile)
  coverFileId: string | null;

  @ManyToOne(() => FileEntity, { nullable: true })
  @JoinColumn({ name: 'content_file_id' })
  contentFile: FileEntity | null;

  @RelationId((session: EditSessionEntity) => session.contentFile)
  contentFileId: string | null;

  @Column({ name: 'template_set_id', type: 'varchar', length: 36, nullable: true })
  templateSetId: string | null;

  @Column({ name: 'canvas_data', type: 'json', nullable: true })
  canvasData: any;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({
    name: 'worker_status',
    type: 'enum',
    enum: WorkerStatus,
    nullable: true,
  })
  workerStatus: WorkerStatus | null;

  @Column({ name: 'worker_error', type: 'text', nullable: true })
  workerError: string | null;

  /**
   * Phase C — 세션 발사 사이트 식별 (X-API-Key /auth/shop-session 시 자동 주입).
   * 기존 데이터는 NULL.
   */
  @Index('idx_edit_sessions_site_id')
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @Column({ name: 'callback_url', type: 'varchar', length: 500, nullable: true })
  callbackUrl: string | null;

  // ─────────────────────────────────────────────────────
  // 인쇄 워크플로우 v1 Phase 2 (2026-05-19)
  // 면지/PDF첨부/게스트 토큰/레더 커버를 위한 신규 컬럼.
  // 마이그레이션: apps/api/migrations/20260519_v1_phase2_workflow_schema.sql
  // 사용자 확정 결정 §4.4 (3-1~3-6 권장안).
  // ─────────────────────────────────────────────────────

  /**
   * 고객 첨부 내지 PDF file_id.
   * 결정 3-3: PDF 첨부와 일부 편집은 배타적 — 둘 다 동시 보유 금지.
   */
  @Column({ name: 'content_pdf_file_id', type: 'varchar', length: 36, nullable: true })
  contentPdfFileId: string | null;

  /** PDF 페이지수 — 자동 페이지 확장 계산용 */
  @Column({ name: 'content_pdf_page_count', type: 'int', nullable: true })
  contentPdfPageCount: number | null;

  /**
   * 워커 검증 결과 캐시 (issues, warnings, metadata).
   * 결정 3-4: 검증 실패 시 클라이언트가 첨부 자체 거부 UI 노출 — 이 필드 확인.
   */
  @Column({ name: 'content_pdf_validation_result', type: 'json', nullable: true })
  contentPdfValidationResult: Record<string, unknown> | null;

  /**
   * P0-2 (2026-06-02): 내지 PDF 첨부 모드.
   * - 'replace'(기본/레거시): PDF 만 인쇄, 캔버스 편집 배타(PDF_ATTACHED_EXCLUSIVE).
   * - 'underlay': PDF 각 페이지를 잠금 배경으로 깔고 그 위 편집 허용 → canvasData 저장 허용.
   * null 은 'replace' 로 간주(기존 세션 호환).
   */
  @Column({ name: 'content_pdf_mode', type: 'varchar', length: 16, nullable: true })
  contentPdfMode: 'replace' | 'underlay' | null;

  /**
   * 게스트 식별자 — 결정 3-1: 24h 자동 삭제. 결정 3-6: 저장 시점에 회원 전환 유도.
   * 회원 가입 시 user/member 컬럼으로 마이그레이션되고 guestToken/guestExpiresAt 클리어.
   */
  @Index('idx_edit_sessions_guest_token')
  @Column({ name: 'guest_token', type: 'varchar', length: 64, nullable: true })
  guestToken: string | null;

  /** 게스트 작업 자동 삭제 시점 (NOW + 24h). EVENT 'evt_purge_expired_guest_sessions' 가 시간 경과 시 DELETE */
  @Index('idx_edit_sessions_guest_expires_at')
  @Column({ name: 'guest_expires_at', type: 'timestamp', nullable: true })
  guestExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
