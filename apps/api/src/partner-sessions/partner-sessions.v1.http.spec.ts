/**
 * Partner API v1 — Sessions 런처 실스택 HTTP 스모크 (P2-b, 2026-10-18).
 *
 * @PartnerV1Controller('sessions') 가 v1 표준 스택(PartnerApiKeyGuard→RateLimit→필터→감사/멱등/봉투)을
 * 실제 HTTP(supertest)로 관통하는지 고정한다 — books.v1.http.spec 과 동일 레시피(DB 없음: 서비스 스텁).
 *
 * 커버리지:
 *  ① 무키 → 401 에러 봉투(6필드)
 *  ② launch 201 성공 봉투 4필드(pagination null) + data shape
 *  ③ worker 키(WORKER_API_KEY) → 403 ERR_FORBIDDEN
 *  ④ DTO — 추가 필드/누락 → 400 ERR_VALIDATION_FAILED(fieldErrors), mode 'spread' 거부
 *  ⑤ Idempotency-Key 재전달 — 동일 키+동일 body 2회 → 2회째 Idempotency-Replayed:true·핸들러 1회, 다른 body → 422
 *  ⑥ deliverables 200 봉투 / synthesize 201 봉투 / 스코프 404 / 미완료 409
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../sites/sites.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { AuthService } from '../auth/auth.service';
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
import { EditSessionsService } from '../edit-sessions/edit-sessions.service';
import { SessionStatus } from '../edit-sessions/entities/edit-session.entity';
import { TemplateSetsService } from '../templates/template-sets.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { PartnerSessionsController } from './partner-sessions.controller';
import { PartnerSessionsService } from './partner-sessions.service';

const KEY_A = 'test-key-site-a';
const KEY_WORKER = 'internal-worker-key';
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const TS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

type IdemRow = {
  id: string;
  siteId: string;
  env: string;
  method: string;
  path: string;
  idempotencyKey: string;
  requestHash: string;
  status: string;
  responseStatus: number | null;
  responseSnapshot: string | null;
  expiresAt: Date;
};

/** 멱등 저장소 인메모리 — uq_idem_scope UNIQUE 위반을 ER_DUP_ENTRY 로 흉내낸다 */
function makeIdemRepo() {
  const rows = new Map<string, IdemRow>();
  const scopeKey = (r: Pick<IdemRow, 'siteId' | 'env' | 'method' | 'path' | 'idempotencyKey'>) =>
    [r.siteId, r.env, r.method, r.path, r.idempotencyKey].join('|');
  return {
    rows,
    insert: jest.fn(async (r: IdemRow) => {
      if ([...rows.values()].some((x) => scopeKey(x) === scopeKey(r))) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
      rows.set(r.id, { ...r });
    }),
    findOne: jest.fn(async ({ where }: { where: Pick<IdemRow, 'siteId' | 'env' | 'method' | 'path' | 'idempotencyKey'> }) =>
      [...rows.values()].find((x) => scopeKey(x) === scopeKey(where)) ?? null,
    ),
    update: jest.fn(async ({ id }: { id: string }, patch: Partial<IdemRow>) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...patch });
    }),
    delete: jest.fn(async ({ id }: { id: string }) => {
      rows.delete(id);
    }),
  };
}

