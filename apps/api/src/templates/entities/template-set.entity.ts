import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Category } from './category.entity';
import { Template } from './template.entity';
import type { ProductSpecs, TemplateSetType, TemplateRef, EditorMode, EditorMenuKey } from '@storige/types';

/**
 * 템플릿셋 타입 enum (DB용)
 */
export enum TemplateSetTypeEnum {
  BOOK = 'book',
  LEAFLET = 'leaflet',
}

@Entity('template_sets')
@Index('idx_template_set_type', ['type'])
@Index('idx_template_set_deleted', ['isDeleted'])
export class TemplateSet {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  /**
   * 템플릿셋 타입: book(책자), leaflet(리플렛)
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: TemplateSetTypeEnum.BOOK,
  })
  type: TemplateSetType;

  /**
   * 판형 - 가로 (mm)
   */
  @Column({ type: 'float', default: 210 })
  width: number;

  /**
   * 판형 - 세로 (mm)
   */
  @Column({ type: 'float', default: 297 })
  height: number;

  /**
   * 내지 추가 가능 여부
   */
  @Column({ name: 'can_add_page', type: 'boolean', default: true })
  canAddPage: boolean;

  /**
   * 내지 수량 범위 (예: [10, 20, 30, 40])
   */
  @Column({ name: 'page_count_range', type: 'json', default: '[]' })
  pageCountRange: number[];

  /**
   * 템플릿 구성 (순서 포함)
   * TemplateRef[] 형태로 저장
   */
  @Column({ type: 'json', default: '[]' })
  templates: TemplateRef[];

  /**
   * 에디터 모드: single(개별 캔버스 편집) | book(스프레드 편집)
   */
  @Column({ name: 'editor_mode', type: 'varchar', length: 20, default: 'single' })
  editorMode: EditorMode;

  /**
   * 에디터 좌측 도구 메뉴 노출 화이트리스트.
   * - null: 모든 메뉴 노출 (legacy/기본값)
   * - 배열: 배열에 포함된 키만 노출 (예: ['UPLOAD','TEXT','IMAGE'])
   * - 빈 배열 []: 모든 도구 메뉴 숨김
   *
   * 키 정의는 `@storige/types` 의 `EditorMenuKey` / `EDITOR_MENU_DEFS` 참조.
   * Admin 의 템플릿셋 편집 화면에서 토글로 설정.
   */
  @Column({ name: 'enabled_menus', type: 'json', nullable: true })
  enabledMenus: EditorMenuKey[] | null;

  // ─────────────────────────────────────────────────────
  // 인쇄 워크플로우 v1 Phase 2 (2026-05-19)
  // 면지 / 표지 편집 / 레더 커버 미리보기 필드.
  // 마이그레이션: apps/api/migrations/20260519_v1_phase2_workflow_schema.sql
  // ─────────────────────────────────────────────────────

  /**
   * 면지(EndPaper) 구성 — Phase 2.
   * shape: { frontCount, backCount, frontEditable, backEditable }.
   * null: 면지 없음 (legacy/기본).
   */
  @Column({ name: 'endpaper_config', type: 'json', nullable: true })
  endpaperConfig: {
    frontCount: number;
    backCount: number;
    frontEditable: boolean;
    backEditable: boolean;
  } | null;

  /**
   * 표지 편집 가능 여부 — Phase 2.
   * 기본 true (일반 책 표지). 레더 커버 / 화보집은 false.
   */
  @Column({ name: 'cover_editable', type: 'boolean', default: true })
  coverEditable: boolean;

  /**
   * 레더 커버 / 화보집용 표지 미리보기 이미지 storage URL — Phase 2.
   * 결정 3-5: 별도 필드. `coverEditable=false` 일 때만 의미 있음.
   */
  @Column({ name: 'cover_preview_image', type: 'varchar', length: 500, nullable: true })
  coverPreviewImage: string | null;

  /**
   * 소프트 삭제 플래그
   */
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  // Legacy fields (하위 호환)
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'category_id', type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @Column({ name: 'product_specs', type: 'json', nullable: true })
  productSpecs: ProductSpecs | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @OneToMany(() => TemplateSetItem, (item) => item.templateSet)
  items: TemplateSetItem[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}

@Entity('template_set_items')
export class TemplateSetItem {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ name: 'template_set_id', type: 'varchar', length: 36 })
  templateSetId: string;

  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * 필수 페이지 여부
   */
  @Column({ type: 'boolean', default: false })
  required: boolean;

  // Relations
  @ManyToOne(() => TemplateSet, (set) => set.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_set_id' })
  templateSet: TemplateSet;

  @ManyToOne(() => Template, { nullable: true })
  @JoinColumn({ name: 'template_id' })
  template: Template;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
