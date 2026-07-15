import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  BOOK_ASSET_TYPES,
  type BookAssetType,
  type BookAssetStatus,
} from '../books.constants';

/**
 * 도서 자산 엔티티 (표지/내지/사진/바인딩) — Partner API v1 Stage 3.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.5
 * 마이그레이션: apps/api/migrations/20260716_add_books_core.sql
 *
 * - POST=신규(active 단수 유형은 기존재 시 409 ERR_ASSET_ALREADY_EXISTS)
 *   / PUT=교체(기존 row status='replaced' 전환 + 신규 'active' — 이력 보존).
 * - 파일 실체(file_id)는 기존 files 계층 재사용 — 삭제·보존도 기존 retention 승계.
 *   files 는 조회+참조만(AD-1). template_set_id/binding_params 는 바인딩형(W4).
 * - photo 다건은 sort_order 로 순서 유지.
 */
@Entity('book_assets')
@Index('idx_book_assets_book', ['bookId', 'assetType', 'status'])
export class BookAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** books.id */
  @Column({ name: 'book_id', type: 'varchar', length: 36 })
  bookId: string;

  @Column({
    name: 'asset_type',
    type: 'enum',
    enum: BOOK_ASSET_TYPES as unknown as string[],
  })
  assetType: BookAssetType;

  /** files.id 참조(업로드형) */
  @Column({ name: 'file_id', type: 'varchar', length: 36, nullable: true })
  fileId: string | null;

  /** 바인딩형 templateSet 참조(W4) */
  @Column({ name: 'template_set_id', type: 'varchar', length: 36, nullable: true })
  templateSetId: string | null;

  /** 템플릿 파라미터(Stage 5 schema 정합) */
  @Column({ name: 'binding_params', type: 'json', nullable: true })
  bindingParams: Record<string, unknown> | null;

  /** photo 다건 순서 */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'enum', enum: ['active', 'replaced'], default: 'active' })
  status: BookAssetStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
