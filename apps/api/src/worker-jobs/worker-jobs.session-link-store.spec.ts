/**
 * 잡 생성 시 편집 세션 연결 저장(2026-10-03)과 상태 보고의 세션 부수 효과.
 *
 *  - 생성 저장(saveNewJob): 세션 FK 위반이면 세션 연결 없이 1회 다시 저장하고 `[job-link] unlinked` 로그(라우트만).
 *    그 밖의 오류는 그대로 던진다. 분리 합성의 unique 위반 처리(기존 잡 반환)는 그대로다.
 *  - 변환 잡은 editSessionId 프로퍼티로 세션 id 를 넣는다.
 *  - updateJobStatus: 잡을 세션 관계 없이 읽는다. 세션 workerStatus 갱신·session.* 발신은
 *    isSessionStatusSyncJob(VALIDATE + options.sessionStatusSync === true) 잡만 한다.
 *  - 컨트롤러 → 생성 저장: 세션 연결을 확인한 호출(사이트 키·shop·X-Guest-Token·staff)만 edit_session_id 를 저장한다.
 *    확인 없이 진행한 호출(none, JOB_LINK_STRICT 꺼짐)은 잡을 만들되 edit_session_id 는 NULL 이고 options 표지는 그대로다.
 *    JOB_LINK_STRICT 켜짐이면 none 호출은 404(잡 미생성).
 *  - 실제 DB 저장 경로는 entities/worker-job.entity.spec.ts(sqlite)에서 확인한다.
 */
