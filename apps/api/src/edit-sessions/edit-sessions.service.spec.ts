import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EditSessionsService } from './edit-sessions.service';
import {
  EditSessionEntity,
  SessionStatus,
  SessionMode,
} from './entities/edit-session.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { WorkerJobStatus } from '@storige/types';

describe('EditSessionsService', () => {
  let service: EditSessionsService;

  const mockGetMany = jest.fn();
  const mockGetRawOne = jest.fn();

  const mockSessionQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: mockGetMany,
  };

  const mockManagerQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: mockGetRawOne,
  };

  const mockSessionRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockSessionQueryBuilder),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn().mockReturnValue(mockManagerQueryBuilder),
    },
  };

  const mockWorkerJobsService = {
    createValidationJob: jest.fn(),
  };

  const mockTemplateSetsService = {
    findOneWithTemplates: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        {
          provide: getRepositoryToken(EditSessionEntity),
          useValue: mockSessionRepository,
        },
        {
          provide: WorkerJobsService,
          useValue: mockWorkerJobsService,
        },
        {
          provide: TemplateSetsService,
          useValue: mockTemplateSetsService,
        },
      ],
    }).compile();

    service = module.get<EditSessionsService>(EditSessionsService);
  });

  describe('findByOrderExternal', () => {
    const makeSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity => ({
      id: 'session-uuid-1',
      orderSeqno: 12345,
      memberSeqno: 100,
      status: SessionStatus.COMPLETE,
      mode: SessionMode.SPREAD,
      coverFile: null,
      contentFile: null,
      coverFileId: null,
      contentFileId: null,
      templateSetId: null,
      canvasData: null,
      metadata: null,
      completedAt: new Date('2026-02-19T10:00:00Z'),
      workerStatus: null,
      workerError: null,
      callbackUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    } as EditSessionEntity);

    it('정상 조회 - 워커 완료된 세션', async () => {
      const session = makeSession();
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue({
        status: WorkerJobStatus.COMPLETED,
        result: {
          outputFileUrl: '/storage/outputs/job-1/merged.pdf',
          outputFiles: [
            { type: 'cover', url: '/storage/outputs/job-1/cover.pdf' },
            { type: 'content', url: '/storage/outputs/job-1/content.pdf' },
          ],
        },
        outputFileUrl: '/storage/outputs/job-1/merged.pdf',
      });

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('session-uuid-1');
      expect(result[0].orderSeqno).toBe(12345);
      expect(result[0].files.cover).toBe('/storage/outputs/job-1/cover.pdf');
      expect(result[0].files.content).toBe('/storage/outputs/job-1/content.pdf');
      expect(result[0].files.merged).toBe('/storage/outputs/job-1/merged.pdf');
    });

    it('워커 미완료 - 에디터 원본 fallback', async () => {
      const session = makeSession({
        coverFile: { id: 'file-1', fileUrl: '/storage/designs/cover.pdf' } as any,
        contentFile: { id: 'file-2', fileUrl: '/storage/designs/content.pdf' } as any,
      });
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue(null); // 워커잡 없음

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(1);
      expect(result[0].files.cover).toBe('/storage/designs/cover.pdf');
      expect(result[0].files.content).toBe('/storage/designs/content.pdf');
      expect(result[0].files.merged).toBeNull();
    });

    it('세션 없음 - 빈 배열 반환', async () => {
      mockGetMany.mockResolvedValue([]);

      const result = await service.findByOrderExternal(99999);

      expect(result).toEqual([]);
    });

    it('복수 세션 - 여러 세션 반환', async () => {
      const session1 = makeSession({ id: 'session-1', mode: SessionMode.COVER });
      const session2 = makeSession({ id: 'session-2', mode: SessionMode.CONTENT });
      mockGetMany.mockResolvedValue([session1, session2]);
      mockGetRawOne.mockResolvedValue(null);

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('session-1');
      expect(result[0].mode).toBe(SessionMode.COVER);
      expect(result[1].sessionId).toBe('session-2');
      expect(result[1].mode).toBe(SessionMode.CONTENT);
    });

    it('워커 실패 세션 - 에디터 원본 fallback', async () => {
      const session = makeSession({
        coverFile: { id: 'file-1', fileUrl: '/storage/designs/cover.pdf' } as any,
      });
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue({
        status: WorkerJobStatus.FAILED,
        result: null,
        outputFileUrl: null,
      });

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(1);
      expect(result[0].files.cover).toBe('/storage/designs/cover.pdf');
      expect(result[0].files.content).toBeNull();
      expect(result[0].files.merged).toBeNull();
    });

    it('부분 파일만 있는 경우', async () => {
      const session = makeSession({
        coverFile: { id: 'file-1', fileUrl: '/storage/designs/cover.pdf' } as any,
        contentFile: null,
      });
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue(null);

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(1);
      expect(result[0].files.cover).toBe('/storage/designs/cover.pdf');
      expect(result[0].files.content).toBeNull();
      expect(result[0].files.merged).toBeNull();
    });

    it('워커잡 result가 문자열(JSON)인 경우 파싱', async () => {
      const session = makeSession();
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue({
        status: WorkerJobStatus.COMPLETED,
        result: JSON.stringify({
          outputFileUrl: '/storage/outputs/job-1/merged.pdf',
          outputFiles: [
            { type: 'cover', url: '/storage/outputs/job-1/cover.pdf' },
          ],
        }),
        outputFileUrl: '/storage/outputs/job-1/merged.pdf',
      });

      const result = await service.findByOrderExternal(12345);

      expect(result[0].files.cover).toBe('/storage/outputs/job-1/cover.pdf');
      expect(result[0].files.merged).toBe('/storage/outputs/job-1/merged.pdf');
    });

    it('워커잡 outputFileUrl fallback (result에 없는 경우)', async () => {
      const session = makeSession();
      mockGetMany.mockResolvedValue([session]);
      mockGetRawOne.mockResolvedValue({
        status: WorkerJobStatus.COMPLETED,
        result: { outputFiles: [] },
        outputFileUrl: '/storage/outputs/job-1/merged.pdf',
      });

      const result = await service.findByOrderExternal(12345);

      expect(result[0].files.merged).toBe('/storage/outputs/job-1/merged.pdf');
    });
  });
});
