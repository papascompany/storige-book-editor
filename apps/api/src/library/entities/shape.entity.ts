import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  BeforeInsert,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LibraryCategory } from './category.entity';

@Entity('library_shapes')
export class LibraryShape {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'file_url', type: 'varchar', length: 500 })
  fileUrl: string;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  @Column({ name: 'category_id', type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @Column({ type: 'json', nullable: true })
  tags: string[] | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => LibraryCategory, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  categoryEntity: LibraryCategory | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