import { HttpException, Logger } from '@nestjs/common';
import { TemplateType, WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService, isForeignKeyViolation, isSessionStatusSyncJob } from './worker-jobs.service';
import { WorkerJobsController } from './worker-jobs.controller';
import type { CreateConversionJobDto, CreateValidationJobDto } from './dto/worker-job.dto';
import type { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';

const SESSION_ID = 'sess-1';
const FK_ERROR = Object.assign(new Error('Cannot add or update a child row: a foreign key constraint fails'), {
  code: 'ER_NO_REFERENCED_ROW_2',
  errno: 1452,
});

type Saved = Record<string, unknown>;

describe('isForeignKeyViolation', () => {
  it.each<[string, boolean, unknown]>([
    ['MySQL ER_NO_REFERENCED_ROW_2', true, { code: 'ER_NO_REFERENCED_ROW_2' }],
    ['MySQL ER_NO_REFERENCED_ROW', true, { code: 'ER_NO_REFERENCED_ROW' }],
    ['errno 1452', true, { errno: 1452 }],
    ['errno 1216', true, { errno: 1216 }],
    ['PostgreSQL 23503', true, { code: '23503' }],
    ['SQLite 코드', true, { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }],
    ['SQLite 메시지', true, new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed')],
    ['unique 위반', false, { code: 'ER_DUP_ENTRY', errno: 1062 }],
    ['일반 오류', false, new Error('connection lost')],
    ['null', false, null],
    ['문자열', false, 'ER_NO_REFERENCED_ROW_2'],
  ])('%s → %s', (_label, expected, err) => {
    expect(isForeignKeyViolation(err)).toBe(expected);
  });
});

describe('isSessionStatusSyncJob', () => {
  it.each<[string, boolean, { jobType?: unknown; options?: unknown } | null]>([
    ['VALIDATE + sessionStatusSync true', true, { jobType: WorkerJobType.VALIDATE, options: { sessionStatusSync: true } }],
    ['VALIDATE + 표지 없음', false, { jobType: WorkerJobType.VALIDATE, options: { fileType: 'content' } }],
    ['VALIDATE + 문자열 true', false, { jobType: WorkerJobType.VALIDATE, options: { sessionStatusSync: 'true' } }],
    ['VALIDATE + options null', false, { jobType: WorkerJobType.VALIDATE, options: null }],
    ['SYNTHESIZE + 표지', false, { jobType: WorkerJobType.SYNTHESIZE, options: { sessionStatusSync: true } }],
    ['CONVERT + 표지', false, { jobType: WorkerJobType.CONVERT, options: { sessionStatusSync: true } }],
    ['null', false, null],
  ])('%s → %s', (_label, expected, job) => {
    expect(isSessionStatusSyncJob(job)).toBe(expected);
  });
});

describe('WorkerJobsService 생성 저장 — 세션 FK 위반 처리', () => {
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let filesService: { findById: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let saved: Saved[];
  let warnSpy: jest.SpyInstance;
  let service: WorkerJobsService;

  beforeEach(() => {
    saved = [];
    workerJobRepository = {
      create: jest.fn((v: Saved) => ({ ...v })),
      // 저장 시점의 값을 복사해 둔다(재저장 전후 비교)
      save: jest.fn(async (e: Saved) => {
        saved.push({ ...e });
        return { id: 'job-new', ...e };
      }),
      findOne: jest.fn(async () => null),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    filesService = { findById: jest.fn() };
    conversionQueue = { add: jest.fn() };
    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      conversionQueue as never,
      { add: jest.fn() } as never, // synthesisQueue
      filesService as never,
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  const validateDto = (editSessionId?: string): CreateValidationJobDto =>
    ({
      fileUrl: 'https://files.example.com/a.pdf',
      fileType: 'content',
      ...(editSessionId ? { editSessionId } : {}),
    }) as CreateValidationJobDto;

  it('저장 엔티티에 요청한 editSessionId 가 실린다', async () => {
    await service.createValidationJob(validateDto(SESSION_ID));
    expect(saved).toHaveLength(1);
    expect(saved[0].editSessionId).toBe(SESSION_ID);
  });

  it('FK 위반 1회 → 세션 연결 없이 다시 저장, warn 은 라우트만', async () => {
    workerJobRepository.save.mockRejectedValueOnce(FK_ERROR);
    const job = await service.createValidationJob(validateDto(SESSION_ID));
    expect(workerJobRepository.save).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1); // 성공한 저장(두 번째)
    expect(saved[0].editSessionId).toBeNull();
    expect(saved[0].editSession).toBeNull();
    expect(job.editSessionId).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[job-link] unlinked route=validate reason=session-missing');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(SESSION_ID);
  });

  it('FK 가 아닌 오류는 그대로 던지고 저장은 1회', async () => {
    const err = new Error('connection lost');
    workerJobRepository.save.mockRejectedValueOnce(err);
    await expect(service.createValidationJob(validateDto(SESSION_ID))).rejects.toBe(err);
    expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('세션 id 가 없는 잡의 FK 오류는 그대로 던진다(재저장 없음)', async () => {
    workerJobRepository.save.mockRejectedValueOnce(FK_ERROR);
    await expect(service.createValidationJob(validateDto())).rejects.toBe(FK_ERROR);
    expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
  });

  it('두 번째 저장 오류는 그대로 던진다', async () => {
    const second = new Error('db down');
    workerJobRepository.save.mockRejectedValueOnce(FK_ERROR).mockRejectedValueOnce(second);
    await expect(service.createValidationJob(validateDto(SESSION_ID))).rejects.toBe(second);
    expect(workerJobRepository.save).toHaveBeenCalledTimes(2);
  });

  it('변환 잡: create 인자에 editSessionId 가 있고 editSession 키는 없다', async () => {
    await service.createConversionJob({
      fileUrl: 'https://files.example.com/a.pdf',
      editSessionId: SESSION_ID,
    } as CreateConversionJobDto);
    const createArg = workerJobRepository.create.mock.calls[0][0] as Saved;
    expect(createArg.editSessionId).toBe(SESSION_ID);
    expect(createArg).not.toHaveProperty('editSession');
  });

  it('변환 잡: 세션 id 미지정이면 editSessionId null', async () => {
    await service.createConversionJob({ fileUrl: 'https://files.example.com/a.pdf' } as CreateConversionJobDto);
    const createArg = workerJobRepository.create.mock.calls[0][0] as Saved;
    expect(createArg.editSessionId).toBeNull();
  });

  describe('분리 합성 — unique 위반 시 기존 잡 반환', () => {
    const dto = {
      sessionId: SESSION_ID,
      pdfFileId: 'file-1',
      requestId: 'req-1',
    } as CreateSplitSynthesisJobDto;

    beforeEach(() => {
      editSessionRepository.findOne.mockResolvedValue({
        id: SESSION_ID,
        metadata: {
          pages: [
            { sortOrder: 0, templateType: TemplateType.COVER },
            { sortOrder: 1, templateType: TemplateType.PAGE },
          ],
        },
      });
      filesService.findById.mockResolvedValue({
        id: 'file-1',
        metadata: { generatedBy: 'editor', editSessionId: SESSION_ID },
      });
    });

    it('unique 위반 → 같은 키의 기존 잡을 반환한다', async () => {
      const existing = { id: 'job-existing' };
      workerJobRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
      workerJobRepository.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
      await expect(service.createSplitSynthesisJob(dto)).resolves.toBe(existing);
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
    });

    it('FK 위반 → 연결 없이 저장하고 라우트 split-synthesize 로그', async () => {
      workerJobRepository.save.mockRejectedValueOnce(FK_ERROR);
      await service.createSplitSynthesisJob(dto);
      expect(saved).toHaveLength(1);
      expect(saved[0].editSessionId).toBeNull();
      expect(saved[0].sessionId).toBe(SESSION_ID); // 분리 합성 멱등 키는 그대로
      expect(warnSpy).toHaveBeenCalledWith('[job-link] unlinked route=split-synthesize reason=session-missing');
    });
  });
});

describe('WorkerJobsService.updateJobStatus — 세션 연결 잡의 부수 효과', () => {
  let workerJobRepository: { findOne: jest.Mock; save: jest.Mock; find: jest.Mock; update: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    jobType: WorkerJobType.VALIDATE,
    editSessionId: SESSION_ID,
    siteId: 'site-a',
    options: { fileType: 'content' },
    result: null,
    status: WorkerJobStatus.PROCESSING,
    ...overrides,
  });

  const makeService = (job: Record<string, unknown>): WorkerJobsService => {
    workerJobRepository = {
      findOne: jest.fn(async () => ({ ...job })),
      save: jest.fn(async (e: unknown) => e),
      find: jest.fn(async () => [{ ...job, status: WorkerJobStatus.COMPLETED }]),
      update: jest.fn(async () => ({ affected: 1 })), // 상태 쓰기는 조건부 UPDATE
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ id: SESSION_ID, workerStatus: null, callbackUrl: null })),
      update: jest.fn(async () => ({})),
    };
    return new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      {} as never,
      webhookService as never,
      {} as never,
      {} as never,
    );
  };

  const sentEvents = (): string[] =>
    webhookService.sendCallback.mock.calls.map((c) => (c[1] as { event: string }).event);

  beforeEach(() => {
    webhookService = { sendCallback: jest.fn(async () => true), hasV2Config: jest.fn(async () => false) };
  });

  it('잡은 세션 관계 없이 읽는다', async () => {
    const service = makeService(makeJob());
    await service.updateJobStatus('job-1', { status: WorkerJobStatus.COMPLETED });
    expect(workerJobRepository.findOne).toHaveBeenCalledWith({ where: { id: 'job-1' } });
  });

  it.each([WorkerJobStatus.PROCESSING, WorkerJobStatus.COMPLETED, WorkerJobStatus.FAILED])(
    '표지 없는 검증 잡(세션 연결) %s → 세션 조회·갱신 없음, session.* 발신 없음',
    async (status) => {
      const service = makeService(makeJob());
      await service.updateJobStatus('job-1', { status });
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(editSessionRepository.update).not.toHaveBeenCalled();
      expect(sentEvents().filter((e) => e.startsWith('session.'))).toEqual([]);
      expect(workerJobRepository.update).toHaveBeenCalledTimes(1);
    },
  );

  it('표지 없는 검증 잡 + callbackUrl → validation.completed 1회, 본문 sessionId 는 잡의 세션 id', async () => {
    const service = makeService(
      makeJob({ options: { fileType: 'content', callbackUrl: 'https://www.bookmoa.com/api/cb' } }),
    );
    await service.updateJobStatus('job-1', { status: WorkerJobStatus.COMPLETED });
    expect(sentEvents()).toEqual(['validation.completed']);
    const payload = webhookService.sendCallback.mock.calls[0][1] as { sessionId?: string };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(editSessionRepository.update).not.toHaveBeenCalled();
  });

  it('검증 잡 + sessionStatusSync 표지 → 세션 workerStatus 갱신', async () => {
    const service = makeService(makeJob({ options: { fileType: 'content', sessionStatusSync: true } }));
    await service.updateJobStatus('job-1', { status: WorkerJobStatus.PROCESSING });
    expect(editSessionRepository.update).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ workerStatus: 'processing' }));
  });

  it('합성 잡은 sessionStatusSync 표지가 있어도 세션 갱신 없음', async () => {
    const service = makeService(
      makeJob({ jobType: WorkerJobType.SYNTHESIZE, options: { sessionStatusSync: true } }),
    );
    await service.updateJobStatus('job-1', { status: WorkerJobStatus.COMPLETED });
    expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    expect(editSessionRepository.update).not.toHaveBeenCalled();
    expect(sentEvents().filter((e) => e.startsWith('session.'))).toEqual([]);
  });
});

