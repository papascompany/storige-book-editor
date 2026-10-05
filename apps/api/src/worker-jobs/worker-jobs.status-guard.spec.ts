/**
 * updateJobStatus — 상태 전이 가드(조건부 UPDATE)와 종결 웹훅 발신 장부.
 *
 * 저장소 mock 은 행 1개를 들고 조건부 UPDATE 의 WHERE(id·status·errorCode·outputFileId, In·IsNull 포함)를 실제로 대조한다.
 * 장부는 합성 큐 client 자리에 넣은 Map 기반 가짜 Redis 다.
 * 인스턴스 생성 패턴은 worker-jobs.callback-gate.spec.ts 선례.
 */
import { Logger } from '@nestjs/common';
import { FindOperator, In, IsNull } from 'typeorm';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService } from './worker-jobs.service';
import type { UpdateJobStatusDto } from './dto/worker-job.dto';
import type { WebhookSendReceipt } from '../webhook/webhook.service';

type Row = Record<string, unknown> & { id: string; status: string; errorCode: string | null };

const { PENDING, PROCESSING, COMPLETED, FIXABLE, FAILED } = WorkerJobStatus;
const LEDGER_KEY = (status: string) => `storige:job-callback:job-1:${status}`;
const CALLBACK_URL = 'https://www.bookmoa.com/api/storige/webhook';

