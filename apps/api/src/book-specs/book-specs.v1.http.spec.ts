/**
 * Partner API v1 — BookSpecs 실스택 HTTP 스모크 (Stage 1 통합 검증).
 *
 * @PartnerV1Controller 로 정합화된 BookSpecsController 가 v1 표준 스택
 * (PartnerApiKeyGuard→RateLimit→필터→감사/멱등/봉투 인터셉터)을 실제
 * HTTP(supertest)로 관통하는지 고정한다 — partner-api.v1.spec.ts 와 동일
 * 구성 레시피(DB 없음: SitesService·repo 스텁, 대상 코드 경로는 전부 실물).
 *
 *  ① 무키 → 401 에러 봉투(6필드)
 *  ② 유효 키(X-API-Key) → 200 성공 봉투 + pagination(§5.1)
 *  ③ Authorization: Bearer 동등 수용(AD-5)
 *  ④ pageCount 규칙 위반 → 422 ERR_PAGE_COUNT_OUT_OF_RANGE 봉투(§3.3)
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../sites/sites.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { PartnerApiKeyGuard } from '../partner-api/guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../partner-api/guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from '../partner-api/http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../partner-api/http/partner-envelope.interceptor';
import { PartnerAuditService } from '../partner-api/audit/partner-audit.service';
import { PartnerAuditInterceptor } from '../partner-api/audit/partner-audit.interceptor';
import { PublicApiAuditLog } from '../partner-api/entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from '../partner-api/entities/partner-idempotency-key.entity';
import { PartnerApiKey } from '../partner-api/entities/partner-api-key.entity';
import { PartnerApiKeysService } from '../partner-api/keys/partner-api-keys.service';
import { PartnerIdempotencyService } from '../partner-api/idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from '../partner-api/idempotency/partner-idempotency.interceptor';
import { PARTNER_API_CONFIG } from '../partner-api/partner-api.constants';
import { BookSpecsController } from './book-specs.controller';
import { BookSpecsService } from './book-specs.service';
import { BookSpec } from './entities/book-spec.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { SpineService } from '../products/spine.service';

const KEY_A = 'test-key-site-a';

const makeSpec = (overrides: Partial<BookSpec> = {}): BookSpec => {
  const base = new BookSpec();
  base.id = 'internal-uuid-1';
  base.uid = 'bs_a4perfect01';
  base.siteId = null;
  base.name = 'A4 무선 소프트커버';
  base.coverType = 'softcover_variable_spine';
  base.bindingType = 'perfect';
  base.orientation = 'portrait';
  base.innerTrimWidthMm = 210;
  base.innerTrimHeightMm = 297;
  base.bleedMm = 3;
  base.sizeToleranceMm = 1;
  base.pageMin = 32;
  base.pageMax = 400;
  base.pageIncrement = 2;
  base.spineFormula = null;
  base.defaultPaperCode = 'mojo_80g';
  base.templateSetId = null;
  base.pricing = null;
  base.isActive = true;
  base.sortOrder = 10;
  return Object.assign(base, overrides);
};

describe('BookSpecs v1 실스택 HTTP 스모크 (Stage 1 통합)', () => {
  let app: INestApplication;
  const findAndCount = jest.fn();
  const findOne = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [BookSpecsController],
      providers: [
        BookSpecsService,
        ApiKeyGuard,
        PartnerApiKeyGuard,
        PartnerRateLimitGuard,
        PartnerApiExceptionFilter,
        PartnerEnvelopeInterceptor,
        PartnerAuditService,
        PartnerAuditInterceptor,
        PartnerIdempotencyService,
        PartnerIdempotencyInterceptor,
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: jest.fn(async (code: string) =>
              code === KEY_A ? { id: 'site-a', name: 'Site A', retentionDays: null } : null,
            ),
            findByWorkerAuthCode: jest.fn(async () => null),
          },
        },
        { provide: getRepositoryToken(BookSpec), useValue: { findAndCount, findOne } },
        { provide: getRepositoryToken(TemplateSet), useValue: { findOne: jest.fn() } },
        // list/422 스모크는 SpineService 경로에 도달하지 않는다 — 형태 스텁
        { provide: SpineService, useValue: {} },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getRepositoryToken(PartnerIdempotencyKey),
          useValue: { insert: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn() },
        },
        // Stage 2 — 가드 폴백 의존(partner_api_keys). 이 spec 은 sites 키 경로만 사용
        PartnerApiKeysService,
        {
          provide: getRepositoryToken(PartnerApiKey),
          useValue: { findOne: jest.fn().mockResolvedValue(null), update: jest.fn() },
        },
        {
          provide: PARTNER_API_CONFIG,
          useValue: {
            rateLimit: { general: { limitPerMin: 300 }, heavy: { limitPerMin: 100 } },
            idempotencyTtlMs: 24 * 60 * 60 * 1000,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // main.ts 와 동일 — 최종 경로 /api/v1/book-specs
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('① 무키 — 401 ERR_UNAUTHORIZED 에러 봉투 6필드', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/book-specs').expect(401);

    expect(Object.keys(res.body).sort()).toEqual(
      ['errorCode', 'errors', 'fieldErrors', 'message', 'requestId', 'success'].sort(),
    );
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
    expect(res.body.requestId).toMatch(/^req_/);
  });

  it('② 유효 키 — 200 성공 봉투 4필드 + pagination(§5.1)', async () => {
    findAndCount.mockResolvedValue([[makeSpec()], 1]);

    const res = await request(app.getHttpServer())
      .get('/api/v1/book-specs')
      .set('X-API-Key', KEY_A)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ['data', 'message', 'pagination', 'success'].sort(),
    );
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasNext: false });
    expect(res.body.data[0].uid).toBe('bs_a4perfect01');
    expect(res.body.data[0].id).toBeUndefined(); // 내부 UUID 비노출
  });

  it('③ Authorization: Bearer 동등 수용 (AD-5)', async () => {
    findAndCount.mockResolvedValue([[makeSpec()], 1]);

    const res = await request(app.getHttpServer())
      .get('/api/v1/book-specs')
      .set('Authorization', `Bearer ${KEY_A}`)
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('④ pageCount 규칙 위반 — 422 ERR_PAGE_COUNT_OUT_OF_RANGE 봉투 (설계서 §3.3)', async () => {
    findOne.mockResolvedValue(makeSpec()); // pageMin 32 — 30 은 범위 미만

    const res = await request(app.getHttpServer())
      .get('/api/v1/book-specs/bs_a4perfect01/calculated-size?pageCount=30')
      .set('X-API-Key', KEY_A)
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe(ErrV1.ERR_PAGE_COUNT_OUT_OF_RANGE);
    expect(res.body.errors.map((e: { code: string }) => e.code)).toContain('PAGE_COUNT_RANGE');
    expect(res.body.requestId).toMatch(/^req_/);
  });
});
