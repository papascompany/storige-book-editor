import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';

import { TemplatesModule } from '../src/templates/templates.module';
import { Template } from '../src/templates/entities/template.entity';
import { Category } from '../src/templates/entities/category.entity';
import { TemplateSet, TemplateSetItem } from '../src/templates/entities/template-set.entity';
import { TemplateSetLibraryCategory } from '../src/templates/entities/template-set-library-category.entity';
// 삭제 경로가 raw SQL 로 edit_sessions(레거시 editor 엔티티 테이블)의 활성 세션 수를 센다.
import { EditSession } from '../src/editor/entities/edit-session.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductSize } from '../src/products/entities/product-size.entity';
import { User } from '../src/auth/entities/user.entity';
import { UserSiteRole } from '../src/auth/entities/user-site-role.entity';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { SitesServiceStubModule } from './support/sites-service.stub';
import { asGlobalAdmin, seedGlobalAdminRow } from './support/e2e-principal';
import { ProductsModule } from '../src/products/products.module';
import { TemplateType, TemplateSetType, CanvasData } from '@storige/types';

// Mock RolesGuard to always allow access
const mockRolesGuard: CanActivate = { canActivate: () => true };

describe('TemplateSetsController (e2e)', () => {
  let app: INestApplication;
  let templateSetRepository: Repository<TemplateSet>;
  let templateRepository: Repository<Template>;
  let productRepository: Repository<Product>;

  const mockCanvasData: CanvasData = {
    version: '5.3.0',
    width: 210,
    height: 297,
    objects: [],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          driver: require('better-sqlite3'),
          database: ':memory:',
          // User.siteRoleAssignments 관계 대상까지 등록해야 메타데이터가 완성된다.
          entities: [
            Template, Category, TemplateSet, TemplateSetItem, TemplateSetLibraryCategory,
            Product, ProductSize, User, UserSiteRole, EditSession,
          ],
          synchronize: true,
          dropSchema: true,
        }),
        // 운영의 @Global SitesModule 자리 — TemplatesModule 의 ApiKeyGuard 가 SitesService 를 주입받는다.
        SitesServiceStubModule,
        TemplatesModule,
        ProductsModule,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    // 쓰기 라우트는 RolesGuard 뒤에 TenantGuard 가 req.user 를 요구한다 — 전역 관리자 주체를 둔다.
    app.use(asGlobalAdmin);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    await seedGlobalAdminRow(moduleFixture.get(DataSource));
    templateSetRepository = moduleFixture.get<Repository<TemplateSet>>(getRepositoryToken(TemplateSet));
    templateRepository = moduleFixture.get<Repository<Template>>(getRepositoryToken(Template));
    productRepository = moduleFixture.get<Repository<Product>>(getRepositoryToken(Product));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await templateSetRepository.clear();
    await templateRepository.clear();
  });

  describe('/template-sets (POST)', () => {
    it('should create a new template set', async () => {
      const createDto = {
        name: 'Test Template Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        canAddPage: true,
        pageCountRange: [10, 20, 30],
      };

      const response = await request(app.getHttpServer())
        .post('/template-sets')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(createDto.name);
      expect(response.body.type).toBe(createDto.type);
      expect(response.body.width).toBe(createDto.width);
      expect(response.body.height).toBe(createDto.height);
      expect(response.body.canAddPage).toBe(createDto.canAddPage);
    });

    it('should create template set with templates', async () => {
      // 먼저 템플릿 생성
      const template = await templateRepository.save({
        id: 'template-for-set',
        name: 'Page Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const createDto = {
        name: 'Template Set with Templates',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [
          { templateId: template.id, required: true },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/template-sets')
        .send(createDto)
        .expect(201);

      expect(response.body.templates).toHaveLength(1);
      expect(response.body.templates[0].templateId).toBe(template.id);
    });
  });

  describe('/template-sets (GET)', () => {
    it('should return paginated template sets', async () => {
      await templateSetRepository.save({
        id: 'test-set-1',
        name: 'Template Set 1',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      await templateSetRepository.save({
        id: 'test-set-2',
        name: 'Template Set 2',
        type: TemplateSetType.LEAFLET,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get('/template-sets')
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pageSize');
      expect(response.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by type', async () => {
      await templateSetRepository.save({
        id: 'book-set',
        name: 'Book Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      await templateSetRepository.save({
        id: 'leaflet-set',
        name: 'Leaflet Set',
        type: TemplateSetType.LEAFLET,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get('/template-sets')
        .query({ type: TemplateSetType.BOOK })
        .expect(200);

      response.body.items.forEach((set: any) => {
        expect(set.type).toBe(TemplateSetType.BOOK);
      });
    });

    it('should filter by dimensions', async () => {
      await templateSetRepository.save({
        id: 'a4-set',
        name: 'A4 Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      await templateSetRepository.save({
        id: 'a5-set',
        name: 'A5 Set',
        type: TemplateSetType.BOOK,
        width: 148,
        height: 210,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get('/template-sets')
        .query({ width: 210, height: 297 })
        .expect(200);

      response.body.items.forEach((set: any) => {
        expect(set.width).toBe(210);
        expect(set.height).toBe(297);
      });
    });
  });

  describe('/template-sets/:id (GET)', () => {
    it('should return a template set by id', async () => {
      const templateSet = await templateSetRepository.save({
        id: 'find-me-set',
        name: 'Find Me Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get(`/template-sets/${templateSet.id}`)
        .expect(200);

      expect(response.body.id).toBe(templateSet.id);
      expect(response.body.name).toBe(templateSet.name);
    });

    it('should return 404 for non-existent template set', async () => {
      await request(app.getHttpServer())
        .get('/template-sets/non-existent-id')
        .expect(404);
    });
  });

  describe('/template-sets/:id (PUT)', () => {
    it('should update a template set', async () => {
      const templateSet = await templateSetRepository.save({
        id: 'update-me-set',
        name: 'Original Name',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const updateDto = {
        name: 'Updated Name',
        canAddPage: false,
      };

      const response = await request(app.getHttpServer())
        .put(`/template-sets/${templateSet.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe(updateDto.name);
      expect(response.body.canAddPage).toBe(updateDto.canAddPage);
    });
  });

  describe('/template-sets/:id (DELETE)', () => {
    it('should soft delete a template set', async () => {
      const templateSet = await templateSetRepository.save({
        id: 'delete-me-set',
        name: 'Delete Me',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      await request(app.getHttpServer())
        .delete(`/template-sets/${templateSet.id}`)
        .expect(200);

      const deleted = await templateSetRepository.findOne({
        where: { id: templateSet.id },
      });
      expect(deleted?.isDeleted).toBe(true);
    });
  });

  describe('/template-sets/:id/copy (POST)', () => {
    it('should create a copy of a template set', async () => {
      const templateSet = await templateSetRepository.save({
        id: 'copy-me-set',
        name: 'Original Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .post(`/template-sets/${templateSet.id}/copy`)
        .expect(201);

      expect(response.body.id).not.toBe(templateSet.id);
      expect(response.body.name).toContain('Original Set');
    });
  });

  describe('/template-sets/:id/templates (POST)', () => {
    it('should add a template to template set', async () => {
      const template = await templateRepository.save({
        id: 'add-template',
        name: 'Page Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const templateSet = await templateSetRepository.save({
        id: 'add-to-set',
        name: 'Add To Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .post(`/template-sets/${templateSet.id}/templates`)
        .send({ templateId: template.id, required: true })
        .expect(201);

      expect(response.body.templates).toHaveLength(1);
      expect(response.body.templates[0].templateId).toBe(template.id);
    });
  });

  describe('/template-sets/:id/templates/:templateId (DELETE)', () => {
    it('should remove a template from template set', async () => {
      const template = await templateRepository.save({
        id: 'remove-template',
        name: 'Page Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const templateSet = await templateSetRepository.save({
        id: 'remove-from-set',
        name: 'Remove From Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [{ templateId: template.id, required: true }],
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .delete(`/template-sets/${templateSet.id}/templates/${template.id}`)
        .expect(200);

      expect(response.body.templates).toHaveLength(0);
    });
  });
});
