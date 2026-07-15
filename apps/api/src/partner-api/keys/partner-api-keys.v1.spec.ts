/**
 * Partner API v1 파트너 키 통합 spec (Stage 2 작업 1~4 — 설계서 §2.1·§7.1~7.2).
 *
 * 검증 범위:
 *  - 키 보안 3종: 발급 1회 노출(이후 마스킹만)·SHA-256 해시 저장·오버랩 회전(72h grace)
 *  - 가드 폴백: v1 표면에서 partner_api_keys 키 인증 왕복(해시 대조),
 *    grace 내 유효 / grace 만료 401 / revoked 401 / suspended 사이트 401
 *  - env 전파: test 키의 감사 행·멱등 scope·@PartnerLiveOnly 403 ERR_ENV_MISMATCH
 *  - 회귀: sites 기존 키 경로 완전 불변(env='live'·apiKeyId=null) +
 *    v1 발급 키는 공용 ApiKeyGuard(기존 external 표면)에서 무효(§7.3 논리 분리)
 *
 * DB 미사용 — partner_api_keys 는 인메모리 fake repo(해시/상태 로직은 실물 경로).
 */
import {
  ExecutionContext,
  Get,
  INestApplication,
  NotFoundException,
  Post,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../../sites/sites.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PartnerApiKeyGuard } from '../guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../guards/partner-rate-limit.guard';
import { PartnerLiveOnly } from '../guards/partner-live-only.decorator';
import { PartnerApiExceptionFilter } from '../http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../http/partner-envelope.interceptor';
import { PartnerAuditService } from '../audit/partner-audit.service';
import { PartnerAuditInterceptor } from '../audit/partner-audit.interceptor';
import { PublicApiAuditLog } from '../entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from '../entities/partner-idempotency-key.entity';
import { PartnerApiKey } from '../entities/partner-api-key.entity';
import { PartnerIdempotencyService } from '../idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from '../idempotency/partner-idempotency.interceptor';
import { PARTNER_API_CONFIG } from '../partner-api.constants';
import { PartnerV1Controller } from '../partner-v1.decorator';
import { PartnerPingController } from '../ping.controller';
import {
  PARTNER_KEY_GRACE_HOURS,
  PartnerApiKeysService,
} from './partner-api-keys.service';
import { PartnerApiKeysController } from './partner-api-keys.controller';
import { PartnerApiKeysSweeper } from './partner-api-keys.sweeper';

// ── 픽스처 ────────────────────────────────────────────────────────────────

const SITES_KEY = 'legacy-sites-key';
const SITE_LEGACY = 'site-legacy';
const SITE_P = 'site-partner';
const SITE_SUSPENDED = 'site-suspended';

/** 인메모리 partner_api_keys fake — 서비스가 쓰는 서브셋만 (해시·상태 로직은 실물) */
class FakePartnerKeyRepo {
  rows: PartnerApiKey[] = [];

  create(data: Partial<PartnerApiKey>): PartnerApiKey {
    return { ...data } as PartnerApiKey;
  }

  async save(row: PartnerApiKey): Promise<PartnerApiKey> {
    const saved: PartnerApiKey = {
      ...row,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    const idx = this.rows.findIndex((r) => r.id === saved.id);
    if (idx >= 0) this.rows[idx] = saved;
    else this.rows.push(saved);
    return saved;
  }

  async find(options: {
    where: Partial<PartnerApiKey>;
  }): Promise<PartnerApiKey[]> {
    return this.rows.filter((r) => this.matches(r, options.where));
  }

  async findOne(options: {
    where: Partial<PartnerApiKey>;
  }): Promise<PartnerApiKey | null> {
    return this.rows.find((r) => this.matches(r, options.where)) ?? null;
  }

  async update(
    criteria: Record<string, unknown>,
    set: Partial<PartnerApiKey>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const row of this.rows) {
      if (!this.matches(row, criteria)) continue;
      Object.assign(row, set, { updatedAt: new Date() });
      affected += 1;
    }
    return { affected };
  }

  private matches(row: PartnerApiKey, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, expected]) => {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (expected instanceof FindOperator) {
        if (expected.type === 'lessThan') {
          return (
            actual instanceof Date &&
            expected.value instanceof Date &&
            actual.getTime() < expected.value.getTime()
          );
        }
        throw new Error(`fake repo: 미지원 FindOperator ${expected.type}`);
      }
      return actual === expected;
    });
  }
}

