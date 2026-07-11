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
  const mockGetRawMany = jest.fn();
  // DB-001: findByOrderExternal 이 manager.query(윈도우함수 배치)로 전환됨 → query 목 추가.
  const mockQuery = jest.fn().mockResolvedValue([]);

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
    getRawMany: mockGetRawMany,
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
      query: mockQuery,
    },
  };

  const mockWorkerJobsService = {
    createValidationJob: jest.fn(),
  };

  const mockTemplateSetsService = {
    findOneWithTemplates: jest.fn(),
    // C+ G2: createValidationJobs 가 size 폴백/cropMark 주입에 findOne 사용.
    findOne: jest.fn(),
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
      mockQuery.mockResolvedValue([
        {
          sessionId: 'session-uuid-1',
          status: WorkerJobStatus.COMPLETED,
          result: {
            outputFileUrl: '/storage/outputs/job-1/merged.pdf',
            outputFiles: [
              { type: 'cover', url: '/storage/outputs/job-1/cover.pdf' },
              { type: 'content', url: '/storage/outputs/job-1/content.pdf' },
            ],
          },
          outputFileUrl: '/storage/outputs/job-1/merged.pdf',
        },
      ]);

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
      mockQuery.mockResolvedValue([]); // 워커잡 없음

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
      mockQuery.mockResolvedValue([]);

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
      mockQuery.mockResolvedValue([
        {
          sessionId: 'session-uuid-1',
          status: WorkerJobStatus.FAILED,
          result: null,
          outputFileUrl: null,
        },
      ]);

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
      mockQuery.mockResolvedValue([]);

      const result = await service.findByOrderExternal(12345);

      expect(result).toHaveLength(1);
      expect(result[0].files.cover).toBe('/storage/designs/cover.pdf');
      expect(result[0].files.content).toBeNull();
      expect(result[0].files.merged).toBeNull();
    });

    it('워커잡 result가 문자열(JSON)인 경우 파싱', async () => {
      const session = makeSession();
      mockGetMany.mockResolvedValue([session]);
      mockQuery.mockResolvedValue([
        {
          sessionId: 'session-uuid-1',
          status: WorkerJobStatus.COMPLETED,
          result: JSON.stringify({
            outputFileUrl: '/storage/outputs/job-1/merged.pdf',
            outputFiles: [
              { type: 'cover', url: '/storage/outputs/job-1/cover.pdf' },
            ],
          }),
          outputFileUrl: '/storage/outputs/job-1/merged.pdf',
        },
      ]);

      const result = await service.findByOrderExternal(12345);

      expect(result[0].files.cover).toBe('/storage/outputs/job-1/cover.pdf');
      expect(result[0].files.merged).toBe('/storage/outputs/job-1/merged.pdf');
    });

    it('워커잡 outputFileUrl fallback (result에 없는 경우)', async () => {
      const session = makeSession();
      mockGetMany.mockResolvedValue([session]);
      mockQuery.mockResolvedValue([
        {
          sessionId: 'session-uuid-1',
          status: WorkerJobStatus.COMPLETED,
          result: { outputFiles: [] },
          outputFileUrl: '/storage/outputs/job-1/merged.pdf',
        },
      ]);

      const result = await service.findByOrderExternal(12345);

      expect(result[0].files.merged).toBe('/storage/outputs/job-1/merged.pdf');
    });
  });

  // ── 편집보관함 경량(summary) 모드 (2026-06-11) ──
  describe('findMyRecentSummary', () => {
    const makeSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'session-uuid-1',
        orderSeqno: 12345,
        memberSeqno: 100,
        status: SessionStatus.EDITING,
        mode: SessionMode.SPREAD,
        coverFile: null,
        contentFile: null,
        coverFileId: null,
        contentFileId: null,
        templateSetId: null,
        canvasData: { objects: [{ type: 'textbox' }] }, // 경량 모드에서 제외돼야 함
        metadata: null,
        completedAt: null,
        guestToken: null,
        guestExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
      }) as EditSessionEntity;

    it('canvasData 제외 + templateSetName/thumbnailUrl 포함, 이름은 단일 IN 쿼리 배치 조회', async () => {
      const sessions = [
        makeSession({
          id: 'session-1',
          templateSetId: 'ts-1',
          coverFile: {
            id: 'file-1',
            fileName: 'cover.pdf',
            originalName: 'cover.pdf',
            thumbnailUrl: '/storage/thumbs/file-1.png',
            fileSize: 1024,
            mimeType: 'application/pdf',
          } as any,
        }),
        // 같은 templateSetId 중복(IN 쿼리 dedupe 검증) + 셋 미연결 세션
        makeSession({ id: 'session-2', templateSetId: 'ts-1' }),
        makeSession({ id: 'session-3', templateSetId: null }),
      ];
      mockSessionRepository.find.mockResolvedValue(sessions);
      mockGetRawMany.mockResolvedValue([{ id: 'ts-1', name: 'A4 기본 책자' }]);

      const result = await service.findMyRecentSummary(100);

      expect(result).toHaveLength(3);
      // canvasData 부재 (목록 경량화)
      for (const dto of result) {
        expect(dto).not.toHaveProperty('canvasData');
      }
      // templateSetName 배치 조인
      expect(result[0].templateSetName).toBe('A4 기본 책자');
      expect(result[1].templateSetName).toBe('A4 기본 책자');
      expect(result[2].templateSetName).toBeNull(); // 셋 미연결 → null
      // thumbnailUrl 평탄화
      expect(result[0].thumbnailUrl).toBe('/storage/thumbs/file-1.png');
      expect(result[1].thumbnailUrl).toBeNull();
      // 단일 IN 쿼리 (세션당 N+1 금지) + 중복 id dedupe
      expect(mockSessionRepository.manager.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockManagerQueryBuilder.where).toHaveBeenCalledWith('ts.id IN (:...ids)', {
        ids: ['ts-1'],
      });
    });

    it('templateSetId 가 전부 null 이면 IN 쿼리 자체를 생략', async () => {
      mockSessionRepository.find.mockResolvedValue([
        makeSession({ id: 'session-1', templateSetId: null }),
      ]);

      const result = await service.findMyRecentSummary(100);

      expect(mockSessionRepository.manager.createQueryBuilder).not.toHaveBeenCalled();
      expect(result[0].templateSetName).toBeNull();
      expect(result[0]).not.toHaveProperty('canvasData');
    });
  });

  // ── C+ G2 (2026-07-11): 세션 검증 잡 orderOptions.size — A4 하드코드 → templateSet 판형 폴백 ──
  // A4 고정 디폴트는 비-A4 상품 세션의 생성 PDF 를 SIZE_MISMATCH 로 오검증했고
  // (FIXABLE→VALIDATED 매핑이 마스킹), 워커 게이팅 ON 시 session.failed 로 flip 하는 원인.
  describe('createValidationJobs orderOptions.size 소싱 (C+ G2)', () => {
    beforeEach(() => {
      // 리뷰 반영: undefined 반환 mock 은 서비스 내부 job.id 로깅에서 TypeError 를
      // 던져(이너 catch 가 삼킴) 성공 경로가 예외 경로로 검증되던 위생 문제 — 실 성공으로.
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-g2' } as any);
    });

    const makeSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'session-g2',
        contentFileId: 'file-content-1',
        coverFileId: null,
        templateSetId: null,
        metadata: null,
        ...overrides,
      }) as EditSessionEntity;

    const callPrivate = (session: EditSessionEntity): Promise<void> =>
      (service as unknown as { createValidationJobs(s: EditSessionEntity): Promise<void> })
        .createValidationJobs(session);

    const lastOrderOptions = () =>
      mockWorkerJobsService.createValidationJob.mock.calls.at(-1)?.[0]?.orderOptions;

    it('metadata.size 있으면 그대로 사용 (templateSet 무관)', async () => {
      mockTemplateSetsService.findOne = jest.fn();
      await callPrivate(
        makeSession({ metadata: { size: { width: 148, height: 210 } } as any, templateSetId: 'ts-1' }),
      );
      expect(lastOrderOptions().size).toEqual({ width: 148, height: 210 });
    });

    it('metadata.size 부재 + templateSet 있음 → templateSet 판형으로 폴백 (A4 아님)', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 250, height: 250, cropMarkEnabled: false });
      await callPrivate(makeSession({ templateSetId: 'ts-250' }));
      expect(mockTemplateSetsService.findOne).toHaveBeenCalledWith('ts-250');
      expect(lastOrderOptions().size).toEqual({ width: 250, height: 250 });
    });

    it('metadata.size 부재 + templateSetId 없음 → 최후 A4 폴백 (레거시 동일)', async () => {
      await callPrivate(makeSession({ templateSetId: null }));
      expect(lastOrderOptions().size).toEqual({ width: 210, height: 297 });
    });

    it('templateSet 조회 실패 → A4 폴백 + 잡 생성은 계속 (완료 비차단)', async () => {
      mockTemplateSetsService.findOne = jest.fn().mockRejectedValue(new Error('not found'));
      await callPrivate(makeSession({ templateSetId: 'ts-missing' }));
      expect(mockWorkerJobsService.createValidationJob).toHaveBeenCalled();
      expect(lastOrderOptions().size).toEqual({ width: 210, height: 297 });
    });

    it('cropMarkEnabled=true 주입(2026-06-10 게이트)은 폴백 재구조화 후에도 동일 동작', async () => {
      mockTemplateSetsService.findOne = jest.fn().mockResolvedValue({
        width: 200,
        height: 280,
        cropMarkEnabled: true,
        bleedMm: 3,
        sizeToleranceMm: 0.2,
      });
      await callPrivate(makeSession({ templateSetId: 'ts-crop' }));
      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 200, height: 280 });
      expect(oo.cropMarkEnabled).toBe(true);
      expect(oo.trimSize).toEqual({ width: 200, height: 280 });
      expect(oo.workSize).toEqual({ width: 206, height: 286 });
      expect(oo.sizeToleranceMm).toBe(0.2);
    });

    it('교차: metadata.size 있음 + cropMarkEnabled=true — size 는 metadata 우선, trim/work 주입은 templateSet 독립 수행', async () => {
      // 호이스트 재구조화가 지키려 한 우선순위 잠금: ①size 소싱(metadata > templateSet > A4)과
      // ②cropMark 주입(templateSet 게이트)은 서로 독립이다.
      mockTemplateSetsService.findOne = jest.fn().mockResolvedValue({
        width: 200,
        height: 280,
        cropMarkEnabled: true,
        bleedMm: 3,
        sizeToleranceMm: 0.2,
      });
      await callPrivate(
        makeSession({
          templateSetId: 'ts-crop',
          metadata: { size: { width: 148, height: 210 } } as any,
        }),
      );
      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 148, height: 210 }); // metadata 우선 유지
      expect(oo.cropMarkEnabled).toBe(true);
      expect(oo.trimSize).toEqual({ width: 200, height: 280 }); // 주입은 templateSet 기준
      expect(oo.workSize).toEqual({ width: 206, height: 286 });
    });
  });
});
