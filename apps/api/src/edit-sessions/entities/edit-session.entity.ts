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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
