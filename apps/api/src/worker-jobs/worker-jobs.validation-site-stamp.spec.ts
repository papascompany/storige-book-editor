/**
 * D6 선행조건 ② — 편집 세션 완료 검증 잡(VALIDATE) 테넌트 스탬프.
 *
 * 잠그는 계약(createValidationJob 의 internal 옵션):
 *  - internal.skipSiteWorkerDefaults=true: dto.siteId 는 job.siteId 스탬프에만 쓰이고
 *    site default 머지(mergeSiteWorkerDefaults)는 일어나지 않는다 — 잡에 저장되는/큐로
 *    가는 orderOptions 가 입력과 동일(검증 동작 불변, sitesService 조회 0).
 *  - internal 미전달(컨트롤러/validate-external/finalization 경로): 기존대로 dto.siteId 로
 *    site default 를 머지하고 스탬프한다(회귀 잠금).
 *  - siteId 부재 + skip: 스탬프 NULL(종전 세션 검증 잡과 동일).
 *
 * 인스턴스 생성 패턴은 worker-jobs.bleed-fix.spec.ts / worker-jobs.spine-inject.spec.ts 선례를 따른다.
 */
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService.createValidationJob — 세션 검증 잡 site 스탬프(머지 없음)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let sitesService: { findOne: jest.Mock };

  // site default 가 모두 설정된 사이트 — 머지가 일어나면 아래 5개 키가 orderOptions 에 생긴다.
  const siteWithDefaults = {
    id: 'site-A',
    pdfConversionEnabled: true,
    defaultUnit: 'mm',
    checkWorkorder: true,
    checkCutting: true,
    checkSafezone: true,
  };

  const inputOrderOptions = () => ({
    size: { width: 148, height: 210 },
    pages: 32,
    binding: 'perfect',
    bleed: 3,
  });

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-v', ...x })),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    filesService = {
      findById: jest.fn(async (id: string) => ({
        id,
        filePath: `/app/storage/uploads/${id}.pdf`,
        storageBackend: 'local',
      })),
    };
    sitesService = { findOne: jest.fn(async () => ({ ...siteWithDefaults })) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      {} as any, // editSessionRepository
      validationQueue as any,
      { add: jest.fn() } as any, // conversionQueue
      { add: jest.fn() } as any, // synthesisQueue
      filesService as any,
      {} as any, // webhookService
      sitesService as any,
      {} as any, // templateSetsService
      undefined, // bookFinalizationsService (@Optional)
      undefined, // spineService (@Optional) — spine 재계산 비개입
    );
  });

  const savedJob = () => workerJobRepository.create.mock.calls.at(-1)?.[0];
  const queuePayload = () => validationQueue.add.mock.calls.at(-1)?.[1];

  it.each(['cover', 'content'] as const)(
    'skipSiteWorkerDefaults + siteId → job.siteId 스탬프, orderOptions 는 입력과 동일(%s)',
    async (fileType) => {
      await service.createValidationJob(
        {
          editSessionId: 'sess-1',
          fileId: `file-${fileType}`,
          fileType,
          orderOptions: inputOrderOptions() as any,
          siteId: 'site-A',
        },
        { skipSiteWorkerDefaults: true },
      );

      expect(sitesService.findOne).not.toHaveBeenCalled();
      const job = savedJob();
      expect(job.jobType).toBe(WorkerJobType.VALIDATE);
      expect(job.status).toBe(WorkerJobStatus.PENDING);
      expect(job.editSessionId).toBe('sess-1');
      expect(job.siteId).toBe('site-A');
      expect(job.options.orderOptions).toEqual(inputOrderOptions());
      expect(Object.keys(job.options.orderOptions).sort()).toEqual(
        Object.keys(inputOrderOptions()).sort(),
      );
      expect(queuePayload().orderOptions).toEqual(inputOrderOptions());
      expect(queuePayload().fileType).toBe(fileType);
    },
  );

  it('skipSiteWorkerDefaults + siteId 부재 → job.siteId NULL(종전 동일), orderOptions 불변', async () => {
    await service.createValidationJob(
      {
        editSessionId: 'sess-guest',
        fileId: 'file-content',
        fileType: 'content',
        orderOptions: inputOrderOptions() as any,
        siteId: undefined,
      },
      { skipSiteWorkerDefaults: true },
    );

    expect(sitesService.findOne).not.toHaveBeenCalled();
    expect(savedJob().siteId).toBeNull();
    expect(savedJob().options.orderOptions).toEqual(inputOrderOptions());
    expect(queuePayload().orderOptions).toEqual(inputOrderOptions());
  });

  it('회귀 잠금 — internal 미전달 + dto.siteId → 기존대로 site default 머지 + 스탬프', async () => {
    await service.createValidationJob({
      fileId: 'file-content',
      fileType: 'content',
      orderOptions: inputOrderOptions() as any,
      siteId: 'site-A',
    });

    expect(sitesService.findOne).toHaveBeenCalledWith('site-A');
    const merged = {
      ...inputOrderOptions(),
      applyBleed: true,
      unit: 'mm',
      checkWorkorder: true,
      checkCutting: true,
      checkSafezone: true,
    };
    expect(savedJob().siteId).toBe('site-A');
    expect(savedJob().options.orderOptions).toEqual(merged);
    expect(queuePayload().orderOptions).toEqual(merged);
  });
});
