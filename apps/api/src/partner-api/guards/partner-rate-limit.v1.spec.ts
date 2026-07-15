/**
 * v1 per-API-Key 레이트리밋 통합 spec (Stage 1 작업 4 — 설계서 §5.2).
 *
 *  - 한도 초과 시 429 ERR_RATE_LIMITED 봉투 + Retry-After(초) 헤더
 *  - 키(사이트) 단위 격리 — 타 키 비간섭
 *  - 버킷 분리: general vs heavy(@PartnerRateLimitBucket) 독립 카운터
 *
 * 한도는 PARTNER_API_CONFIG 오버라이드(테스트용 소값)로 주입 — env 조정 경로와 동일.
 */
import { Get, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../../sites/sites.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { PartnerApiKeyGuard } from './partner-api-key.guard';
import { PartnerRateLimitGuard } from './partner-rate-limit.guard';
import { PartnerRateLimitBucket } from './partner-rate-limit.decorator';
import { PartnerApiExceptionFilter } from '../http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../http/partner-envelope.interceptor';
import { PartnerAuditService } from '../audit/partner-audit.service';
import { PartnerAuditInterceptor } from '../audit/partner-audit.interceptor';
import { PublicApiAuditLog } from '../entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from '../entities/partner-idempotency-key.entity';
import { PartnerIdempotencyService } from '../idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from '../idempotency/partner-idempotency.interceptor';
import { PARTNER_API_CONFIG } from '../partner-api.constants';
import { PartnerV1Controller } from '../partner-v1.decorator';

const GENERAL_LIMIT = 3;
const HEAVY_LIMIT = 2;

@PartnerV1Controller('rl-things')
class RateLimitedController {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }

  @Post('heavy')
  @PartnerRateLimitBucket('heavy')
  heavy(): { ok: true } {
    return { ok: true };
  }
}

describe('Partner API v1 per-Key 레이트리밋 (§5.2)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // 전역 per-IP Throttler 옵션(현행 300/min) — per-Key 가드는 이와 병존하는 추가 레이어
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [RateLimitedController],
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
        {
          provide: SitesService,
          useValue: {
            // rl-key-* 형태의 키는 각자 독립 사이트로 매핑 — 키 단위 격리 검증용
            findByEditorAuthCode: async (code: string) =>
              code.startsWith('rl-key-')
                ? { id: `site-${code}`, name: code, retentionDays: null }
                : null,
            findByWorkerAuthCode: async () => null,
          },
        },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getRepositoryToken(PartnerIdempotencyKey),
          useValue: { insert: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn() },
        },
        {
          provide: PARTNER_API_CONFIG,
          useValue: {
            rateLimit: {
              general: { limitPerMin: GENERAL_LIMIT },
              heavy: { limitPerMin: HEAVY_LIMIT },
            },
            idempotencyTtlMs: 24 * 60 * 60 * 1000,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (key: string) =>
    request(app.getHttpServer()).get('/api/v1/rl-things').set('X-API-Key', key);

  it('general 한도 초과 — 429 ERR_RATE_LIMITED + Retry-After 헤더', async () => {
    const key = 'rl-key-general';
    for (let i = 0; i < GENERAL_LIMIT; i++) {
      await get(key).expect(200);
    }
    const res = await get(key).expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe(ErrV1.ERR_RATE_LIMITED);
    expect(res.body.requestId).toMatch(/^req_/);

    const retryAfter = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('타 키 비간섭 — 한 키가 차단돼도 다른 키는 통과', async () => {
    const blocked = 'rl-key-blocked';
    for (let i = 0; i < GENERAL_LIMIT; i++) {
      await get(blocked).expect(200);
    }
    await get(blocked).expect(429);

    // 다른 키(다른 사이트)는 영향 없음
    await get('rl-key-other').expect(200);
  });

  it('heavy 버킷 — 독립 카운터·별도 한도 (100/min 계열, 테스트값 2)', async () => {
    const key = 'rl-key-heavy';
    const postHeavy = () =>
      request(app.getHttpServer())
        .post('/api/v1/rl-things/heavy')
        .set('X-API-Key', key)
        .send({});

    for (let i = 0; i < HEAVY_LIMIT; i++) {
      await postHeavy().expect(201);
    }
    const res = await postHeavy().expect(429);
    expect(res.body.errorCode).toBe(ErrV1.ERR_RATE_LIMITED);
    expect(res.headers['retry-after']).toBeDefined();

    // heavy 가 차단돼도 같은 키의 general 버킷은 독립
    await get(key).expect(200);
  });

  it('429 도 표준 에러 봉투 6필드', async () => {
    const key = 'rl-key-envelope';
    for (let i = 0; i < GENERAL_LIMIT; i++) {
      await get(key).expect(200);
    }
    const res = await get(key).expect(429);
    expect(Object.keys(res.body).sort()).toEqual(
      ['errorCode', 'errors', 'fieldErrors', 'message', 'requestId', 'success'].sort(),
    );
  });
});
