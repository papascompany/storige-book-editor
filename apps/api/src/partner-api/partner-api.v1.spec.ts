/**
 * Partner API v1 코어 통합 spec (Stage 1 작업 1 — 봉투·인증·감사).
 *
 * 실제 HTTP 스택(supertest)으로 v1 표준 스택 전체를 관통 검증한다:
 *  - 성공 봉투 4필드 / 에러 봉투 6필드(requestId 존재)
 *  - PartnerApiKeyGuard: Bearer/X-API-Key 병행·불일치 401·무키 401·무효키 401
 *  - 감사 기록: 성공=인터셉터 / 실패(가드 401 포함)=필터, 정확히 1회
 *
 * DB 는 사용하지 않는다 — SitesService·감사 repo 를 스텁으로 대체
 * (대상 로직 자체는 실물: 가드/필터/인터셉터/봉투 직렬화 전부 실제 코드 경로).
 */
import {
  Body,
  Get,
  HttpCode,
  INestApplication,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsString } from 'class-validator';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../sites/sites.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from './guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from './http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from './http/partner-envelope.interceptor';
import { PartnerAuditService } from './audit/partner-audit.service';
import { PartnerAuditInterceptor } from './audit/partner-audit.interceptor';
import { PublicApiAuditLog } from './entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from './entities/partner-idempotency-key.entity';
import { PartnerApiKey } from './entities/partner-api-key.entity';
import { PartnerApiKeysService } from './keys/partner-api-keys.service';
import { PartnerIdempotencyService } from './idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from './idempotency/partner-idempotency.interceptor';
import { PARTNER_API_CONFIG } from './partner-api.constants';
import { PartnerApiException } from './http/partner-api.exceptions';
import { PaginatedResult, normalizePaginationQuery } from './http/pagination';
import { PartnerV1Controller } from './partner-v1.decorator';
import { PartnerPingController } from './ping.controller';

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────

const KEY_A = 'test-key-site-a';
const KEY_B = 'test-key-site-b';

class CreateThingDto {
  @IsString()
  value: string;
}

@PartnerV1Controller('test-things')
class TestThingsController {
  @Post()
  create(@Body() dto: CreateThingDto): { echoed: string } {
    return { echoed: dto.value };
  }

  @Post('missing')
  @HttpCode(200)
  missing(): never {
    throw new PartnerApiException(ErrV1.ERR_NOT_FOUND, 404, '리소스가 없습니다');
  }

  @Post('crash')
  crash(): never {
    throw new Error('kaboom-internal-secret');
  }

  @Get('items')
  items(): Array<{ id: number }> {
    return [{ id: 1 }, { id: 2 }];
  }

  /** 총 45건 고정 목록 — 페이지네이션 규약(§5.1) 통합 검증용 */
  @Get('paged')
  paged(@Query() query: Record<string, unknown>): PaginatedResult<{ id: number }> {
    const page = normalizePaginationQuery(query);
    const total = 45;
    const count = Math.max(0, Math.min(page.limit, total - page.offset));
    const items = Array.from({ length: count }, (_, i) => ({ id: page.offset + i }));
    return PaginatedResult.of(items, total, page);
  }
}

interface StubSite {
  id: string;
  name: string;
  retentionDays: number | null;
}

const sitesServiceStub = {
  findByEditorAuthCode: jest.fn(async (code: string): Promise<StubSite | null> => {
    if (code === KEY_A) return { id: 'site-a', name: 'Site A', retentionDays: null };
    if (code === KEY_B) return { id: 'site-b', name: 'Site B', retentionDays: null };
    return null;
  }),
  findByWorkerAuthCode: jest.fn(async (): Promise<StubSite | null> => null),
};

