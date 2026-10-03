/**
 * X1 — merge 합성 잡의 내지 기대 재단(contentTrim) 전달.
 *
 * 잠그는 계약:
 *  1. editSessionId → 세션 templateSetId → 템플릿셋(재단·도련·템플릿 참조만 select) → contentTrim.
 *     job.options.contentTrim 과 큐 페이로드 contentTrim 에 같은 값(계약 fixture deep-equal).
 *  2. editSessionId 없음 → 세션·템플릿셋 조회 0회, options·큐 키 집합 종전과 같음.
 *  3. 세션 없음·templateSetId 없음·템플릿셋 없음·조회 예외·내지 펼침면·무효 도련 → 키 없음, 잡 생성 그대로.
 *  4. 내부 호출(books 확정)의 dto.contentTrim 은 정규화해 그대로 싣고 세션을 조회하지 않는다.
 *  5. 로그에 세션·템플릿셋 id 를 남기지 않는다.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { Template } from '../templates/entities/template.entity';

type AnyRec = Record<string, unknown>;

/** 계약 fixture — apps/worker spec 과 같은 리터럴 */
const FIXTURE_TEMPLATE_SET = JSON.parse(
  '{"trimWidthMm":210,"trimHeightMm":297,"bleedMm":3,"source":"templateSet"}',
) as unknown;
const FIXTURE_BOOK_SPEC = JSON.parse(
  '{"trimWidthMm":148,"trimHeightMm":210,"bleedMm":3,"tolMm":0.5,"source":"bookSpec"}',
) as unknown;

const SESSION_ID = '5b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
const TEMPLATE_SET_ID = '6c1d2e3f-4051-4b6c-9d7e-8f90a1b2c3d4';

const LEGACY_QUEUE_KEYS = [
  'jobId',
  'coverFileId',
  'contentFileId',
  'coverUrl',
  'contentUrl',
  'spineWidth',
  'orderId',
  'callbackUrl',
  'outputFormat',
  'bindingType',
].sort();

