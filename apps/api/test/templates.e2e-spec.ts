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
import { User } from '../src/auth/entities/user.entity';
import { UserSiteRole } from '../src/auth/entities/user-site-role.entity';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { SitesServiceStubModule } from './support/sites-service.stub';
import { asGlobalAdmin, seedGlobalAdminRow } from './support/e2e-principal';
import { TemplateType, TemplateSetType, CanvasData } from '@storige/types';

// Mock RolesGuard to always allow access
const mockRolesGuard: CanActivate = { canActivate: () => true };

describe('TemplatesController (e2e)', () => {
  let app: INestApplication;
  let templateRepository: Repository<Template>;
  let categoryRepository: Repository<Category>;

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
          entities: [Template, Category, TemplateSet, TemplateSetItem, User, UserSiteRole],
          synchronize: true,
          dropSchema: true,
        }),
        // 운영의 @Global SitesModule 자리 — TemplatesModule 의 ApiKeyGuard 가 SitesService 를 주입받는다.
        SitesServiceStubModule,
        TemplatesModule,
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
    templateRepository = moduleFixture.get<Repository<Template>>(getRepositoryToken(Template));
    categoryRepository = moduleFixture.get<Repository<Category>>(getRepositoryToken(Category));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // 각 테스트 전에 데이터 정리
    await templateRepository.clear();
  });

  describe('/templates (POST)', () => {
    it('should create a new template', async () => {
      const createDto = {
        name: 'Test Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
      };

      const response = await request(app.getHttpServer())
        .post('/templates')
        .send(createDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(createDto.name);
      expect(response.body.type).toBe(createDto.type);
      expect(response.body.width).toBe(createDto.width);
      expect(response.body.height).toBe(createDto.height);
      expect(response.body).toHaveProperty('templateCode');
      expect(response.body).toHaveProperty('editCode');
    });

    it('should fail with invalid data', async () => {
      const invalidDto = {
        name: '', // 빈 이름
        type: 'invalid', // 잘못된 타입
      };

      await request(app.getHttpServer())
        .post('/templates')
        .send(invalidDto)
        .expect(400);
    });
  });

  describe('/templates (GET)', () => {
    it('should return all templates', async () => {
      // 테스트 데이터 생성
      await templateRepository.save({
        id: 'test-id-1',
        name: 'Template 1',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      await templateRepository.save({
        id: 'test-id-2',
        name: 'Template 2',
        type: TemplateType.COVER,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get('/templates')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by isActive', async () => {
      await templateRepository.save({
        id: 'test-active-1',
        name: 'Active Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      await templateRepository.save({
        id: 'test-inactive-1',
        name: 'Inactive Template',
        type: TemplateType.COVER,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: false,
      });

      const response = await request(app.getHttpServer())
        .get('/templates')
        .query({ isActive: true })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((template: any) => {
        expect(template.isActive).toBe(true);
      });
    });
  });

  describe('/templates/:id (GET)', () => {
    it('should return a template by id', async () => {
      const template = await templateRepository.save({
        id: 'test-find-id',
        name: 'Find Me Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .get(`/templates/${template.id}`)
        .expect(200);

      expect(response.body.id).toBe(template.id);
      expect(response.body.name).toBe(template.name);
    });

    it('should return 404 for non-existent template', async () => {
      await request(app.getHttpServer())
        .get('/templates/non-existent-id')
        .expect(404);
    });
  });

  describe('/templates/:id (PATCH)', () => {
    it('should update a template', async () => {
      const template = await templateRepository.save({
        id: 'test-update-id',
        name: 'Original Name',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const updateDto = {
        name: 'Updated Name',
      };

      const response = await request(app.getHttpServer())
        .patch(`/templates/${template.id}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe(updateDto.name);
    });
  });

  describe('/templates/:id (DELETE)', () => {
    it('should soft delete a template', async () => {
      const template = await templateRepository.save({
        id: 'test-delete-id',
        name: 'Delete Me',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      await request(app.getHttpServer())
        .delete(`/templates/${template.id}`)
        .expect(200);

      const deleted = await templateRepository.findOne({
        where: { id: template.id },
      });
      expect(deleted?.isDeleted).toBe(true);
    });
  });

  describe('/templates/:id/copy (POST)', () => {
    it('should create a copy of a template', async () => {
      const template = await templateRepository.save({
        id: 'test-copy-id',
        name: 'Original Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: mockCanvasData,
        isDeleted: false,
        isActive: true,
      });

      const response = await request(app.getHttpServer())
        .post(`/templates/${template.id}/copy`)
        .expect(201);

      expect(response.body.id).not.toBe(template.id);
      expect(response.body.name).toContain('Original Template');
    });
  });
});
