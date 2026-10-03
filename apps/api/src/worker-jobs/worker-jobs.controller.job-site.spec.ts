/**
 * POST /worker-jobs/validate(JWT) — 잡 사이트는 서버가 정한다.
 *
 *  - shop-session(토큰 사이트 있음): 잡 사이트 = 토큰 사이트. 검증 옵션은 요청 그대로(사이트 기본값 미병합),
 *    완료 발신에 사이트 웹훅 설정(v2)을 쓰지 않는다 → createValidationJob(dto, {skipSiteWorkerDefaults, siteWebhookOff}).
 *  - staff·그 밖의 JWT·사이트 없는 shop: 잡 사이트 NULL(본문 siteId 미사용, 두 번째 인자 없음).
 *  - 본문 siteId 가 잡 사이트와 다르면 `[job-site] body-site-ignored route=validate caller=…` 경고 1줄(값 미기록).
 *  - 운영자 토큰: 권한 사이트(종전과 같음).
 */
import { Logger } from '@nestjs/common';
import { WorkerJobsController } from './worker-jobs.controller';
import type { WorkerJobsService } from './worker-jobs.service';
import type { ConfigService } from '@nestjs/config';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FILE_ID = 'f0000000-0000-4000-8000-00000000000a';

describe('WorkerJobsController.createValidationJob — 잡 사이트 결정', () => {
  let service: {
    createValidationJob: jest.Mock;
    assertEditSessionLink: jest.Mock;
    observeJobInputFileSites: jest.Mock;
  };
  let controller: WorkerJobsController;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    fileId: FILE_ID,
    fileType: 'content',
    orderOptions: { size: { width: 210, height: 297 }, pages: 4, binding: 'perfect', bleed: 3 },
    ...extra,
  });
  const siteWarnings = (): string[] =>
    warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('[job-site]'));

  beforeEach(() => {
    service = {
      createValidationJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      assertEditSessionLink: jest.fn().mockResolvedValue(undefined),
      observeJobInputFileSites: jest.fn().mockResolvedValue(undefined),
    };
    controller = new WorkerJobsController(
      service as unknown as WorkerJobsService,
      { get: jest.fn() } as unknown as ConfigService,
    );
    const logger = (controller as unknown as { logger: Logger }).logger;
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  });

  it('validate(shop-session) → createValidationJob({...본문, siteId: 토큰 사이트}, {skipSiteWorkerDefaults, siteWebhookOff})', async () => {
    const dto = body();
    await controller.createValidationJob(dto as never, { source: 'shop', siteId: SITE_A, userId: '123' });
    expect(service.createValidationJob).toHaveBeenCalledWith(
      { ...dto, siteId: SITE_A },
      { skipSiteWorkerDefaults: true, siteWebhookOff: true },
    );
    expect(siteWarnings()).toEqual([]);
  });

  it('validate(shop-session) + 본문 다른 siteId → 토큰 사이트로 결정, 경고 1줄(사이트 값 미기록)', async () => {
    await controller.createValidationJob(body({ siteId: SITE_OTHER }) as never, { source: 'shop', siteId: SITE_A });
    expect(service.createValidationJob.mock.calls[0][0].siteId).toBe(SITE_A);
    expect(siteWarnings()).toEqual(['[job-site] body-site-ignored route=validate caller=shop']);
  });

  it('validate(shop-session) + 본문 siteId == 토큰 사이트 → 경고 없음', async () => {
    await controller.createValidationJob(body({ siteId: SITE_A }) as never, { source: 'shop', siteId: SITE_A });
    expect(service.createValidationJob.mock.calls[0][0].siteId).toBe(SITE_A);
    expect(siteWarnings()).toEqual([]);
  });

  it.each<[string, Record<string, unknown> | undefined, string]>([
    ['staff(ADMIN)', { role: 'ADMIN' }, 'staff'],
    ['staff(super_admin)', { role: 'super_admin' }, 'staff'],
    ['그 밖의 JWT(customer)', { role: 'customer' }, 'none'],
    ['인증 컨텍스트 없음', undefined, 'none'],
    ['사이트 없는 shop', { source: 'shop', userId: '123' }, 'shop'],
  ])('validate(%s) + 본문 siteId → siteId 없이 생성(두 번째 인자 없음), 경고 caller=%s', async (_l, user, kind) => {
    await controller.createValidationJob(body({ siteId: SITE_OTHER }) as never, user as never);
    const call = service.createValidationJob.mock.calls[0] as unknown[];
    expect(call).toHaveLength(1);
    expect((call[0] as { siteId?: string }).siteId).toBeUndefined();
    expect(siteWarnings()).toEqual([`[job-site] body-site-ignored route=validate caller=${kind}`]);
  });

  it('validate 본문 siteId 없음 → 경고 없음', async () => {
    await controller.createValidationJob(body() as never, { role: 'ADMIN' });
    await controller.createValidationJob(body() as never, undefined);
    expect(siteWarnings()).toEqual([]);
    expect(service.createValidationJob.mock.calls.map((c: unknown[]) => c.length)).toEqual([1, 1]);
  });

  it('validate(운영자) → 권한 사이트, 두 번째 인자 없음', async () => {
    await controller.createValidationJob(body({ siteId: SITE_OTHER }) as never, {
      source: 'partner_operator',
      siteId: SITE_A,
      partnerOperator: { siteId: SITE_A, sessionIds: [] },
    });
    const call = service.createValidationJob.mock.calls[0] as unknown[];
    expect(call).toHaveLength(1);
    expect((call[0] as { siteId?: string }).siteId).toBe(SITE_A);
    expect(siteWarnings()).toEqual([]);
  });

  it('로그 전체에 본문 siteId 값이 나타나지 않는다', async () => {
    await controller.createValidationJob(body({ siteId: SITE_OTHER }) as never, { source: 'shop', siteId: SITE_A });
    await controller.createValidationJob(body({ siteId: SITE_OTHER }) as never, { role: 'ADMIN' });
    const text = JSON.stringify([...warnSpy.mock.calls, ...logSpy.mock.calls]);
    expect(text).not.toContain(SITE_OTHER);
  });
});
