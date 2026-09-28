/**
 * 첨부 내지 PDF 빈 페이지 배수 채움 (2026-09-28) — fix-pagecount/attach 잠금.
 *
 * 잠그는 계약:
 *  - 배수는 서버가 templateSet 에서 권위 산출(padToPageStep===true && pageStep>=2 일 때만).
 *  - 실행은 fix-pagecount 잡 재사용: CONVERT + kind='pagecount-fix' + padToMultiple=pageStep,
 *    원본 파일 site 승계, editSessionId 미주입(세션 상태기계 무관).
 *  - 미설정·미존재 templateSet, 비PDF → 400(코드 명시), 잡/큐 미발행.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobType } from '@storige/types';

describe('WorkerJobsService — createAttachPagePadJob(첨부 PDF 빈 페이지 채움)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let templateSetsService: { findOne: jest.Mock };

  const pdfFile = { id: 'file-1', filePath: '/app/storage/uploads/inner.pdf', mimeType: 'application/pdf', siteId: 'site-1' };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-pad', ...x })),
      findOne: jest.fn(),
    };
    conversionQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn(async () => ({ ...pdfFile })) };
    templateSetsService = {
      findOne: jest.fn(async () => ({ id: 'ts-1', pageStep: 4, padToPageStep: true })),
    };
    service = new WorkerJobsService(
      workerJobRepository as any,
      { findOne: jest.fn(), update: jest.fn() } as any,
      { add: jest.fn() } as any, // validationQueue
      conversionQueue as any,
      { add: jest.fn() } as any, // synthesisQueue
      filesService as any,
      {} as any, // webhookService
      {} as any, // sitesService
      templateSetsService as any,
    );
  });

  const expectBadRequest = async (code: string) => {
    let err: any;
    try {
      await service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code });
    expect(conversionQueue.add).not.toHaveBeenCalled();
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  };

  it('설정된 templateSet → pageStep 을 padToMultiple 로 fix-pagecount 잡 발행(site 승계, 세션 무관)', async () => {
    const job = await service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' });
    expect(job.id).toBe('job-pad');

    const created = workerJobRepository.create.mock.calls[0][0];
    expect(created.jobType).toBe(WorkerJobType.CONVERT);
    expect(created.options).toMatchObject({ kind: 'pagecount-fix', sourceFileId: 'file-1', targetMultiple: 4 });
    expect(created.siteId).toBe('site-1');
    expect(created).not.toHaveProperty('editSessionId');

    const [jobName, payload] = conversionQueue.add.mock.calls[0];
    expect(jobName).toBe('convert-pdf');
    expect(payload.convertOptions).toMatchObject({ padToMultiple: 4, addPages: false, applyBleed: false });
  });

  it('padToPageStep=false → 400 PAGE_PAD_NOT_ENABLED', async () => {
    templateSetsService.findOne.mockResolvedValue({ id: 'ts-1', pageStep: 4, padToPageStep: false });
    await expectBadRequest('PAGE_PAD_NOT_ENABLED');
  });

  it('pageStep 미설정(null)·1 → 400 PAGE_PAD_NOT_ENABLED', async () => {
    templateSetsService.findOne.mockResolvedValue({ id: 'ts-1', pageStep: null, padToPageStep: true });
    await expectBadRequest('PAGE_PAD_NOT_ENABLED');
    templateSetsService.findOne.mockResolvedValue({ id: 'ts-1', pageStep: 1, padToPageStep: true });
    await expectBadRequest('PAGE_PAD_NOT_ENABLED');
  });

  it('templateSet 미존재 → 400 TEMPLATE_SET_NOT_FOUND', async () => {
    templateSetsService.findOne.mockRejectedValue(new NotFoundException('nope'));
    await expectBadRequest('TEMPLATE_SET_NOT_FOUND');
  });

  it('비PDF → 400 FILE_NOT_PDF', async () => {
    filesService.findById.mockResolvedValue({ ...pdfFile, mimeType: 'image/png' });
    await expectBadRequest('FILE_NOT_PDF');
  });
});
