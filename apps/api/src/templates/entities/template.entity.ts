import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  Index,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Category } from './category.entity';
import { User } from '../../auth/entities/user.entity';
import type { CanvasData, TemplateType, SpreadConfig } from '@storige/types';

/**
 * 템플릿 타입 enum (DB용).
 *
 * 인쇄 워크플로우 v1 Phase 2 (2026-05-19): ENDPAPER 추가.
 * 마이그레이션: apps/api/migrations/20260519_v1_phase2_workflow_schema.sql
 */
export enum TemplateTypeEnum {
  WING = 'wing',
  COVER = 'cover',
  SPINE = 'spine',
  PAGE = 'page',
  SPREAD = 'spread',
  /** 면지 — 표지 안쪽/뒤표지 안쪽 빈 면 (편집가능/불가 토글) */
  ENDPAPER = 'endpaper',
}

@Entity('templates')
@Index('idx_template_type', ['type'])
@Index('idx_template_deleted', ['isDeleted'])
export class Template {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  /**
   * 템플릿 타입: wing(날개), cover(표지), spine(책등), page(내지)
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: TemplateTypeEnum.PAGE,
  })
  type: TemplateType;

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
   * 편집 가능 여부
   */
  @Column({ type: 'boolean', default: true })
  editable: boolean;

  /**
   * 삭제 가능 여부 (에디터에서 페이지 삭제)
   */
  @Column({ type: 'boolean', default: true })
  deleteable: boolean;

  @Column({ name: 'canvas_data', type: 'json' })
  canvasData: CanvasData;

  /**
   * 스프레드 설정 (type='spread'일 때만 사용)
   */
  @Column({ name: 'spread_config', type: 'json', nullable: true })
  spreadConfig: SpreadConfig | null;

  /**
   * 소프트 삭제 플래그
   */
  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  // Legacy fields (하위 호환)
  @Column({ name: 'category_id', type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @Column({ name: 'edit_code', type: 'varchar', length: 50, unique: true, nullable: true })
  editCode: string | null;

  @Column({ name: 'template_code', type: 'varchar', length: 50, unique: true, nullable: true })
  templateCode: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'varchar', nullable: true, length: 36 })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