describe('Partner API v1 코어 (봉투·인증·감사)', () => {
  let app: INestApplication;
  let auditInsert: jest.Mock;

  beforeAll(async () => {
    auditInsert = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [PartnerPingController, TestThingsController],
      providers: [
        ApiKeyGuard,
        PartnerApiKeyGuard,
        PartnerRateLimitGuard,
        PartnerApiExceptionFilter,
        PartnerEnvelopeInterceptor,
        PartnerAuditService,
        PartnerAuditInterceptor,
        PartnerIdempotencyService,
        PartnerIdempotencyInterceptor,
        { provide: SitesService, useValue: sitesServiceStub },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: auditInsert },
        },
        {
          provide: getRepositoryToken(PartnerIdempotencyKey),
          useValue: { insert: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn() },
        },
        // Stage 2 — 가드 폴백 의존(partner_api_keys). 이 spec 은 sites 키 경로만 검증
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
    app.setGlobalPrefix('api'); // main.ts 와 동일 — 최종 경로 /api/v1/*
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auditInsert.mockClear();
  });

  // ── 성공 봉투 (§3.1) ──

  it('GET /api/v1/ping — 성공 봉투 4필드 고정 {success,message,data,pagination}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('X-API-Key', KEY_A)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ['data', 'message', 'pagination', 'success'].sort(),
    );
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Success');
    expect(res.body.data.pong).toBe(true);
    expect(res.body.pagination).toBeNull();
  });

  it('POST — 기본 201 + data 에 핸들러 반환값', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test-things')
      .set('X-API-Key', KEY_A)
      .send({ value: 'hello' })
      .expect(201);

    expect(res.body).toEqual({
      success: true,
      message: 'Success',
      data: { echoed: 'hello' },
      pagination: null,
    });
  });

  // ── 페이지네이션 (§5.1) ──

  it('목록 라우트 — pagination 봉투 {total,limit,offset,hasNext}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-things/paged')
      .set('X-API-Key', KEY_A)
      .expect(200);

    expect(res.body.data).toHaveLength(20); // 기본 limit 20
    expect(res.body.pagination).toEqual({ total: 45, limit: 20, offset: 0, hasNext: true });
  });

  it('limit=101 — 100으로 캡, offset 반영·hasNext 산식', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/test-things/paged?limit=101&offset=40')
      .set('X-API-Key', KEY_A)
      .expect(200);

    expect(res.body.data).toHaveLength(5); // 45-40
    expect(res.body.pagination).toEqual({ total: 45, limit: 100, offset: 40, hasNext: false });
  });

  it.each(['limit=0', 'limit=-5', 'offset=-1'])(
    '%s — 400 ERR_VALIDATION_FAILED 봉투',
    async (qs) => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/test-things/paged?${qs}`)
        .set('X-API-Key', KEY_A)
        .expect(400);
      expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
      expect(res.body.fieldErrors).toBeTruthy();
    },
  );

  // ── 인증 (AD-5, §7.1) ──

  it('Authorization: Bearer 로 인증된다', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Authorization', `Bearer ${KEY_A}`)
      .expect(200);
  });

  it('두 헤더 동일 값 — 인증된다 (Authorization 우선)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Authorization', `Bearer ${KEY_A}`)
      .set('X-API-Key', KEY_A)
      .expect(200);
  });

  it('두 헤더 값 불일치 — 401 ERR_UNAUTHORIZED (모호성 거부)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Authorization', `Bearer ${KEY_A}`)
      .set('X-API-Key', KEY_B)
      .expect(401);

    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId).toMatch(/^req_/);
  });

  it('키 없음 — 401 에러 봉투 6필드', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ping').expect(401);

    expect(Object.keys(res.body).sort()).toEqual(
      ['errorCode', 'errors', 'fieldErrors', 'message', 'requestId', 'success'].sort(),
    );
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  it('무효 키 — 401 ERR_UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('X-API-Key', 'nope')
      .expect(401);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  it('Bearer 가 아닌 Authorization 스킴은 무시 — 키 없음으로 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Authorization', 'Basic abc123')
      .expect(401);
  });

  // ── 에러 봉투 (§3.2) ──

  it('PartnerApiException — errorCode 그대로 직렬화', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test-things/missing')
      .set('X-API-Key', KEY_A)
      .send({})
      .expect(404);

    expect(res.body.errorCode).toBe(ErrV1.ERR_NOT_FOUND);
    expect(res.body.errors).toEqual([]);
    expect(res.body.fieldErrors).toBeNull();
  });

  it('DTO 검증 실패 — 400 ERR_VALIDATION_FAILED + fieldErrors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test-things')
      .set('X-API-Key', KEY_A)
      .send({ value: 123 })
      .expect(400);

    expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
    expect(res.body.fieldErrors).toBeTruthy();
    expect(res.body.fieldErrors.value).toBeDefined();
  });

  it('미분류 예외 — 500 ERR_INTERNAL, 내부 메시지 비노출', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test-things/crash')
      .set('X-API-Key', KEY_A)
      .send({})
      .expect(500);

    expect(res.body.errorCode).toBe(ErrV1.ERR_INTERNAL);
    expect(JSON.stringify(res.body)).not.toContain('kaboom-internal-secret');
    expect(res.body.requestId).toMatch(/^req_/);
  });

  // ── 감사 (§2.9) ──

  it('성공 요청 — 감사 1회 (siteId·statusCode·latency 기록)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('X-API-Key', KEY_A)
      .expect(200);

    expect(auditInsert).toHaveBeenCalledTimes(1);
    const row = auditInsert.mock.calls[0][0];
    expect(row.siteId).toBe('site-a');
    expect(row.env).toBe('live');
    expect(row.method).toBe('GET');
    expect(row.path).toBe('/api/v1/ping');
    expect(row.statusCode).toBe(200);
    expect(row.errorCode).toBeNull();
    expect(typeof row.latencyMs).toBe('number');
    expect(row.requestId).toMatch(/^req_/);
  });

  it('인증 실패 — 감사 1회 (siteId=null, errorCode 기록)', async () => {
    await request(app.getHttpServer()).get('/api/v1/ping').expect(401);

    expect(auditInsert).toHaveBeenCalledTimes(1);
    const row = auditInsert.mock.calls[0][0];
    expect(row.siteId).toBeNull();
    expect(row.env).toBeNull();
    expect(row.statusCode).toBe(401);
    expect(row.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  it('핸들러 에러 — 감사 1회 (이중 기록 없음)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/test-things/missing')
      .set('X-API-Key', KEY_A)
      .send({})
      .expect(404);

    expect(auditInsert).toHaveBeenCalledTimes(1);
    expect(auditInsert.mock.calls[0][0].statusCode).toBe(404);
    expect(auditInsert.mock.calls[0][0].errorCode).toBe(ErrV1.ERR_NOT_FOUND);
  });

  it('POST 성공 감사는 201 로 기록 (라우트 기본 status 반영)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/test-things')
      .set('X-API-Key', KEY_A)
      .send({ value: 'x' })
      .expect(201);

    expect(auditInsert.mock.calls[0][0].statusCode).toBe(201);
  });
});