class FakeRedis {
  readonly store = new Map<string, string>();
  readonly set = jest.fn(async (key: string, value: string, _px: 'PX', _ttl: number, nx?: 'NX') => {
    if (nx === 'NX' && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK' as const;
  });
  readonly get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  readonly del = jest.fn(async (key: string) => (this.store.delete(key) ? 1 : 0));
}

function matches(cond: unknown, actual: unknown): boolean {
  if (cond instanceof FindOperator) {
    if (cond.type === 'isNull') return actual === null || actual === undefined;
    if (cond.type !== 'in') throw new Error(`unsupported operator ${cond.type}`);
    return (cond.value as unknown[]).includes(actual);
  }
  return cond === actual;
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 조건이 참이 될 때까지 이벤트 루프를 몇 차례 넘긴다(동시 보고 인터리빙용). */
async function waitUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('WorkerJobsService.updateJobStatus — 상태 전이 가드·발신 장부', () => {
  let row: Row;
  let repo: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock; find: jest.Mock };
  let redis: FakeRedis;
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };
  let filesService: { registerExternalFile: jest.Mock; findById: jest.Mock; softDelete: jest.Mock };
  let finService: { onWorkerJobSettled: jest.Mock };
  let logSpy: jest.SpyInstance;

  const makeRow = (overrides: Partial<Row> = {}): Row => ({
    id: 'job-1',
    jobType: WorkerJobType.SYNTHESIZE,
    editSessionId: null,
    siteId: 'site-a',
    options: { callbackUrl: CALLBACK_URL },
    result: null,
    outputFileId: null,
    outputFileUrl: null,
    errorMessage: null,
    errorDetail: null,
    completedAt: null,
    status: PROCESSING,
    errorCode: null,
    ...overrides,
  });

  const build = (initial: Row, opts: { client?: boolean } = {}): WorkerJobsService => {
    row = initial;
    repo = {
      findOne: jest.fn(async () => ({ ...row })),
      update: jest.fn(async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
        const hit = Object.entries(where).every(([k, v]) => matches(v, row[k]));
        if (!hit) return { affected: 0 };
        row = { ...row, ...patch } as Row;
        return { affected: 1 };
      }),
      save: jest.fn(async (e: unknown) => e),
      find: jest.fn(async () => []),
    };
    redis = new FakeRedis();
    filesService = {
      registerExternalFile: jest.fn(async () => ({ id: 'file-new' })),
      findById: jest.fn(async () => ({ id: 'file-src', siteId: 'site-a' })),
      softDelete: jest.fn(async () => undefined),
    };
    finService = { onWorkerJobSettled: jest.fn(async () => undefined) };
    const service = new WorkerJobsService(
      repo as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      (opts.client === false ? { add: jest.fn() } : { add: jest.fn(), client: redis }) as never,
      filesService as never,
      webhookService as never,
      {} as never,
      {} as never,
      finService as never,
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    return service;
  };

  const events = (): string[] =>
    webhookService.sendCallback.mock.calls.map((c) => (c[1] as { event: string }).event);
  const logs = (): string[] => logSpy.mock.calls.map((c) => String(c[0]));
  const worker = { siteId: 'site-worker', role: 'worker' };

  beforeEach(() => {
    webhookService = {
      sendCallback: jest.fn(async () => true),
      hasV2Config: jest.fn(async () => false),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('PROCESSING → COMPLETED: 진행 중 조건 UPDATE, completedAt 기록, synthesis.completed 1회, 장부 sent', async () => {
    const service = build(makeRow());
    const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/outputs/a.pdf' }, worker);

    expect(repo.update).toHaveBeenCalledTimes(1);
    const [where, patch] = repo.update.mock.calls[0];
    expect(where).toEqual({ id: 'job-1', status: In([PENDING, PROCESSING]) });
    expect(patch).toEqual({ status: COMPLETED, outputFileUrl: '/storage/outputs/a.pdf', completedAt: expect.any(Date) });
    expect(res.status).toBe(COMPLETED);
    expect(res.completedAt).toBeInstanceOf(Date);
    expect(events()).toEqual(['synthesis.completed']);
    expect(redis.store.get(LEDGER_KEY(COMPLETED))).toBe('sent');
  });

  it('같은 종결 재수신 + 장부 sent → DB 쓰기·발신 없음, 현재 상태 반환, repeat 로그', async () => {
    const service = build(makeRow({ status: COMPLETED, outputFileUrl: '/storage/outputs/first.pdf' }));
    redis.store.set(LEDGER_KEY(COMPLETED), 'sent');

    const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/outputs/second.pdf' }, worker);

    expect(repo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(res.status).toBe(COMPLETED);
    expect(res.outputFileUrl).toBe('/storage/outputs/first.pdf'); // 처음 종결 값 유지
    expect(logs()).toContain('[job-status] repeat job=job-1 status=COMPLETED callback=skipped-sent');
  });

  it('같은 종결 재수신 + 장부 없음 → 1회 발신하고 sent 기록', async () => {
    const service = build(makeRow({ status: COMPLETED }));
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(repo.update).not.toHaveBeenCalled();
    expect(events()).toEqual(['synthesis.completed']);
    expect(redis.store.get(LEDGER_KEY(COMPLETED))).toBe('sent');
  });

  it('같은 종결 재수신 + 장부 sending → 발신 생략(skipped-in-flight)', async () => {
    const service = build(makeRow({ status: COMPLETED }));
    redis.store.set(LEDGER_KEY(COMPLETED), 'sending');
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(logs()).toContain('[job-status] repeat job=job-1 status=COMPLETED callback=skipped-in-flight');
  });

  it('첫 발신 실패 → 장부 키 삭제, 다음 같은 종결 보고에서 다시 발신', async () => {
    const service = build(makeRow());
    webhookService.sendCallback.mockResolvedValueOnce(false);
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(redis.del).toHaveBeenCalledWith(LEDGER_KEY(COMPLETED));
    expect(redis.store.has(LEDGER_KEY(COMPLETED))).toBe(false);

    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(events()).toEqual(['synthesis.completed', 'synthesis.completed']);
    expect(redis.store.get(LEDGER_KEY(COMPLETED))).toBe('sent');
  });

  it('v2 재시도 체인 접수(반환 false + receipt.accepted) → 장부 sent, 다음 보고는 발신 생략', async () => {
    const service = build(makeRow());
    webhookService.sendCallback.mockImplementationOnce(
      async (_u: string, _p: unknown, _c: unknown, receipt?: WebhookSendReceipt) => {
        if (receipt) receipt.accepted = true;
        return false;
      },
    );
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(redis.store.get(LEDGER_KEY(COMPLETED))).toBe('sent');

    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
  });

  it('COMPLETED → PROCESSING: 예외 없이 현재 상태 반환, 쓰기·발신 없음, blocked 로그 1줄', async () => {
    const service = build(makeRow({ status: COMPLETED }));
    const res = await service.updateJobStatus('job-1', { status: PROCESSING }, worker);
    expect(res.status).toBe(COMPLETED);
    expect(repo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(logs()).toEqual(['[job-status] blocked job=job-1 from=COMPLETED to=PROCESSING']);
  });

  it('알 수 없는 요청 status 는 로그에 원문 대신 other 로 남는다', async () => {
    const service = build(makeRow({ status: COMPLETED }));
    await service.updateJobStatus('job-1', { status: 'X\nY' }, worker);
    expect(logs()).toEqual(['[job-status] blocked job=job-1 from=COMPLETED to=other']);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('X\\nY');
  });

  it.each([
    [COMPLETED, null, FAILED],
    [FAILED, 'PAGE_COUNT_MISMATCH', COMPLETED],
    [FAILED, 'JOB_STALLED', FIXABLE],
    [FIXABLE, null, COMPLETED],
  ])('종결 %s(errorCode=%s) → %s 는 blocked(쓰기·발신·후속 처리 없음)', async (status, errorCode, requested) => {
    const service = build(makeRow({ status, errorCode, options: { callbackUrl: CALLBACK_URL, finalizationId: 'fin-1' } }));
    const res = await service.updateJobStatus('job-1', { status: requested }, worker);
    expect(res.status).toBe(status);
    expect(repo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(finService.onWorkerJobSettled).not.toHaveBeenCalled();
  });

  it.each(['JOB_STALLED', 'JOB_TIMEOUT_SWEPT'])(
    'FAILED(%s) → COMPLETED(워커): 승격 조건 UPDATE, 오류 필드 비움, synthesis.completed 1회',
    async (code) => {
      const service = build(makeRow({ status: FAILED, errorCode: code, errorMessage: 'stalled', errorDetail: { a: 1 } }));
      const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/outputs/late.pdf' }, worker);

      const [where, patch] = repo.update.mock.calls[0];
      expect(where).toEqual({ id: 'job-1', status: FAILED, errorCode: In(['JOB_STALLED', 'JOB_TIMEOUT_SWEPT']) });
      expect(patch).toEqual({
        status: COMPLETED,
        outputFileUrl: '/storage/outputs/late.pdf',
        completedAt: expect.any(Date),
        errorCode: null,
        errorMessage: null,
        errorDetail: null,
      });
      expect(res.status).toBe(COMPLETED);
      expect(res.errorCode).toBeNull();
      expect(row.errorMessage).toBeNull();
      expect(events()).toEqual(['synthesis.completed']);
      expect(logs()).toContain(`[job-status] promoted job=job-1 from=FAILED(${code}) to=COMPLETED`);
    },
  );

  it('caller 없는 내부 호출도 승격한다', async () => {
    const service = build(makeRow({ status: FAILED, errorCode: 'JOB_STALLED' }));
    const res = await service.updateJobStatus('job-1', { status: COMPLETED });
    expect(res.status).toBe(COMPLETED);
  });

  it('finalization 마커 잡 승격 → 웹훅 없음, onWorkerJobSettled 1회', async () => {
    const service = build(
      makeRow({ status: FAILED, errorCode: 'JOB_STALLED', options: { callbackUrl: CALLBACK_URL, finalizationId: 'fin-1' } }),
    );
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(finService.onWorkerJobSettled).toHaveBeenCalledTimes(1);
    expect(finService.onWorkerJobSettled.mock.calls[0][0]).toMatchObject({ id: 'job-1', status: COMPLETED });
  });

  it('VALIDATE 승격 → validation.completed 1회', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.VALIDATE,
        status: FAILED,
        errorCode: 'JOB_TIMEOUT_SWEPT',
        options: { callbackUrl: CALLBACK_URL, fileType: 'content' },
      }),
    );
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(events()).toEqual(['validation.completed']);
  });

  it('테넌트 키(editor 역할)의 승격 요청은 blocked', async () => {
    const service = build(makeRow({ status: FAILED, errorCode: 'JOB_STALLED' }));
    const res = await service.updateJobStatus('job-1', { status: COMPLETED }, { siteId: 'site-a', role: 'editor' });
    expect(res.status).toBe(FAILED);
    expect(repo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(logs()).toEqual(['[job-status] blocked job=job-1 from=FAILED to=COMPLETED']);
  });

  it('경합: UPDATE 0건 뒤 다시 읽은 상태가 요청과 같은 종결이면 repeat(쓰기 없음, 기록된 결과 파일은 다시 등록하지 않음)', async () => {
    const service = build(
      makeRow({ jobType: WorkerJobType.CONVERT, options: { kind: 'pagecount-fix', sourceFileId: 'file-src' } }),
    );
    // 판독(PROCESSING) 직후 다른 보고가 COMPLETED·결과 파일을 먼저 기록한 상황
    repo.update.mockImplementationOnce(async () => {
      row = { ...row, status: COMPLETED, outputFileUrl: '/storage/converted/x.pdf', outputFileId: 'file-first' };
      return { affected: 0 };
    });
    const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/x.pdf' }, worker);
    expect(res.status).toBe(COMPLETED);
    expect(repo.findOne).toHaveBeenCalledTimes(2);
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    expect(logs().some((l) => l.startsWith('[job-status] repeat job=job-1 status=COMPLETED'))).toBe(true);
  });

  it('경합: UPDATE 0건 뒤 다시 읽은 상태가 다른 종결이면 blocked', async () => {
    const service = build(makeRow());
    repo.update.mockImplementationOnce(async () => {
      row = { ...row, status: FAILED, errorCode: 'PAGE_COUNT_MISMATCH' };
      return { affected: 0 };
    });
    const res = await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(res.status).toBe(FAILED);
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(logs()).toEqual(['[job-status] blocked job=job-1 from=FAILED to=COMPLETED']);
  });

  it('스위퍼 경합: PROCESSING 판독 뒤 FAILED 요청, 그 사이 COMPLETED → blocked, synthesis.failed 없음', async () => {
    const service = build(makeRow());
    repo.update.mockImplementationOnce(async () => {
      row = { ...row, status: COMPLETED };
      return { affected: 0 };
    });
    const res = await service.updateJobStatus('job-1', {
      status: FAILED,
      errorCode: 'JOB_TIMEOUT_SWEPT',
      errorMessage: 'swept',
    });
    expect(res.status).toBe(COMPLETED);
    expect(events()).not.toContain('synthesis.failed');
    expect(row.status).toBe(COMPLETED);
  });

  it('장부 client 가 없으면 같은 종결 재수신마다 발신한다', async () => {
    const service = build(makeRow({ status: COMPLETED }), { client: false });
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(events()).toEqual(['synthesis.completed', 'synthesis.completed']);
  });

  it('status 없는 보고: 진행 중이면 필드만 갱신(completedAt 없음), 종결이면 blocked', async () => {
    const service = build(makeRow());
    await service.updateJobStatus('job-1', { result: { progress: 50 } } as UpdateJobStatusDto, worker);
    expect(repo.update.mock.calls[0][1]).toEqual({ result: { progress: 50 } });
    expect(webhookService.sendCallback).not.toHaveBeenCalled();

    const done = build(makeRow({ status: COMPLETED }));
    const res = await done.updateJobStatus('job-1', { result: { progress: 100 } } as UpdateJobStatusDto, worker);
    expect(res.status).toBe(COMPLETED);
    expect(repo.update).not.toHaveBeenCalled();
    expect(logs()).toEqual(['[job-status] blocked job=job-1 from=COMPLETED to=-']);
  });

  it('빈 DTO 는 쓰기 없이 현재 잡을 돌려준다', async () => {
    const service = build(makeRow());
    const res = await service.updateJobStatus('job-1', {}, worker);
    expect(repo.update).not.toHaveBeenCalled();
    expect(res.status).toBe(PROCESSING);
  });

  describe.each(['pagecount-fix', 'bleed-fix'])('%s CONVERT 의 COMPLETED 재수신', (kind) => {
    const convertRow = (overrides: Partial<Row> = {}): Row =>
      makeRow({
        jobType: WorkerJobType.CONVERT,
        status: COMPLETED,
        outputFileUrl: '/storage/converted/x.pdf',
        options: { kind, sourceFileId: 'file-src' },
        ...overrides,
      });

    it('outputFileId 가 기록돼 있으면 결과 파일을 다시 등록하지 않는다(쓰기 없음)', async () => {
      const service = build(convertRow({ outputFileId: 'file-first' }));
      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/x.pdf' }, worker);
      expect(filesService.registerExternalFile).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('결과 파일이 아직 없으면 1회 등록하고, 이어지는 재수신은 다시 등록하지 않는다', async () => {
      const service = build(convertRow());

      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/x.pdf' }, worker);
      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/x.pdf' }, worker);

      expect(filesService.registerExternalFile).toHaveBeenCalledTimes(1);
      expect(filesService.registerExternalFile.mock.calls[0][0]).toBe('/storage/converted/x.pdf');
      expect(row.outputFileId).toBe('file-new');
      expect(row.status).toBe(COMPLETED);
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.update).toHaveBeenCalledWith({ id: 'job-1', outputFileId: IsNull() }, { outputFileId: 'file-new' });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('finalization 마커 잡 같은 종결 재수신 → onWorkerJobSettled 다시 호출, 상태 쓰기·웹훅 없음', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.VALIDATE,
        status: COMPLETED,
        options: { callbackUrl: CALLBACK_URL, finalizationId: 'fin-1' },
      }),
    );
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);

    expect(finService.onWorkerJobSettled).toHaveBeenCalledTimes(2);
    expect(finService.onWorkerJobSettled.mock.calls[0][0]).toMatchObject({
      id: 'job-1',
      status: COMPLETED,
      options: { finalizationId: 'fin-1' },
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
  });

  it('finalization 마커 잡 재수신에서 onWorkerJobSettled 예외는 격리하고 현재 잡을 돌려준다', async () => {
    const service = build(
      makeRow({ jobType: WorkerJobType.SYNTHESIZE, status: FAILED, options: { finalizationId: 'fin-1' } }),
    );
    finService.onWorkerJobSettled.mockRejectedValueOnce(new Error('fin down'));
    const res = await service.updateJobStatus('job-1', { status: FAILED }, worker);
    expect(res.status).toBe(FAILED);
    expect(finService.onWorkerJobSettled).toHaveBeenCalledTimes(1);
  });

  it('같은 종결 재수신 + 장부 sent → 웹훅 0회, 세션 workerStatus 쓰기 없음, 되연결이 끝난 내지 임포지션 세션은 그대로', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.VALIDATE,
        status: COMPLETED,
        editSessionId: 'sess-1',
        options: { callbackUrl: CALLBACK_URL, sessionStatusSync: true },
      }),
    );
    redis.store.set(LEDGER_KEY(COMPLETED), 'sent');
    const sessions = (service as unknown as { editSessionRepository: { findOne: jest.Mock; update: jest.Mock } })
      .editSessionRepository;

    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(sessions.findOne).not.toHaveBeenCalled();
    expect(sessions.update).not.toHaveBeenCalled();

    row = makeRow({
      jobType: WorkerJobType.CONVERT,
      status: COMPLETED,
      editSessionId: 'sess-1',
      outputFileUrl: '/storage/converted/imposed.pdf',
      outputFileId: 'file-imposed',
      options: { purpose: 'inner-imposition', editSessionId: 'sess-1', sourceFileId: 'file-src' },
    });
    sessions.findOne.mockResolvedValue({ id: 'sess-1', contentPdfFileId: 'file-imposed', metadata: {} });
    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(sessions.update).not.toHaveBeenCalled();
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('내지 임포지션 CONVERT: 첫 COMPLETED 는 세션 되연결 1회, 이어지는 재수신은 되연결·재등록 없음', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.CONVERT,
        editSessionId: 'sess-1',
        options: { purpose: 'inner-imposition', editSessionId: 'sess-1', sourceFileId: 'file-src' },
      }),
    );
    const sessions = (service as unknown as { editSessionRepository: { findOne: jest.Mock; update: jest.Mock } })
      .editSessionRepository;
    let session: Record<string, unknown> = { id: 'sess-1', contentPdfFileId: 'file-src', metadata: {} };
    sessions.findOne.mockImplementation(async () => ({ ...session }));
    sessions.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      session = { ...session, ...patch };
      return { affected: 1 };
    });

