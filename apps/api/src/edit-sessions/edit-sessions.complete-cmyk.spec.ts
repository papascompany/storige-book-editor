import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus, SessionMode } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';

/**
 * 색 처리 'cmyk' 세트의 편집 완료 CMYK 변환 (2026-11-21).
 * - 게이트(COMPLETE_CMYK_CONVERT) 꺼짐 / 세트 rgb → 종전 그대로(변환 없음)
 * - 켜짐 + cmyk → 표지·내지 변환 결과로 세션 파일을 바꾸고, 다시 읽은 세션으로 검증 잡·응답
 * - 변환 실패 → throw, 세션 저장(완료) 없음
 * - 이미 변환본이면 다시 변환하지 않는다
 */
describe('EditSessionsService.complete — 색 처리 cmyk 세트 CMYK 변환', () => {
  let service: EditSessionsService;
  const envBackup = process.env.COMPLETE_CMYK_CONVERT;

  const sessionRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (s: any) => s),
    create: jest.fn((s: any) => s),
    createQueryBuilder: jest.fn(),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const versionRepository = { find: jest.fn().mockResolvedValue([]), save: jest.fn(), create: jest.fn() };
  const workerJobsService = {
    createValidationJob: jest.fn().mockResolvedValue({ id: 'vjob' }),
    createDuplexSplitJob: jest.fn(),
    createSheetMapJob: jest.fn(),
    convertFileToCmykForCompletion: jest.fn(),
  };
  const templateSetsService = { findOne: jest.fn(), findOneWithTemplates: jest.fn() };

  const mkSession = (extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
    ({
      id: 'sess-c',
      memberSeqno: 7,
      guestToken: null,
      status: SessionStatus.EDITING,
      mode: SessionMode.COVER,
      templateSetId: 'ts-cal',
      coverFileId: 'file-rgb-cover',
      coverFile: { id: 'file-rgb-cover', metadata: null, thumbnailUrl: '/t.png' },
      contentFileId: null,
      contentFile: null,
      canvasData: null,
      metadata: { revision: 0 },
      ...extra,
    }) as unknown as EditSessionEntity;

  beforeEach(async () => {
    jest.clearAllMocks();
    sessionRepository.save.mockImplementation(async (s: any) => s);
    templateSetsService.findOne.mockResolvedValue({
      id: 'ts-cal', width: 210, height: 150, cropMarkEnabled: false, productProfile: null, colorMode: 'cmyk', pdfOutputMode: 'duplex-merged',
    });
    templateSetsService.findOneWithTemplates.mockResolvedValue({ templateDetails: [] });
    workerJobsService.convertFileToCmykForCompletion.mockImplementation(async (sourceId: string, ctx: any) => ({
      fileId: `cmyk-of-${sourceId}`,
      jobId: `job-${ctx.role}`,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepository },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepository },
        { provide: WorkerJobsService, useValue: workerJobsService },
        { provide: TemplateSetsService, useValue: templateSetsService },
      ],
    }).compile();
    service = module.get(EditSessionsService);
  });

  afterAll(() => {
    if (envBackup === undefined) delete process.env.COMPLETE_CMYK_CONVERT;
    else process.env.COMPLETE_CMYK_CONVERT = envBackup;
  });

  it('게이트가 꺼져 있으면 cmyk 세트도 변환하지 않는다(종전 그대로)', async () => {
    delete process.env.COMPLETE_CMYK_CONVERT;
    sessionRepository.findOne.mockResolvedValue(mkSession());
    const completed = await service.complete('sess-c', 7);
    expect(completed.status).toBe(SessionStatus.COMPLETE);
    expect(workerJobsService.convertFileToCmykForCompletion).not.toHaveBeenCalled();
    expect(completed.metadata).not.toHaveProperty('colorConversion');
  });

  it('게이트가 켜져 있어도 rgb 세트는 변환하지 않는다', async () => {
    process.env.COMPLETE_CMYK_CONVERT = 'true';
    templateSetsService.findOne.mockResolvedValue({ id: 'ts-cal', productProfile: null, colorMode: 'rgb' });
    sessionRepository.findOne.mockResolvedValue(mkSession());
    await service.complete('sess-c', 7);
    expect(workerJobsService.convertFileToCmykForCompletion).not.toHaveBeenCalled();
  });

  it('켜짐 + cmyk 세트 → 표지를 변환본으로 바꾸고 다시 읽은 세션으로 검증 잡을 만든다', async () => {
    process.env.COMPLETE_CMYK_CONVERT = 'true';
    const reloaded = mkSession({
      status: SessionStatus.COMPLETE,
      coverFileId: 'cmyk-of-file-rgb-cover',
      coverFile: { id: 'cmyk-of-file-rgb-cover', thumbnailUrl: '/t.png', metadata: { generatedBy: 'worker-cmyk' } } as any,
    });
    sessionRepository.findOne.mockResolvedValueOnce(mkSession()).mockResolvedValue(reloaded);

    const completed = await service.complete('sess-c', 7);

    expect(workerJobsService.convertFileToCmykForCompletion).toHaveBeenCalledTimes(1);
    expect(workerJobsService.convertFileToCmykForCompletion).toHaveBeenCalledWith('file-rgb-cover', {
      editSessionId: 'sess-c',
      role: 'cover',
    });
    const saved = sessionRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(SessionStatus.COMPLETE);
    expect(saved.coverFile).toEqual({ id: 'cmyk-of-file-rgb-cover' });
    expect(saved.metadata.colorConversion).toMatchObject({
      mode: 'cmyk',
      cover: { sourceFileId: 'file-rgb-cover', fileId: 'cmyk-of-file-rgb-cover', jobId: 'job-cover' },
    });
    // 응답·검증 잡은 다시 읽은 세션(변환본 id) 기준
    expect(completed.coverFileId).toBe('cmyk-of-file-rgb-cover');
    const coverValidation = workerJobsService.createValidationJob.mock.calls.find((c: any[]) => c[0]?.fileType === 'cover');
    expect(coverValidation?.[0]?.fileId).toBe('cmyk-of-file-rgb-cover');
  });

  it('표지·내지가 모두 있으면 둘 다 변환한다', async () => {
    process.env.COMPLETE_CMYK_CONVERT = 'true';
    sessionRepository.findOne.mockResolvedValue(
      mkSession({ contentFileId: 'file-rgb-content', contentFile: { id: 'file-rgb-content', metadata: null } as any }),
    );
    await service.complete('sess-c', 7);
    const roles = workerJobsService.convertFileToCmykForCompletion.mock.calls.map((c: any[]) => c[1].role).sort();
    expect(roles).toEqual(['content', 'cover']);
    const saved = sessionRepository.save.mock.calls[0][0];
    expect(saved.contentFile).toEqual({ id: 'cmyk-of-file-rgb-content' });
  });

  it('변환 실패 → throw 하고 세션을 저장(완료)하지 않는다', async () => {
    process.env.COMPLETE_CMYK_CONVERT = 'true';
    sessionRepository.findOne.mockResolvedValue(mkSession());
    workerJobsService.convertFileToCmykForCompletion.mockRejectedValueOnce(
      new UnprocessableEntityException({ code: 'COLOR_CONVERSION_FAILED' }),
    );
    await expect(service.complete('sess-c', 7)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
  });

  it('이미 변환본(generatedBy worker-cmyk)이면 다시 변환하지 않는다', async () => {
    process.env.COMPLETE_CMYK_CONVERT = 'true';
    sessionRepository.findOne.mockResolvedValue(
      mkSession({ coverFile: { id: 'file-rgb-cover', metadata: { generatedBy: 'worker-cmyk' } } as any }),
    );
    await service.complete('sess-c', 7);
    expect(workerJobsService.convertFileToCmykForCompletion).not.toHaveBeenCalled();
  });
});
