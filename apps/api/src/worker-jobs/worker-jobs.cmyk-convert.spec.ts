/**
 * convertFileToCmykForCompletion (2026-11-21) — 편집 완료용 CMYK 변환 잡 발행·대기·결과 등록.
 *
 * 잠그는 계약:
 *  1. CONVERT 잡: 큐 convertOptions = { colorConvert:'cmyk' }, edit_session_id 비움(세션 검증 추적과 분리),
 *     options.purpose 'cmyk-convert'.
 *  2. COMPLETED → 결과를 새 File 로 등록(원본 주문·회원·사이트·유형·썸네일 승계) → 새 id 반환. 원본 무변경.
 *  3. FAILED·시간 초과·결과 경로 없음·등록 실패 → 422 COLOR_CONVERSION_FAILED.
 * 인스턴스 생성 패턴은 worker-jobs.duplex-split-page-count.spec.ts 선례.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService.convertFileToCmykForCompletion', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock; registerExternalFile: jest.Mock };

  const source = {
    id: 'file-rgb',
    storageBackend: 's3',
    filePath: 'uploads/x.pdf',
    fileType: 'cover',
    orderSeqno: 5001,
    memberSeqno: 77,
    siteId: 'site-1',
    thumbnailUrl: '/storage/thumbs/x.png',
    originalName: 'cover.pdf',
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-cmyk', ...x })),
      findOne: jest.fn(),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    conversionQueue = { add: jest.fn(async () => ({})) };
    filesService = {
      findById: jest.fn(async () => source),
      registerExternalFile: jest.fn(async () => ({ id: 'file-cmyk' })),
    };
    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: jest.fn(), update: jest.fn() } as never, // editSessionRepository
      { add: jest.fn() } as never, // validationQueue
      conversionQueue as never,
      { add: jest.fn() } as never, // synthesisQueue
      filesService as never,
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
  });

  const call = (timeoutMs = 2000) =>
    service.convertFileToCmykForCompletion('file-rgb', {
      editSessionId: 'sess-1',
      role: 'cover',
      timeoutMs,
      pollMs: 5,
    });

  it('COMPLETED → 결과 File 등록(원본 메타·썸네일 승계) 후 새 id 반환', async () => {
    workerJobRepository.findOne
      .mockResolvedValueOnce({ id: 'job-cmyk', status: WorkerJobStatus.PROCESSING })
      .mockResolvedValue({ id: 'job-cmyk', status: WorkerJobStatus.COMPLETED, outputFileUrl: '/storage/converted/c.pdf' });

    await expect(call()).resolves.toEqual({ fileId: 'file-cmyk', jobId: 'job-cmyk' });

    const created = workerJobRepository.create.mock.calls[0][0];
    expect(created).toMatchObject({
      jobType: WorkerJobType.CONVERT,
      editSessionId: null,
      fileId: 'file-rgb',
      inputFileUrl: 'api://file-rgb',
      siteId: 'site-1',
      options: { colorConvert: 'cmyk', purpose: 'cmyk-convert', editSessionId: 'sess-1', role: 'cover', sourceFileId: 'file-rgb' },
    });
    expect(conversionQueue.add).toHaveBeenCalledWith('convert-pdf', {
      jobId: 'job-cmyk',
      fileId: 'file-rgb',
      fileUrl: 'api://file-rgb',
      convertOptions: { colorConvert: 'cmyk' },
    });
    expect(filesService.registerExternalFile).toHaveBeenCalledWith('/storage/converted/c.pdf', {
      fileType: 'cover',
      orderSeqno: 5001,
      memberSeqno: 77,
      siteId: 'site-1',
      thumbnailUrl: '/storage/thumbs/x.png',
      originalName: 'cover.pdf',
      metadata: expect.objectContaining({ generatedBy: 'worker-cmyk', colorMode: 'CMYK', sourceFileId: 'file-rgb', workerJobId: 'job-cmyk' }),
    });
  });

  it('잡 FAILED → 422 COLOR_CONVERSION_FAILED, 등록 없음', async () => {
    workerJobRepository.findOne.mockResolvedValue({ id: 'job-cmyk', status: WorkerJobStatus.FAILED, errorMessage: 'ICC 부재' });
    await expect(call()).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(call()).rejects.toMatchObject({ response: { code: 'COLOR_CONVERSION_FAILED' } });
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
  });

  it('시간 안에 끝나지 않으면 422', async () => {
    workerJobRepository.findOne.mockResolvedValue({ id: 'job-cmyk', status: WorkerJobStatus.PROCESSING });
    await expect(call(30)).rejects.toMatchObject({ response: { code: 'COLOR_CONVERSION_FAILED' } });
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
  });

  it('COMPLETED 인데 결과 경로가 없으면 422', async () => {
    workerJobRepository.findOne.mockResolvedValue({ id: 'job-cmyk', status: WorkerJobStatus.COMPLETED, outputFileUrl: null, result: {} });
    await expect(call()).rejects.toMatchObject({ response: { code: 'COLOR_CONVERSION_FAILED' } });
  });

  it('결과 등록이 실패하면 422', async () => {
    workerJobRepository.findOne.mockResolvedValue({ id: 'job-cmyk', status: WorkerJobStatus.COMPLETED, outputFileUrl: '/storage/converted/c.pdf' });
    filesService.registerExternalFile.mockRejectedValueOnce(new Error('FILE_NOT_ON_DISK'));
    await expect(call()).rejects.toMatchObject({ response: { code: 'COLOR_CONVERSION_FAILED' } });
  });
});