    await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/imposed.pdf' }, worker);
    expect(sessions.update).toHaveBeenCalledTimes(1);
    expect(sessions.update.mock.calls[0][1]).toMatchObject({
      contentPdfFileId: 'file-new',
      metadata: { innerPdfImposition: { originalContentPdfFileId: 'file-src', resultFileId: 'file-new' } },
    });

    await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/imposed.pdf' }, worker);
    expect(sessions.update).toHaveBeenCalledTimes(1);
    expect(filesService.registerExternalFile).toHaveBeenCalledTimes(1);
    expect(session).toMatchObject({
      contentPdfFileId: 'file-new',
      metadata: { innerPdfImposition: { originalContentPdfFileId: 'file-src', resultFileId: 'file-new' } },
    });
  });

  it('내지 임포지션 CONVERT: 첫 COMPLETED 의 세션 갱신이 끝나지 않았으면 재수신이 등록된 결과 파일로 되연결한다', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.CONVERT,
        editSessionId: 'sess-1',
        options: { purpose: 'inner-imposition', editSessionId: 'sess-1', sourceFileId: 'file-src' },
      }),
    );
    const sessions = (service as unknown as { editSessionRepository: { findOne: jest.Mock; update: jest.Mock } })
      .editSessionRepository;
    sessions.findOne.mockResolvedValue({ id: 'sess-1', contentPdfFileId: 'file-src', metadata: { innerPdfImposition: { jobId: 'job-1' } } });
    sessions.update.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ affected: 1 });

    await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/imposed.pdf' }, worker);
    expect(row.status).toBe(COMPLETED);
    expect(row.outputFileId).toBe('file-new');

    await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/imposed.pdf' }, worker);
    expect(filesService.registerExternalFile).toHaveBeenCalledTimes(1);
    expect(sessions.update).toHaveBeenCalledTimes(2);
    expect(sessions.update.mock.calls[1][1]).toMatchObject({
      contentPdfFileId: 'file-new',
      metadata: { innerPdfImposition: { jobId: 'job-1', originalContentPdfFileId: 'file-src', resultFileId: 'file-new' } },
    });
  });

  it('내지 임포지션 CONVERT 재수신: 세션이 원본이 아닌 다른 파일을 가리키면 되연결·등록 없음', async () => {
    const service = build(
      makeRow({
        jobType: WorkerJobType.CONVERT,
        status: COMPLETED,
        editSessionId: 'sess-1',
        outputFileUrl: '/storage/converted/imposed.pdf',
        options: { purpose: 'inner-imposition', editSessionId: 'sess-1', sourceFileId: 'file-src' },
      }),
    );
    redis.store.set(LEDGER_KEY(COMPLETED), 'sent');
    const sessions = (service as unknown as { editSessionRepository: { findOne: jest.Mock; update: jest.Mock } })
      .editSessionRepository;
    sessions.findOne.mockResolvedValue({ id: 'sess-1', contentPdfFileId: 'file-uploaded-later', metadata: {} });

    await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: '/storage/converted/imposed.pdf' }, worker);
    expect(sessions.update).not.toHaveBeenCalled();
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('동시 보고: 첫 발신이 끝나기 전 같은 종결 재수신은 발신하지 않고, 총 발신 1회 뒤 장부 sent', async () => {
    const service = build(makeRow());
    let releaseFirst: (ok: boolean) => void = () => undefined;
    webhookService.sendCallback.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { releaseFirst = resolve; }),
    );

    const first = service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    // 첫 보고가 상태를 쓰고 발신 대기에 들어갈 때까지 진행
    for (let i = 0; i < 20 && webhookService.sendCallback.mock.calls.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);

    await service.updateJobStatus('job-1', { status: COMPLETED }, worker);
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    expect(logs()).toContain('[job-status] repeat job=job-1 status=COMPLETED callback=skipped-in-flight');

    releaseFirst(true);
    await first;
    expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
    expect(redis.store.get(LEDGER_KEY(COMPLETED))).toBe('sent');
  });

  describe.each(['pagecount-fix', 'bleed-fix'])('%s CONVERT 결과 파일 기록 — 겹치는 보고', (kind) => {
    const OUT = '/storage/converted/x.pdf';
    const pendingRow = (): Row =>
      makeRow({ jobType: WorkerJobType.CONVERT, options: { kind, sourceFileId: 'file-src' } });
    const recordCalls = (): Array<[Record<string, unknown>, Record<string, unknown>]> =>
      (repo.update.mock.calls as Array<[Record<string, unknown>, Record<string, unknown>]>).filter(
        ([where]) => 'outputFileId' in where,
      );

    it('첫 보고의 결과 등록 중 같은 종결 재수신이 오면 먼저 기록된 결과 파일 하나만 남는다', async () => {
      const service = build(pendingRow());
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementation(async () => ({ id: 'file-B' }));

      const a = service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      const resB = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      expect(row.outputFileId).toBe('file-B');

      regA.resolve({ id: 'file-A' });
      const resA = await a;
      expect(row.outputFileId).toBe('file-B');
      expect(resA.outputFileId).toBe('file-B');
      expect(resB.outputFileId).toBe('file-B');
      expect(filesService.softDelete).toHaveBeenCalledTimes(1);
      expect(filesService.softDelete).toHaveBeenCalledWith('file-A');
      const recs = recordCalls();
      expect(recs).toHaveLength(2);
      for (const [where, patch] of recs) {
        expect(where).toEqual({ id: 'job-1', outputFileId: IsNull() });
        expect(Object.keys(patch)).toEqual(['outputFileId']);
      }
      expect(repo.save).not.toHaveBeenCalled();
      expect(row.status).toBe(COMPLETED);
      expect(row.errorCode).toBeNull();
    });

    it.each<['A' | 'B', 'A' | 'B']>([
      ['A', 'B'],
      ['B', 'A'],
    ])('두 요청이 모두 등록 단계에 있을 때 먼저 끝난 쪽의 결과 파일을 쓴다(%s 먼저)', async (first, second) => {
      const service = build(pendingRow());
      const regs = { A: deferred<{ id: string }>(), B: deferred<{ id: string }>() };
      filesService.registerExternalFile
        .mockImplementationOnce(() => regs.A.promise)
        .mockImplementationOnce(() => regs.B.promise);

      const a = service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length === 1);
      const b = service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length === 2);
      expect(filesService.registerExternalFile).toHaveBeenCalledTimes(2);
      const reqs = { A: a, B: b };

      regs[first].resolve({ id: `file-${first}` });
      await reqs[first];
      regs[second].resolve({ id: `file-${second}` });
      const [resA, resB] = await Promise.all([reqs.A, reqs.B]);

      expect(row.outputFileId).toBe(`file-${first}`);
      expect(resA.outputFileId).toBe(`file-${first}`);
      expect(resB.outputFileId).toBe(`file-${first}`);
      expect(filesService.softDelete).toHaveBeenCalledTimes(1);
      expect(filesService.softDelete).toHaveBeenCalledWith(`file-${second}`);
    });

    it('결과 파일 기록 쓰기가 실패하면 다음 재수신이 결과 파일을 다시 등록해 기록한다', async () => {
      const service = build(pendingRow());
      const baseUpdate = repo.update.getMockImplementation() as (
        w: Record<string, unknown>,
        p: Record<string, unknown>,
      ) => Promise<{ affected: number }>;
      let failed = false;
      repo.update.mockImplementation(async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
        if ('outputFileId' in where && !failed) {
          failed = true;
          throw new Error('db down');
        }
        return baseUpdate(where, patch);
      });
      filesService.registerExternalFile
        .mockResolvedValueOnce({ id: 'file-1st' })
        .mockResolvedValueOnce({ id: 'file-2nd' });

      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      expect(row.status).toBe(COMPLETED);
      expect(row.outputFileId).toBeNull();

      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      expect(filesService.registerExternalFile).toHaveBeenCalledTimes(2);
      expect(row.outputFileId).toBe('file-2nd');
      expect(filesService.softDelete).not.toHaveBeenCalled();
    });

    it('사용하지 않는 결과 파일의 삭제 표시가 실패해도 먼저 기록된 결과 파일을 쓴다', async () => {
      const service = build(pendingRow());
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementation(async () => ({ id: 'file-B' }));
      filesService.softDelete.mockRejectedValueOnce(new Error('not found'));

      const a = service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      regA.resolve({ id: 'file-A' });
      const resA = await a;

      expect(resA.outputFileId).toBe('file-B');
      expect(resA.status).toBe(COMPLETED);
      expect(row.outputFileId).toBe('file-B');
      expect(filesService.softDelete).toHaveBeenCalledWith('file-A');
    });
  });

  describe('내지 임포지션 CONVERT 결과 파일 기록', () => {
    const OUT = '/storage/converted/imposed.pdf';
    const impositionRow = (): Row =>
      makeRow({
        jobType: WorkerJobType.CONVERT,
        editSessionId: 'sess-1',
        options: { purpose: 'inner-imposition', editSessionId: 'sess-1', sourceFileId: 'file-src' },
      });
    const sessionsOf = (service: WorkerJobsService): { findOne: jest.Mock; update: jest.Mock } =>
      (service as unknown as { editSessionRepository: { findOne: jest.Mock; update: jest.Mock } })
        .editSessionRepository;

    it('첫 보고의 결과 등록 중 재수신이 되연결하면 세션 갱신은 1회이고 원본 기록이 유지된다', async () => {
      const service = build(impositionRow());
      const sessions = sessionsOf(service);
      let session: Record<string, unknown> = { id: 'sess-1', contentPdfFileId: 'file-src', metadata: {} };
      sessions.findOne.mockImplementation(async () => ({ ...session }));
      sessions.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
        session = { ...session, ...patch };
        return { affected: 1 };
      });
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementation(async () => ({ id: 'file-B' }));

      const a = service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);
      regA.resolve({ id: 'file-A' });
      await a;

      expect(sessions.update).toHaveBeenCalledTimes(1);
      expect(session).toMatchObject({
        contentPdfFileId: 'file-B',
        metadata: { innerPdfImposition: { originalContentPdfFileId: 'file-src', resultFileId: 'file-B' } },
      });
      expect(row.outputFileId).toBe('file-B');
      expect(filesService.softDelete).toHaveBeenCalledTimes(1);
      expect(filesService.softDelete).toHaveBeenCalledWith('file-A');
    });

    it('세션이 이미 이 결과 파일을 가리키면 다시 쓰지 않는다', async () => {
      const service = build(impositionRow());
      const sessions = sessionsOf(service);
      sessions.findOne
        .mockResolvedValueOnce({ id: 'sess-1', contentPdfFileId: 'file-src', metadata: {} })
        .mockResolvedValueOnce({ id: 'sess-1', contentPdfFileId: 'file-new', metadata: {} });

      await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);

      expect(sessions.findOne).toHaveBeenCalledTimes(2);
      expect(sessions.update).not.toHaveBeenCalled();
      expect(row.outputFileId).toBe('file-new');
    });

    /**
     * 결과 파일 id 기록 update 는 affected 0 을 돌려주고, 기록 여부 확인 읽기(select)는 readRecorded 결과를 쓴다.
     * 세션은 처음 읽기에서 원본(file-src), 갱신 직전 다시 읽기에서 freshContent 를 가리킨다.
     */
    const stubRecordNotApplied = (
      service: WorkerJobsService,
      readRecorded: () => Promise<{ id: string; outputFileId: string | null }>,
      freshContent: string,
    ): { findOne: jest.Mock; update: jest.Mock } => {
      const baseUpdate = repo.update.getMockImplementation() as (
        w: Record<string, unknown>,
        p: Record<string, unknown>,
      ) => Promise<{ affected: number }>;
      repo.update.mockImplementation(async (where: Record<string, unknown>, patch: Record<string, unknown>) =>
        'outputFileId' in where ? { affected: 0 } : baseUpdate(where, patch),
      );
      const baseFind = repo.findOne.getMockImplementation() as (o: unknown) => Promise<Row>;
      repo.findOne.mockImplementation(async (opts: { select?: unknown }) =>
        opts?.select ? readRecorded() : baseFind(opts),
      );
      const sessions = sessionsOf(service);
      sessions.findOne
        .mockResolvedValueOnce({ id: 'sess-1', contentPdfFileId: 'file-src', metadata: {} })
        .mockResolvedValueOnce({ id: 'sess-1', contentPdfFileId: freshContent, metadata: {} });
      sessions.update.mockResolvedValue({ affected: 1 });
      return sessions;
    };

    it.each<['읽기 실패' | '기록 값 없음', string, number]>([
      ['읽기 실패', 'file-src', 1],
      ['읽기 실패', 'file-other', 0],
      ['기록 값 없음', 'file-src', 1],
      ['기록 값 없음', 'file-other', 0],
    ])(
      '결과 파일 기록 여부를 확인하지 못하면(%s) 세션이 원본을 가리킬 때만 되연결한다(세션=%s → 갱신 %d회)',
      async (read, current, updates) => {
        const service = build(impositionRow());
        const sessions = stubRecordNotApplied(
          service,
          async () => {
            if (read === '읽기 실패') throw new Error('read failed');
            return { id: 'job-1', outputFileId: null };
          },
          current,
        );

        const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);

        expect(res.status).toBe(COMPLETED);
        expect(res.outputFileId).toBe('file-new');
        expect(sessions.update).toHaveBeenCalledTimes(updates);
        if (updates > 0) {
          expect(sessions.update.mock.calls[0][1]).toMatchObject({
            contentPdfFileId: 'file-new',
            metadata: { innerPdfImposition: { originalContentPdfFileId: 'file-src', resultFileId: 'file-new' } },
          });
        }
        expect(filesService.softDelete).not.toHaveBeenCalled();
      },
    );

    it('기록 update 가 반영 행 0 이어도 다시 읽은 값이 이번 결과 파일이면 첫 보고로 되연결한다', async () => {
      const service = build(impositionRow());
      const sessions = stubRecordNotApplied(
        service,
        async () => ({ id: 'job-1', outputFileId: 'file-new' }),
        'file-other',
      );

      const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);

      expect(res.outputFileId).toBe('file-new');
      expect(sessions.update).toHaveBeenCalledTimes(1);
      expect(sessions.update.mock.calls[0][1]).toMatchObject({
        contentPdfFileId: 'file-new',
        metadata: { innerPdfImposition: { originalContentPdfFileId: 'file-other', resultFileId: 'file-new' } },
      });
      expect(filesService.softDelete).not.toHaveBeenCalled();
    });

    it('먼저 기록된 결과 파일을 쓰게 되고 세션이 원본도 그 파일도 아닌 파일을 가리키면 되연결하지 않는다', async () => {
      const service = build(impositionRow());
      const sessions = stubRecordNotApplied(
        service,
        async () => ({ id: 'job-1', outputFileId: 'file-B' }),
        'file-X',
      );

      const res = await service.updateJobStatus('job-1', { status: COMPLETED, outputFileUrl: OUT }, worker);

      expect(res.status).toBe(COMPLETED);
      expect(res.outputFileId).toBe('file-B');
      expect(sessions.update).not.toHaveBeenCalled();
      expect(filesService.softDelete).toHaveBeenCalledTimes(1);
      expect(filesService.softDelete).toHaveBeenCalledWith('file-new');
    });
  });
});
