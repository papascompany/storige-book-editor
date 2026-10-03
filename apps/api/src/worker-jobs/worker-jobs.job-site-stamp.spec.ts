/**
 * 잡 사이트 기록(validate·render-pages)과 사이트 웹훅 마커 — WorkerJobsService.
 *
 *  - createValidationJob + {skipSiteWorkerDefaults, siteWebhookOff}: job.siteId = 입력 사이트,
 *    orderOptions 는 요청 그대로(사이트 기본값 미병합), job.options.siteWebhook=false. 큐 페이로드는 같다.
 *  - createRenderPagesJob: 잡 사이트 = fileId 원본 파일 사이트(파일 사이트 NULL → NULL), fileUrl 입력은 NULL.
 *    본문 siteId 는 쓰지 않는다(값 미기록 경고).
 *  - updateJobStatus: siteWebhook=false 잡은 사이트 웹훅 설정(v2) 판정·발신 컨텍스트에 사이트를 넘기지 않는다.
 *    callbackUrl 이 있으면 그 URL 로 발신한다. 마커 없는 잡은 job.siteId 그대로.
 *  - 편집기 폴링: validate(shop) 잡은 같은 토큰으로 조회되고, 다른 사이트 파일의 render-pages 잡은 다른 사이트 토큰에 404.
 */
import { HttpException, Logger } from '@nestjs/common';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService, isSiteWebhookOff } from './worker-jobs.service';
import { WorkerJobsController } from './worker-jobs.controller';
import { getTenantScope } from '../common/helpers/tenant-scope.helper';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import type { ConfigService } from '@nestjs/config';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FILE_A = 'f0000000-0000-4000-8000-00000000000a';
const FILE_B = 'f0000000-0000-4000-8000-00000000000b';
const FILE_NULL = 'f0000000-0000-4000-8000-0000000000ff';

