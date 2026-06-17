import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  RelationId,
} from 'typeorm';
import { ProductSize } from './product-size.entity';
import { TemplateSet } from '../../templates/entities/template-set.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  title: string;

  // ─── Bookmoa-style 메타 (2026-05-03 추가) ─────────────────────────
  // Admin UI에서 사용하는 사용자 노출용 필드. title과 별도로 관리되며,
  // 누락 시 title을 fallback으로 사용. bookmoa 외부 쇼핑몰 매핑용.
  // TypeORM은 `string | null` union type을 인식 못하므로 explicit type 필수.

  /** 상품 코드 (Bookmoa 측 식별자, 예: BOOK-A4-20P) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  code: string;

  /** 카테고리 ID (Bookmoa 카테고리 트리) */
  @Column({ name: 'category_id', type: 'varchar', length: 36, nullable: true })
  categoryId: string;

  /** 가격 (원) */
  @Column({ type: 'int', nullable: true })
  price: number;
  // ──────────────────────────────────────────────────────────────────

  @Column({ length: 255, nullable: true })
  productId: string; // External product ID (e.g., WowPress)

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'json', nullable: true })
  template: {
    editorPreset?: {
      settings: {
        dpi?: number;
        guideline?: { cutLine?: boolean; safeLine?: boolean };
        page?: { count?: number; min?: number; max?: number; interval?: number };
        size?: { width?: number; height?: number; cutSize?: number; safeSize?: number };
        unit?: string;
        exportOption?: { colorMode?: 'RGB' | 'CMYK' };
        menu?: unknown[];
      };
      defaultTemplate?: { id: string } | null;
      editorTemplates?: Array<{
        id: string;
        name: string;
        sizeNo?: number;
        image?: { image?: { url?: string } };
        design?: { document?: { url?: string } };
        cutLineTemplate?: { image?: { url?: string } };
        tags?: Array<{ id?: string; name?: string }>;
      }> | null;
    } | null;
  };

  @Column({ type: 'json', nullable: true })
  editorTemplates: Array<{
    id: string;
    name: string;
    sizeNo?: number;
    image?: { image?: { url?: string } };
    design?: { document?: { url?: string } };
    cutLineTemplate?: { image?: { url?: string } };
    tags?: Array<{ id?: string; name?: string }>;
  }>;

  @Column({ default: true })
  isActive: boolean;

  /**
   * 북모아 등 외부 쇼핑몰에서 에디터 진입 시 `width`, `height` URL 파라미터로
   * 인쇄물 사이즈를 동적으로 override 할 수 있도록 허용. (옵션 C)
   * - false (기본): templateSetId / sizeno 로만 사이즈 결정
   * - true: ?width=148&height=210 (mm) 으로 워크스페이스 사이즈를 직접 지정 가능
   *
   * Storige 가 모든 사이즈 디자인을 사전 등록하지 않고도 쇼핑몰의 동적 사이즈
   * 옵션 (예: 정사각형 자유 입력) 을 받을 수 있게 함.
   */
  @Column({ default: false })
  allowCustomSize: boolean;

  @ManyToOne(() => TemplateSet, { nullable: true })
  @JoinColumn({ name: 'template_set_id' })
  templateSet: TemplateSet;

  @RelationId((product: Product) => product.templateSet)
  templateSetId: string | null;

  @OneToMany(() => ProductSize, (size) => size.product)
  sizes: ProductSize[];

  // P2 멀티테넌시 (2026-06-17) — 소속 site. NULL = 시스템공유(hybrid). additive nullable(비파괴).
  // 조회 스코핑은 QueryScope(P2b)에서 적용. 인덱스는 마이그레이션 SQL에서 생성.
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