describe('WorkerJobsController → 생성 저장 — 확인된 세션 연결만 edit_session_id 저장', () => {
  const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MEMBER_SESSION = '11111111-1111-4111-8111-111111111111';
  const GUEST_SESSION = '22222222-2222-4222-8222-222222222222';
  const GUEST_TOKEN = 'guest-token-value-7c1e';

  let saved: Saved[];
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let flags: Record<string, string>;
  let controller: WorkerJobsController;

  beforeEach(() => {
    saved = [];
    flags = {};
    const sessions: Record<string, Saved> = {
      [MEMBER_SESSION]: {
        id: MEMBER_SESSION,
        siteId: SITE_A,
        memberSeqno: 123,
        orderSeqno: 100,
        guestToken: null,
        guestExpiresAt: null,
      },
      [GUEST_SESSION]: {
        id: GUEST_SESSION,
        siteId: SITE_A,
        memberSeqno: 0,
        orderSeqno: 0,
        guestToken: GUEST_TOKEN,
        guestExpiresAt: new Date(Date.now() + 3600_000),
      },
    };
    workerJobRepository = {
      create: jest.fn((v: Saved) => ({ ...v })),
      save: jest.fn(async (e: Saved) => {
        saved.push({ ...e });
        return { id: 'job-new', ...e };
      }),
      findOne: jest.fn(async () => null),
    };
    editSessionRepository = {
      findOne: jest.fn(async (opts: { where: { id: string } }) => {
        const r = sessions[opts.where.id];
        return r ? { ...r } : null;
      }),
      update: jest.fn(),
    };
    const service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      { add: jest.fn() } as never, // synthesisQueue
      { findById: jest.fn() } as never,
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    controller = new WorkerJobsController(service, { get: jest.fn((key: string) => flags[key]) } as never);
  });

  const composeDto = (editSessionId: string): never =>
    ({
      editSessionId,
      coverUrl: 'https://files.example.com/cover.pdf',
      contentPdfUrl: 'https://files.example.com/content.pdf',
    }) as never;
  const renderDto = (editSessionId: string): never =>
    ({ fileUrl: 'https://files.example.com/content.pdf', editSessionId }) as never;
  const optionsOf = (row: Saved): Record<string, unknown> => row.options as Record<string, unknown>;

  async function httpError(p: Promise<unknown>): Promise<{ status: number; body: { code?: string } }> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      return { status: (e as HttpException).getStatus(), body: (e as HttpException).getResponse() as { code?: string } };
    }
    throw new Error('expected HttpException');
  }

  it('compose-mixed 무인증 + editSessionId(연결 미확인) → 잡 생성, edit_session_id NULL, options.editSessionId 유지', async () => {
    await controller.createComposeMixed(composeDto(MEMBER_SESSION), undefined);
    expect(saved).toHaveLength(1);
    expect(saved[0].editSessionId).toBeNull();
    expect(optionsOf(saved[0]).editSessionId).toBe(MEMBER_SESSION);
  });

  it('compose-mixed 무인증 + 비회원 세션 + 유효한 X-Guest-Token(연결 확인) → edit_session_id 저장', async () => {
    await controller.createComposeMixed(composeDto(GUEST_SESSION), undefined, undefined, GUEST_TOKEN);
    expect(saved[0].editSessionId).toBe(GUEST_SESSION);
    expect(optionsOf(saved[0]).editSessionId).toBe(GUEST_SESSION);
  });

  it('compose-mixed 사이트 키 + 자기 사이트 세션(연결 확인) → edit_session_id 저장', async () => {
    await controller.createComposeMixed(composeDto(MEMBER_SESSION), undefined, { siteId: SITE_A, siteName: 'site' });
    expect(saved).toHaveLength(1);
    expect(saved[0].editSessionId).toBe(MEMBER_SESSION);
    expect(saved[0].siteId).toBe(SITE_A);
  });

  it('compose-mixed shop-session 자기 회원 세션(연결 확인) → edit_session_id 저장', async () => {
    await controller.createComposeMixed(composeDto(MEMBER_SESSION), {
      userId: '123',
      source: 'shop',
      siteId: SITE_A,
    });
    expect(saved[0].editSessionId).toBe(MEMBER_SESSION);
  });

  it('render-pages 무인증 + editSessionId(연결 미확인) → 잡 생성, edit_session_id NULL / 유효한 X-Guest-Token → 저장', async () => {
    await controller.createRenderPages(renderDto(MEMBER_SESSION));
    await controller.createRenderPages(renderDto(GUEST_SESSION), GUEST_TOKEN);
    expect(saved).toHaveLength(2);
    expect(saved[0].editSessionId).toBeNull();
    expect(saved[0].jobType).toBe(WorkerJobType.RENDER_PAGES);
    expect(saved[1].editSessionId).toBe(GUEST_SESSION);
  });

  it('validate 그 밖의 JWT(none, 연결 미확인) → edit_session_id NULL / admin-app staff → 저장', async () => {
    const dto = { fileUrl: 'https://files.example.com/a.pdf', fileType: 'content', editSessionId: MEMBER_SESSION };
    await controller.createValidationJob({ ...dto } as never, { role: 'customer' } as never);
    await controller.createValidationJob({ ...dto } as never, { role: 'admin' } as never);
    expect(saved).toHaveLength(2);
    expect(saved[0].editSessionId).toBeNull();
    expect(saved[1].editSessionId).toBe(MEMBER_SESSION);
  });

  it('JOB_LINK_STRICT=true → none 호출의 compose-mixed·render-pages 는 404 SESSION_NOT_FOUND, 잡 미생성', async () => {
    flags.JOB_LINK_STRICT = 'true';
    const c = await httpError(controller.createComposeMixed(composeDto(MEMBER_SESSION), undefined));
    const r = await httpError(controller.createRenderPages(renderDto(MEMBER_SESSION)));
    expect([c.status, c.body.code]).toEqual([404, 'SESSION_NOT_FOUND']);
    expect([r.status, r.body.code]).toEqual([404, 'SESSION_NOT_FOUND']);
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  });
});
