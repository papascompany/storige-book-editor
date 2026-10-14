/**
 * 워커 잡 컨트롤러 HTTP spec — 실물 WorkerJobsController 를 전역 접두사·ValidationPipe(main.ts 와 같은 옵션)와
 * 함께 supertest 로 띄워, 가드·파이프·직렬화를 거친 실제 응답을 고정한다.
 *
 * 고정 대상:
 *  - 잡 상태 보고 두 경로(PATCH external/:id/status · :id/status): 내부 워커 키만 처리한다.
 *    그 밖의 키는 잡이 없을 때와 같은 404, 키 없음·미등록 키는 401, DTO 위반은 400.
 *  - GET external/:id 응답 형태: PARTNER_JOB_VIEW 플래그가 켜지면 정해진 키만 싣고, 꺼지면 엔티티 형태다.
 *    플래그는 요청마다 읽는다(같은 앱에서 값을 바꾸면 다음 요청부터 반영).
 *  - POST validate/external 의 플래그 ON 응답 형태 1건.
 *
 * WorkerJobsService 는 mock 이다. 단 없는 잡 404 는 실물 updateJobStatus 를 빈 저장소에 묶어 만든다.
 * SitesService 는 stub 이므로 사이트 상태(active) 필터는 이 spec 범위 밖이다(그 필터는 SitesService 쿼리 안에 있다).
 */
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SitesService } from '../sites/sites.service';
import { PARTNER_JOB_VIEW_KEYS } from './partner-job-view';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_DEFAULT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SITE_KEY = 'spec-site-key-a';
const PARTNER_WORKER_CODE = 'spec-site-a-worker-code';
const INTERNAL_WORKER_KEY = 'spec-internal-worker-key';
const JOB_ID = 'job-1';

type ServiceMock = {
  findOne: jest.Mock;
  updateJobStatus: jest.Mock;
  createValidationJob: jest.Mock;
  assertEditSessionLink: jest.Mock;
  observeJobInputFileSites: jest.Mock;
};

