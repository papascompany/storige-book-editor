import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export type LibraryCategoryType = 'background' | 'shape' | 'frame' | 'clipart' | 'font';

@Entity('library_categories')
export class LibraryCategory {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  type: LibraryCategoryType;

  @Column({ name: 'parent_id', type: 'varchar', length: 36, nullable: true })
  parentId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => LibraryCategory, (category) => category.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: LibraryCategory | null;

  @OneToMany(() => LibraryCategory, (category) => category.parent)
  children: LibraryCategory[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
