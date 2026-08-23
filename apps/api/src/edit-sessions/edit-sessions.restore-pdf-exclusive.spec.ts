import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';

/**
 * restoreVersion — PDF 첨부(replace) 배타 가드.
 * update(canvasData) 와 동일한 PDF_ATTACHED_EXCLUSIVE 가드가 스냅샷 복원 경로에도 적용되어야 한다.
 * 가드는 스냅샷 생성·세션 save 이전에 throw 해야 한다(부수효과 0).
 */
describe('EditSessionsService.restoreVersion — PDF 배타 가드', () => {
  let service: EditSessionsService;

  const mockSessionRepository = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
    },
  };

  const mockVersionRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver-new', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };

  const mockWorkerJobsService = { createValidationJob: jest.fn() };
  const mockTemplateSetsService = { findOneWithTemplates: jest.fn(), findOne: jest.fn() };

  const mkSession = (extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
    ({
      id: 'sess-1',
      memberSeqno: 7,
      guestToken: null,
      status: SessionStatus.EDITING,
      canvasData: Array(8).fill({ cur: true }),
      metadata: null,
      contentPdfFileId: null,
      contentPdfMode: null,
      ...extra,
    }) as EditSessionEntity;

  const oldCanvas = Array(16).fill({ old: true });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockVersionRepository.find.mockResolvedValue([]);
    mockSessionRepository.save.mockImplementation(async (s: EditSessionEntity) => s);
    mockVersionRepository.findOne.mockResolvedValue({
      id: 'ver-old',
      canvasData: oldCanvas,
      pageCount: 16,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: mockSessionRepository },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: mockVersionRepository },
        { provide: WorkerJobsService, useValue: mockWorkerJobsService },
        { provide: TemplateSetsService, useValue: mockTemplateSetsService },
      ],
    }).compile();

    service = module.get<EditSessionsService>(EditSessionsService);
  });

  it('replace 모드 + contentPdfFileId 세션은 400 PDF_ATTACHED_EXCLUSIVE, 스냅샷·세션 save 미호출', async () => {
    mockSessionRepository.findOne.mockResolvedValue(
      mkSession({ contentPdfFileId: 'file-pdf-1', contentPdfMode: 'replace' }),
    );

    let caught: unknown;
    try {
      await service.restoreVersion('sess-1', 'ver-old', 7);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('PDF_ATTACHED_EXCLUSIVE');
    expect(body.message).toContain('underlay');
    expect(mockVersionRepository.save).not.toHaveBeenCalled();
    expect(mockSessionRepository.save).not.toHaveBeenCalled();
  });

  it('contentPdfMode 미설정(null) + contentPdfFileId 는 replace 로 간주 → 400, 부수효과 0', async () => {
    mockSessionRepository.findOne.mockResolvedValue(
      mkSession({ contentPdfFileId: 'file-pdf-1', contentPdfMode: null }),
    );

    await expect(service.restoreVersion('sess-1', 'ver-old', 7)).rejects.toMatchObject({
      response: { code: 'PDF_ATTACHED_EXCLUSIVE' },
    });
    expect(mockVersionRepository.save).not.toHaveBeenCalled();
    expect(mockSessionRepository.save).not.toHaveBeenCalled();
  });

  it('underlay 모드는 정상 복원 — restore 스냅샷 보존 + canvasData 교체', async () => {
    const session = mkSession({ contentPdfFileId: 'file-pdf-1', contentPdfMode: 'underlay' });
    const current = session.canvasData;
    mockSessionRepository.findOne.mockResolvedValue(session);

    const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

    expect(restored.canvasData).toBe(oldCanvas);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    const snap = mockVersionRepository.save.mock.calls[0][0];
    expect(snap.reason).toBe('restore');
    expect(snap.canvasData).toBe(current);
    expect(mockSessionRepository.save).toHaveBeenCalledTimes(1);
  });

  it('contentPdfFileId 없으면 모드와 무관하게 정상 복원', async () => {
    const session = mkSession({ contentPdfFileId: null, contentPdfMode: 'replace' });
    mockSessionRepository.findOne.mockResolvedValue(session);

    const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

    expect(restored.canvasData).toBe(oldCanvas);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    expect(mockSessionRepository.save).toHaveBeenCalledTimes(1);
  });
});
