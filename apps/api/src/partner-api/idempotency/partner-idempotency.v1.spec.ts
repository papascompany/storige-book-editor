/**
 * v1 멱등성 통합 spec (Stage 1 작업 2 — 설계서 §4).
 *
 * 실제 HTTP 스택으로 멱등 인터셉터 전 경로를 검증한다:
 *  - 동일 키+동일 body → 최초 응답(status 포함) 재전달 + Idempotency-Replayed 헤더, 핸들러 미재실행
 *  - 동일 키+다른 body → 422 ERR_IDEMPOTENCY_KEY_MISMATCH
 *  - 처리 중 동일 키 → 409 ERR_IDEMPOTENCY_IN_PROGRESS
 *  - TTL 만료 → 신규 처리
 *  - 결정적 4xx 스냅샷 재전달 / 5xx 미저장(재시도 가능)
 *  - POST 전용(GET 미적용)·헤더 미제공 시 무보호 통과·키 길이 검증
 *
 * DB 대신 unique 제약(ER_DUP_ENTRY)을 에뮬레이트하는 in-memory repo 를 사용 —
 * 서비스의 INSERT 선점/만료/스냅샷 로직은 실물 코드 경로.
 */
import { Body, Get, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../../sites/sites.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { PartnerApiKeyGuard } from '../guards/partner-api-key.guard';
import { PartnerApiExceptionFilter } from '../http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../http/partner-envelope.interceptor';
import { PartnerApiException } from '../http/partner-api.exceptions';
import { PartnerAuditService } from '../audit/partner-audit.service';
import { PartnerAuditInterceptor } from '../audit/partner-audit.interceptor';
import { PublicApiAuditLog } from '../entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from '../entities/partner-idempotency-key.entity';
import { PartnerIdempotencyService } from './partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from './partner-idempotency.interceptor';
import { canonicalBodyHash } from './canonical-hash';
import { PARTNER_API_CONFIG } from '../partner-api.constants';
import { PartnerV1Controller } from '../partner-v1.decorator';

const KEY_A = 'idem-test-key-a';

// ── in-memory repo (uq_idem_scope UNIQUE 에뮬레이트) ──────────────────────

type Row = {
  id: string;
  siteId: string;
  env: 'test' | 'live';
  method: string;
  path: string;
  idempotencyKey: string;
  requestHash: string;
  status: 'in_progress' | 'completed';
  responseStatus: number | null;
  responseSnapshot: string | null;
  expiresAt: Date;
};

class InMemoryIdempotencyRepo {
  rows = new Map<string, Row>();

  private scopeOf(r: Pick<Row, 'siteId' | 'env' | 'method' | 'path' | 'idempotencyKey'>): string {
    return [r.siteId, r.env, r.method, r.path, r.idempotencyKey].join('|');
  }

  async insert(row: Row): Promise<void> {
    for (const existing of this.rows.values()) {
      if (this.scopeOf(existing) === this.scopeOf(row)) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
    }
    this.rows.set(row.id, { ...row });
  }

  async findOne(options: { where: Partial<Row> }): Promise<Row | null> {
    for (const row of this.rows.values()) {
      const match = Object.entries(options.where).every(
        ([k, v]) => row[k as keyof Row] === v,
      );
      if (match) return { ...row };
    }
    return null;
  }

  async update(criteria: { id: string }, patch: Partial<Row>): Promise<{ affected: number }> {
    const row = this.rows.get(criteria.id);
    if (!row) return { affected: 0 };
    Object.assign(row, patch);
    return { affected: 1 };
  }

  async delete(criteria: { id: string }): Promise<{ affected: number }> {
    return { affected: this.rows.delete(criteria.id) ? 1 : 0 };
  }

  seed(partial: Omit<Row, 'id'>): Row {
    const row: Row = { id: randomUUID(), ...partial };
    this.rows.set(row.id, row);
    return row;
  }
}

// ── 테스트 컨트롤러 ───────────────────────────────────────────────────────

let createCalls = 0;
let notFoundCalls = 0;
let crashCalls = 0;

@PartnerV1Controller('idem-things')
class IdemThingsController {
  @Post()
  create(@Body() body: Record<string, unknown>): { seq: number; echo: unknown } {
    createCalls += 1;
    return { seq: createCalls, echo: body.value ?? null };
  }

  @Post('notfound')
  notFound(): never {
    notFoundCalls += 1;
    throw new PartnerApiException(ErrV1.ERR_NOT_FOUND, 404, '대상 없음');
  }

  @Post('crash')
  crash(): never {
    crashCalls += 1;
    throw new Error('transient-boom');
  }

  @Get('list')
  list(): number[] {
    return [1, 2, 3];
  }
}

describe('Partner API v1 멱등성 (§4)', () => {
  let app: INestApplication;
  let repo: InMemoryIdempotencyRepo;

  beforeAll(async () => {
    repo = new InMemoryIdempotencyRepo();

    const moduleRef = await Test.createTestingModule({
      controllers: [IdemThingsController],
      providers: [
        ApiKeyGuard,
        PartnerApiKeyGuard,
        PartnerApiExceptionFilter,
        PartnerEnvelopeInterceptor,
        PartnerAuditService,
        PartnerAuditInterceptor,
        PartnerIdempotencyService,
        PartnerIdempotencyInterceptor,
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: async (code: string) =>
              code === KEY_A ? { id: 'site-a', name: 'Site A', retentionDays: null } : null,
            findByWorkerAuthCode: async () => null,
          },
        },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: getRepositoryToken(PartnerIdempotencyKey), useValue: repo },
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
    repo.rows.clear();
    createCalls = 0;
    notFoundCalls = 0;
    crashCalls = 0;
  });

  const post = (path: string, key?: string) => {
    const req = request(app.getHttpServer()).post(path).set('X-API-Key', KEY_A);
    return key === undefined ? req : req.set('Idempotency-Key', key);
  };

  it('canonical hash — 키 순서만 다른 body 는 동일 hash', () => {
    expect(canonicalBodyHash({ a: 1, b: { d: 4, c: 3 } })).toBe(
      canonicalBodyHash({ b: { c: 3, d: 4 }, a: 1 }),
    );
    expect(canonicalBodyHash({ a: 1 })).not.toBe(canonicalBodyHash({ a: 2 }));
  });

  it('동일 키+동일 body — 최초 응답(201) 스냅샷 재전달 + Replayed 헤더, 핸들러 1회', async () => {
    const first = await post('/api/v1/idem-things', 'K-1').send({ value: 'x' }).expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const second = await post('/api/v1/idem-things', 'K-1').send({ value: 'x' }).expect(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body); // 봉투 전체 동일(스냅샷 그대로)
    expect(createCalls).toBe(1);
  });

  it('키 순서만 다른 동일 body — 재전달 (canonical hash)', async () => {
    await post('/api/v1/idem-things', 'K-2').send({ a: 1, b: 2 }).expect(201);
    const replay = await post('/api/v1/idem-things', 'K-2').send({ b: 2, a: 1 }).expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(createCalls).toBe(1);
  });

  it('동일 키+다른 body — 422 ERR_IDEMPOTENCY_KEY_MISMATCH', async () => {
    await post('/api/v1/idem-things', 'K-3').send({ value: 'x' }).expect(201);
    const res = await post('/api/v1/idem-things', 'K-3').send({ value: 'DIFFERENT' }).expect(422);
    expect(res.body.errorCode).toBe(ErrV1.ERR_IDEMPOTENCY_KEY_MISMATCH);
    expect(createCalls).toBe(1);
  });

  it('처리 중 동일 키 — 409 ERR_IDEMPOTENCY_IN_PROGRESS', async () => {
    const body = { value: 'x' };
    repo.seed({
      siteId: 'site-a',
      env: 'live',
      method: 'POST',
      path: '/api/v1/idem-things',
      idempotencyKey: 'K-prog',
      requestHash: canonicalBodyHash(body),
      status: 'in_progress',
      responseStatus: null,
      responseSnapshot: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await post('/api/v1/idem-things', 'K-prog').send(body).expect(409);
    expect(res.body.errorCode).toBe(ErrV1.ERR_IDEMPOTENCY_IN_PROGRESS);
    expect(createCalls).toBe(0);
  });

  it('TTL 만료 — 만료 행 제거 후 신규 처리 (재전달 아님)', async () => {
    const body = { value: 'x' };
    repo.seed({
      siteId: 'site-a',
      env: 'live',
      method: 'POST',
      path: '/api/v1/idem-things',
      idempotencyKey: 'K-ttl',
      requestHash: canonicalBodyHash(body),
      status: 'completed',
      responseStatus: 201,
      responseSnapshot: JSON.stringify({ stale: true }),
      expiresAt: new Date(Date.now() - 1000), // 이미 만료
    });

    const res = await post('/api/v1/idem-things', 'K-ttl').send(body).expect(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(res.body.data.seq).toBe(1); // 신규 실행
    expect(createCalls).toBe(1);
  });

  it('결정적 4xx — 에러 봉투 스냅샷 재전달, 핸들러 1회', async () => {
    const first = await post('/api/v1/idem-things/notfound', 'K-4xx').send({}).expect(404);
    const second = await post('/api/v1/idem-things/notfound', 'K-4xx').send({}).expect(404);

    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(second.body.errorCode).toBe(ErrV1.ERR_NOT_FOUND);
    expect(notFoundCalls).toBe(1);
  });

  it('5xx — 스냅샷 미저장·선점 해제, 재호출 시 재실행(409 아님)', async () => {
    await post('/api/v1/idem-things/crash', 'K-5xx').send({}).expect(500);
    const second = await post('/api/v1/idem-things/crash', 'K-5xx').send({}).expect(500);

    expect(second.headers['idempotency-replayed']).toBeUndefined();
    expect(crashCalls).toBe(2);
    expect(repo.rows.size).toBe(0); // 선점 행 해제됨
  });

  it('헤더 미제공 — 멱등 보호 없이 매번 실행', async () => {
    await post('/api/v1/idem-things').send({ value: 'x' }).expect(201);
    await post('/api/v1/idem-things').send({ value: 'x' }).expect(201);
    expect(createCalls).toBe(2);
    expect(repo.rows.size).toBe(0);
  });

  it('키 129자 — 400 ERR_VALIDATION_FAILED', async () => {
    const res = await post('/api/v1/idem-things', 'k'.repeat(129)).send({}).expect(400);
    expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
    expect(createCalls).toBe(0);
  });

  it('GET 은 미적용 — 캐시 없음', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/idem-things/list')
      .set('X-API-Key', KEY_A)
      .set('Idempotency-Key', 'K-get')
      .expect(200);
    expect(repo.rows.size).toBe(0);
  });

  it('스냅샷 완료 후 저장 행이 completed 로 남는다 (24h TTL)', async () => {
    await post('/api/v1/idem-things', 'K-row').send({ value: 'x' }).expect(201);
    const rows = [...repo.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].responseStatus).toBe(201);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(JSON.parse(rows[0].responseSnapshot ?? 'null')).toMatchObject({
      success: true,
      data: { seq: 1 },
    });
  });
});
