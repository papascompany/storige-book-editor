import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum FileType {
  COVER = 'cover',
  CONTENT = 'content',
  TEMPLATE = 'template',
  OTHER = 'other',
}

/**
 * 파일 메타데이터 엔티티
 * bookmoa와 storige에서 공유하는 파일 정보를 저장합니다.
 */
@Entity('files')
export class FileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_name', length: 255 })
  fileName: string;

  @Column({ name: 'original_name', length: 255 })
  originalName: string;

  @Column({ name: 'file_path', length: 500 })
  filePath: string;

  @Column({ name: 'file_url', length: 500 })
  fileUrl: string;

  /**
   * 저장 백엔드 (2026-06-13, R2 보강). 'local'=VPS 파일시스템, 's3'=객체스토리지(R2).
   * 읽기/삭제 시 이 값으로 라우팅 → 기존 local 파일과 신규 s3 파일 공존 보장.
   * 기본 'local' (기존 레코드는 마이그레이션에서 'local' 채움).
   */
  @Column({ name: 'storage_backend', type: 'varchar', length: 16, default: 'local' })
  storageBackend: 'local' | 's3';

  /** 백엔드 내 객체 key (local=STORAGE_PATH 상대경로, s3=버킷 object key). nullable=레거시 레코드. */
  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: true })
  storageKey: string | null;

  /**
   * 업로드 라이프사이클 상태 (2026-06-19 presigned 직결).
   * 'ready'  = 사용 가능(기존 multipart 업로드·워커출력 전부 ready). 기본값 → 기존행 무해.
   * 'pending'= presigned 직결 발급됨·아직 R2 PUT 미완(complete 전). 검증/다운로드 금지.
   * 'failed' = 클라 abort 또는 complete 검증 실패. retention/cleanup 대상.
   */
  @Index('idx_files_status')
  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ready' })
  status: 'pending' | 'ready' | 'failed';

  /** 멀티파트 업로드 ID (R2 CreateMultipartUpload 반환). single-part 또는 완료 후 NULL.
   *  ⚠️ R2 UploadId 는 길다(실측 ~343자) — varchar(255) 부족 → 1024. */
  @Column({ name: 'multipart_upload_id', type: 'varchar', length: 1024, nullable: true })
  multipartUploadId: string | null;

  /** 클라가 선언한 예상 바이트 수 (complete 시 HeadObject ContentLength 와 대조). NULL=레거시. */
  @Column({ name: 'expected_size', type: 'bigint', nullable: true })
  expectedSize: number | null;

  /**
   * 업로드 세션 소유 토큰 (2026-06-19). presign 발급 시 서버가 고엔트로피로 생성해 클라에 1회 반환.
   * complete/sign/abort 호출 시 이 토큰을 대조 → fileId(UUID)만 아는 제3자가 진행중(pending)
   * 업로드를 가로채/abort 하거나 멀티파트에 임의 파트를 주입하는 IDOR 차단. ready/failed 확정 시 NULL.
   */
  @Column({ name: 'upload_token', type: 'varchar', length: 64, nullable: true })
  uploadToken: string | null;

  /**
   * 보존 만료 시각 (2026-06-13). null=영구보관(기본, bookmoa 등 보호).
   * 테넌트가 주문 이행 후 설정 → FileRetentionService cron 이 만료분 하드삭제.
   */
  @Index('idx_files_expires_at')
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  @Column({ name: 'file_size', type: 'bigint' })
  fileSize: number;

  @Column({ name: 'mime_type', length: 100 })
  mimeType: string;

  @Column({
    name: 'file_type',
    type: 'enum',
    enum: FileType,
  })
  fileType: FileType;

  @Index('idx_files_order_seqno')
  @Column({ name: 'order_seqno', type: 'bigint', nullable: true })
  orderSeqno: number | null;

  @Index('idx_files_member_seqno')
  @Column({ name: 'member_seqno', type: 'bigint', nullable: true })
  memberSeqno: number | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
