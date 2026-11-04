/**
 * 2026-11-04 — 검증 잡 `orderOptions.source:'editor'` 서버 전유 스탬프(ADDITIVE).
 *
 * 잠그는 계약:
 *  1. fileId 로 만든 검증 잡의 입력 파일 metadata.generatedBy==='editor' 이면 DB job.options.orderOptions 와
 *     검증 큐 페이로드 orderOptions 둘 다에 `source:'editor'` 가 실린다.
 *  2. 편집기 산출이 아닌 파일(고객 업로드 — generatedBy 없음·다른 값)은 `source` 키 자체가 없다(종전 바이트 불변).
 *  3. fileUrl 직접 전달(파일 행 없음)은 키 없음.
 *  4. 호출자가 보낸 `source` 는 소독된다 — 고객 업로드에 `source:'editor'` 를 실어 보내도 키 없음,
 *     편집기 파일에 다른 값을 보내도 서버가 `'editor'` 로 재발급.
 *
 * 인스턴스 생성 패턴은 worker-jobs.test-env-stamp.spec.ts 선례.
 */
import { WorkerJobsService } from './worker-jobs.service';

describe("WorkerJobsService — 검증 잡 orderOptions.source:'editor' 스탬프", () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; find: jest.Mock; update: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };

  const editorPdf = {
    id: 'file-editor',
    filePath: '/app/storage/uploads/editor-out.pdf',
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  };
  const uploadedPdf = {
    id: 'file-upload',
    filePath: '/app/storage/uploads/customer.pdf',
    metadata: { originalName: 'customer.pdf' },
  };

  const baseOrderOptions = {
    size: { width: 210, height: 297 },
    pages: 4,
    binding: 'perfect' as const,
    bleed: 3,
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn(async () => ({ ...editorPdf })) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      { findOne: jest.fn(async () => null), update: jest.fn() } as any, // editSessionRepository
      validationQueue as any,
      { add: jest.fn() } as any, // conversionQueue
      { add: jest.fn(async () => ({})) } as any, // synthesisQueue
      filesService as any,
      { sendCallback: jest.fn(async () => true), hasV2Config: jest.fn(async () => false) } as any,
      { findOne: jest.fn(async () => ({})) } as any, // sitesService
      {} as any, // templateSetsService
    );
  });

  const createdOrderOptions = () => workerJobRepository.create.mock.calls[0][0].options.orderOptions;
  const queuedOrderOptions = () => validationQueue.add.mock.calls[0][1].orderOptions;

  it("편집기 산출 파일(generatedBy:'editor') → DB options 와 큐 페이로드 orderOptions 에 source:'editor'", async () => {
    await service.createValidationJob({
      fileId: editorPdf.id,
      fileType: 'content',
      orderOptions: { ...baseOrderOptions },
    } as any);

    expect(createdOrderOptions()).toMatchObject({ ...baseOrderOptions, source: 'editor' });
    expect(queuedOrderOptions()).toMatchObject({ ...baseOrderOptions, source: 'editor' });
  });

  it('고객 업로드 파일(generatedBy 없음) → source 키 자체가 없음(종전 orderOptions 바이트 불변)', async () => {
    filesService.findById.mockResolvedValueOnce({ ...uploadedPdf });

    await service.createValidationJob({
      fileId: uploadedPdf.id,
      fileType: 'content',
      orderOptions: { ...baseOrderOptions },
    } as any);

    expect(createdOrderOptions()).toEqual(baseOrderOptions);
    expect('source' in queuedOrderOptions()).toBe(false);
  });

  it("다른 생성 주체(generatedBy:'worker-bleed-fix')도 편집기 산출이 아니다 → 키 없음", async () => {
    filesService.findById.mockResolvedValueOnce({
      ...uploadedPdf,
      metadata: { generatedBy: 'worker-bleed-fix' },
    });

    await service.createValidationJob({
      fileId: uploadedPdf.id,
      fileType: 'content',
      orderOptions: { ...baseOrderOptions },
    } as any);

    expect('source' in createdOrderOptions()).toBe(false);
  });

  it('fileUrl 직접 전달(파일 행 없음) → 키 없음, 파일 조회도 없음', async () => {
    await service.createValidationJob({
      fileUrl: 'https://example.com/customer.pdf',
      fileType: 'content',
      orderOptions: { ...baseOrderOptions },
    } as any);

    expect(filesService.findById).not.toHaveBeenCalled();
    expect('source' in createdOrderOptions()).toBe(false);
    expect('source' in queuedOrderOptions()).toBe(false);
  });

  it("호출자가 보낸 source 는 소독 — 고객 업로드에 source:'editor' 를 실어도 키 없음", async () => {
    filesService.findById.mockResolvedValueOnce({ ...uploadedPdf });

    await service.createValidationJob({
      fileId: uploadedPdf.id,
      fileType: 'content',
      orderOptions: { ...baseOrderOptions, source: 'editor' },
    } as any);

    expect('source' in createdOrderOptions()).toBe(false);
    expect('source' in queuedOrderOptions()).toBe(false);
  });

  it("호출자가 보낸 다른 값도 소독 — 편집기 파일이면 서버가 'editor' 로 재발급", async () => {
    await service.createValidationJob({
      fileId: editorPdf.id,
      fileType: 'content',
      orderOptions: { ...baseOrderOptions, source: 'upload' },
    } as any);

    expect(createdOrderOptions().source).toBe('editor');
    expect(queuedOrderOptions().source).toBe('editor');
  });
});
