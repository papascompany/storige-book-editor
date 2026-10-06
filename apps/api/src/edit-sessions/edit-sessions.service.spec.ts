import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EditSessionsService } from './edit-sessions.service';
import {
  EditSessionEntity,
  SessionStatus,
  SessionMode,
} from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { WorkerJobStatus } from '@storige/types';
import { DataSource } from 'typeorm';

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

  // P1-4: canvasData 덮어쓰기 직전 스냅샷 저장소
  const mockVersionRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v: any) => ({ id: 'ver-1', ...v })),
    save: jest.fn(async (v: any) => v),
    delete: jest.fn(),
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
          provide: getRepositoryToken(EditSessionVersionEntity),
          useValue: mockVersionRepository,
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
    // 아래 기존 케이스는 SESSION_JOB_OUTPUT_LOOKUP=true(연결 잡 산출물 조회) 경로를 고정한다.
    // 기본값(false) 동작은 'SESSION_JOB_OUTPUT_LOOKUP 기본값' 블록에서 따로 고정한다.
    const lookupEnvBackup = process.env.SESSION_JOB_OUTPUT_LOOKUP;
    beforeEach(() => {
      process.env.SESSION_JOB_OUTPUT_LOOKUP = 'true';
    });
    afterEach(() => {
      if (lookupEnvBackup === undefined) delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
      else process.env.SESSION_JOB_OUTPUT_LOOKUP = lookupEnvBackup;
    });

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

    it('사이트 키 호출자: 자기 사이트 세션과 게스트 토큰이 없는 사이트 미지정 세션만 조회 조건에 포함', async () => {
      mockGetMany.mockResolvedValue([]);

      await service.findByOrderExternal(12345, { siteId: 'site-A', role: 'editor' });

      expect(mockSessionQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(session.siteId = :callerSiteId OR (session.siteId IS NULL AND session.guestToken IS NULL))',
        { callerSiteId: 'site-A' },
      );
    });

    it('worker 역할·호출자 미지정은 사이트 조건을 추가하지 않는다', async () => {
      mockGetMany.mockResolvedValue([]);

      await service.findByOrderExternal(12345, { siteId: 'site-A', role: 'worker' });
      await service.findByOrderExternal(12345);

      const siteClauses = mockSessionQueryBuilder.andWhere.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('callerSiteId'),
      );
      expect(siteClauses).toEqual([]);
    });

    it('ON: 잡 조회 SQL 은 세션 테이블과 조인해 잡 사이트가 세션 사이트와 같은(NULL 끼리 포함) 잡만 고른다', async () => {
      mockGetMany.mockResolvedValue([makeSession()]);
      mockQuery.mockResolvedValue([]);

      await service.findByOrderExternal(12345);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      const flat = sql.replace(/\s+/g, ' ');
      expect(flat).toContain('JOIN file_edit_sessions sess ON sess.id = job.edit_session_id');
      expect(flat).toContain('job.site_id <=> sess.site_id');
      expect(flat).toContain("job.job_type = 'SYNTHESIZE'");
      expect(params).toEqual([['session-uuid-1']]);
    });

    /**
     * ON 분기 SQL 을 sqlite 인메모리 DB 에서 실행해 귀속 조건을 확인한다(mysql 방언 SQL —
     * 백틱·? 파라미터는 sqlite 도 받는다. `<=>` 는 sqlite 의 같은 의미 연산자 `IS` 로, `IN (?)` 배열은 펼쳐서 실행).
     */
    type JobSeed = { id: string; siteId: string | null; createdAt: string };
    const attributionCases: Array<[string, string | null, JobSeed[], string | null]> = [
      ['세션 A · 잡 A → 그 잡', 'site-A', [{ id: 'job-a', siteId: 'site-A', createdAt: '2026-10-01' }], 'job-a'],
      ['세션 A · 잡 B(다른 사이트) → 제외', 'site-A', [{ id: 'job-b', siteId: 'site-B', createdAt: '2026-10-01' }], null],
      [
        '세션 A · 잡 A(이전)·잡 B(최신) → 다른 사이트 최신 잡은 제외하고 잡 A',
        'site-A',
        [
          { id: 'job-a', siteId: 'site-A', createdAt: '2026-10-01' },
          { id: 'job-b', siteId: 'site-B', createdAt: '2026-10-02' },
        ],
        'job-a',
      ],
      ['세션 A · 잡 NULL → 제외', 'site-A', [{ id: 'job-n', siteId: null, createdAt: '2026-10-01' }], null],
      ['세션 NULL · 잡 NULL → 그 잡', null, [{ id: 'job-n', siteId: null, createdAt: '2026-10-01' }], 'job-n'],
      ['세션 NULL · 잡 A → 제외', null, [{ id: 'job-a', siteId: 'site-A', createdAt: '2026-10-01' }], null],
    ];

    it.each(attributionCases)('ON 실행: %s', async (_label, sessionSite, jobs, expectedJobId) => {
      mockGetMany.mockResolvedValue([makeSession({ siteId: sessionSite } as Partial<EditSessionEntity>)]);
      mockQuery.mockResolvedValue([]);
      await service.findByOrderExternal(12345);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      const ids = params[0] as string[];
      const liteSql = sql
        .replace(/<=>/g, 'IS')
        .replace('IN (?)', `IN (${ids.map(() => '?').join(', ')})`)
        .replace('t.output_file_url AS outputFileUrl', 't.output_file_url AS outputFileUrl, t.id AS jobId')
        .replace('SELECT job.edit_session_id,', 'SELECT job.id, job.edit_session_id,');

      const lite = new DataSource({ type: 'sqlite', database: ':memory:' });
      await lite.initialize();
      try {
        await lite.query('CREATE TABLE file_edit_sessions (id TEXT, site_id TEXT)');
        await lite.query(
          'CREATE TABLE worker_jobs (id TEXT, edit_session_id TEXT, job_type TEXT, status TEXT, result TEXT, ' +
            'output_file_url TEXT, options TEXT, site_id TEXT, created_at TEXT)',
        );
        await lite.query('INSERT INTO file_edit_sessions (id, site_id) VALUES (?, ?)', ['session-uuid-1', sessionSite]);
        for (const j of jobs) {
          await lite.query(
            'INSERT INTO worker_jobs (id, edit_session_id, job_type, status, result, output_file_url, options, site_id, created_at) ' +
              "VALUES (?, 'session-uuid-1', 'SYNTHESIZE', 'COMPLETED', NULL, ?, NULL, ?, ?)",
            [j.id, `/storage/outputs/${j.id}/merged.pdf`, j.siteId, j.createdAt],
          );
        }
        const rows = (await lite.query(liteSql, ids)) as Array<{ jobId: string }>;
        expect(rows.map((r) => r.jobId)).toEqual(expectedJobId ? [expectedJobId] : []);
      } finally {
        await lite.destroy();
      }
    });

    describe('SESSION_JOB_OUTPUT_LOOKUP 기본값(미설정·false)', () => {
      it.each([[undefined], ['false'], ['0'], ['']])(
        'SESSION_JOB_OUTPUT_LOOKUP=%j → 잡 조회 없이 편집기 원본 파일, merged null',
        async (raw) => {
          if (raw === undefined) delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
          else process.env.SESSION_JOB_OUTPUT_LOOKUP = raw;
          const session = makeSession({
            coverFile: { id: 'file-1', fileUrl: '/storage/designs/cover.pdf' } as EditSessionEntity['coverFile'],
            contentFile: { id: 'file-2', fileUrl: '/storage/designs/content.pdf' } as EditSessionEntity['contentFile'],
          });
          mockGetMany.mockResolvedValue([session]);
          mockQuery.mockResolvedValue([
            {
              sessionId: 'session-uuid-1',
              status: WorkerJobStatus.COMPLETED,
              result: { outputFileUrl: '/storage/outputs/job-1/merged.pdf' },
              outputFileUrl: '/storage/outputs/job-1/merged.pdf',
            },
          ]);

          const result = await service.findByOrderExternal(12345);

          expect(mockQuery).not.toHaveBeenCalled();
          expect(result).toHaveLength(1);
          expect(result[0].files).toEqual({
            cover: '/storage/designs/cover.pdf',
            content: '/storage/designs/content.pdf',
            merged: null,
          });
        },
      );
    });
  });

  describe('getPromotionArtifact', () => {
    const lookupEnvBackup = process.env.SESSION_JOB_OUTPUT_LOOKUP;
    afterEach(() => {
      if (lookupEnvBackup === undefined) delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
      else process.env.SESSION_JOB_OUTPUT_LOOKUP = lookupEnvBackup;
    });

    const session = {
      id: 'session-uuid-1',
      siteId: 'site-A',
      coverFile: { id: 'file-1', fileUrl: '/storage/designs/cover.pdf' },
      contentFile: { id: 'file-2', fileUrl: '/storage/designs/content.pdf' },
    } as unknown as EditSessionEntity;
    const completedJobRow = {
      status: WorkerJobStatus.COMPLETED,
      result: {
        outputFileUrl: '/storage/outputs/job-1/merged.pdf',
        outputFiles: [
          { type: 'cover', url: '/storage/outputs/job-1/cover.pdf' },
          { type: 'content', url: '/storage/outputs/job-1/content.pdf' },
        ],
      },
      outputFileUrl: '/storage/outputs/job-1/merged.pdf',
    };

    it('기본값(미설정) → 잡 조회 없이 편집기 원본 파일, merged null', async () => {
      delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
      mockSessionRepository.findOne.mockResolvedValue(session);
      mockQuery.mockResolvedValue([completedJobRow]);

      const { files } = await service.getPromotionArtifact('session-uuid-1');

      expect(mockQuery).not.toHaveBeenCalled();
      expect(files).toEqual({
        cover: '/storage/designs/cover.pdf',
        content: '/storage/designs/content.pdf',
        merged: null,
      });
    });

    it('ON → 세션 사이트와 같은 잡의 최신 합성 산출물 1건을 조회해 쓴다', async () => {
      process.env.SESSION_JOB_OUTPUT_LOOKUP = 'true';
      mockSessionRepository.findOne.mockResolvedValue(session);
      mockQuery.mockResolvedValue([completedJobRow]);

      const { files } = await service.getPromotionArtifact('session-uuid-1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      const flat = sql.replace(/\s+/g, ' ');
      expect(flat).toContain('JOIN file_edit_sessions sess ON sess.id = job.edit_session_id');
      expect(flat).toContain('job.site_id <=> sess.site_id');
      expect(flat).toContain('ORDER BY job.created_at DESC LIMIT 1');
      expect(params).toEqual(['session-uuid-1']);
      expect(files).toEqual({
        cover: '/storage/outputs/job-1/cover.pdf',
        content: '/storage/outputs/job-1/content.pdf',
        merged: '/storage/outputs/job-1/merged.pdf',
      });
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

  // ── R-195(2026-09-28): 편집기 스프레드 책 — 표지·내지 잡에 주문 제본/쪽수/책등 기하 연결 ──
  describe('validateSpreadSnapshot — 책등 0mm 유효 (S7)', () => {
    const ORIGINAL_HARD = process.env.SPREAD_SNAPSHOT_HARD_FAIL;

    afterEach(() => {
      if (ORIGINAL_HARD === undefined) delete process.env.SPREAD_SNAPSHOT_HARD_FAIL;
      else process.env.SPREAD_SNAPSHOT_HARD_FAIL = ORIGINAL_HARD;
    });

    const spread = {
      spec: {
        coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 0, wingEnabled: false,
        wingWidthMm: 0, cutSizeMm: 3, safeSizeMm: 5, dpi: 150,
      },
      totalWidthMm: 420, totalHeightMm: 297, dpi: 150,
    };
    const spine = {
      pageCount: 40, paperType: 'mojo_80g', bindingType: 'spiral',
      spineWidthMm: 0, formulaVersion: '1.0',
    };

    const validate = (metadata: Record<string, unknown>) =>
      (
        service as unknown as {
          validateSpreadSnapshot(s: EditSessionEntity): { ok: boolean; mismatches: string[] };
        }
      ).validateSpreadSnapshot({
        id: 'session-s7',
        mode: SessionMode.SPREAD,
        metadata,
      } as unknown as EditSessionEntity);

    it('spineWidthMm=0 → 통과(SPINE_INVALID 아님)', () => {
      const r = validate({ spread, spine });
      expect(r.ok).toBe(true);
      expect(r.mismatches).toEqual([]);
    });

    it('HARD 모드에서도 spineWidthMm=0 은 차단하지 않는다', () => {
      process.env.SPREAD_SNAPSHOT_HARD_FAIL = 'true';
      expect(() => validate({ spread, spine })).not.toThrow();
    });

    it.each([
      ['음수', -0.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['문자열', '0'],
      ['null', null],
    ])('spineWidthMm %s → SPINE_INVALID', (_label, value) => {
      const r = validate({ spread, spine: { ...spine, spineWidthMm: value } });
      expect(r.ok).toBe(false);
      expect(r.mismatches).toHaveLength(1);
      expect(r.mismatches[0]).toMatch(/^SPINE_INVALID/);
    });

    it('spineWidthMm 키 누락 → SPINE_INVALID', () => {
      const { spineWidthMm: _omit, ...rest } = spine;
      const r = validate({ spread, spine: rest });
      expect(r.mismatches[0]).toMatch(/^SPINE_INVALID/);
    });

    it('spineWidthMm=0 이어도 perfect 제본 paperType 누락 → SPINE_INVALID(공식제본은 paperType 필수)', () => {
      const r = validate({ spread, spine: { ...spine, bindingType: 'perfect', paperType: '' } });
      expect(r.ok).toBe(false);
      expect(r.mismatches[0]).toMatch(/^SPINE_INVALID/);
    });

    it('spiral + 0mm + paperType 누락 → ok', () => {
      const { paperType: _omit, ...noPaper } = spine;
      const r = validate({ spread, spine: noPaper });
      expect(r.ok).toBe(true);
      expect(r.mismatches).toEqual([]);
    });

    it('saddle + >0mm + paperType 누락 → SPINE_INVALID', () => {
      const { paperType: _omit, ...noPaper } = spine;
      const r = validate({ spread, spine: { ...noPaper, bindingType: 'saddle', spineWidthMm: 3 } });
      expect(r.ok).toBe(false);
      expect(r.mismatches[0]).toMatch(/^SPINE_INVALID/);
    });

    it('0mm + bindingType 누락 → SPINE_INVALID', () => {
      const { paperType: _p, bindingType: _b, ...rest } = spine;
      const r = validate({ spread, spine: rest });
      expect(r.ok).toBe(false);
      expect(r.mismatches[0]).toMatch(/^SPINE_INVALID/);
    });

    it('metadata.spine 부재 → SPINE_MISSING', () => {
      const r = validate({ spread });
      expect(r.mismatches).toEqual(['SPINE_MISSING: metadata.spine 누락']);
    });
  });

  // ── D6 선행조건 ②: 세션 완료 검증 잡 테넌트 스탬프 — session.siteId 전달 + site default 머지 금지 ──
  describe('createValidationJobs — 검증 잡 site 스탬프 (D6 ②)', () => {
    beforeEach(() => {
      mockWorkerJobsService.createValidationJob.mockReset();
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-stamp' } as any);
    });

    const makeSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'session-stamp',
        coverFileId: 'file-cover-1',
        contentFileId: 'file-content-1',
        templateSetId: null,
        metadata: null,
        siteId: 'site-A',
        ...overrides,
      }) as EditSessionEntity;

    const callPrivate = (session: EditSessionEntity): Promise<void> =>
      (service as unknown as { createValidationJobs(s: EditSessionEntity): Promise<void> })
        .createValidationJobs(session);

    it('session.siteId 있음 → cover·content 두 VALIDATE 잡 모두 siteId 스탬프 + 머지 skip 옵션', async () => {
      await callPrivate(makeSession());

      const calls = mockWorkerJobsService.createValidationJob.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c[0].fileType)).toEqual(['cover', 'content']);
      for (const [dto, internal] of calls) {
        expect(dto.siteId).toBe('site-A');
        expect(dto.editSessionId).toBe('session-stamp');
        expect(internal).toEqual({ skipSiteWorkerDefaults: true });
      }
    });

    it('session.siteId NULL(게스트/무사이트) → siteId 미전달(undefined, 종전 NULL 스탬프 유지)', async () => {
      await callPrivate(makeSession({ siteId: null }));

      const calls = mockWorkerJobsService.createValidationJob.mock.calls;
      expect(calls).toHaveLength(2);
      for (const [dto, internal] of calls) {
        expect(dto.siteId).toBeUndefined();
        expect(internal).toEqual({ skipSiteWorkerDefaults: true });
      }
    });
  });

  describe('createValidationJobs — 편집기 스프레드 책 검증 연결 (R-195)', () => {
    const ORIGINAL_FLAG = process.env.EDITOR_SPREAD_VALIDATION_MAPPING;

    beforeEach(() => {
      mockWorkerJobsService.createValidationJob.mockReset();
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-r195' } as any);
      delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
    });

    afterAll(() => {
      if (ORIGINAL_FLAG === undefined) delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
      else process.env.EDITOR_SPREAD_VALIDATION_MAPPING = ORIGINAL_FLAG;
    });

    const spreadMetadata = {
      orderOptions: { bindingType: 'spiral' },
      spreadContentPageCount: 40,
      spread: {
        spec: {
          coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 0, wingEnabled: false,
          wingWidthMm: 0, cutSizeMm: 3, safeSizeMm: 5, dpi: 150,
        },
        totalWidthMm: 420, totalHeightMm: 297, dpi: 150,
      },
      coverOutput: { widthMm: 426, heightMm: 303, bleedMm: 3 },
      appliedSpine: { spineWidthMm: 0, source: 'host' },
    };

    const mkSession = (metadata: Record<string, unknown> | null): EditSessionEntity =>
      ({
        id: 'session-r195',
        coverFileId: 'file-cover-r195',
        contentFileId: 'file-content-r195',
        templateSetId: null,
        metadata,
      }) as unknown as EditSessionEntity;

    const callPrivate = (session: EditSessionEntity): Promise<void> =>
      (service as unknown as { createValidationJobs(s: EditSessionEntity): Promise<void> })
        .createValidationJobs(session);

    const optionsFor = (fileType: 'cover' | 'content') =>
      mockWorkerJobsService.createValidationJob.mock.calls.find(
        (c: any[]) => c[0]?.fileType === fileType,
      )?.[0]?.orderOptions;

    it('표지 = 스펙 판형·책등·도련 + 주문 제본, 내지 = 주문 제본 + 실제 쪽수 (서로 다른 객체)', async () => {
      await callPrivate(mkSession(spreadMetadata));
      const cover = optionsFor('cover');
      const content = optionsFor('content');
      expect(cover).toMatchObject({
        binding: 'spiral', pages: 40, size: { width: 210, height: 297 },
        spineWidthMm: 0, bleed: 3, wingEnabled: false, expectedOrientation: 'landscape',
      });
      expect(cover).not.toHaveProperty('paperType');
      expect(content).toMatchObject({ binding: 'spiral', pages: 40, size: { width: 210, height: 297 } });
      expect(content).not.toHaveProperty('spineWidthMm');
    });

    it('EDITOR_SPREAD_VALIDATION_MAPPING=off → 현행(perfect·pages 1·책등 없음) 그대로', async () => {
      process.env.EDITOR_SPREAD_VALIDATION_MAPPING = 'off';
      await callPrivate(mkSession(spreadMetadata));
      expect(optionsFor('cover')).toMatchObject({ binding: 'perfect', pages: 1 });
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      expect(optionsFor('content')).toMatchObject({ binding: 'perfect', pages: 1 });
    });

    it('스프레드 스냅샷 없는 세션 → 현행 그대로(표지·내지 동일 옵션)', async () => {
      await callPrivate(mkSession({ orderOptions: { bindingType: 'saddle' } }));
      expect(optionsFor('cover')).toMatchObject({ binding: 'perfect', pages: 1 });
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      expect(optionsFor('content')).toEqual(optionsFor('cover'));
    });

    it('coverOutput 없음(구 편집기 빌드) → 표지는 현행 그대로(제본 보정도 금지), 내지만 보정', async () => {
      const { coverOutput: _omit, ...legacy } = spreadMetadata;
      await callPrivate(mkSession(legacy));
      // spiral 을 표지에 얹으면 책등 기대치 없는 펼침 표지가 단일 판형 검사로 오차단된다
      expect(optionsFor('cover')).toMatchObject({ binding: 'perfect', pages: 1 });
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      expect(optionsFor('content')).toMatchObject({ binding: 'spiral', pages: 40 });
    });

    // ── Wave 6 D1: 싸바리 전개 표지 — 템플릿셋 판형 결선 ──
    // A4 · 책등 8: 면 218×305, 전개 (218×2+8+40)×(305+40) = 484×345
    const wrapMetadata = {
      orderOptions: { bindingType: 'hardcover' },
      spreadContentPageCount: 32,
      spread: {
        spec: {
          coverWidthMm: 218, coverHeightMm: 305, spineWidthMm: 8, wingEnabled: false,
          wingWidthMm: 0, cutSizeMm: 40, safeSizeMm: 5, dpi: 150,
        },
        totalWidthMm: 444, totalHeightMm: 305, dpi: 150,
      },
      coverOutput: {
        widthMm: 484, heightMm: 345, bleedMm: 0,
        layout: 'hardcover-wrap', trimWidthMm: 210, trimHeightMm: 297, wrapMm: 20,
      },
      appliedSpine: { spineWidthMm: 8, source: 'host' },
    };

    const withTemplateSet = (width: number, height: number) => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width, height, cropMarkEnabled: false });
      mockTemplateSetsService.findOneWithTemplates = jest
        .fn()
        .mockResolvedValue({ templateDetails: [] });
    };

    const mkSessionWithSet = (metadata: Record<string, unknown> | null): EditSessionEntity =>
      ({ ...mkSession(metadata), templateSetId: 'ts-r195' }) as unknown as EditSessionEntity;

    it('싸바리 전개 + 템플릿셋 판형 일치 → 표지 hardcover 연결(판형=템플릿셋, 도련 0), 템플릿셋 추가 조회 없음', async () => {
      withTemplateSet(210, 297);
      await callPrivate(mkSessionWithSet(wrapMetadata));
      expect(mockTemplateSetsService.findOne).toHaveBeenCalledTimes(1);
      expect(optionsFor('cover')).toMatchObject({
        binding: 'hardcover', pages: 32, size: { width: 210, height: 297 },
        spineWidthMm: 8, bleed: 0, wingEnabled: false, wingWidthMm: 0,
        expectedOrientation: 'landscape',
      });
      expect(optionsFor('cover')).not.toHaveProperty('paperType');
      // 양장 내지는 현행(perfect 계열) 유지 — 쪽수만 보정
      expect(optionsFor('content')).toMatchObject({ binding: 'perfect', pages: 32 });
      expect(optionsFor('content')).not.toHaveProperty('spineWidthMm');
    });

    it('싸바리 전개 + 템플릿셋 미연결 → 표지 현행 그대로, warn 에 undefined 미출력', async () => {
      const warnSpy = jest.spyOn(
        (service as unknown as { logger: { warn(message: string): void } }).logger,
        'warn',
      );
      await callPrivate(mkSession(wrapMetadata));
      expect(optionsFor('cover')).toMatchObject({ binding: 'perfect', pages: 1 });
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      // 양장 내지는 현행(perfect 계열) 유지 — 쪽수만 보정
      expect(optionsFor('content')).toMatchObject({ binding: 'perfect', pages: 32 });
      const skipLogs = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('표지 책등 연결 생략(GEOMETRY_INCONSISTENT)'));
      expect(skipLogs).toHaveLength(1);
      expect(skipLogs[0]).not.toContain('undefined');
      warnSpy.mockRestore();
    });

    it('싸바리 전개 + 템플릿셋 판형 불일치(기록 210×297 ≠ 세트 297×210) → 표지 현행 그대로', async () => {
      withTemplateSet(297, 210);
      await callPrivate(mkSessionWithSet(wrapMetadata));
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      expect(optionsFor('cover')?.binding).not.toBe('hardcover');
    });

    it('layout 없는 세션 → 템플릿셋 판형이 주어져도 표지 책등 연결 결과 불변', async () => {
      withTemplateSet(210, 297);
      await callPrivate(mkSessionWithSet(spreadMetadata));
      // 첫 테스트(템플릿셋 미연결)와 같은 표지 보정값 — 판형 인자는 layout 없는 표지 판정에 쓰이지 않는다
      expect(optionsFor('cover')).toMatchObject({
        binding: 'spiral', pages: 40, size: { width: 210, height: 297 },
        spineWidthMm: 0, bleed: 3, wingEnabled: false, expectedOrientation: 'landscape',
      });
      expect(optionsFor('cover')).not.toHaveProperty('paperType');
      // 내지 방향(portrait)은 기존 비정사각 템플릿셋 방향 주입 — 이번 결선과 무관한 현행
      expect(optionsFor('content')).toMatchObject({
        binding: 'spiral', pages: 40, size: { width: 210, height: 297 }, expectedOrientation: 'portrait',
      });
      expect(optionsFor('content')).not.toHaveProperty('spineWidthMm');
    });

    it('layout 없는 양장 주문 → 템플릿셋 판형이 있어도 표지 연결 생략(현행)', async () => {
      withTemplateSet(210, 297);
      const { layout: _l, trimWidthMm: _w, trimHeightMm: _h, wrapMm: _m, ...plainOutput } =
        wrapMetadata.coverOutput;
      await callPrivate(mkSessionWithSet({ ...wrapMetadata, coverOutput: plainOutput }));
      expect(optionsFor('cover')).not.toHaveProperty('spineWidthMm');
      expect(optionsFor('cover')?.binding).not.toBe('hardcover');
      // 양장 내지는 현행(perfect 계열) 유지 — 쪽수만 보정
      expect(optionsFor('content')).toMatchObject({ binding: 'perfect', pages: 32 });
    });
  });

  // ── 방향 정합 (2026-07-14, 오너 규격표): size W↔H 스왑 정규화 + expectedOrientation ──
  // templateSet = 오리엔트된 판형 권위(가로 A4 세트=297×210), metadata.size 는 bookmoa
  // 미오리엔트 전달 이력(R-13). 워커 validatePageSize 는 무수정(축별 엄격 비교 유지) —
  // 정규화는 기준값 유도측에서 "정확 스왑 관계"에만 수행. 스왑 아닌 불일치는 원본 보존.
  // 2026-08-03 E2E 실측: 포토북 내지 세트의 content.pdf 는 '1페이지 = 1펼침면'(D-1)이라
  // 실제 페이지가 420×297 인데 기대값이 세트 판형(210×297)이라 정상 PDF 가 매번
  // SIZE_MISMATCH 로 오검증됐다. (기대: 210x297mm, 현재: 420x297mm)
  describe('createValidationJobs — 내지 펼침면 content 크기 (2026-08-03)', () => {
    beforeEach(() => {
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-inner' } as any);
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 210, height: 297, cropMarkEnabled: false });
    });

    const mkSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'session-inner',
        contentFileId: 'file-content-inner',
        coverFileId: null,
        templateSetId: 'ts-inner',
        metadata: null,
        ...overrides,
      }) as EditSessionEntity;

    const call = (session: EditSessionEntity): Promise<void> =>
      (service as unknown as { createValidationJobs(s: EditSessionEntity): Promise<void> })
        .createValidationJobs(session);

    const lastOpts = () =>
      mockWorkerJobsService.createValidationJob.mock.calls.at(-1)?.[0]?.orderOptions;

    const withInnerSpread = (pageWidthMm = 210, pageHeightMm = 297) => {
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockResolvedValue({
        templateDetails: [
          { type: 'spread', spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm, pageHeightMm } } },
        ],
      });
    };

    it('내지 펼침면이면 기대 크기 = 한 면 × 2 (펼침면)', async () => {
      withInnerSpread(210, 297);
      await call(mkSession());
      expect(lastOpts().size).toEqual({ width: 420, height: 297 });
    });

    it('metadata.size 가 있어도 내지 펼침면 크기가 우선한다(서버 권위)', async () => {
      withInnerSpread(210, 297);
      await call(mkSession({ metadata: { size: { width: 210, height: 297 } } as any }));
      expect(lastOpts().size).toEqual({ width: 420, height: 297 });
    });

    it('방향도 펼침면 기준 — 세로 판형의 펼침면은 landscape', async () => {
      withInnerSpread(210, 297);
      await call(mkSession());
      expect(lastOpts().expectedOrientation).toBe('landscape');
    });

    it('표지 spread(cover)는 기존 폴백 그대로 — 무회귀', async () => {
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockResolvedValue({
        templateDetails: [
          { type: 'spread', spreadConfig: { regionScope: 'cover', spec: { coverWidthMm: 210, coverHeightMm: 297 } } },
        ],
      });
      await call(mkSession());
      expect(lastOpts().size).toEqual({ width: 210, height: 297 });
    });

    it('innerSpec 치수가 비유효하면 폴백(잡 생성은 계속)', async () => {
      withInnerSpread(0, 297);
      await call(mkSession());
      expect(lastOpts().size).toEqual({ width: 210, height: 297 });
      expect(mockWorkerJobsService.createValidationJob).toHaveBeenCalled();
    });

    it('findOneWithTemplates 실패해도 완료 비차단 + 기존 폴백', async () => {
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockRejectedValue(new Error('boom'));
      await call(mkSession());
      expect(lastOpts().size).toEqual({ width: 210, height: 297 });
      expect(mockWorkerJobsService.createValidationJob).toHaveBeenCalled();
    });

    // ── N-API-3(W8): [표지 spread → 내지 spread] 결합 세트 — 펼침면 크기·방향은 content 잡에만 ──
    describe('결합 세트(표지 spread + 내지 spread) — content 잡에만 펼침면 적용', () => {
      // 아래 describe 들이 mockTemplateSetsService 상태를 공유하므로 진입 전 mock 을 복원한다.
      let savedFindOne: typeof mockTemplateSetsService.findOne;
      let savedFindOneWithTemplates: typeof mockTemplateSetsService.findOneWithTemplates;
      beforeAll(() => {
        savedFindOne = mockTemplateSetsService.findOne;
        savedFindOneWithTemplates = mockTemplateSetsService.findOneWithTemplates;
      });
      afterAll(() => {
        mockTemplateSetsService.findOne = savedFindOne;
        mockTemplateSetsService.findOneWithTemplates = savedFindOneWithTemplates;
      });

      const COVER_SPREAD = {
        type: 'spread',
        spreadConfig: {
          regionScope: 'cover',
          spec: { coverWidthMm: 218, coverHeightMm: 218, spineWidthMm: 8 },
        },
      };
      const UNSCOPED_SPREAD = {
        type: 'spread',
        spreadConfig: { spec: { coverWidthMm: 210, coverHeightMm: 297 } },
      };
      const PAGE = { type: 'page', spreadConfig: null };
      const innerSpread = (pageWidthMm: number, pageHeightMm: number) => ({
        type: 'spread',
        spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm, pageHeightMm } },
      });
      const withDetails = (templateDetails: unknown[]): void => {
        mockTemplateSetsService.findOneWithTemplates = jest
          .fn()
          .mockResolvedValue({ templateDetails });
      };
      const withTrim = (width: number, height: number): void => {
        mockTemplateSetsService.findOne = jest
          .fn()
          .mockResolvedValue({ width, height, cropMarkEnabled: false });
      };
      const optsFor = (fileType: 'cover' | 'content') =>
        mockWorkerJobsService.createValidationJob.mock.calls.find(
          (c: any[]) => c[0]?.fileType === fileType,
        )?.[0]?.orderOptions;
      const withCover = (metadata: Record<string, unknown> | null = null): EditSessionEntity =>
        mkSession({ coverFileId: 'file-cover-inner', metadata: metadata as any });
      type InnerLayout =
        | { kind: 'inner-spread'; size: { width: number; height: number } }
        | { kind: 'none' }
        | { kind: 'unknown' };
      const resolve = (session: EditSessionEntity): Promise<InnerLayout> =>
        (
          service as unknown as {
            resolveInnerSpreadContentSizeMm(s: EditSessionEntity): Promise<InnerLayout>;
          }
        ).resolveInnerSpreadContentSizeMm(session);

      it('[표지 spread, 내지 spread] → content 420×210·landscape, 표지 잡은 판형 210×210(방향 미주입)', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, innerSpread(210, 210)]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 420, height: 210 });
        expect(optsFor('content').expectedOrientation).toBe('landscape');
        expect(optsFor('cover').size).toEqual({ width: 210, height: 210 });
        expect(optsFor('cover')).not.toHaveProperty('expectedOrientation');
      });

      it('순서가 [내지, 표지] 여도 content 는 420×210', async () => {
        withTrim(210, 210);
        withDetails([innerSpread(210, 210), COVER_SPREAD]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 420, height: 210 });
      });

      it('regionScope 미기재 spread 가 앞에 있어도 내지 spread 를 찾는다(A4 → 420×297)', async () => {
        withTrim(210, 297);
        withDetails([UNSCOPED_SPREAD, innerSpread(210, 297), PAGE]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 420, height: 297 });
        expect(optsFor('content').expectedOrientation).toBe('landscape');
      });

      it('결합 세트에서도 metadata.size(호스트 판형)보다 펼침면 크기가 우선', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, innerSpread(210, 210)]);
        await call(withCover({ size: { width: 210, height: 210 } }));
        expect(optsFor('content').size).toEqual({ width: 420, height: 210 });
        expect(optsFor('cover').size).toEqual({ width: 210, height: 210 });
      });

      it('결합 세트의 내지 innerSpec 이 비유효하면 기존 폴백(판형) — 잡 생성 계속', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, innerSpread(0, 210)]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 210, height: 210 });
        expect(optsFor('cover').size).toEqual({ width: 210, height: 210 });
      });

      it("resolveInnerSpreadContentSizeMm: 내지 spread 가 없는 세트는 'none', 결합 세트는 펼침면", async () => {
        withDetails([PAGE]);
        await expect(resolve(withCover())).resolves.toEqual({ kind: 'none' });
        withDetails([COVER_SPREAD, PAGE]);
        await expect(resolve(withCover())).resolves.toEqual({ kind: 'none' });
        withDetails([UNSCOPED_SPREAD]);
        await expect(resolve(withCover())).resolves.toEqual({ kind: 'none' });
        withDetails([COVER_SPREAD, innerSpread(210, 210)]);
        await expect(resolve(withCover())).resolves.toEqual({
          kind: 'inner-spread',
          size: { width: 420, height: 210 },
        });
      });

      it("resolveInnerSpreadContentSizeMm(N-API-3b 3분기): 템플릿셋 미연결 'none', 치수 무효·조회 예외 'unknown'", async () => {
        await expect(resolve(mkSession({ templateSetId: null }))).resolves.toEqual({ kind: 'none' });
        withDetails([COVER_SPREAD, innerSpread(0, 210)]);
        await expect(resolve(withCover())).resolves.toEqual({ kind: 'unknown' });
        mockTemplateSetsService.findOneWithTemplates = jest.fn().mockRejectedValue(new Error('boom'));
        await expect(resolve(withCover())).resolves.toEqual({ kind: 'unknown' });
      });

      it('비스프레드 세트(page 만)는 무회귀 — 표지·내지 동일 판형 옵션', async () => {
        withTrim(210, 297);
        withDetails([PAGE]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 210, height: 297 });
        expect(optsFor('content').expectedOrientation).toBe('portrait');
        expect(optsFor('content')).toEqual(optsFor('cover'));
      });

      it('표지 spread 만 있는 세트는 무회귀(판형 폴백)', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, PAGE]);
        await call(withCover());
        expect(optsFor('content').size).toEqual({ width: 210, height: 210 });
        expect(optsFor('content')).toEqual(optsFor('cover'));
      });

      it('[필수] 결합 세트 + 표지 연결 생략 세션(S4형: 양장·coverOutput 496×276) → 표지 잡 옵션 현행 그대로', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, innerSpread(210, 210)]);
        await call(
          withCover({
            orderOptions: { bindingType: 'hardcover' },
            spreadContentPageCount: 8,
            spread: {
              spec: {
                coverWidthMm: 247.4, coverHeightMm: 276, spineWidthMm: 1.2,
                wingEnabled: false, wingWidthMm: 0, cutSizeMm: 3,
              },
            },
            appliedSpine: { spineWidthMm: 1.2, source: 'template' },
            coverOutput: { widthMm: 496, heightMm: 276, bleedMm: 0 },
          }),
        );
        // 표지 = 공유 기본 옵션(판형 210×210, 정사각이라 방향 미주입, 책등 연결 없음) — fixB 이전과 동일
        expect(optsFor('cover')).toEqual({
          size: { width: 210, height: 210 },
          pages: 1,
          binding: 'perfect',
          bleed: 3,
        });
        expect(optsFor('content')).toMatchObject({
          size: { width: 420, height: 210 },
          expectedOrientation: 'landscape',
          binding: 'perfect', // 양장 내지 = 무선 기준(R-195 content 보정 현행)
          pages: 8,
        });
      });

      it('[필수] 내지 선행 세트([내지, 표지])의 표지 잡은 펼침면 크기·방향을 받지 않는다', async () => {
        withTrim(210, 297);
        withDetails([innerSpread(210, 297), COVER_SPREAD]);
        await call(withCover());
        expect(optsFor('cover').size).toEqual({ width: 210, height: 297 });
        expect(optsFor('cover').expectedOrientation).toBe('portrait');
        expect(optsFor('content').size).toEqual({ width: 420, height: 297 });
        expect(optsFor('content').expectedOrientation).toBe('landscape');
      });

      it('싸바리 표지 연결 세션: 표지 잡 size 는 판형(override) 유지, 내지만 펼침면', async () => {
        withTrim(210, 210);
        withDetails([COVER_SPREAD, innerSpread(210, 210)]);
        await call(
          withCover({
            orderOptions: { bindingType: 'hardcover' },
            spreadContentPageCount: 8,
            spread: {
              spec: { coverWidthMm: 218, coverHeightMm: 218, spineWidthMm: 8, wingEnabled: false, wingWidthMm: 0 },
            },
            appliedSpine: { spineWidthMm: 8, source: 'template' },
            coverOutput: {
              widthMm: 484, heightMm: 258, bleedMm: 0, layout: 'hardcover-wrap',
              trimWidthMm: 210, trimHeightMm: 210, wrapMm: 20,
            },
          }),
        );
        expect(optsFor('cover')).toMatchObject({
          binding: 'hardcover', size: { width: 210, height: 210 }, spineWidthMm: 8,
        });
        expect(optsFor('content')).toMatchObject({ size: { width: 420, height: 210 }, pages: 8 });
      });

      it('EDITOR_SPREAD_VALIDATION_MAPPING=off 여도 content 펼침면 크기는 적용(플래그 밖)', async () => {
        const original = process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
        process.env.EDITOR_SPREAD_VALIDATION_MAPPING = 'off';
        try {
          withTrim(210, 210);
          withDetails([COVER_SPREAD, innerSpread(210, 210)]);
          await call(withCover());
          expect(optsFor('content').size).toEqual({ width: 420, height: 210 });
          expect(optsFor('cover').size).toEqual({ width: 210, height: 210 });
        } finally {
          if (original === undefined) delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
          else process.env.EDITOR_SPREAD_VALIDATION_MAPPING = original;
        }
      });
    });
  });

  // ── N-API-3b(2026-10-06): 편집기 실효 쪽 단위 → content PDF 쪽 단위 pageMultiple(중철 pageCountMax) ──
  // 오너 결정 D1(a): page_step NULL + 낱장은 미주입(레거시 그대로). 'deep-equal' 기준선은 같은 세션을
  // EDITOR_CONTENT_PAGE_RULES=off 로 다시 만든 잡 옵션(= 이번 변경 이전 동작)이다.
  describe('createValidationJobs — N-API-3b 쪽 단위', () => {
    const ORIGINAL_RULES = process.env.EDITOR_CONTENT_PAGE_RULES;
    const ORIGINAL_MAPPING = process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
    let savedFindOne: typeof mockTemplateSetsService.findOne;
    let savedFindOneWithTemplates: typeof mockTemplateSetsService.findOneWithTemplates;

    beforeAll(() => {
      savedFindOne = mockTemplateSetsService.findOne;
      savedFindOneWithTemplates = mockTemplateSetsService.findOneWithTemplates;
    });

    beforeEach(() => {
      mockWorkerJobsService.createValidationJob.mockReset();
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-3b' } as any);
      delete process.env.EDITOR_CONTENT_PAGE_RULES;
      delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
    });

    afterEach(() => {
      if (ORIGINAL_RULES === undefined) delete process.env.EDITOR_CONTENT_PAGE_RULES;
      else process.env.EDITOR_CONTENT_PAGE_RULES = ORIGINAL_RULES;
      if (ORIGINAL_MAPPING === undefined) delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
      else process.env.EDITOR_SPREAD_VALIDATION_MAPPING = ORIGINAL_MAPPING;
    });

    afterAll(() => {
      mockTemplateSetsService.findOne = savedFindOne;
      mockTemplateSetsService.findOneWithTemplates = savedFindOneWithTemplates;
    });

    const CONTENT_ID = 'file-content-3b';
    const PAGE = { type: 'page', spreadConfig: null };
    const COVER_SPREAD = {
      type: 'spread',
      spreadConfig: { regionScope: 'cover', spec: { coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 2 } },
    };
    const INNER_SPREAD = {
      type: 'spread',
      spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm: 210, pageHeightMm: 297 } },
    };

    /** 템플릿셋(A4·크롭마크 off) + pageStep, 템플릿 구성(낱장 'none' / 결합 펼침면 'inner') */
    const withSet = (pageStep: number | null, layout: 'none' | 'inner'): void => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 210, height: 297, cropMarkEnabled: false, pageStep });
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockResolvedValue({
        templateDetails: layout === 'inner' ? [COVER_SPREAD, INNER_SPREAD] : [PAGE],
      });
    };

    const meta = (
      orderOptions: Record<string, unknown> = { bindingType: 'perfect' },
      over: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      orderOptions,
      spreadContentPageCount: 20,
      spread: {
        spec: { coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 2, wingEnabled: false, wingWidthMm: 0 },
      },
      editorOutputContentFileId: CONTENT_ID,
      ...over,
    });

    const mkSession = (metadata: Record<string, unknown> | null): EditSessionEntity =>
      ({
        id: 'session-3b',
        coverFileId: 'file-cover-3b',
        contentFileId: CONTENT_ID,
        templateSetId: 'ts-3b',
        metadata,
      }) as unknown as EditSessionEntity;

    type JobOptions = Record<string, unknown>;
    const optsFor = (fileType: 'cover' | 'content'): JobOptions =>
      mockWorkerJobsService.createValidationJob.mock.calls.find(
        (c: any[]) => c[0]?.fileType === fileType,
      )?.[0]?.orderOptions;

    const call = async (session: EditSessionEntity): Promise<{ cover: JobOptions; content: JobOptions }> => {
      mockWorkerJobsService.createValidationJob.mockClear();
      await (service as unknown as { createValidationJobs(s: EditSessionEntity): Promise<void> })
        .createValidationJobs(session);
      return { cover: optsFor('cover'), content: optsFor('content') };
    };

    /** 같은 세션을 킬스위치 off(= 변경 이전)와 기본(on)으로 각각 만든다 */
    const callOffThenOn = async (
      session: EditSessionEntity,
    ): Promise<{ off: { cover: JobOptions; content: JobOptions }; on: { cover: JobOptions; content: JobOptions } }> => {
      process.env.EDITOR_CONTENT_PAGE_RULES = 'off';
      const off = await call(session);
      delete process.env.EDITOR_CONTENT_PAGE_RULES;
      const on = await call(session);
      return { off, on };
    };

    it('① 결합 세트(내지 펼침면) step4 → content pageMultiple 2, 그 밖의 키·cover 잡은 이전과 deep-equal', async () => {
      withSet(4, 'inner');
      const logSpy = jest.spyOn(
        (service as unknown as { logger: { log(message: string): void } }).logger,
        'log',
      );
      const { off, on } = await callOffThenOn(mkSession(meta()));
      expect(on.content).toEqual({ ...off.content, pageMultiple: 2 });
      expect(on.content).toMatchObject({ size: { width: 420, height: 297 }, binding: 'perfect', pages: 20 });
      expect(on.content).not.toHaveProperty('pageCountMax');
      expect(on.cover).toEqual(off.cover);
      expect(on.cover).not.toHaveProperty('pageMultiple');
      const ruleLogs = logSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('내지 쪽 규칙'));
      expect(ruleLogs).toEqual([
        '[validation-jobs] session session-3b 내지 쪽 규칙: S=4 k=2 pageMultiple=2 max=- source=template',
      ]);
      logSpy.mockRestore();
    });

    it('② 낱장 step2 → content pageMultiple 2', async () => {
      withSet(2, 'none');
      const { off, on } = await callOffThenOn(mkSession(meta()));
      expect(on.content).toEqual({ ...off.content, pageMultiple: 2 });
      expect(on.cover).toEqual(off.cover);
    });

    it.each<[string, Record<string, unknown>]>([
      ['bindingType 미전송', {}],
      ['명시적 무선(D1(a) — 2배수 기본값 없음)', { bindingType: 'perfect' }],
    ])('③ page_step NULL 낱장 + %s → content·cover 이전과 deep-equal', async (_name, orderOptions) => {
      withSet(null, 'none');
      const { off, on } = await callOffThenOn(mkSession(meta(orderOptions)));
      expect(on.content).toEqual(off.content);
      expect(on.content).not.toHaveProperty('pageMultiple');
      expect(on.content).not.toHaveProperty('pageCountMax');
      expect(on.cover).toEqual(off.cover);
    });

    it('④ EDITOR_CONTENT_PAGE_RULES=off → 쪽 규칙 키 없음(이전과 동일), 대소문자·공백 무시', async () => {
      withSet(4, 'inner');
      process.env.EDITOR_CONTENT_PAGE_RULES = ' OFF ';
      const off = await call(mkSession(meta()));
      expect(off.content).not.toHaveProperty('pageMultiple');
      expect(off.content).not.toHaveProperty('pageCountMax');
      expect(off.content).toMatchObject({ size: { width: 420, height: 297 }, binding: 'perfect', pages: 20 });
      delete process.env.EDITOR_CONTENT_PAGE_RULES;
      const on = await call(mkSession(meta()));
      const { pageMultiple: _pm, ...onWithoutRules } = on.content;
      expect(onWithoutRules).toEqual(off.content);
    });

    it.each<[string, Record<string, unknown>]>([
      ['마커 불일치(첨부 교체 세션)', meta({ bindingType: 'perfect' }, { editorOutputContentFileId: 'file-other' })],
      ['단일 모드 metadata(spread 스냅샷 없음)', { orderOptions: { bindingType: 'perfect' }, editorOutputContentFileId: CONTENT_ID }],
    ])('⑤ %s → content 쪽 규칙 키 없음', async (_name, metadata) => {
      withSet(2, 'none');
      const { off, on } = await callOffThenOn(mkSession(metadata));
      expect(on.content).toEqual(off.content);
      expect(on.content).not.toHaveProperty('pageMultiple');
    });

    it('⑥ 중철 주문 step2 낱장 → pageMultiple 4 · pageCountMax 64', async () => {
      withSet(2, 'none');
      const { off, on } = await callOffThenOn(mkSession(meta({ bindingType: 'saddle' })));
      expect(on.content).toEqual({ ...off.content, pageMultiple: 4, pageCountMax: 64 });
      expect(on.content.binding).toBe('saddle');
      expect(on.cover).toEqual(off.cover);
    });

    it('⑦ findOneWithTemplates 예외(판정 unknown) → 쪽 규칙 키 없음, size 는 기존 폴백', async () => {
      withSet(4, 'inner');
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockRejectedValue(new Error('boom'));
      const { content } = await call(mkSession(meta()));
      expect(content).not.toHaveProperty('pageMultiple');
      expect(content.size).toEqual({ width: 210, height: 297 });
      expect(mockWorkerJobsService.createValidationJob).toHaveBeenCalledTimes(2);
    });

    it('⑧ templateSet findOne 실패 + 호스트 pageStep 2 → pageMultiple 2 (A4 최후 폴백 유지)', async () => {
      mockTemplateSetsService.findOne = jest.fn().mockRejectedValue(new Error('db down'));
      mockTemplateSetsService.findOneWithTemplates = jest.fn().mockResolvedValue({ templateDetails: [PAGE] });
      const { content } = await call(mkSession(meta({ bindingType: 'perfect', pageStep: 2 })));
      expect(content).toMatchObject({ pageMultiple: 2, size: { width: 210, height: 297 } });
      expect(content).not.toHaveProperty('pageCountMax');
    });

    it('⑨ 양장 주문: step4 낱장 → 4(binding 은 perfect 유지), page_step NULL 낱장 → 이전과 deep-equal', async () => {
      withSet(4, 'none');
      const step4 = await callOffThenOn(mkSession(meta({ bindingType: 'hardcover' })));
      expect(step4.on.content).toEqual({ ...step4.off.content, pageMultiple: 4 });
      expect(step4.on.content.binding).toBe('perfect');
      expect(step4.on.cover).toEqual(step4.off.cover);

      withSet(null, 'none');
      const nullStep = await callOffThenOn(mkSession(meta({ bindingType: 'hardcover' })));
      expect(nullStep.on.content).toEqual(nullStep.off.content);
      expect(nullStep.on.content).not.toHaveProperty('pageMultiple');
    });

    it('⑩ spring 주문 step2 낱장 → pageMultiple 2', async () => {
      withSet(2, 'none');
      const { off, on } = await callOffThenOn(mkSession(meta({ bindingType: 'spring' })));
      expect(on.content).toEqual({ ...off.content, pageMultiple: 2 });
      expect(on.content.binding).toBe('spring');
    });

    it('⑪ 중철 + 호스트 pageCountMax 80 → 낱장 80, 펼침면 40', async () => {
      withSet(2, 'none');
      const single = await call(mkSession(meta({ bindingType: 'saddle', pageCountMax: 80 })));
      expect(single.content).toMatchObject({ pageMultiple: 4, pageCountMax: 80 });

      withSet(2, 'inner');
      const spread = await call(mkSession(meta({ bindingType: 'saddle', pageCountMax: 80 })));
      expect(spread.content).toMatchObject({
        pageMultiple: 2,
        pageCountMax: 40,
        size: { width: 420, height: 297 },
      });
    });

    it("⑫ EDITOR_SPREAD_VALIDATION_MAPPING=off + 중철 주문 step2 낱장 → binding 'perfect' 그대로 + 4 · 64", async () => {
      withSet(2, 'none');
      process.env.EDITOR_SPREAD_VALIDATION_MAPPING = 'off';
      const { off, on } = await callOffThenOn(mkSession(meta({ bindingType: 'saddle' })));
      expect(on.content).toEqual({ ...off.content, pageMultiple: 4, pageCountMax: 64 });
      expect(on.content).toMatchObject({ binding: 'perfect', pages: 1 });
      expect(on.cover).toEqual(off.cover);
    });
  });

  describe('createValidationJobs 방향 정합 — size 스왑 정규화 + expectedOrientation (2026-07-14)', () => {
    beforeEach(() => {
      mockWorkerJobsService.createValidationJob.mockResolvedValue({ id: 'job-orient' } as any);
    });

    const makeSession = (overrides: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'session-orient',
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

    const warnSpy = () =>
      jest.spyOn(
        (service as unknown as { logger: { warn: (msg: string) => void } }).logger,
        'warn',
      );

    it('① 가로 templateSet(297×210) + 미오리엔트 size{210×297} → 스왑 정규화 {297×210} + expectedOrientation=landscape + warn 계측', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 297, height: 210, cropMarkEnabled: false });
      const spy = warnSpy();

      await callPrivate(
        makeSession({
          templateSetId: 'ts-landscape-a4',
          metadata: { size: { width: 210, height: 297 } } as any,
        }),
      );

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 297, height: 210 });
      expect(oo.expectedOrientation).toBe('landscape');
      // bookmoa 교정 계측 로그: 세션 id + 원본→정규화 값
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('session-orient'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('210×297 → 297×210'));
    });

    it('② 정사각 templateSet(210×210) + size{210×210} → 무정규화 + expectedOrientation 미주입', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 210, height: 210, cropMarkEnabled: false });

      await callPrivate(
        makeSession({
          templateSetId: 'ts-square',
          metadata: { size: { width: 210, height: 210 } } as any,
        }),
      );

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 210, height: 210 });
      expect(oo.expectedOrientation).toBeUndefined();
    });

    it('③ 스왑 아닌 불일치(templateSet 297×210 + size 200×280) → 원본 보존(파트너 명시값 계약) — expectedOrientation 주입은 독립 수행', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 297, height: 210, cropMarkEnabled: false });
      const spy = warnSpy();

      await callPrivate(
        makeSession({
          templateSetId: 'ts-landscape-a4',
          metadata: { size: { width: 200, height: 280 } } as any,
        }),
      );

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 200, height: 280 }); // 정확 스왑 아님 → 무접촉
      expect(oo.expectedOrientation).toBe('landscape'); // 비정사각 templateSet → 주입은 수행
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('방향 정규화'));
    });

    it('④ metadata.size 부재 + 가로 templateSet → templateSet 판형 폴백(기존 G2 회귀) + expectedOrientation=landscape', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 297, height: 210, cropMarkEnabled: false });

      await callPrivate(makeSession({ templateSetId: 'ts-landscape-a4' }));

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 297, height: 210 }); // G2 폴백 유지(스왑 대상 아님 — 동일값)
      expect(oo.expectedOrientation).toBe('landscape');
    });

    it('⑤ templateSet 부재 → 무정규화 + expectedOrientation 미주입 (A4 최후 폴백 레거시 동일)', async () => {
      await callPrivate(makeSession({ templateSetId: null }));

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 210, height: 297 });
      expect(oo.expectedOrientation).toBeUndefined();
    });

    it('⑥ 세로 templateSet(210×297) + 스왑 전달 size{297×210} → 세로로 정규화 + expectedOrientation=portrait (대칭)', async () => {
      mockTemplateSetsService.findOne = jest
        .fn()
        .mockResolvedValue({ width: 210, height: 297, cropMarkEnabled: false });

      await callPrivate(
        makeSession({
          templateSetId: 'ts-portrait-a4',
          metadata: { size: { width: 297, height: 210 } } as any,
        }),
      );

      const oo = lastOrderOptions();
      expect(oo.size).toEqual({ width: 210, height: 297 });
      expect(oo.expectedOrientation).toBe('portrait');
    });
  });

  describe('P1-4 canvasData 덮어쓰기 직전 스냅샷 (file_edit_session_versions)', () => {
    const mkSession = (canvasData: any, extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
      ({
        id: 'sess-1',
        memberSeqno: 7,
        guestToken: null,
        status: SessionStatus.EDITING,
        canvasData,
        metadata: null,
        ...extra,
      }) as EditSessionEntity;

    beforeEach(() => {
      mockVersionRepository.find.mockResolvedValue([]);
      mockSessionRepository.save.mockImplementation(async (s: any) => s);
    });

    it('update(canvasData) 는 이전 값을 스냅샷으로 저장한 뒤 덮어쓴다 (autosave)', async () => {
      const prev = [{ v: 1 }, { v: 2 }];
      mockSessionRepository.findOne.mockResolvedValue(mkSession(prev));
      const next = [{ v: 1 }, { v: 2 }, { v: 3 }];

      await service.update('sess-1', { canvasData: next } as any, 7);

      expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
      const saved = mockVersionRepository.save.mock.calls[0][0];
      expect(saved.canvasData).toBe(prev);
      expect(saved.pageCount).toBe(2);
      expect(saved.nextPageCount).toBe(3);
      expect(saved.reason).toBe('autosave');
      expect(saved.createdBy).toBe(7);
      expect(mockSessionRepository.save.mock.calls[0][0].canvasData).toBe(next);
    });

    it('최초 저장(이전 canvasData 없음)·동일 내용은 스냅샷하지 않는다', async () => {
      mockSessionRepository.findOne.mockResolvedValue(mkSession(null));
      await service.update('sess-1', { canvasData: [{ a: 1 }] } as any, 7);
      expect(mockVersionRepository.save).not.toHaveBeenCalled();

      service['lastVersionAt'].clear();
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{ a: 1 }]));
      await service.update('sess-1', { canvasData: [{ a: 1 }] } as any, 7);
      expect(mockVersionRepository.save).not.toHaveBeenCalled();
    });

    it('autosave 는 세션당 60s debounce — 연속 저장은 1건만', async () => {
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{ a: 1 }]));
      await service.update('sess-1', { canvasData: [{ a: 2 }] } as any, 7);
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{ a: 2 }]));
      await service.update('sess-1', { canvasData: [{ a: 3 }] } as any, 7);
      expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    });

    it('페이지 수 감소(shrink)는 debounce 를 무시하고 즉시 보존한다 — R2 절단 포착', async () => {
      mockSessionRepository.findOne.mockResolvedValue(mkSession(Array(16).fill({})));
      await service.update('sess-1', { canvasData: Array(17).fill({}) } as any, 7);
      mockSessionRepository.findOne.mockResolvedValue(mkSession(Array(16).fill({})));
      await service.update('sess-1', { canvasData: Array(8).fill({}) } as any, 7);

      expect(mockVersionRepository.save).toHaveBeenCalledTimes(2);
      const shrink = mockVersionRepository.save.mock.calls[1][0];
      expect(shrink.reason).toBe('shrink');
      expect(shrink.pageCount).toBe(16);
      expect(shrink.nextPageCount).toBe(8);
    });

    it('스냅샷 저장 실패는 세션 저장을 막지 않는다', async () => {
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{ a: 1 }]));
      mockVersionRepository.save.mockRejectedValueOnce(new Error('no table'));
      const updated = await service.update('sess-1', { canvasData: [{ a: 2 }] } as any, 7);
      expect(updated.canvasData).toEqual([{ a: 2 }]);
    });

    it('트림: 10건 초과 시 오래된 것부터 삭제하되 shrink 최근 5건은 보호', async () => {
      const rows = Array.from({ length: 14 }, (_, i) => ({
        id: `v${i}`,
        reason: i % 2 === 0 ? 'shrink' : 'autosave',
        createdAt: new Date(2026, 7, 22, 0, 14 - i), // v0 최신
      }));
      mockVersionRepository.find.mockResolvedValue(rows);
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{ a: 1 }]));

      await service.update('sess-1', { canvasData: [{ a: 2 }] } as any, 7);

      expect(mockVersionRepository.delete).toHaveBeenCalledTimes(1);
      const deleted: string[] = mockVersionRepository.delete.mock.calls[0][0];
      // shrink v0,v2,v4,v6,v8 보호 → 총 10건 유지 → 삭제 4건이며 보호 id 는 없다
      expect(deleted).toHaveLength(4);
      for (const id of ['v0', 'v2', 'v4', 'v6', 'v8']) expect(deleted).not.toContain(id);
      expect(deleted).toEqual(['v11', 'v12', 'v13', 'v10'].sort());
    });

    it('restoreVersion: 복원 직전 현재 상태를 restore 스냅샷으로 보존하고 canvasData 를 교체한다', async () => {
      const current = Array(8).fill({ cur: true });
      const old = Array(16).fill({ old: true });
      mockSessionRepository.findOne.mockResolvedValue(mkSession(current));
      mockVersionRepository.findOne.mockResolvedValue({ id: 'ver-old', canvasData: old, pageCount: 16 });

      const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

      expect(restored.canvasData).toBe(old);
      const snap = mockVersionRepository.save.mock.calls[0][0];
      expect(snap.reason).toBe('restore');
      expect(snap.canvasData).toBe(current);
    });

    it('restoreVersion: 다른 세션의 스냅샷 id 는 404', async () => {
      mockSessionRepository.findOne.mockResolvedValue(mkSession([{}]));
      mockVersionRepository.findOne.mockResolvedValue(null);
      await expect(service.restoreVersion('sess-1', 'ver-x', 7)).rejects.toThrow();
      expect(mockVersionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ver-x', session: { id: 'sess-1' } },
      });
    });
  });
});
