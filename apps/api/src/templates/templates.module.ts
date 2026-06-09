import { Module, DynamicModule, Provider } from '@nestjs/common';
import { TypeOrmModule, getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { TemplateSetsService } from './template-sets.service';
import { TemplateSetsController } from './template-sets.controller';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { ProductTemplateSetsService } from './product-template-sets.service';
import { ProductTemplateSetsController } from './product-template-sets.controller';
import { Template } from './entities/template.entity';
import { Category } from './entities/category.entity';
import { TemplateSet, TemplateSetItem } from './entities/template-set.entity';
import { TemplateSetLibraryCategory } from './entities/template-set-library-category.entity';
import { ProductTemplateSet } from './entities/product-template-set.entity';
import { Product } from '../products/entities/product.entity';

// Bookmoa 카테고리 조건부 import
const bookmoaImports: DynamicModule[] = [];
const bookmoaProviders: Provider[] = [];

if (process.env.BOOKMOA_DB_PASSWORD) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BookmoaCategoryEntity } = require('../bookmoa-entities/category.entity');
  bookmoaImports.push(TypeOrmModule.forFeature([BookmoaCategoryEntity], 'bookmoa'));

  // Repository provider for ProductTemplateSetsService
  bookmoaProviders.push({
    provide: 'BOOKMOA_CATEGORY_REPOSITORY',
    useFactory: (dataSource: DataSource) => dataSource.getRepository(BookmoaCategoryEntity),
    inject: [getDataSourceToken('bookmoa')],
  });
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Template,
      Category,
      TemplateSet,
      TemplateSetItem,
      TemplateSetLibraryCategory,
      ProductTemplateSet,
      Product,
    ]),
    // Bookmoa 카테고리 (상품명 조회용) - 조건부 로드
    ...bookmoaImports,
  ],
  controllers: [
    TemplatesController,
    TemplateSetsController,
    CategoriesController,
    ProductTemplateSetsController,
  ],
  providers: [
    TemplatesService,
    TemplateSetsService,
    CategoriesService,
    ProductTemplateSetsService,
    // Bookmoa category repository (조건부)
    ...bookmoaProviders,
  ],
  exports: [
    TemplatesService,
    TemplateSetsService,
    CategoriesService,
    ProductTemplateSetsService,
  ],
})
export class TemplatesModule {}
