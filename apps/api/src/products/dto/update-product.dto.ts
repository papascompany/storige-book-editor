import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto implements Partial<CreateProductDto> {
  title?: string;
  productId?: string;
  description?: string;
  template?: CreateProductDto['template'];
  wowPressProduct?: CreateProductDto['wowPressProduct'];
  editorTemplates?: CreateProductDto['editorTemplates'];
  isActive?: boolean;
  allowCustomSize?: boolean;
}