describe('잡 사이트 기록 · 사이트 웹훅 마커', () => {
  let service: WorkerJobsService;
  let saved: Record<string, Record<string, unknown>>;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let sitesService: { findOne: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };
  let warnSpy: jest.SpyInstance;

  const orderOptions = { size: { width: 210, height: 297 }, pages: 4, binding: 'perfect', bleed: 3 };

  beforeEach(() => {
    saved = {};
    let seq = 0;
    workerJobRepository = {
      create: jest.fn((x: Record<string, unknown>) => ({ ...x })),
      save: jest.fn(async (x: Record<string, unknown>) => {
        const id = (x.id as string | undefined) ?? `job-${++seq}`;
        const row = { ...x, id };
        saved[id] = row;
        return row;
      }),
      findOne: jest.fn(async (opts: { where: { id: string } }) => saved[opts.where.id] ?? null),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    conversionQueue = { add: jest.fn(async () => ({})) };
    const files: Record<string, { id: string; siteId: string | null; filePath: string; storageBackend: 'local' | 's3' }> = {
      [FILE_A]: { id: FILE_A, siteId: SITE_A, filePath: '/app/storage/a.pdf', storageBackend: 'local' },
      [FILE_B]: { id: FILE_B, siteId: SITE_B, filePath: '/app/storage/b.pdf', storageBackend: 's3' },
      [FILE_NULL]: { id: FILE_NULL, siteId: null, filePath: '/app/storage/n.pdf', storageBackend: 'local' },
    };
    filesService = { findById: jest.fn(async (id: string) => files[id]) };
    sitesService = {
      findOne: jest.fn(async () => ({
        pdfConversionEnabled: true,
        defaultUnit: 'mm',
        checkWorkorder: true,
        checkCutting: true,
        checkSafezone: true,
      })),
    };
    webhookService = {
      sendCallback: jest.fn(async () => true),
      hasV2Config: jest.fn(async (siteId?: string | null) => !!siteId),
    };
    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      validationQueue as never,
      conversionQueue as never,
      { add: jest.fn() } as never,
      filesService as never,
      webhookService as never,
      sitesService as never,
      {} as never,
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  });

  // ── createValidationJob ───────────────────────────────────────────────
  it('createValidationJob + {skipSiteWorkerDefaults, siteWebhookOff} → 입력 사이트 기록, 검증 옵션 요청 그대로, options.siteWebhook=false, 큐 페이로드에 마커 없음', async () => {
    const job = await service.createValidationJob(
      { fileId: FILE_A, fileType: 'content', orderOptions: { ...orderOptions }, siteId: SITE_A } as never,
      { skipSiteWorkerDefaults: true, siteWebhookOff: true },
    );
    expect(job.siteId).toBe(SITE_A);
    expect(job.options).toEqual({
      fileType: 'content',
      orderOptions,
      callbackUrl: undefined,
      siteWebhook: false,
    });
    expect(sitesService.findOne).not.toHaveBeenCalled();
    const payload = validationQueue.add.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['fileId', 'fileType', 'fileUrl', 'jobId', 'orderOptions']);
    expect(payload.orderOptions).toEqual(orderOptions);
  });

  it('createValidationJob internal 없음 → options 에 siteWebhook 키 없음', async () => {
    const job = await service.createValidationJob({ fileId: FILE_A, fileType: 'content', orderOptions } as never);
    expect(job.options).not.toHaveProperty('siteWebhook');
    expect(job.siteId).toBeNull();
  });

  // ── createRenderPagesJob ──────────────────────────────────────────────
  it('createRenderPagesJob(fileId) → 파일 사이트 / 파일 사이트 NULL → NULL / fileUrl → NULL(findById 0회)', async () => {
    const a = await service.createRenderPagesJob({ fileId: FILE_A } as never);
    const n = await service.createRenderPagesJob({ fileId: FILE_NULL } as never);
    expect([a.siteId, n.siteId]).toEqual([SITE_A, null]);
    filesService.findById.mockClear();
    const u = await service.createRenderPagesJob({ fileUrl: '/app/storage/x.pdf' } as never);
    expect(u.siteId).toBeNull();
    expect(filesService.findById).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('createRenderPagesJob 본문 siteId 는 쓰지 않고 경고 1줄(caller=none, 값 미기록), 큐 페이로드 키 집합은 같다', async () => {
    const j1 = await service.createRenderPagesJob({ fileId: FILE_A, siteId: SITE_B } as never);
    const j2 = await service.createRenderPagesJob({ fileUrl: '/app/storage/x.pdf', siteId: SITE_B } as never);
    const j3 = await service.createRenderPagesJob({ fileId: FILE_A, siteId: SITE_A } as never);
    expect([j1.siteId, j2.siteId, j3.siteId]).toEqual([SITE_A, null, SITE_A]);
    const warnings = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnings).toEqual([
      '[job-site] body-site-ignored route=render-pages caller=none',
      '[job-site] body-site-ignored route=render-pages caller=none',
    ]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(SITE_B);
    for (const call of conversionQueue.add.mock.calls) {
      expect(call[0]).toBe('render-pdf-pages');
      expect(Object.keys(call[1]).sort()).toEqual(['fileUrl', 'jobId', 'pageCount', 'sourceFileId']);
    }
  });

  // ── updateJobStatus 발신 ──────────────────────────────────────────────
  const validateJob = (options: Record<string, unknown>): Record<string, unknown> => ({
    id: 'job-v',
    jobType: WorkerJobType.VALIDATE,
    editSessionId: null,
    siteId: 'site-a',
    options: { fileType: 'content', ...options },
    result: null,
    status: WorkerJobStatus.PROCESSING,
  });

  it('updateJobStatus: siteWebhook=false VALIDATE 잡 + callbackUrl 없음 + 사이트 v2 설정 → 발신 없음', async () => {
    saved['job-v'] = validateJob({ siteWebhook: false });
    await service.updateJobStatus('job-v', { status: WorkerJobStatus.COMPLETED } as never);
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(webhookService.hasV2Config).not.toHaveBeenCalledWith('site-a');
  });

  it('updateJobStatus: siteWebhook=false VALIDATE 잡 + callbackUrl → callbackUrl 로 발신, 컨텍스트 siteId null', async () => {
    saved['job-v'] = validateJob({ siteWebhook: false, callbackUrl: 'https://partner.example.com/cb' });
    await service.updateJobStatus('job-v', { status: WorkerJobStatus.FIXABLE } as never);
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    const [url, payload, context] = webhookService.sendCallback.mock.calls[0];
    expect(url).toBe('https://partner.example.com/cb');
    expect(payload.event).toBe('validation.fixable');
    expect(context).toEqual({ siteId: null, env: undefined });
  });

  it("마커 없는 VALIDATE 잡 → hasV2Config('site-a') 호출, 발신 컨텍스트 siteId 'site-a'", async () => {
    saved['job-v'] = validateJob({});
    await service.updateJobStatus('job-v', { status: WorkerJobStatus.COMPLETED } as never);
    expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-a');
    expect(webhookService.sendCallback.mock.calls[0][2]).toEqual({ siteId: 'site-a' });
  });

  it.each<[unknown, boolean]>([
    [{ options: { siteWebhook: false } }, true],
    [{ options: { siteWebhook: true } }, false],
    [{ options: {} }, false],
    [{ options: null }, false],
    [{}, false],
    [null, false],
  ])('isSiteWebhookOff(%j) → %s', (job, expected) => {
    expect(isSiteWebhookOff(job as never)).toBe(expected);
  });

  // ── 편집기 폴링(GET /worker-jobs/:id) ─────────────────────────────────
  describe('편집기 폴링', () => {
    const shopUser = (siteId: string): Record<string, unknown> => ({
      userId: '123',
      role: 'customer',
      source: 'shop',
      siteId,
    });
    const shopSite = (siteId: string): CurrentSitePayload =>
      ({ siteId, siteName: 'site', role: 'customer', apiKey: undefined }) as unknown as CurrentSitePayload;
    let controller: WorkerJobsController;

    beforeEach(() => {
      controller = new WorkerJobsController(service, { get: jest.fn() } as unknown as ConfigService);
      jest.spyOn((controller as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
    });

    it('validate(shop) 잡은 같은 토큰으로 조회된다', async () => {
      const created = await controller.createValidationJob(
        { fileId: FILE_A, fileType: 'content', orderOptions } as never,
        shopUser(SITE_A),
      );
      expect(created.siteId).toBe(SITE_A);
      const polled = await controller.findOne(getTenantScope(shopUser(SITE_A)), created.id, shopSite(SITE_A));
      expect(polled.id).toBe(created.id);
    });

    it('다른 사이트 파일의 render-pages 잡은 다른 사이트 토큰 조회에 404', async () => {
      const created = await controller.createRenderPages({ fileId: FILE_B } as never);
      expect(created.siteId).toBe(SITE_B);
      let status = 0;
      try {
        await controller.findOne(getTenantScope(shopUser(SITE_A)), created.id, shopSite(SITE_A));
      } catch (e) {
        status = (e as HttpException).getStatus();
      }
      expect(status).toBe(404);
    });
  });
});