describe('Sessions v1 실스택 HTTP 스모크 (P2-b 런처)', () => {
  let app: INestApplication;
  const idemRepo = makeIdemRepo();
  const workerKeyBackup = process.env.WORKER_API_KEY;
  const flagBackup = process.env.PARTNER_SESSION_LAUNCH_ENABLED;

  // EditSessionsService
  const create = jest.fn();
  const findById = jest.fn();
  const findLatestPartnerVisibleSynthJob = jest.fn();
  const requestDuplexSplitResynthesis = jest.fn();
  // TemplateSetsService / AuthService / WorkerJobsService
  const tsFindOne = jest.fn();
  const createShopSession = jest.fn();
  const issueOutputUrls = jest.fn();

  const launchBody = () => ({
    member: { seqno: 5, id: 'u@example.com', name: '홍길동' },
    templateSetId: TS_ID,
    orderSeqno: 123,
  });

  const makeSession = (o: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    siteId: SITE_A,
    status: SessionStatus.COMPLETE,
    orderSeqno: 123,
    templateSetId: TS_ID,
    coverFileId: 'file-1',
    coverFile: { id: 'file-1', thumbnailUrl: null, createdAt: new Date('2026-10-18T00:00:00Z') },
    contentFile: null,
    canvasData: [{ objects: [] }, { objects: [] }],
    callbackUrl: null,
    completedAt: new Date('2026-10-18T00:00:00Z'),
    metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1 },
    ...o,
  });

  beforeAll(async () => {
    process.env.WORKER_API_KEY = KEY_WORKER;
    delete process.env.PARTNER_SESSION_LAUNCH_ENABLED;

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [PartnerSessionsController],
      providers: [
        PartnerSessionsService,
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
            // 내부 워커 키는 Default Site 의 editor==worker 코드 — editor 조회로 매칭돼도 role 은 'worker'
            findByEditorAuthCode: jest.fn(async (code: string) =>
              code === KEY_A || code === KEY_WORKER
                ? { id: SITE_A, name: 'Site A', retentionDays: null }
                : null,
            ),
            findByWorkerAuthCode: jest.fn(async () => null),
          },
        },
        { provide: EditSessionsService, useValue: { create, findById, findLatestPartnerVisibleSynthJob, requestDuplexSplitResynthesis } },
        { provide: TemplateSetsService, useValue: { findOne: tsFindOne } },
        { provide: AuthService, useValue: { createShopSession } },
        { provide: WorkerJobsService, useValue: { issueOutputUrls } },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: getRepositoryToken(PartnerIdempotencyKey), useValue: idemRepo },
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
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (workerKeyBackup === undefined) delete process.env.WORKER_API_KEY;
    else process.env.WORKER_API_KEY = workerKeyBackup;
    if (flagBackup === undefined) delete process.env.PARTNER_SESSION_LAUNCH_ENABLED;
    else process.env.PARTNER_SESSION_LAUNCH_ENABLED = flagBackup;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    idemRepo.rows.clear();
    tsFindOne.mockResolvedValue({ id: TS_ID, siteId: null, isActive: true, pdfOutputMode: 'duplex-split', productProfile: null });
    create.mockImplementation(async (dto: Record<string, unknown>) => ({ id: SESSION_ID, ...dto }));
    createShopSession.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
    findById.mockResolvedValue(makeSession());
    findLatestPartnerVisibleSynthJob.mockResolvedValue(null);
    requestDuplexSplitResynthesis.mockResolvedValue({ jobId: 'job-7', revision: 2 });
  });

  it('① 무키 — 401 ERR_UNAUTHORIZED 에러 봉투 6필드', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .send(launchBody())
      .expect(401);
    expect(Object.keys(res.body).sort()).toEqual(
      ['errorCode', 'errors', 'fieldErrors', 'message', 'requestId', 'success'].sort(),
    );
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
    expect(res.body.requestId).toMatch(/^req_/);
  });

  it('② launch — 201 성공 봉투 4필드 + data{sessionId,accessToken,refreshToken,expiresIn,embed}', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('X-API-Key', KEY_A)
      .send(launchBody())
      .expect(201);

    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'pagination', 'success'].sort());
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeNull();
    expect(res.body.data).toEqual({
      sessionId: SESSION_ID,
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      embed: { sessionId: SESSION_ID, token: 'at', refreshToken: 'rt', orderSeqno: 123 },
    });
    const dto = create.mock.calls[0][0];
    expect(dto).toMatchObject({ mode: 'both', siteId: SITE_A, memberSeqno: 5, orderSeqno: 123, templateSetId: TS_ID });
    expect(dto.metadata.launch).toMatchObject({ via: 'partner-v1', env: 'live' });
    expect(dto.metadata.launch.requestId).toMatch(/^req_/);
    expect(createShopSession).toHaveBeenCalledWith(
      { memberSeqno: 5, memberId: 'u@example.com', memberName: '홍길동', orderSeqno: 123 },
      { siteId: SITE_A, siteName: 'Site A' },
    );
  });

  it('③ worker 키 — 403 ERR_FORBIDDEN (사이트 편집기 키만)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('Authorization', `Bearer ${KEY_WORKER}`)
      .send(launchBody())
      .expect(403);
    expect(res.body.errorCode).toBe(ErrV1.ERR_FORBIDDEN);
    expect(create).not.toHaveBeenCalled();
  });

  it('④ -a DTO — member 누락·추가 필드 → 400 ERR_VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('X-API-Key', KEY_A)
      .send({ templateSetId: TS_ID, extra: 1 })
      .expect(400);
    expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
    expect(res.body.fieldErrors).toEqual(expect.objectContaining({ member: expect.any(Array) }));
    expect(create).not.toHaveBeenCalled();
  });

  it("④ -b DTO — mode 'spread'/'template' 거부, member.seqno 0 거부, templateSetId UUID 아님 거부", async () => {
    for (const bad of [
      { ...launchBody(), mode: 'spread' },
      { ...launchBody(), mode: 'template' },
      { ...launchBody(), member: { seqno: 0, id: 'a', name: 'b' } },
      { ...launchBody(), templateSetId: 'not-a-uuid' },
      { ...launchBody(), callbackUrl: 'http://partner.example.com/cb' },
    ]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/launch')
        .set('X-API-Key', KEY_A)
        .send(bad)
        .expect(400);
      expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('⑤ Idempotency-Key — 동일 키+동일 body 재전달(핸들러 1회·Idempotency-Replayed), 다른 body 422', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('X-API-Key', KEY_A)
      .set('Idempotency-Key', 'idem-launch-1')
      .send(launchBody())
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('X-API-Key', KEY_A)
      .set('Idempotency-Key', 'idem-launch-1')
      .send(launchBody())
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(create).toHaveBeenCalledTimes(1);
    expect(createShopSession).toHaveBeenCalledTimes(1);

    const mismatch = await request(app.getHttpServer())
      .post('/api/v1/sessions/launch')
      .set('X-API-Key', KEY_A)
      .set('Idempotency-Key', 'idem-launch-1')
      .send({ ...launchBody(), orderSeqno: 999 })
      .expect(422);
    expect(mismatch.body.errorCode).toBe(ErrV1.ERR_IDEMPOTENCY_KEY_MISMATCH);
  });

  it('⑥ -a deliverables — 200 봉투 + 편집기 PDF(api-key)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${SESSION_ID}/deliverables`)
      .set('X-API-Key', KEY_A)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeNull();
    expect(res.body.data).toMatchObject({
      sessionId: SESSION_ID,
      status: 'complete',
      revision: 1,
      orderSeqno: 123,
      product: null,
      calendar: null,
    });
    expect(res.body.data.files).toEqual([
      expect.objectContaining({ role: 'single', fileId: 'file-1', url: '/api/files/file-1/download/external', auth: 'api-key', pageCount: 2 }),
    ]);
  });

  it('⑥ -b deliverables 스코프 — 타 site 세션 404 ERR_NOT_FOUND', async () => {
    findById.mockResolvedValue(makeSession({ siteId: SITE_B }));
    const res = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${SESSION_ID}/deliverables`)
      .set('X-API-Key', KEY_A)
      .expect(404);
    expect(res.body.errorCode).toBe(ErrV1.ERR_NOT_FOUND);
  });

  it('⑥ -c synthesize — 201 봉투 {jobId, revision}', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${SESSION_ID}/synthesize`)
      .set('X-API-Key', KEY_A)
      .expect(201);
    expect(res.body.data).toEqual({ jobId: 'job-7', revision: 2 });
    expect(requestDuplexSplitResynthesis).toHaveBeenCalledWith(SESSION_ID, { siteId: SITE_A, env: 'live' });
  });

  it('⑥ -d synthesize 미완료 — 409 ERR_SESSION_NOT_COMPLETE', async () => {
    findById.mockResolvedValue(makeSession({ status: SessionStatus.EDITING }));
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${SESSION_ID}/synthesize`)
      .set('X-API-Key', KEY_A)
      .expect(409);
    expect(res.body.errorCode).toBe(ErrV1.ERR_SESSION_NOT_COMPLETE);
    expect(requestDuplexSplitResynthesis).not.toHaveBeenCalled();
  });

  it('⑥ -e 킬스위치 off — 503 ERR_SERVICE_UNAVAILABLE 봉투', async () => {
    process.env.PARTNER_SESSION_LAUNCH_ENABLED = 'off';
    try {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/sessions/${SESSION_ID}/deliverables`)
        .set('X-API-Key', KEY_A)
        .expect(503);
      expect(res.body.errorCode).toBe(ErrV1.ERR_SERVICE_UNAVAILABLE);
    } finally {
      delete process.env.PARTNER_SESSION_LAUNCH_ENABLED;
    }
  });
});
