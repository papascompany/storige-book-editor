/**
 * S2-5 (2026-07-16) — test env 잡 인프라: isTest 스탬프 + 웹훅 env 전파 계약.
 *
 * 잠그는 계약:
 *  1. 잡 생성 — partnerEnv==='test' 일 때만 options.isTest=true 스탬프.
 *     'live'/미전달(내부·게스트·레거시 sites 키)은 isTest **키 자체가 없음**
 *     (기존 잡 options 바이트 불변).
 *  2. 합성 큐 페이로드 — isTest 잡에만 isTest:true 등재(conditional spread).
 *     live 잡 페이로드 키 집합 불변(external-site-stamp spec "큐 페이로드 불변" 준용).
 *     검증(validate) 큐 페이로드는 env 무관 불변 — 워커 검증 프로세서에 isTest
 *     분기가 없다(더미 분기는 합성 전용, 로드맵 §6 Stage 2 작업 1).
 *  3. 잡 완료 웹훅 발신 — options.isTest 잡만 sendCallback context.env='test',
 *     그 외 env=undefined(live 폴백, webhook-v1-invariance.spec 바이트 불변 게이트).
 *  4. hasV2Config 게이트 — isTest 잡은 test env config 로 판정, 그 외 undefined
 *     (webhook.service 가 live 폴백 — 기존 SQL 동일).
 *
 * ⚠️ 발화 경로 부재(Stage 3 게이트): 현 잡 생성 external 라우트는 공용
 * ApiKeyGuard(sites 키=항상 live) 전용이라 v1 test 키로 인증 불가 — 본 계약은
 * 선행 인프라이며 실발화는 Stage 3(v1 books 잡 생성 표면)이다.
 *
 * 인스턴스 생성 패턴은 worker-jobs.external-site-stamp.spec.ts 선례.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType, TemplateType } from '@storige/types';

describe('WorkerJobsService — S2-5 test env 잡 인프라 (isTest 스탬프·웹훅 env 전파)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };
  let sitesService: { findOne: jest.Mock };

  const editorPdf = {
    id: 'file-1',
    filePath: '/app/storage/uploads/out.pdf',
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  };

  const session = {
    id: 'sess-1',
    metadata: {
      pages: [
        { sortOrder: 0, templateType: TemplateType.COVER },
        { sortOrder: 1, templateType: TemplateType.PAGE },
      ],
    },
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ ...session })),
      update: jest.fn(),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn(async () => ({ ...editorPdf })) };
    webhookService = {
      sendCallback: jest.fn(async () => true),
      hasV2Config: jest.fn(async () => false),
    };
    sitesService = { findOne: jest.fn(async () => ({})) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      editSessionRepository as any,
      validationQueue as any,
      { add: jest.fn() } as any, // conversionQueue
      synthesisQueue as any,
      filesService as any,
      webhookService as any,
      sitesService as any,
      {} as any, // templateSetsService
    );
  });

  // ──────────────────────────────────────────────────────────────
  // 계약 1·2 — createSynthesisJob
  // ──────────────────────────────────────────────────────────────
  describe('createSynthesisJob — isTest 스탬프', () => {
    const baseDto = {
      coverUrl: 'https://example.com/cover.pdf',
      contentUrl: 'https://example.com/content.pdf',
      spineWidth: 3,
    };

    it("partnerEnv='test' → options.isTest=true + 큐 페이로드 isTest=true", async () => {
      await service.createSynthesisJob({ ...baseDto, partnerEnv: 'test' } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.options.isTest).toBe(true);

      const queuePayload = synthesisQueue.add.mock.calls[0][1];
      expect(queuePayload.isTest).toBe(true);
    });

    it("partnerEnv='live' → isTest 키 자체가 없음 (options·큐 페이로드 불변)", async () => {
      await service.createSynthesisJob({ ...baseDto, partnerEnv: 'live' } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect('isTest' in created.options).toBe(false);

      const queuePayload = synthesisQueue.add.mock.calls[0][1];
      expect('isTest' in queuePayload).toBe(false);
    });

    it('partnerEnv 미전달(기존 호출자 전원) → isTest 키 없음 + 페이로드 키 집합 기존 동일', async () => {
      await service.createSynthesisJob({ ...baseDto } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect('isTest' in created.options).toBe(false);

      const queuePayload = synthesisQueue.add.mock.calls[0][1];
      expect(Object.keys(queuePayload).sort()).toEqual(
        [
          'jobId',
          'coverFileId',
          'contentFileId',
          'coverUrl',
          'contentUrl',
          'spineWidth',
          'orderId',
          'callbackUrl',
          'outputFormat',
          'bindingType',
        ].sort(),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 계약 1·2 — createSplitSynthesisJob
  // ──────────────────────────────────────────────────────────────
  describe('createSplitSynthesisJob — isTest 스탬프', () => {
    const baseDto = {
      sessionId: 'sess-1',
      pdfFileId: 'file-1',
      requestId: '11111111-1111-4111-8111-111111111111',
    };

    it("partnerEnv='test' → options.isTest=true + 큐 페이로드 isTest=true", async () => {
      await service.createSplitSynthesisJob({
        ...baseDto,
        partnerEnv: 'test',
      } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.options.isTest).toBe(true);
      // 기존 옵션 보존(스탬프는 additive)
      expect(created.options.mode).toBe('split');

      const queuePayload = synthesisQueue.add.mock.calls[0][1];
      expect(queuePayload.isTest).toBe(true);
      expect(queuePayload.mode).toBe('split');
    });

    it('partnerEnv 미전달 → isTest 키 없음(options·큐 페이로드 불변)', async () => {
      await service.createSplitSynthesisJob({ ...baseDto } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect('isTest' in created.options).toBe(false);

      const queuePayload = synthesisQueue.add.mock.calls[0][1];
      expect('isTest' in queuePayload).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 계약 1·2 — createValidationJob (options 만 스탬프, 큐 페이로드 불변)
  // ──────────────────────────────────────────────────────────────
  describe('createValidationJob — isTest 스탬프(options 한정)', () => {
    const baseDto = {
      fileUrl: 'https://example.com/in.pdf',
      fileType: 'content' as const,
      orderOptions: {},
    };

    it("partnerEnv='test' → options.isTest=true, 검증 큐 페이로드는 env 무관 불변", async () => {
      await service.createValidationJob({ ...baseDto, partnerEnv: 'test' } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.options.isTest).toBe(true);

      // 워커 검증 프로세서에 isTest 분기가 없다 — 큐 페이로드 등재 안 함(스코프 계약)
      const queuePayload = validationQueue.add.mock.calls[0][1];
      expect('isTest' in queuePayload).toBe(false);
    });

    it('partnerEnv 미전달 → options isTest 키 없음(기존 불변)', async () => {
      await service.createValidationJob({ ...baseDto } as any);

      const created = workerJobRepository.create.mock.calls[0][0];
      expect('isTest' in created.options).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 계약 3·4 — 잡 완료 웹훅 발신 env 전파 (updateJobStatus 경유)
  // ──────────────────────────────────────────────────────────────
  describe('updateJobStatus — 잡 완료 웹훅 발신 env 전파', () => {
    function mockJobRow(overrides: Record<string, unknown>) {
      return {
        id: 'job-1',
        jobType: WorkerJobType.SYNTHESIZE,
        status: WorkerJobStatus.PROCESSING,
        editSessionId: null,
        siteId: 'site-1',
        options: { callbackUrl: 'https://bookmoa.com/hook' },
        ...overrides,
      };
    }

    it("isTest 잡 → sendCallback context.env='test' (synthesis 콜백)", async () => {
      workerJobRepository.findOne.mockResolvedValue(
        mockJobRow({
          options: { callbackUrl: 'https://bookmoa.com/hook', isTest: true },
        }),
      );

      await service.updateJobStatus('job-1', {
        status: WorkerJobStatus.COMPLETED,
      } as any);

      expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
      const context = webhookService.sendCallback.mock.calls[0][2];
      expect(context).toEqual({ siteId: 'site-1', env: 'test' });
    });

    it('isTest 아닌 잡(기존 전원) → context.env=undefined (live 폴백 — 발신 바이트 불변)', async () => {
      workerJobRepository.findOne.mockResolvedValue(mockJobRow({}));

      await service.updateJobStatus('job-1', {
        status: WorkerJobStatus.COMPLETED,
      } as any);

      const context = webhookService.sendCallback.mock.calls[0][2];
      expect(context.siteId).toBe('site-1');
      expect(context.env).toBeUndefined();
    });

    it("validation 잡도 동일 — isTest 잡만 env='test'", async () => {
      workerJobRepository.findOne.mockResolvedValue(
        mockJobRow({
          jobType: WorkerJobType.VALIDATE,
          options: {
            callbackUrl: 'https://bookmoa.com/hook',
            fileType: 'content',
            isTest: true,
          },
        }),
      );

      await service.updateJobStatus('job-1', {
        status: WorkerJobStatus.COMPLETED,
      } as any);

      const context = webhookService.sendCallback.mock.calls[0][2];
      expect(context.env).toBe('test');
    });

    it("callbackUrl 없는 isTest 잡 — hasV2Config 게이트가 env='test' 로 판정", async () => {
      workerJobRepository.findOne.mockResolvedValue(
        mockJobRow({ options: { isTest: true } }),
      );

      await service.updateJobStatus('job-1', {
        status: WorkerJobStatus.COMPLETED,
      } as any);

      expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-1', 'test');
    });

    it('callbackUrl 없는 일반 잡 — hasV2Config 기존 단일 인자 호출 그대로(live 경로 불변)', async () => {
      workerJobRepository.findOne.mockResolvedValue(mockJobRow({ options: {} }));

      await service.updateJobStatus('job-1', {
        status: WorkerJobStatus.COMPLETED,
      } as any);

      // callback-gate.spec 과 동일 계약 — env 인자 없이 호출(기존 잡 완전 불변)
      expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-1');
    });
  });
});
