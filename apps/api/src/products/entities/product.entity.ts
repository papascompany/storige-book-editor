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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
