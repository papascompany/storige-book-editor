/**
 * createDuplexSplitJob 페이지 수 원천(2026-10-16, 낱장 N장 duplex-split 결함 수정).
 *
 * 잠그는 계약:
 *  1. 편집기 세션 형태(metadata.pages 숫자 + 단일 canvasData)에서 잡이 생성되고
 *     options.totalExpectedPages 가 그 숫자다(종전: `.length` → undefined → ODD_PAGE_COUNT).
 *  2. 홀수면 ODD_PAGE_COUNT, 근거 없음이면 EMPTY_SESSION_PAGES(메시지·코드 유지).
 *  3. 배열 canvasData 가 metadata.pages 보다 우선한다.
 *
 * 인스턴스 생성 패턴은 worker-jobs.synthesis-retry.spec.ts 선례.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService.createDuplexSplitJob — 페이지 수 원천', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let synthesisQueue: { add: jest.Mock };

  const requestId = '22222222-2222-4222-8222-222222222222';

  const editorPdf = (id: string) => ({
    id,
    filePath: `/app/storage/uploads/${id}.pdf`,
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  });

  const useSession = (session: Record<string, unknown>) => {
    editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', ...session });
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    synthesisQueue = { add: jest.fn(async () => ({})) };

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      synthesisQueue as never,
      { findById: jest.fn(async (id: string) => editorPdf(id)) } as never, // filesService
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
  });

  const call = () =>
    service.createDuplexSplitJob({ sessionId: 'sess-1', pdfFileId: 'file-1', requestId });

  it('(a) metadata.pages=2 숫자 + 단일 canvasData → 잡 생성, totalExpectedPages 2', async () => {
    useSession({ metadata: { pages: 2 }, canvasData: { objects: [] } });

    const job = await call();

    expect(job.options).toMatchObject({ mode: 'duplex-split', totalExpectedPages: 2 });
    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisQueue.add.mock.calls[0][1]).toMatchObject({ totalExpectedPages: 2 });
  });

  it('(b) metadata.pages=3 숫자 → ODD_PAGE_COUNT (현재 3쪽)', async () => {
    useSession({ metadata: { pages: 3 }, canvasData: { objects: [] } });

    await expect(call()).rejects.toMatchObject({
      response: { code: 'ODD_PAGE_COUNT', message: expect.stringContaining('3쪽') },
    });
    await expect(call()).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(workerJobRepository.save).not.toHaveBeenCalled();
    expect(synthesisQueue.add).not.toHaveBeenCalled();
  });

  it('(c) 배열 canvasData 4장 + metadata.pages 없음 → 잡 생성, totalExpectedPages 4', async () => {
    useSession({
      metadata: {},
      canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }, { objects: [] }],
    });

    const job = await call();

    expect(job.options).toMatchObject({ mode: 'duplex-split', totalExpectedPages: 4 });
  });

  it('배열 canvasData 2장 + metadata.pages=4 → 배열 우선, totalExpectedPages 2', async () => {
    useSession({ metadata: { pages: 4 }, canvasData: [{ objects: [] }, { objects: [] }] });

    const job = await call();

    expect(job.options).toMatchObject({ totalExpectedPages: 2 });
  });

  it('근거 없음(metadata·canvasData 모두 없음) → EMPTY_SESSION_PAGES', async () => {
    useSession({ metadata: null, canvasData: null });

    await expect(call()).rejects.toMatchObject({
      response: { code: 'EMPTY_SESSION_PAGES' },
    });
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  });
});
