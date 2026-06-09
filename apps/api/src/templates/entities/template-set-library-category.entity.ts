import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  Index,
  Unique,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TemplateSet } from './template-set.entity';

/**
 * 템플릿셋 ↔ 라이브러리 카테고리 연결 (④, 2026-06-09).
 * 상품/템플릿셋별로 노출할 에셋(배경/도형/클립아트/프레임/폰트)을 '카테고리 단위'로 큐레이션.
 * 규약: 특정 템플릿셋에 연결이 하나도 없으면 = 전역(모든 카테고리 노출). 연결이 있으면 그 카테고리만.
 * 에셋은 LibraryCategory.type 으로 종류가 구분되므로 카테고리 연결이 곧 종류별 스코프가 된다.
 */
@Entity('template_set_library_categories')
@Unique('uk_tslc', ['templateSetId', 'libraryCategoryId'])
export class TemplateSetLibraryCategory {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index('idx_tslc_set')
  @Column({ name: 'template_set_id', type: 'varchar', length: 36 })
  templateSetId: string;

  @Column({ name: 'library_category_id', type: 'varchar', length: 36 })
  libraryCategoryId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => TemplateSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_set_id' })
  templateSet: TemplateSet;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = uuidv4();
  }
}
