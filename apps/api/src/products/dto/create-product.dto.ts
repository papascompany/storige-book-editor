import { IsString, IsOptional, IsBoolean, IsObject, IsArray } from 'class-validator';

export class CreateProductDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  template?: {
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
      }> | null;
    } | null;
  };

  @IsOptional()
  @IsObject()
  wowPressProduct?: {
    prodname?: string;
    dlvygrpname?: string;
    sizeinfo?: Array<{ sizelist: Array<{
      sizeno?: number;
      width?: number;
      height?: number;
      non_standard?: boolean;
    }> }>;
    colorinfo?: Array<{ pagelist: unknown[] }>;
  };

  @IsOptional()
  @IsArray()
  editorTemplates?: Array<{
    id: string;
    name: string;
    sizeNo?: number;
    image?: { image?: { url?: string } };
    design?: { document?: { url?: string } };
  }>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * 옵션 C — 외부 쇼핑몰이 width/height URL 파라미터로 사이즈 override 허용 여부.
   */
  @IsOptional()
  @IsBoolean()
  allowCustomSize?: boolean;
}
