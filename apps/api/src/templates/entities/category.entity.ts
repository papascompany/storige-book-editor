import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('categories')
export class Category {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ name: 'parent_id', type: 'varchar', nullable: true, length: 36 })
  parentId: string | null;

  @Column({ type: 'tinyint' })
  level: 1 | 2 | 3;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Category, (category) => category.children, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent: Category;

  @OneToMany(() => Category, (category) => category.parent)
  children: Category[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