describe('WorkerJobsController (HTTP)', () => {
  let app: INestApplication;
  const flags: Record<string, string | undefined> = {};
  const jobs = new Map<string, Record<string, unknown>>();
  const ORIGINAL_WORKER_KEY = process.env.WORKER_API_KEY;

  const seedJob = (over: Record<string, unknown> = {}): Record<string, unknown> => {
    const job: Record<string, unknown> = {
      id: JOB_ID,
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PROCESSING,
      siteId: SITE_A,
      fileId: 'file-1',
      inputFileUrl: 'api://file-1',
      editSessionId: null,
      sessionId: null,
      outputFileId: null,
      outputFileUrl: null,
      errorCode: null,
      errorMessage: null,
      errorDetail: { stage: 'synthesis', jobData: { url: 'x' } },
      options: { siteWebhook: false, callbackUrl: 'https://partner.example/hook' },
      result: null,
      createdAt: '2026-10-13T00:00:00.000Z',
      completedAt: null,
      ...over,
    };
    jobs.clear();
    jobs.set(JOB_ID, job);
    return job;
  };

  // 없는 잡 404 는 실물 서비스 코드가 만든다 — 저장소가 null 을 돌려주면 다른 의존 없이 NotFoundException 을 던진다.
  const missingJobHost = { workerJobRepository: { findOne: async (): Promise<null> => null } };
  const realUpdateJobStatus = WorkerJobsService.prototype.updateJobStatus.bind(
    missingJobHost as unknown as WorkerJobsService,
  );

  const svc: ServiceMock = {
    findOne: jest.fn(async (id: string) => {
      const j = jobs.get(id);
      if (!j) throw new NotFoundException(`Worker job with ID ${id} not found`);
      return j;
    }),
    updateJobStatus: jest.fn(async (id: string, dto: Record<string, unknown>, site: unknown) => {
      const j = jobs.get(id);
      return j ? { ...j, ...dto } : realUpdateJobStatus(id, dto as never, site as never);
    }),
    createValidationJob: jest.fn(async (dto: Record<string, unknown>) => ({
      ...seedJob({ jobType: WorkerJobType.VALIDATE, status: WorkerJobStatus.PENDING }),
      siteId: dto.siteId ?? null,
    })),
    assertEditSessionLink: jest.fn(async () => undefined),
    observeJobInputFileSites: jest.fn(async () => undefined),
  };

  const sites = {
    findByEditorAuthCode: jest.fn(async (k: string) =>
      k === SITE_KEY
        ? { id: SITE_A, name: 'A' }
        : k === INTERNAL_WORKER_KEY
          ? { id: SITE_DEFAULT, name: 'Default' }
          : null,
    ),
    findByWorkerAuthCode: jest.fn(async (k: string) =>
      k === PARTNER_WORKER_CODE ? { id: SITE_A, name: 'A' } : null,
    ),
  };

  beforeAll(async () => {
    process.env.WORKER_API_KEY = INTERNAL_WORKER_KEY;

    const moduleRef = await Test.createTestingModule({
      // 형제 라우트(compose-mixed·cutout)의 OptionalShopJwtGuard 가 JwtService 를 쓴다.
      imports: [JwtModule.register({ secret: 'spec-only-secret' })],
      controllers: [WorkerJobsController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: { get: (k: string) => flags[k] } },
        { provide: WorkerJobsService, useValue: svc },
        { provide: SitesService, useValue: sites },
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
    if (ORIGINAL_WORKER_KEY === undefined) delete process.env.WORKER_API_KEY;
    else process.env.WORKER_API_KEY = ORIGINAL_WORKER_KEY;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(flags)) delete flags[k];
    seedJob();
  });

  const patch = (path: string, key?: string) => {
    const r = request(app.getHttpServer()).patch(`/api/worker-jobs/${path}`);
    return key ? r.set('X-API-Key', key) : r;
  };
  const get = (path: string, key?: string) => {
    const r = request(app.getHttpServer()).get(`/api/worker-jobs/${path}`);
    return key ? r.set('X-API-Key', key) : r;
  };
  const post = (path: string, key?: string) => {
    const r = request(app.getHttpServer()).post(`/api/worker-jobs/${path}`);
    return key ? r.set('X-API-Key', key) : r;
  };

  const ROUTES = [
    ['external/:id/status', (id: string) => `external/${id}/status`],
    [':id/status', (id: string) => `${id}/status`],
  ] as const;
  const OK_BODY = { status: WorkerJobStatus.COMPLETED, outputFileUrl: '/storage/outputs/job-1/a.pdf' };
  const SORTED_VIEW_KEYS = [...PARTNER_JOB_VIEW_KEYS].sort();

  describe('PATCH 잡 상태 보고 — 두 경로 공통', () => {
    it.each(ROUTES)('%s: 사이트 키 + 있는 잡 → 없는 잡과 같은 404, 서비스 미호출', async (_name, url) => {
      const denied = await patch(url(JOB_ID), SITE_KEY).send(OK_BODY).expect(404);
      expect(svc.updateJobStatus).not.toHaveBeenCalled();

      jobs.delete(JOB_ID);
      const missing = await patch(url(JOB_ID), INTERNAL_WORKER_KEY).send(OK_BODY).expect(404);

      expect(denied.body).toEqual(missing.body);
      expect(denied.body).toEqual({
        statusCode: 404,
        message: `Worker job with ID ${JOB_ID} not found`,
        error: 'Not Found',
      });
    });

    it.each(ROUTES)('%s: 파트너 worker 코드(editor 역할) + 있는 잡 → 404, 서비스 미호출', async (_name, url) => {
      await patch(url(JOB_ID), PARTNER_WORKER_CODE).send(OK_BODY).expect(404);
      expect(svc.updateJobStatus).not.toHaveBeenCalled();
      expect(sites.findByEditorAuthCode).toHaveBeenCalledWith(PARTNER_WORKER_CODE);
      expect(sites.findByWorkerAuthCode).toHaveBeenCalledWith(PARTNER_WORKER_CODE);
      expect(sites.findByEditorAuthCode.mock.invocationCallOrder[0]).toBeLessThan(
        sites.findByWorkerAuthCode.mock.invocationCallOrder[0],
      );
    });

    it.each(ROUTES)('%s: 내부 워커 키 + 있는 잡 → 200', async (_name, url) => {
      const res = await patch(url(JOB_ID), INTERNAL_WORKER_KEY).send(OK_BODY).expect(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(svc.updateJobStatus).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining(OK_BODY),
        expect.objectContaining({ siteId: SITE_DEFAULT, role: 'worker' }),
      );
    });

    it.each(ROUTES)('%s: 키 없음·미등록 키 → 401, 서비스 미호출', async (_name, url) => {
      const none = await patch(url(JOB_ID)).send(OK_BODY).expect(401);
      expect(none.body.message).toBe('API Key is required');

      const unknown = await patch(url(JOB_ID), 'spec-unknown-key').send(OK_BODY).expect(401);
      expect(unknown.body.message).toBe('Invalid API Key');

      expect(svc.updateJobStatus).not.toHaveBeenCalled();
    });

    it.each(ROUTES)('%s: 내부 워커 키 + DTO 위반 → 400, 서비스 미호출', async (_name, url) => {
      const badType = await patch(url(JOB_ID), INTERNAL_WORKER_KEY).send({ status: 123 }).expect(400);
      expect(badType.body.message).toEqual(expect.arrayContaining(['status must be a string']));

      const extra = await patch(url(JOB_ID), INTERNAL_WORKER_KEY)
        .send({ status: 'COMPLETED', unknownField: 'x' })
        .expect(400);
      expect(extra.body.message).toEqual(
        expect.arrayContaining(['property unknownField should not exist']),
      );

      expect(svc.updateJobStatus).not.toHaveBeenCalled();
    });
  });

  describe('GET external/:id — 응답 형태 플래그', () => {
    it.each([[undefined], ['false']])('PARTNER_JOB_VIEW=%p → 엔티티 형태', async (value: string | undefined) => {
      if (value !== undefined) flags.PARTNER_JOB_VIEW = value;

      const res = await get(`external/${JOB_ID}`, SITE_KEY).expect(200);
      expect(res.body).toEqual(JSON.parse(JSON.stringify(jobs.get(JOB_ID))));
      expect(res.body).toHaveProperty('siteId', SITE_A);
      expect(res.body).toHaveProperty('inputFileUrl');
      expect(svc.findOne).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({ siteId: SITE_A, role: 'editor' }),
      );
    });

    it.each([['true'], [' TRUE '], ['1']])('PARTNER_JOB_VIEW=%p → 정해진 키만', async (value: string) => {
      flags.PARTNER_JOB_VIEW = value;

      const res = await get(`external/${JOB_ID}`, SITE_KEY).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(SORTED_VIEW_KEYS);
      expect(res.body).not.toHaveProperty('siteId');
      expect(res.body).not.toHaveProperty('fileId');
      expect(res.body).not.toHaveProperty('inputFileUrl');
    });

    it('같은 앱에서 플래그를 바꾸면 다음 요청부터 반영된다', async () => {
      const off1 = await get(`external/${JOB_ID}`, SITE_KEY).expect(200);
      expect(off1.body).toHaveProperty('siteId', SITE_A);

      flags.PARTNER_JOB_VIEW = 'true';
      const on = await get(`external/${JOB_ID}`, SITE_KEY).expect(200);
      expect(Object.keys(on.body).sort()).toEqual(SORTED_VIEW_KEYS);

      delete flags.PARTNER_JOB_VIEW;
      const off2 = await get(`external/${JOB_ID}`, SITE_KEY).expect(200);
      expect(off2.body).toHaveProperty('siteId', SITE_A);
    });

    it('키 없음 → 401, 서비스 미호출', async () => {
      await get(`external/${JOB_ID}`).expect(401);
      expect(svc.findOne).not.toHaveBeenCalled();
    });
  });

  describe('POST validate/external — 플래그 ON 응답 형태', () => {
    it('사이트 키 → 201, 정해진 키만', async () => {
      flags.PARTNER_JOB_VIEW = 'true';

      const res = await post('validate/external', SITE_KEY)
        .send({
          fileUrl: 'https://example.com/a.pdf',
          fileType: 'cover',
          orderOptions: { size: { width: 210, height: 297 }, pages: 4, binding: 'perfect', bleed: 3 },
        })
        .expect(201);

      expect(Object.keys(res.body).sort()).toEqual(SORTED_VIEW_KEYS);
      expect(res.body.jobType).toBe('VALIDATE');
      expect(svc.createValidationJob).toHaveBeenCalledWith(expect.objectContaining({ siteId: SITE_A }));
      expect(svc.observeJobInputFileSites).toHaveBeenCalledTimes(1);
      expect(svc.assertEditSessionLink).not.toHaveBeenCalled();
    });
  });
});
