/**
 * 합성 큐 재시도 옵션(2026-10-03, JD-2 api).
 *
 * 잠그는 계약:
 *  1. 합성 잡을 넣는 5곳(createSynthesisJob·createComposeMixedJob·createSplitSynthesisJob·
 *     createDuplexSplitJob·createSpreadSynthesisJob)은 synthesisQueue.add 3번째 인자에
 *     priority 와 함께 attempts:3, backoff exponential 30000 을 싣는다.
 *  2. 검증·변환 큐 add 는 옵션 인자 없이 2개 인자 그대로(Bull 기본값).
 *
 * 인스턴스 생성 패턴은 worker-jobs.test-env-stamp.spec.ts 선례.
 */
import { WorkerJobsService, SYNTHESIS_QUEUE_RETRY_OPTS } from './worker-jobs.service';
import { TemplateType } from '@storige/types';

describe('WorkerJobsService — 합성 큐 재시도 옵션', () => {
  let service: WorkerJobsService;
  let workerJobRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock; findManyByIds: jest.Mock };

  const retry = { attempts: 3, backoff: { type: 'exponential', delay: 30000 } };

  const editorPdf = (id: string) => ({
    id,
    filePath: `/app/storage/uploads/${id}.pdf`,
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  });

  const session = {
    id: 'sess-1',
    metadata: {
      pages: [
        { sortOrder: 0, templateType: TemplateType.COVER },
        { sortOrder: 1, templateType: TemplateType.PAGE },
      ],
    },
  };

  const requestId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ ...session })),
      update: jest.fn(),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    conversionQueue = { add: jest.fn(async () => ({})) };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    filesService = {
      findById: jest.fn(async (id: string) => editorPdf(id)),
      findManyByIds: jest.fn(
        async (ids: string[]) => new Map(ids.map((id) => [id, editorPdf(id)])),
      ),
    };

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      validationQueue as never,
      conversionQueue as never,
      synthesisQueue as never,
      filesService as never,
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
  });

  const synthesisOpts = () => synthesisQueue.add.mock.calls[0][2];

  it('상수 값은 attempts 3, exponential 30000', () => {
    expect(SYNTHESIS_QUEUE_RETRY_OPTS).toEqual(retry);
  });

  describe('createSynthesisJob', () => {
    const dto = {
      coverUrl: 'https://example.com/cover.pdf',
      contentUrl: 'https://example.com/content.pdf',
      spineWidth: 3,
    };

    it('normal → priority 5 + 재시도 옵션', async () => {
      await service.createSynthesisJob({ ...dto });
      expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
      expect(synthesisOpts()).toEqual({ priority: 5, ...retry });
    });

    it('high → priority 1 + 재시도 옵션', async () => {
      await service.createSynthesisJob({ ...dto, priority: 'high' });
      expect(synthesisOpts()).toEqual({ priority: 1, ...retry });
    });

    it('low → priority 10 + 재시도 옵션', async () => {
      await service.createSynthesisJob({ ...dto, priority: 'low' });
      expect(synthesisOpts()).toEqual({ priority: 10, ...retry });
    });
  });

  it('createComposeMixedJob → priority 5 + 재시도 옵션', async () => {
    editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

    await service.createComposeMixedJob({
      editSessionId: 'sess-1',
      coverUrl: 'https://example.com/cover.pdf',
      contentPdfUrl: 'https://example.com/content.pdf',
      coverWidthMm: 216,
      coverHeightMm: 303,
      contentWidthMm: 210,
      contentHeightMm: 297,
      outputMode: 'merged',
    });

    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisOpts()).toEqual({ priority: 5, ...retry });
  });

  it('createSplitSynthesisJob → priority 5 + 재시도 옵션', async () => {
    await service.createSplitSynthesisJob({ sessionId: 'sess-1', pdfFileId: 'file-1', requestId });

    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisOpts()).toEqual({ priority: 5, ...retry });
  });

  it('createDuplexSplitJob → priority 5 + 재시도 옵션', async () => {
    await service.createDuplexSplitJob({ sessionId: 'sess-1', pdfFileId: 'file-1', requestId });

    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisOpts()).toEqual({ priority: 5, ...retry });
  });

  it('createSpreadSynthesisJob → priority 5 + 재시도 옵션', async () => {
    await service.createSpreadSynthesisJob({
      sessionId: 'sess-1',
      spreadPdfFileId: 'file-spread',
      contentPdfFileIds: ['file-c1'],
      requestId,
    });

    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    expect(synthesisOpts()).toEqual({ priority: 5, ...retry });
  });

  it('createValidationJob → validationQueue.add 는 옵션 인자 없이 2개 인자', async () => {
    await service.createValidationJob({
      fileUrl: 'https://example.com/content.pdf',
      fileType: 'content',
      orderOptions: {},
    } as Parameters<WorkerJobsService['createValidationJob']>[0]);

    expect(validationQueue.add).toHaveBeenCalledTimes(1);
    expect(validationQueue.add.mock.calls[0]).toHaveLength(2);
  });

  it('createConversionJob → conversionQueue.add 는 옵션 인자 없이 2개 인자', async () => {
    await service.createConversionJob({
      fileUrl: 'https://example.com/content.pdf',
      convertOptions: {},
    } as Parameters<WorkerJobsService['createConversionJob']>[0]);

    expect(conversionQueue.add).toHaveBeenCalledTimes(1);
    expect(conversionQueue.add.mock.calls[0]).toHaveLength(2);
  });
});