describe('WorkerJobsService.createSynthesisJob — 내지 기대 재단(contentTrim)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let sessionFindOne: jest.Mock;
  let templateSetFindOne: jest.Mock;
  let templateFind: jest.Mock;
  let getRepository: jest.Mock;
  let logs: string[];

  const baseDto = {
    coverUrl: 'https://example.com/cover.pdf',
    contentUrl: 'https://example.com/content.pdf',
    spineWidth: 3,
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x: AnyRec) => x),
      save: jest.fn(async (x: AnyRec) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
    };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    sessionFindOne = jest.fn(async () => ({ id: SESSION_ID, templateSetId: TEMPLATE_SET_ID }));
    templateSetFindOne = jest.fn(async () => ({
      id: TEMPLATE_SET_ID,
      width: 210,
      height: 297,
      bleedMm: 3,
      templates: [{ templateId: 't-1' }, { templateId: 't-2' }],
    }));
    templateFind = jest.fn(async () => [
      { id: 't-1', spreadConfig: null },
      { id: 't-2', spreadConfig: { regionScope: 'cover' } },
    ]);
    getRepository = jest.fn((entity: unknown) => {
      if (entity === TemplateSet) return { findOne: templateSetFindOne };
      if (entity === Template) return { find: templateFind };
      throw new Error('unexpected entity');
    });

    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: sessionFindOne, update: jest.fn(), manager: { getRepository } } as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      synthesisQueue as never,
      { findById: jest.fn() } as never, // filesService
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );

    logs = [];
    const logger = (service as unknown as { logger: { log: unknown; warn: unknown } }).logger;
    jest.spyOn(logger as never, 'log').mockImplementation(((m: string) => {
      logs.push(String(m));
    }) as never);
    jest.spyOn(logger as never, 'warn').mockImplementation(((m: string) => {
      logs.push(String(m));
    }) as never);
  });

  const created = (): AnyRec => workerJobRepository.create.mock.calls[0][0] as AnyRec;
  const createdOptions = (): AnyRec => created().options as AnyRec;
  const queuePayload = (): AnyRec => synthesisQueue.add.mock.calls[0][1] as AnyRec;

  it('editSessionId + 세션 템플릿셋 → options·큐 contentTrim 이 계약 fixture 와 같다', async () => {
    await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);

    expect(createdOptions().contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
    expect(queuePayload().contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
    expect(Object.keys(queuePayload()).sort()).toEqual([...LEGACY_QUEUE_KEYS, 'contentTrim'].sort());
    expect(logs).toContain(
      '[content-trim] attach route=synthesize source=templateSet trim=210x297 bleed=3',
    );
  });

  it('템플릿셋·템플릿은 필요한 컬럼만 조회한다(canvas_data 미조회)', async () => {
    await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);

    expect(sessionFindOne).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      select: { id: true, templateSetId: true },
    });
    expect(templateSetFindOne).toHaveBeenCalledTimes(1);
    const tsArg = templateSetFindOne.mock.calls[0][0] as { where: AnyRec; select: AnyRec };
    expect(tsArg.where).toEqual({ id: TEMPLATE_SET_ID, isDeleted: false });
    expect(tsArg.select).toEqual({ id: true, width: true, height: true, bleedMm: true, templates: true });
    const tArg = templateFind.mock.calls[0][0] as { select: AnyRec };
    expect(tArg.select).toEqual({ id: true, spreadConfig: true });
    expect(tArg.select).not.toHaveProperty('canvasData');
  });

  it('editSessionId 없음 → 세션·템플릿셋 조회 0회, 큐 키 집합은 종전 10키', async () => {
    await service.createSynthesisJob({ ...baseDto } as never);

    expect(sessionFindOne).not.toHaveBeenCalled();
    expect(getRepository).not.toHaveBeenCalled();
    expect(createdOptions()).not.toHaveProperty('contentTrim');
    expect(Object.keys(queuePayload()).sort()).toEqual(LEGACY_QUEUE_KEYS);
    expect(logs.some((l) => l.includes('[content-trim]'))).toBe(false);
  });

  it.each([
    ['세션 없음', 'no-session', () => sessionFindOne.mockResolvedValue(null)],
    [
      '세션 templateSetId 없음',
      'no-template-set',
      () => sessionFindOne.mockResolvedValue({ id: SESSION_ID, templateSetId: null }),
    ],
    ['템플릿셋 없음(삭제 포함)', 'no-template-set', () => templateSetFindOne.mockResolvedValue(null)],
    ['세션 조회 reject', 'lookup-error', () => sessionFindOne.mockRejectedValue(new Error('db'))],
    ['템플릿셋 조회 reject', 'lookup-error', () => templateSetFindOne.mockRejectedValue(new Error('db'))],
    [
      '템플릿 조회 TypeError',
      'lookup-error',
      () =>
        templateFind.mockImplementation(() => {
          throw new TypeError('x');
        }),
    ],
    [
      '내지 펼침면 세트',
      'inner-spread',
      () => templateFind.mockResolvedValue([{ id: 't-1', spreadConfig: { regionScope: 'inner' } }]),
    ],
    [
      '도련 6',
      'invalid',
      () =>
        templateSetFindOne.mockResolvedValue({
          id: TEMPLATE_SET_ID,
          width: 210,
          height: 297,
          bleedMm: 6,
          templates: [],
        }),
    ],
  ])('%s → 키 없음, 잡 생성 그대로, skip 경고(reason=%s)', async (_label, reason, arrange) => {
    arrange();
    const job = await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);

    expect(job.id).toBe('job-1');
    expect(createdOptions()).not.toHaveProperty('contentTrim');
    expect(Object.keys(queuePayload()).sort()).toEqual(LEGACY_QUEUE_KEYS);
    expect(logs.some((l) => l.startsWith(`[content-trim] skip route=synthesize reason=${reason}`))).toBe(
      true,
    );
  });

  it('리포지토리 manager 가 없어도 잡은 만들어지고 키는 없다', async () => {
    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: sessionFindOne, update: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      synthesisQueue as never,
      { findById: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const job = await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);
    expect(job.id).toBe('job-1');
    expect(queuePayload()).not.toHaveProperty('contentTrim');
  });

  it('템플릿 참조가 없는 템플릿셋 → 템플릿 조회 없이 도출', async () => {
    templateSetFindOne.mockResolvedValue({ id: TEMPLATE_SET_ID, width: 210, height: 297, bleedMm: 3, templates: [] });
    await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);
    expect(templateFind).not.toHaveBeenCalled();
    expect(queuePayload().contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
  });

  it('내부 호출 dto.contentTrim(bookSpec) → 정규화 값 그대로, 세션 조회 없음', async () => {
    await service.createSynthesisJob({
      ...baseDto,
      contentTrim: { trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3, tolMm: 0.5, source: 'bookSpec' },
    } as never);

    expect(sessionFindOne).not.toHaveBeenCalled();
    expect(createdOptions().contentTrim).toEqual(FIXTURE_BOOK_SPEC);
    expect(queuePayload().contentTrim).toEqual(FIXTURE_BOOK_SPEC);
  });

  it('내부 호출 dto.contentTrim 이 무효(도련 9) → 키 없음, 세션 조회 없음', async () => {
    await service.createSynthesisJob({
      ...baseDto,
      editSessionId: SESSION_ID,
      contentTrim: { trimWidthMm: 148, trimHeightMm: 210, bleedMm: 9, source: 'bookSpec' },
    } as never);

    expect(sessionFindOne).not.toHaveBeenCalled();
    expect(createdOptions()).not.toHaveProperty('contentTrim');
    expect(queuePayload()).not.toHaveProperty('contentTrim');
  });

  it('로그에 세션·템플릿셋 id 를 남기지 않는다', async () => {
    await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);
    sessionFindOne.mockRejectedValue(new Error(`lookup ${SESSION_ID}`));
    await service.createSynthesisJob({ ...baseDto, editSessionId: SESSION_ID } as never);

    const contentTrimLogs = logs.filter((l) => l.includes('[content-trim]'));
    expect(contentTrimLogs).toHaveLength(2);
    expect(contentTrimLogs.join('\n')).not.toContain(SESSION_ID);
    expect(contentTrimLogs.join('\n')).not.toContain(TEMPLATE_SET_ID);
  });
});
