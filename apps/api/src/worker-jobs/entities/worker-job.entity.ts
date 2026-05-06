import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  BeforeInsert,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { WorkerJobType, WorkerJobStatus } from '@storige/types';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';

@Entity('worker_jobs')
@Index('idx_worker_jobs_idempotency', ['sessionId', 'pdfFileId', 'requestId'], { unique: true, where: 'session_id IS NOT NULL AND pdf_file_id IS NOT NULL AND request_id IS NOT NULL' })
export class WorkerJob {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({
    name: 'job_type',
    type: 'varchar',
    length: 30,
  })
  jobType: WorkerJobType;

  @Column({
    type: 'varchar',
    length: 20,
  })
  status: WorkerJobStatus;

  @ManyToOne(() => EditSessionEntity, { nullable: true })
  @JoinColumn({ name: 'edit_session_id' })
  editSession: EditSessionEntity | null;

  @Column({ name: 'edit_session_id', type: 'varchar', nullable: true, insert: false, update: false })
  editSessionId: string | null;

  @Column({ name: 'file_id', type: 'varchar', length: 36, nullable: true })
  fileId: string | null;

  @Column({ name: 'input_file_url', type: 'varchar', length: 500, nullable: true })
  inputFileUrl: string | null;

  @Column({ name: 'output_file_url', type: 'varchar', length: 500, nullable: true })
  outputFileUrl: string | null;

  @Column({ name: 'output_file_id', type: 'varchar', length: 36, nullable: true })
  outputFileId: string | null;

  @Column({ type: 'json', nullable: true })
  options: any;

  @Column({ type: 'json', nullable: true })
  result: any;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * Split-synthesize 전용 필드
   */

  // 분리 합성용 세션 ID (editSessionId와 별개로 명시적 관리)
  @Column({ name: 'session_id', type: 'varchar', length: 36, nullable: true })
  sessionId: string | null;

  // 분리 합성용 PDF 파일 ID
  @Column({ name: 'pdf_file_id', type: 'varchar', length: 36, nullable: true })
  pdfFileId: string | null;

  // 멱등성 키 (클라이언트 UUID)
  @Column({ name: 'request_id', type: 'varchar', length: 36, nullable: true })
  requestId: string | null;

  // 세분화된 에러 코드 (예: 'PAGE_COUNT_MISMATCH')
  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true })
  errorCode: string | null;

  // 에러 상세 정보 (JSON)
  @Column({ name: 'error_detail', type: 'json', nullable: true })
  errorDetail: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  /**
   * Phase C — 잡 발사 사이트 식별 (X-API-Key 사용 시 자동 주입).
   * 기존 데이터는 NULL — 마이그레이션 후 운영팀이 일괄 backfill 가능.
   */
  @Index('idx_worker_jobs_site_id')
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
    if (!this.status) {
      this.status = WorkerJobStatus.PENDING;
    }
  }
}
