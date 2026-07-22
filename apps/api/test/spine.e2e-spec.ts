import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Repository } from 'typeorm';

import { SpineController } from '../src/products/spine.controller';
import { SpineService } from '../src/products/spine.service';
import { PaperTypeEntity } from '../src/products/entities/paper-type.entity';
import { BindingTypeEntity } from '../src/products/entities/binding-type.entity';

describe('SpineController (e2e)', () => {
  let app: INestApplication;
  let paperTypeRepository: Repository<PaperTypeEntity>;
  let bindingTypeRepository: Repository<BindingTypeEntity>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [PaperTypeEntity, BindingTypeEntity],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([PaperTypeEntity, BindingTypeEntity]),
      ],
      controllers: [SpineController],
      providers: [SpineService],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    paperTypeRepository = moduleFixture.get<Repository<PaperTypeEntity>>(
      getRepositoryToken(PaperTypeEntity),
    );
    bindingTypeRepository = moduleFixture.get<Repository<BindingTypeEntity>>(
      getRepositoryToken(BindingTypeEntity),
    );

    // 테스트용 시드 데이터 생성
    await seedTestData();
  });

  async function seedTestData() {
    // 용지 타입 시드
    await paperTypeRepository.save([
      {
        code: 'mojo_70g',
        name: '모조지 70g',
        thickness: 0.09,
        category: 'body',
        isActive: true,
        sortOrder: 1,
      },
      {
        code: 'mojo_80g',
        name: '모조지 80g',
        thickness: 0.1,
        category: 'body',
        isActive: true,
        sortOrder: 2,
      },
      {
        code: 'art_200g',
        name: '아트지 200g',
        thickness: 0.18,
        category: 'cover',
        isActive: true,
        sortOrder: 10,
      },
      {
        code: 'inactive_paper',
        name: '비활성 용지',
        thickness: 0.1,
        category: 'body',
        isActive: false,
        sortOrder: 99,
      },
    ]);

    // 제본 타입 시드
    await bindingTypeRepository.save([
      {
        code: 'perfect',
        name: '무선제본',
        margin: 0.5,
        minPages: 32,
        isActive: true,
        sortOrder: 1,
      },
      {
        code: 'saddle',
        name: '중철제본',
        margin: 0.3,
        maxPages: 64,
        pageMultiple: 4,
        isActive: true,
        sortOrder: 2,
      },
      {
        code: 'spiral',
        name: '스프링제본',
        margin: 3.0,
        isActive: true,
        sortOrder: 3,
      },
      {
        code: 'hardcover',
        name: '양장제본',
        margin: 2.0,
        isActive: true,
        sortOrder: 4,
      },
    ]);
  }

  afterAll(async () => {
    await app.close();
  });

  describe('/products/spine/paper-types (GET)', () => {
    it('should return all active paper types', async () => {
      const response = await request(app.getHttpServer())
        .get('/products/spine/paper-types')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3); // 활성화된 용지만

      // 비활성 용지가 포함되지 않았는지 확인
      const codes = response.body.map((p: any) => p.code);
      expect(codes).not.toContain('inactive_paper');

      // 첫 번째 용지 구조 확인
      expect(response.body[0]).toHaveProperty('code');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('thickness');
      expect(response.body[0]).toHaveProperty('category');
    });

    it('should return paper types sorted by category and sortOrder', async () => {
      const response = await request(app.getHttpServer())
        .get('/products/spine/paper-types')
        .expect(200);

      // body 카테고리가 먼저 오고, 그 다음 cover
      const categories = response.body.map((p: any) => p.category);
      const bodyIndex = categories.indexOf('body');
      const coverIndex = categories.indexOf('cover');
      expect(bodyIndex).toBeLessThan(coverIndex);
    });
  });

  describe('/products/spine/binding-types (GET)', () => {
    it('should return all active binding types', async () => {
      const response = await request(app.getHttpServer())
        .get('/products/spine/binding-types')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(4);

      // 첫 번째 제본 방식 구조 확인
      expect(response.body[0]).toHaveProperty('code');
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('margin');
    });

    it('should include page constraints for binding types', async () => {
      const response = await request(app.getHttpServer())
        .get('/products/spine/binding-types')
        .expect(200);

      // 무선제본: minPages 있음
      const perfect = response.body.find((b: any) => b.code === 'perfect');
      expect(perfect.minPages).toBe(32);

      // 중철제본: maxPages, pageMultiple 있음
      const saddle = response.body.find((b: any) => b.code === 'saddle');
      expect(saddle.maxPages).toBe(64);
      expect(saddle.pageMultiple).toBe(4);
    });
  });

  describe('/products/spine/calculate (POST)', () => {
    it('should calculate spine width correctly', async () => {
      const dto = {
        pageCount: 100,
        paperType: 'mojo_80g',
        bindingType: 'perfect',
      };

      const response = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send(dto)
        .expect(201);

      // 계산: (100 / 2) * 0.1 + 0.5 = 5.5mm
      expect(response.body.spineWidth).toBe(5.5);
      expect(response.body.paperThickness).toBe(0.1);
      expect(response.body.bindingMargin).toBe(0.5);
      expect(response.body.formula).toContain('100');
      expect(response.body.warnings).toEqual([]);
    });

    it('should calculate with different paper and binding types', async () => {
      const dto = {
        pageCount: 100,
        paperType: 'art_200g',
        bindingType: 'hardcover',
      };

      const response = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send(dto)
        .expect(201);

      // 계산: (100 / 2) * 0.18 + 2.0 = 11mm
      expect(response.body.spineWidth).toBe(11);
      expect(response.body.paperThickness).toBe(0.18);
      expect(response.body.bindingMargin).toBe(2);
    });

    it('should use custom thickness when provided', async () => {
      const dto = {
        pageCount: 100,
        paperType: 'mojo_80g',
        bindingType: 'perfect',
        customPaperThickness: 0.15,
      };

      const response = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send(dto)
        .expect(201);

      // 계산: (100 / 2) * 0.15 + 0.5 = 8mm
      expect(response.body.spineWidth).toBe(8);
      expect(response.body.paperThickness).toBe(0.15);
    });

    it('should use custom margin when provided', async () => {
      const dto = {
        pageCount: 100,
        paperType: 'mojo_80g',
        bindingType: 'perfect',
        customBindingMargin: 1.0,
      };

      const response = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send(dto)
        .expect(201);

      // 계산: (100 / 2) * 0.1 + 1.0 = 6mm
      expect(response.body.spineWidth).toBe(6);
      expect(response.body.bindingMargin).toBe(1.0);
    });

    describe('warnings', () => {
      it('should warn when spine is too narrow (< 5mm)', async () => {
        const dto = {
          pageCount: 50,
          paperType: 'mojo_80g',
          bindingType: 'perfect',
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(201);

        // 계산: (50 / 2) * 0.1 + 0.5 = 3mm
        expect(response.body.spineWidth).toBe(3);
        expect(response.body.warnings).toContainEqual({
          code: 'SPINE_TOO_NARROW',
          message: '책등 폭이 5mm 미만입니다. 텍스트 배치에 주의하세요.',
        });
      });

      it('should warn when page count is below minimum', async () => {
        const dto = {
          pageCount: 20,
          paperType: 'mojo_80g',
          bindingType: 'perfect', // minPages: 32
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(201);

        expect(response.body.warnings).toContainEqual({
          code: 'BINDING_PAGE_LIMIT',
          message: '무선제본은 최소 32페이지 이상이어야 합니다.',
        });
      });

      it('should warn when page count exceeds maximum', async () => {
        const dto = {
          pageCount: 100,
          paperType: 'mojo_80g',
          bindingType: 'saddle', // maxPages: 64
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(201);

        expect(response.body.warnings).toContainEqual({
          code: 'BINDING_PAGE_LIMIT',
          message: '중철제본은 최대 64페이지까지 가능합니다.',
        });
      });

      it('should warn when page count is not a multiple', async () => {
        const dto = {
          pageCount: 50, // 4의 배수가 아님
          paperType: 'mojo_80g',
          bindingType: 'saddle', // pageMultiple: 4
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(201);

        expect(response.body.warnings).toContainEqual({
          code: 'BINDING_PAGE_MULTIPLE',
          message: '중철제본은 4의 배수여야 합니다.',
        });
      });
    });

    describe('error cases', () => {
      it('should return 404 for non-existent paper type', async () => {
        const dto = {
          pageCount: 100,
          paperType: 'non_existent',
          bindingType: 'perfect',
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(404);

        expect(response.body.message).toContain('non_existent');
      });

      it('should return 404 for non-existent binding type', async () => {
        const dto = {
          pageCount: 100,
          paperType: 'mojo_80g',
          bindingType: 'non_existent',
        };

        const response = await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(404);

        expect(response.body.message).toContain('non_existent');
      });

      it('should return 400 for invalid page count', async () => {
        const dto = {
          pageCount: 0, // 최소 1 이상
          paperType: 'mojo_80g',
          bindingType: 'perfect',
        };

        await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(400);
      });

      it('should return 400 for missing required fields', async () => {
        const dto = {
          pageCount: 100,
          // paperType 누락
          // bindingType 누락
        };

        await request(app.getHttpServer())
          .post('/products/spine/calculate')
          .send(dto)
          .expect(400);
      });
    });
  });

  // ── R-44 v2 공식 (bookmoa SSOT 정합) — AC#1~#5 HTTP 레벨 잠금 ─────────
  describe('R-44 v2 공식 — /products/spine/calculate', () => {
    beforeAll(async () => {
      // v2 두께 보유 지종 시드(SpineSeedService 시드의 축소 재현)
      await paperTypeRepository.save([
        {
          code: '미색모조 80g',
          name: '미색모조 80g',
          thickness: 0.096,
          thicknessPerPageMm: 0.048,
          category: 'body',
          isActive: true,
          sortOrder: 100,
        },
        {
          code: '미색모조80',
          name: '미색모조80',
          thickness: 0.095,
          thicknessPerSheetMm: 0.095,
          category: 'body',
          isActive: true,
          sortOrder: 200,
        },
        {
          code: '아르떼130',
          name: '아르떼130',
          thickness: 0.191,
          // 단일 행에 양(兩) 공식 두께 공존 — 아르떼 무선 확장(perPage 백필) 재현
          thicknessPerPageMm: 0.096,
          thicknessPerSheetMm: 0.191,
          aliases: ['아르떼(UW)130', '아르떼(NW)130'],
          category: 'body',
          isActive: true,
          sortOrder: 201,
        },
        // caliper 실측 배치(2026-07-22) 대표 2종 — 소수 4자리·양공식 공존 재현
        {
          code: '아르떼105',
          name: '아르떼105',
          thickness: 0.155,
          thicknessPerPageMm: 0.0775,
          thicknessPerSheetMm: 0.155,
          aliases: ['아르떼(UW)105', '아르떼(NW)105'],
          category: 'body',
          isActive: true,
          sortOrder: 202,
        },
        {
          code: '이라이트80',
          name: '이라이트80',
          thickness: 0.13,
          thicknessPerPageMm: 0.065,
          thicknessPerSheetMm: 0.13,
          category: 'body',
          isActive: true,
          sortOrder: 203,
        },
      ]);
    });

    it('AC#1 무선 200p 미색모조 80g → 9.6mm (margin 무가산·v2)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '미색모조 80g', bindingType: 'perfect' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 9.6, formulaVersion: 'v2', effPages: 200 });
    });

    it('AC#2 무선 201p → 홀수 보정 202p → 9.7mm', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 201, paperType: '미색모조 80g', bindingType: 'perfect' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 9.7, formulaVersion: 'v2', effPages: 202 });
    });

    it('AC#3 무선 16p → 0.77mm — 소수 유지(정수화 금지)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 16, paperType: '미색모조 80g', bindingType: 'perfect' })
        .expect(201);
      expect(res.body.spineWidth).toBe(0.77);
    });

    it('AC#4 양장 200p 미색모조80(0.095/장) → 14mm (합지4+내지10)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '미색모조80', bindingType: 'hardcover' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 14, formulaVersion: 'v2', pageThickMm: 10 });
    });

    it('AC#5 양장 40p 아르떼130 → 8mm(최소치)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 40, paperType: '아르떼130', bindingType: 'hardcover' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 8, formulaVersion: 'v2', pageThickMm: 4 });
    });

    it('별칭 해석: bookmoa 라벨 "아르떼(UW)130" → 아르떼130 으로 계산(G-6 해소)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 40, paperType: '아르떼(UW)130', bindingType: 'hardcover' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 8, resolvedPaperCode: '아르떼130' });
    });

    it('아르떼 무선 확장: 단일 행 양 공식 공존 — perfect+"아르떼(UW)130" 200p → 19.2mm v2', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '아르떼(UW)130', bindingType: 'perfect' })
        .expect(201);
      expect(res.body).toMatchObject({
        spineWidth: 19.2,
        formulaVersion: 'v2',
        resolvedPaperCode: '아르떼130',
      });
    });

    it('caliper 배치: 소수 4자리 보존 — perfect+"아르떼(UW)105" 200p → 15.5mm v2', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '아르떼(UW)105', bindingType: 'perfect' })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 15.5, formulaVersion: 'v2' });
    });

    it('caliper 배치: bookmoa 모달 파리티 — 이라이트80 무선 200p → 13mm / 양장 → 17mm', async () => {
      const p = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '이라이트80', bindingType: 'perfect' })
        .expect(201);
      expect(p.body).toMatchObject({ spineWidth: 13, formulaVersion: 'v2' });
      const h = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '이라이트80', bindingType: 'hardcover' })
        .expect(201);
      expect(h.body).toMatchObject({ spineWidth: 17, formulaVersion: 'v2', pageThickMm: 13 });
    });

    it('binding-aware 해석: "미색모조80"+perfect → 무선행("미색모조 80g") 우선 → 9.6mm v2', async () => {
      // code 정확일치는 양장행("미색모조80", perPage 없음)이지만, 요청 binding(perfect)에
      // 필요한 perPage 보유 행을 우선해 SSOT 9.6 을 반환해야 한다 — bookmoa 주력 케이스.
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: '미색모조80', bindingType: 'perfect' })
        .expect(201);
      expect(res.body).toMatchObject({
        spineWidth: 9.6,
        formulaVersion: 'v2',
        resolvedPaperCode: '미색모조 80g',
      });
    });

    it('양장 4의 배수 위반 → 비차단 경고(HARDCOVER_PAGE_RULE) + 값은 반환(D-3 기본 정책)', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 42, paperType: '미색모조80', bindingType: 'hardcover' })
        .expect(201);
      expect(res.body.formulaVersion).toBe('v2');
      const codes = res.body.warnings.map((w: any) => w.code);
      expect(codes).toContain('HARDCOVER_PAGE_RULE');
    });

    it('legacy 코드(mojo_80g)는 v1 유지 — 하위호환 무회귀', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 200, paperType: 'mojo_80g', bindingType: 'perfect' })
        .expect(201);
      // v1: (200/2)×0.1 + 0.5 = 10.5
      expect(res.body).toMatchObject({ spineWidth: 10.5, formulaVersion: 'v1' });
    });

    it('미해석 지종 + 커스텀 두께 없음 → 404 (기존 계약 유지)', async () => {
      // 이라이트80은 2026-07-22 caliper 배치로 편입 → 여전히 미회신인 아트지250 사용
      await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({ pageCount: 100, paperType: '아트지250', bindingType: 'perfect' })
        .expect(404);
    });

    it('customThicknessPerSheet 오버라이드로 지종 없이 v2 양장 강제', async () => {
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({
          pageCount: 200,
          paperType: '이라이트80',
          bindingType: 'hardcover',
          customThicknessPerSheet: 0.095,
        })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 14, formulaVersion: 'v2' });
    });

    it('F5 float-edge 서비스 도달: 100p×0.14 → toFixed3 후 ceil = 7 (naive ceil 이면 8)', async () => {
      // 50×0.14 = 7.000000000000001 — toFixed(3)→Number→ceil 순서(원본 규칙)가
      // 서비스 레벨(hardcoverSpineRaw 공유)에서도 보존됨을 HTTP 로 잠근다.
      const res = await request(app.getHttpServer())
        .post('/products/spine/calculate')
        .send({
          pageCount: 100,
          paperType: '이라이트80',
          bindingType: 'hardcover',
          customThicknessPerSheet: 0.14,
        })
        .expect(201);
      expect(res.body).toMatchObject({ spineWidth: 11, pageThickMm: 7, formulaVersion: 'v2' });
    });
  });
});
