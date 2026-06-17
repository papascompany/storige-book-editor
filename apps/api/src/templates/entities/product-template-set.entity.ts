import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { TemplateSet } from './template-set.entity';

/**
 * 북모아 상품 - 스토리지 템플릿셋 연결 테이블
 * 하나의 상품(sortcode)에 여러 템플릿셋을 연결할 수 있음 (1:N)
 */
@Entity('product_template_sets')
@Index('idx_pts_sortcode', ['sortcode'])
@Index('idx_pts_sortcode_stan', ['sortcode', 'prdtStanSeqno'])
@Index('idx_pts_template_set', ['templateSetId'])
@Unique('uk_product_template', ['sortcode', 'prdtStanSeqno', 'templateSetId'])
export class ProductTemplateSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 북모아 카테고리(상품) 코드
   * 예: "001001001"
   */
  @Column({ type: 'varchar', length: 20 })
  sortcode: string;

  /**
   * 북모아 규격 번호 (선택)
   * NULL이면 해당 카테고리의 모든 규격에 적용
   */
  @Column({ name: 'prdt_stan_seqno', type: 'int', nullable: true })
  prdtStanSeqno: number | null;

  /**
   * 스토리지 템플릿셋 ID
   */
  @Column({ name: 'template_set_id', type: 'varchar', length: 36 })
  templateSetId: string;

  /**
   * 표시 순서 (낮을수록 먼저 표시)
   */
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  /**
   * 기본 템플릿 여부
   * 고객에게 먼저 추천되는 템플릿
   */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  /**
   * 활성화 상태
   */
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
  @ManyToOne(() => TemplateSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_set_id' })
  templateSet: TemplateSet;
}
