import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Entities
import { Template } from '../src/templates/entities/template.entity';
import { Category } from '../src/templates/entities/category.entity';
import { TemplateSet, TemplateSetItem } from '../src/templates/entities/template-set.entity';
import { EditSession, EditHistory } from '../src/editor/entities/edit-session.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductSize } from '../src/products/entities/product-size.entity';
import { User } from '../src/auth/entities/user.entity';

// Modules
import { TemplatesModule } from '../src/templates/templates.module';
import { EditorModule } from '../src/editor/editor.module';
import { ProductsModule } from '../src/products/products.module';
import { AuthModule } from '../src/auth/auth.module';

/**
 * 테스트용 모듈 생성
 */
export async function createTestingModule(modules: any[] = []): Promise<TestingModule> {
  const moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [() => ({
          JWT_SECRET: 'test-jwt-secret',
          JWT_EXPIRES_IN: '1h',
        })],
      }),
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        driver: require('better-sqlite3'),
        database: ':memory:',
        entities: [
          Template,
          Category,
          TemplateSet,
          TemplateSetItem,
          EditSession,
          EditHistory,
          Product,
          ProductSize,
          User,
        ],
        synchronize: true,
        dropSchema: true,
      }),
      ...modules,
    ],
  });

  return moduleBuilder.compile();
}

/**
 * 테스트 앱 생성
 */
export async function createTestApp(module: TestingModule): Promise<INestApplication> {
  const app = module.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return app;
}

/**
 * 테스트용 모듈 목록
 */
export const TestModules = {
  Templates: TemplatesModule,
  Editor: EditorModule,
  Products: ProductsModule,
  Auth: AuthModule,
};
