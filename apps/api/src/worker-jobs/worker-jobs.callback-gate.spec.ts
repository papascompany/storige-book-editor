/**
 * [Stage 2 P1-1] updateJobStatus 발신 게이트 정합화 — **caller 경유** 잠금.
 *
 * 적대 리뷰 P1-1: 종전 호출측 게이트가 `job.options?.callbackUrl &&` 선차단이라
 * sendSynthesisCallback/sendValidationCallback 내부의 v2(hasV2Config) 분기가
 * 도달 불가(죽은 코드)였다. 수정 후 게이트 = "callbackUrl 존재 OR v2 config 존재".
 *
 * 이 spec 은 사설 메서드가 아니라 updateJobStatus(공개 caller)를 경유해 잠근다:
 *  ① callbackUrl 없음 + v2 config 있음 → synthesis.completed / validation.* 발신
 *  ② callbackUrl 없음 + config 없음 → 발신 0 (기존과 동일 스킵)
 *  ③ callbackUrl 있음 → 발신 + hasV2Config 미호출 (기존 경로 그대로·추가 조회 0)
 *  ④ v2 비활성(WEBHOOK_CONFIG_ENC_KEY 미설정, 실물 체인) → DB 조회 0 + 발신 0
 *
 * 인스턴스 생성 패턴은 worker-jobs.session-transition.spec.ts 선례를 따른다.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WebhookService } from '../webhook/webhook.service';
import { WebhookDeliveryService } from '../webhook/v2/webhook-delivery.service';
import { WebhookConfigService } from '../webhook/v2/webhook-config.service';

describe('WorkerJobsService.updateJobStatus — P1-1 발신 게이트(caller 경유)', () => {
  let workerJobRepository: { findOne: jest.Mock; save: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    jobType: WorkerJobType.SYNTHESIZE,
    editSessionId: null, // 세션 없는 직접 발신 경로(파트너 v1 잡)
    siteId: 'site-a',
    options: {},
    result: null,
    status: WorkerJobStatus.PROCESSING,
    ...overrides,
  });

  const makeService = (job: Record<string, unknown>): WorkerJobsService => {
    workerJobRepository = {
      findOne: jest.fn(async () => job),
      save: jest.fn(async (entity: unknown) => entity),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    return new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      { add: jest.fn() } as never, // synthesisQueue
      {} as never, // filesService
      webhookService as never,
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
  };

  beforeEach(() => {
    webhookService = {
      sendCallback: jest.fn(async () => true),
      hasV2Config: jest.fn(async () => false),
    };
  });

  it('① SYNTHESIZE COMPLETED + callbackUrl 없음 + v2 config 있음 → synthesis.completed 발신', async () => {
    webhookService.hasV2Config.mockResolvedValue(true);
    const service = makeService(makeJob());

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.COMPLETED,
    });

    expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-a');
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    const [url, payload, context] = webhookService.sendCallback.mock.calls[0];
    expect(url).toBe(''); // callbackUrl 없음 — v2 경로(tryDispatchForSite) 전용 발신
    expect(payload.event).toBe('synthesis.completed');
    expect(payload.jobId).toBe('job-1');
    expect(context).toEqual({ siteId: 'site-a' });
  });

  it('① VALIDATE FIXABLE + callbackUrl 없음 + v2 config 있음 → validation.fixable 발신', async () => {
    webhookService.hasV2Config.mockResolvedValue(true);
    const service = makeService(
      makeJob({ jobType: WorkerJobType.VALIDATE, options: { fileType: 'content' } }),
    );

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.FIXABLE,
    });

    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    const [url, payload, context] = webhookService.sendCallback.mock.calls[0];
    expect(url).toBe('');
    expect(payload.event).toBe('validation.fixable');
    expect(payload.status).toBe('fixable');
    expect(context).toEqual({ siteId: 'site-a' });
  });

  it('② callbackUrl 없음 + v2 config 없음 → 발신 0 (기존 스킵 동작 보존)', async () => {
    webhookService.hasV2Config.mockResolvedValue(false);
    const service = makeService(makeJob());

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.COMPLETED,
    });

    expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-a');
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
  });

  it('③ callbackUrl 있음 → 발신 + hasV2Config 미호출 (기존 파트너 경로: 추가 조회 0)', async () => {
    const service = makeService(
      makeJob({ options: { callbackUrl: 'https://www.bookmoa.com/api/cb' } }),
    );

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.COMPLETED,
    });

    expect(webhookService.hasV2Config).not.toHaveBeenCalled(); // || 단락 잠금
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    expect(webhookService.sendCallback.mock.calls[0][0]).toBe(
      'https://www.bookmoa.com/api/cb',
    );
  });

  it('②-보강 상태 게이트: 종결 상태가 아니면(PROCESSING) v2 config 있어도 발신/조회 0', async () => {
    webhookService.hasV2Config.mockResolvedValue(true);
    const service = makeService(makeJob());

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.PROCESSING,
    });

    // 상태 조건이 && 앞이라 hasV2Config 평가 자체가 없다(불필요 조회 0)
    expect(webhookService.hasV2Config).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
  });

  it('④ v2 비활성(실물 WebhookService 체인) → config DB 조회 0 + 발신 0', async () => {
    const configRepo = { findOne: jest.fn() };
    const deliveryRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
    const v2Config = { enabled: false, encKey: null };
    const configService = new WebhookConfigService(
      configRepo as never,
      v2Config,
      undefined,
    );
    const deliveryService = new WebhookDeliveryService(
      deliveryRepo as never,
      configRepo as never,
      configService,
      v2Config,
      undefined,
    );
    const realWebhookService = new WebhookService(undefined, deliveryService);
    const sendCallbackSpy = jest.spyOn(realWebhookService, 'sendCallback');

    webhookService = realWebhookService as never;
    const service = makeService(makeJob());

    await service.updateJobStatus('job-1', {
      status: WorkerJobStatus.COMPLETED,
    });

    expect(configRepo.findOne).not.toHaveBeenCalled(); // v2 비활성 — DB 조회 0
    expect(deliveryRepo.findOne).not.toHaveBeenCalled();
    expect(sendCallbackSpy).not.toHaveBeenCalled(); // 기존과 동일 스킵
  });
});

// ── [Stage 3 W3, #4] finalization 역참조 분기 (updateJobStatus additive) ──
describe('WorkerJobsService.updateJobStatus — finalization 콜백(#4) 분기', () => {
  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'vjob-1',
    jobType: WorkerJobType.VALIDATE,
    editSessionId: null,
    siteId: 'site-a',
    options: {},
    result: null,
    status: WorkerJobStatus.PROCESSING,
    ...overrides,
  });

  const build = (
    job: Record<string, unknown>,
    finService?: { onWorkerJobSettled: jest.Mock },
  ) => {
    const repo = { findOne: jest.fn(async () => job), save: jest.fn(async (e: unknown) => e) };
    const webhook = { sendCallback: jest.fn(async () => true), hasV2Config: jest.fn(async () => true) };
    const svc = new WorkerJobsService(
      repo as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      {} as never,
      webhook as never,
      {} as never,
      {} as never,
      finService as never, // 10번째 @Optional — 미주입(undefined)도 검증
    );
    return { svc, webhook };
  };

  it('finalizationId 마커 잡 COMPLETED → onWorkerJobSettled 호출 + 중간 validation.* 억제', async () => {
    const finService = { onWorkerJobSettled: jest.fn(async () => undefined) };
    const { svc, webhook } = build(
      makeJob({ options: { finalizationId: 'fin-1', fileType: 'content' } }),
      finService,
    );
    await svc.updateJobStatus('vjob-1', { status: WorkerJobStatus.COMPLETED });
    expect(finService.onWorkerJobSettled).toHaveBeenCalledTimes(1);
    // 내부 오케스트레이션 잡 — 중간 validation.* 웹훅 억제(book.finalization.* 만 발신)
    expect(webhook.sendCallback).not.toHaveBeenCalled();
    expect(webhook.hasV2Config).not.toHaveBeenCalled();
  });

  it('마커 없는 기존 잡 → onWorkerJobSettled 미호출(서비스 주입돼도) + 기존 발신 경로 유지', async () => {
    const finService = { onWorkerJobSettled: jest.fn(async () => undefined) };
    const { svc, webhook } = build(
      makeJob({ jobType: WorkerJobType.SYNTHESIZE, options: {} }),
      finService,
    );
    await svc.updateJobStatus('vjob-1', { status: WorkerJobStatus.COMPLETED });
    expect(finService.onWorkerJobSettled).not.toHaveBeenCalled();
    expect(webhook.sendCallback).toHaveBeenCalledTimes(1); // 기존 synthesis 발신 그대로
  });

  it('서비스 미주입(기존 9-인자 유닛)이면 마커 잡이어도 no-op(크래시 없음)', async () => {
    const { svc } = build(makeJob({ options: { finalizationId: 'fin-1' } }), undefined);
    await expect(
      svc.updateJobStatus('vjob-1', { status: WorkerJobStatus.COMPLETED }),
    ).resolves.toBeDefined();
  });
});