@PartnerV1Controller('env-things')
class EnvThingsController {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }

  @Post()
  create(): { created: true } {
    return { created: true };
  }

  @Get('live-only')
  @PartnerLiveOnly()
  liveOnly(): { live: true } {
    return { live: true };
  }
}

describe('Partner API v1 파트너 키 (발급·회전·가드 폴백·env 전파)', () => {
  let app: INestApplication;
  let keysService: PartnerApiKeysService;
  let sweeper: PartnerApiKeysSweeper;
  let apiKeyGuard: ApiKeyGuard;
  let keyRepo: FakePartnerKeyRepo;
  let auditInsert: jest.Mock;
  let idemInsert: jest.Mock;

  const sitesById: Record<
    string,
    { id: string; name: string; status: string; retentionDays: number | null }
  > = {
    [SITE_LEGACY]: { id: SITE_LEGACY, name: 'Legacy', status: 'active', retentionDays: null },
    [SITE_P]: { id: SITE_P, name: 'Partner', status: 'active', retentionDays: 30 },
    [SITE_SUSPENDED]: { id: SITE_SUSPENDED, name: 'Suspended', status: 'suspended', retentionDays: null },
  };

  const sitesServiceStub = {
    findByEditorAuthCode: jest.fn(async (code: string) =>
      code === SITES_KEY ? sitesById[SITE_LEGACY] : null,
    ),
    findByWorkerAuthCode: jest.fn(async () => null),
    findOne: jest.fn(async (id: string) => {
      const site = sitesById[id];
      if (!site) throw new NotFoundException(`Site ${id} not found`);
      return site;
    }),
  };

  beforeAll(async () => {
    keyRepo = new FakePartnerKeyRepo();
    auditInsert = jest.fn().mockResolvedValue(undefined);
    idemInsert = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [PartnerPingController, EnvThingsController],
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
        PartnerApiKeysService,
        PartnerApiKeysSweeper,
        { provide: SitesService, useValue: sitesServiceStub },
        { provide: getRepositoryToken(PartnerApiKey), useValue: keyRepo },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: auditInsert },
        },
        {
          provide: getRepositoryToken(PartnerIdempotencyKey),
          useValue: {
            insert: idemInsert,
            findOne: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            delete: jest.fn(),
          },
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

    keysService = moduleRef.get(PartnerApiKeysService);
    sweeper = moduleRef.get(PartnerApiKeysSweeper);
    apiKeyGuard = moduleRef.get(ApiKeyGuard);

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

  beforeEach(() => {
    keyRepo.rows = [];
    auditInsert.mockClear();
    idemInsert.mockClear();
  });

  const ping = (key: string) =>
    request(app.getHttpServer()).get('/api/v1/ping').set('X-API-Key', key);

  // ── 키 보안 3종 ① 발급 1회 노출 + 해시 저장 ──

  it('발급 — 원문은 반환값에서만 1회, 저장분은 SHA-256 해시(원문 미보관)', async () => {
    const issued = await keysService.issue(SITE_P, 'test', 'label-1');

    expect(issued.plaintextKey).toMatch(/^sk_test_[0-9a-f]{48}$/);
    expect(issued.apiKey.keyPrefix).toBe(issued.plaintextKey.slice(0, 12));
    // 마스킹 응답에 원문/해시 부재
    expect(JSON.stringify(issued.apiKey)).not.toContain(issued.plaintextKey);
    expect(issued.apiKey).not.toHaveProperty('keyHash');

    const stored = keyRepo.rows[0];
    expect(stored.keyHash).toBe(PartnerApiKeysService.hashKey(issued.plaintextKey));
    expect(stored.keyHash).not.toBe(issued.plaintextKey);
    expect(Object.values(stored)).not.toContain(issued.plaintextKey);
  });

  it('목록 — prefix 마스킹만 (원문·해시 어떤 형태로도 미노출)', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    const items = await keysService.list(SITE_P);

    expect(items).toHaveLength(1);
    expect(items[0].keyPrefix).toMatch(/^sk_live_/);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain(issued.plaintextKey);
    expect(serialized).not.toContain(keyRepo.rows[0].keyHash);
  });

  // ── 해시 검증 왕복 (가드 폴백 — v1 HTTP 실스택) ──

  it('발급 키 왕복 — v1 표면 인증 성공 + retentionDays 등 site 컨텍스트 세팅', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    const res = await ping(issued.plaintextKey).expect(200);
    expect(res.body.data.pong).toBe(true);

    // 감사 행: siteId/env/apiKeyId 전파
    const row = auditInsert.mock.calls[0][0];
    expect(row.siteId).toBe(SITE_P);
    expect(row.env).toBe('live');
    expect(row.apiKeyId).toBe(issued.apiKey.id);
  });

  it('Bearer 로도 폴백 인증된다 (병행 수용 규약 승계)', async () => {
    const issued = await keysService.issue(SITE_P, 'test', null);
    await request(app.getHttpServer())
      .get('/api/v1/ping')
      .set('Authorization', `Bearer ${issued.plaintextKey}`)
      .expect(200);
  });

  it('suspended 사이트의 유효 키 — 401 (sites 키와 동일 시맨틱)', async () => {
    const issued = await keysService.issue(SITE_SUSPENDED, 'live', null);
    const res = await ping(issued.plaintextKey).expect(401);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  // ── 키 보안 3종 ③ 오버랩 회전 ──

  it('회전 — 구 키 grace(+72h)·신 키 active, 신 원문 1회 반환', async () => {
    const first = await keysService.issue(SITE_P, 'live', 'rotating');
    const before = Date.now();
    const rotated = await keysService.rotate(SITE_P, first.apiKey.id);

    expect(rotated.plaintextKey).not.toBe(first.plaintextKey);
    expect(rotated.apiKey.status).toBe('active');
    expect(rotated.apiKey.env).toBe('live');
    expect(rotated.rotatedFrom.id).toBe(first.apiKey.id);
    expect(rotated.rotatedFrom.status).toBe('grace');

    const graceMs = rotated.rotatedFrom.graceUntil!.getTime() - before;
    const expected = PARTNER_KEY_GRACE_HOURS * 60 * 60 * 1000;
    expect(graceMs).toBeGreaterThan(expected - 5000);
    expect(graceMs).toBeLessThanOrEqual(expected + 5000);
  });

  it('grace 내 구 키 — 여전히 유효 (무중단 교체 창)', async () => {
    const first = await keysService.issue(SITE_P, 'live', null);
    const rotated = await keysService.rotate(SITE_P, first.apiKey.id);

    await ping(first.plaintextKey).expect(200); // 구 키 (grace)
    await ping(rotated.plaintextKey).expect(200); // 신 키
  });

  it('grace 만료 후 구 키 — 401 (요청 시각 판정 — 배치 지연과 무관)', async () => {
    const first = await keysService.issue(SITE_P, 'live', null);
    await keysService.rotate(SITE_P, first.apiKey.id);

    const oldRow = keyRepo.rows.find((r) => r.id === first.apiKey.id)!;
    oldRow.graceUntil = new Date(Date.now() - 1000); // 유예 만료 시뮬레이션

    const res = await ping(first.plaintextKey).expect(401);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  it('grace/revoked 키 재회전 — 409 (이중 회전 방지)', async () => {
    const first = await keysService.issue(SITE_P, 'live', null);
    await keysService.rotate(SITE_P, first.apiKey.id);
    await expect(keysService.rotate(SITE_P, first.apiKey.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('revoked 키 — 401 (즉시 폐기, 유예 없음)', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    await keysService.revoke(SITE_P, issued.apiKey.id);

    const res = await ping(issued.plaintextKey).expect(401);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  it('타 사이트 키 id 로 회전/폐기 불가 — 404 (사이트 스코프)', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    await expect(keysService.rotate(SITE_LEGACY, issued.apiKey.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(keysService.revoke(SITE_LEGACY, issued.apiKey.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('grace 만료 배치 — 만료분만 revoked 승격(+revoked_at), 유예 중 키는 보존', async () => {
    const expiring = await keysService.issue(SITE_P, 'live', null);
    const staying = await keysService.issue(SITE_P, 'live', null);
    await keysService.rotate(SITE_P, expiring.apiKey.id);
    await keysService.rotate(SITE_P, staying.apiKey.id);

    keyRepo.rows.find((r) => r.id === expiring.apiKey.id)!.graceUntil = new Date(
      Date.now() - 1000,
    );

    await sweeper.sweepExpiredGrace();

    const expiredRow = keyRepo.rows.find((r) => r.id === expiring.apiKey.id)!;
    const stayingRow = keyRepo.rows.find((r) => r.id === staying.apiKey.id)!;
    expect(expiredRow.status).toBe('revoked');
    expect(expiredRow.revokedAt).toBeInstanceOf(Date);
    expect(stayingRow.status).toBe('grace');
    expect(stayingRow.revokedAt).toBeNull();
  });

  // ── env 전파 (멱등 scope·감사) ──

  it('test 키 — 감사 행 env=test + apiKeyId 기록', async () => {
    const issued = await keysService.issue(SITE_P, 'test', null);
    await ping(issued.plaintextKey).expect(200);

    const row = auditInsert.mock.calls[0][0];
    expect(row.env).toBe('test');
    expect(row.apiKeyId).toBe(issued.apiKey.id);
  });

  it('test 키 POST + Idempotency-Key — 멱등 scope 행에 env=test', async () => {
    const issued = await keysService.issue(SITE_P, 'test', null);
    await request(app.getHttpServer())
      .post('/api/v1/env-things')
      .set('X-API-Key', issued.plaintextKey)
      .set('Idempotency-Key', 'idem-env-1')
      .send({})
      .expect(201);

    expect(idemInsert).toHaveBeenCalledTimes(1);
    const claim = idemInsert.mock.calls[0][0];
    expect(claim.siteId).toBe(SITE_P);
    expect(claim.env).toBe('test');
  });

  // ── ERR_ENV_MISMATCH 훅 (@PartnerLiveOnly) ──

  it('@PartnerLiveOnly 라우트를 test 키가 호출 — 403 ERR_ENV_MISMATCH 봉투', async () => {
    const issued = await keysService.issue(SITE_P, 'test', null);
    const res = await request(app.getHttpServer())
      .get('/api/v1/env-things/live-only')
      .set('X-API-Key', issued.plaintextKey)
      .expect(403);

    expect(res.body.errorCode).toBe(ErrV1.ERR_ENV_MISMATCH);
    expect(res.body.success).toBe(false);
    // 감사에도 ERR_ENV_MISMATCH 로 기록
    expect(auditInsert.mock.calls[0][0].errorCode).toBe(ErrV1.ERR_ENV_MISMATCH);
  });

  it('@PartnerLiveOnly 라우트 — live 키·sites 레거시 키는 통과', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    await request(app.getHttpServer())
      .get('/api/v1/env-things/live-only')
      .set('X-API-Key', issued.plaintextKey)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/env-things/live-only')
      .set('X-API-Key', SITES_KEY)
      .expect(200);
  });

  // ── 회귀: sites 기존 키 경로 완전 불변 ──

  it('sites 레거시 키 — 인증·감사 기존과 동일(env=live, apiKeyId=null)', async () => {
    await ping(SITES_KEY).expect(200);

    const row = auditInsert.mock.calls[0][0];
    expect(row.siteId).toBe(SITE_LEGACY);
    expect(row.env).toBe('live');
    expect(row.apiKeyId).toBeNull();
    // sites 키 경로는 partner_api_keys 폴백에 진입하지 않는다
    expect(keyRepo.rows).toHaveLength(0);
  });

  it('무효 키 — 401 (sites 실패 후 폴백도 실패)', async () => {
    const res = await ping('sk_live_definitely-not-issued').expect(401);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
  });

  // ── 회귀: v1 발급 키는 공용 ApiKeyGuard(기존 표면)에서 무효 (§7.3) ──

  it('v1 발급 키로 공용 ApiKeyGuard 직접 통과 시도 — Unauthorized (폴백은 v1 전용)', async () => {
    const issued = await keysService.issue(SITE_P, 'live', null);
    const req = { headers: { 'x-api-key': issued.plaintextKey } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(apiKeyGuard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ── 운영자 표면 가드 계약 (무인증 개방 회귀 방지) ──

  it('PartnerApiKeysController — JwtAuthGuard+RolesGuard 전역 admin 가드 고정', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PartnerApiKeysController,
    ) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    const roles = Reflect.getMetadata('roles', PartnerApiKeysController) as string[];
    expect(roles).toEqual(['ADMIN', 'MANAGER']);
  });
});
