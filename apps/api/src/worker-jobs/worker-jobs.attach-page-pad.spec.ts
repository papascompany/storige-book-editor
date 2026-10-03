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

describe('WorkerJobsService — createAttachPagePadJob 내지 기대 재단(convertOptions.contentTrim)', () => {
  /** 계약 fixture — apps/worker spec 과 같은 리터럴 */
  const FIXTURE_TEMPLATE_SET = JSON.parse(
    '{"trimWidthMm":210,"trimHeightMm":297,"bleedMm":3,"source":"templateSet"}',
  ) as unknown;
  const LEGACY_CONVERT_OPTIONS = { addPages: false, applyBleed: false, targetPages: 0, bleed: 0, padToMultiple: 4 };

  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let templateSetsService: { findOne: jest.Mock };
  let templateFind: jest.Mock;
  let getRepository: jest.Mock;

  const pdfFile = { id: 'file-1', filePath: '/app/storage/uploads/inner.pdf', mimeType: 'application/pdf', siteId: 'site-1' };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-pad', ...x })),
    };
    conversionQueue = { add: jest.fn(async () => ({})) };
    templateSetsService = {
      findOne: jest.fn(async () => ({
        id: 'ts-1',
        pageStep: 4,
        padToPageStep: true,
        width: 210,
        height: 297,
        bleedMm: 3,
        templates: [{ templateId: 't-1' }],
      })),
    };
    templateFind = jest.fn(async () => [{ id: 't-1', spreadConfig: null }]);
    getRepository = jest.fn(() => ({ find: templateFind }));
    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: jest.fn(), update: jest.fn(), manager: { getRepository } } as never,
      { add: jest.fn() } as never, // validationQueue
      conversionQueue as never,
      { add: jest.fn() } as never, // synthesisQueue
      { findById: jest.fn(async () => ({ ...pdfFile })) } as never,
      {} as never, // webhookService
      {} as never, // sitesService
      templateSetsService as never,
    );
  });

  const convertOptions = (): Record<string, unknown> => conversionQueue.add.mock.calls[0][1].convertOptions;
  const createdOptions = (): Record<string, unknown> => workerJobRepository.create.mock.calls[0][0].options;

  it('templateSet(210×297, bleedMm 3) → convertOptions.contentTrim = 계약 fixture, 나머지 convertOptions 는 종전과 같다', async () => {
    await service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' });

    expect(convertOptions()).toEqual({ ...LEGACY_CONVERT_OPTIONS, contentTrim: FIXTURE_TEMPLATE_SET });
    expect(createdOptions().contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
    // 템플릿셋은 한 번만 읽고(재사용), 템플릿은 spreadConfig 만 조회한다
    expect(templateSetsService.findOne).toHaveBeenCalledTimes(1);
    expect(templateFind.mock.calls[0][0].select).toEqual({ id: true, spreadConfig: true });
  });

  it('템플릿 조회 실패 → contentTrim 없음, 잡 생성 계속', async () => {
    templateFind.mockRejectedValue(new Error('db'));
    const job = await service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' });

    expect(job.id).toBe('job-pad');
    expect(convertOptions()).toEqual(LEGACY_CONVERT_OPTIONS);
    expect(createdOptions()).not.toHaveProperty('contentTrim');
  });

  it('내지 펼침면 세트 → contentTrim 없음, 잡 생성 계속', async () => {
    templateFind.mockResolvedValue([{ id: 't-1', spreadConfig: { regionScope: 'inner' } }]);
    await service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' });

    expect(convertOptions()).toEqual(LEGACY_CONVERT_OPTIONS);
  });

  it('비PDF 400 경로는 템플릿을 조회하지 않는다', async () => {
    (service as unknown as { filesService: { findById: jest.Mock } }).filesService.findById.mockResolvedValue({
      ...pdfFile,
      mimeType: 'image/png',
    });
    await expect(
      service.createAttachPagePadJob({ fileId: 'file-1', templateSetId: 'ts-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getRepository).not.toHaveBeenCalled();
  });

  it('fix-pagecount 직접 호출 → convertOptions·options 에 contentTrim 없음', async () => {
    await service.createPageCountFixJob({ fileId: 'file-1', targetMultiple: 4 });

    expect(convertOptions()).toEqual(LEGACY_CONVERT_OPTIONS);
    expect(createdOptions()).not.toHaveProperty('contentTrim');
    expect(getRepository).not.toHaveBeenCalled();
  });
});
