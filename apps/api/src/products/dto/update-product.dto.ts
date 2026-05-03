import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto implements Partial<CreateProductDto> {
  // Bookmoa-style 필드 (Admin UI 호환)
  name?: string;
  code?: string;
  categoryId?: string;
  price?: number;
  templateSetId?: string;

  // Storige-style 필드
  title?: string;
  productId?: string;
  description?: string;
  template?: CreateProductDto['template'];
  wowPressProduct?: CreateProductDto['wowPressProduct'];
  editorTemplates?: CreateProductDto['editorTemplates'];
  isActive?: boolean;
  allowCustomSize?: boolean;
}
