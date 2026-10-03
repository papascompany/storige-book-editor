/**
 * JD-4 — stalled 한도 초과 실패 기록 헬퍼와 큐별 failed 리스너 배선.
 *
 * - 헬퍼: bull stalled 한도 초과 사유일 때만 상태를 조회하고, PENDING/PROCESSING 이면
 *   FAILED(JOB_STALLED)로 1회 PATCH 한다. 합성 완료 마커가 있으면 캐시된 COMPLETED 를 재보고한다.
 * - 배선: 큐마다 이름 필터 없는 failed 리스너 1개(pdf-conversion 공유 큐는 ConversionProcessor).
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CUTOUT_JOB_NAME, CUTOUT_QUEUE_NAME } from '@storige/types';
import type { Job } from 'bull';
import type { JobStatusLookup, JobStatusPayload } from '../services/job-status.service';
import { captureJobException } from '../sentry/sentry.init';
import {
  JOB_STALLED_ERROR_CODE,
  JOB_STALLED_ERROR_MESSAGE,
  STALLED_LIMIT_FAILED_REASON,
  StalledFailureDeps,
  isStalledLimitFailure,
  reportStalledLimitFailure,
} from './stalled-job-failure';
import { ConversionProcessor } from './conversion.processor';
import { RenderProcessor } from './render.processor';
import { ValidationProcessor } from './validation.processor';
import { SynthesisProcessor } from './synthesis.processor';
import { CutoutProcessor } from './cutout.processor';
import { DomainError, ErrorCodes } from '../common/errors';

jest.mock('axios');
jest.mock('../sentry/sentry.init', () => ({
  captureJobException: jest.fn(),
  initSentry: jest.fn(),
}));

const mockedCapture = captureJobException as jest.MockedFunction<typeof captureJobException>;

type StalledJob = Pick<Job<unknown>, 'id' | 'name' | 'data' | 'failedReason'>;

const stalledErr = (): Error => new Error(STALLED_LIMIT_FAILED_REASON);

function makeJob(overrides: Partial<StalledJob> = {}): StalledJob {
  return {
    id: 77,
    name: 'validate-pdf',
    data: { jobId: 'job-1' },
    failedReason: STALLED_LIMIT_FAILED_REASON,
    ...overrides,
  };
}

interface Harness {
  deps: StalledFailureDeps;
  fetch: jest.Mock<Promise<JobStatusLookup>, [string]>;
  update: jest.Mock<Promise<boolean>, [string, JobStatusPayload, { jobType?: string; queueName?: string }?]>;
  logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
}

function makeHarness(
  lookup: JobStatusLookup = { ok: true, status: 'PROCESSING' },
  extra: Partial<StalledFailureDeps> = {},
): Harness {
  const fetch = jest.fn<Promise<JobStatusLookup>, [string]>().mockResolvedValue(lookup);
  const update = jest
    .fn<Promise<boolean>, [string, JobStatusPayload, { jobType?: string; queueName?: string }?]>()
    .mockResolvedValue(true);
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const deps: StalledFailureDeps = {
    queueName: 'pdf-validation',
    routes: { 'validate-pdf': { jobType: 'validate' } },
    jobStatusService: { fetchJobStatusWithRetry: fetch, updateJobStatusWithRetry: update },
    logger,
    now: () => new Date('2026-10-03T04:00:00.000Z'),
    ...extra,
  };
  return { deps, fetch, update, logger };
}

describe('isStalledLimitFailure', () => {
  it('bull stalled 한도 초과 사유면 true', () => {
    expect(isStalledLimitFailure(null, stalledErr())).toBe(true);
  });

  it('job.failedReason 만 일치해도 true', () => {
    expect(
      isStalledLimitFailure({ failedReason: STALLED_LIMIT_FAILED_REASON }, new Error('other')),
    ).toBe(true);
  });

  it('프로세서가 던진 일반 오류(DomainError 포함)면 false', () => {
    expect(isStalledLimitFailure({ failedReason: 'boom' }, new Error('boom'))).toBe(false);
    const de = new DomainError(ErrorCodes.FILE_DOWNLOAD_FAILED, 'download failed');
    expect(isStalledLimitFailure({ failedReason: de.message }, de)).toBe(false);
  });

  it('오류·job 이 모두 없으면 false', () => {
    expect(isStalledLimitFailure(null, undefined)).toBe(false);
    expect(isStalledLimitFailure(undefined, null)).toBe(false);
  });
});

describe('reportStalledLimitFailure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('일반 오류 실패 이벤트는 조회·PATCH 없이 ignored', async () => {
    const h = makeHarness();
    const outcome = await reportStalledLimitFailure(
      makeJob({ failedReason: 'boom' }),
      new Error('boom'),
      h.deps,
    );
    expect(outcome).toBe('ignored');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.logger.log).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('라우트에 없는 job.name 은 ignored', async () => {
    const h = makeHarness();
    const outcome = await reportStalledLimitFailure(
      makeJob({ name: 'render-pdf-pages' }),
      stalledErr(),
      h.deps,
    );
    expect(outcome).toBe('ignored');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('job 이 null 이면 경고만 남기고 invalidJob', async () => {
    const h = makeHarness();
    const outcome = await reportStalledLimitFailure(null, stalledErr(), h.deps);
    expect(outcome).toBe('invalidJob');
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('job.data.jobId 가 없으면 invalidJob', async () => {
    const h = makeHarness();
    const outcome = await reportStalledLimitFailure(makeJob({ data: {} }), stalledErr(), h.deps);
    expect(outcome).toBe('invalidJob');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('PROCESSING 잡은 FAILED·JOB_STALLED 로 1회 PATCH 하고 patched', async () => {
    const h = makeHarness({ ok: true, status: 'PROCESSING' });
    const outcome = await reportStalledLimitFailure(makeJob(), stalledErr(), h.deps);

    expect(outcome).toBe('patched');
    expect(h.fetch).toHaveBeenCalledWith('job-1');
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith(
      'job-1',
      {
        status: 'FAILED',
        errorCode: JOB_STALLED_ERROR_CODE,
        errorMessage: JOB_STALLED_ERROR_MESSAGE,
        errorDetail: {
          failedBy: 'worker-stalled-listener',
          queueName: 'pdf-validation',
          jobName: 'validate-pdf',
          queueJobId: '77',
          reason: STALLED_LIMIT_FAILED_REASON,
          previousStatus: 'PROCESSING',
          detectedAt: '2026-10-03T04:00:00.000Z',
        },
        queueJobId: 77,
      },
      { jobType: 'validate', queueName: 'pdf-validation' },
    );
    expect(JOB_STALLED_ERROR_CODE).toBe('JOB_STALLED');
    expect(h.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[JOB_STALLED] queue=pdf-validation name=validate-pdf jobId=job-1 queueJobId=77 outcome=patched previousStatus=PROCESSING'),
    );
  });

  it('PENDING 잡도 patched', async () => {
    const h = makeHarness({ ok: true, status: 'PENDING' });
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe('patched');
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][1].errorDetail).toEqual(
      expect.objectContaining({ previousStatus: 'PENDING' }),
    );
  });

  it.each([0, 1, 2])(
    '남은 시도가 있는 합성 잡(attemptsMade %i, attempts 3)도 FAILED·JOB_STALLED 로 patched',
    async (attemptsMade) => {
      const h = makeHarness(
        { ok: true, status: 'PROCESSING' },
        { queueName: 'pdf-synthesis', routes: { 'synthesize-pdf': { jobType: 'synthesize' } } },
      );
      const job = Object.assign(makeJob({ name: 'synthesize-pdf' }), {
        attemptsMade,
        opts: { attempts: 3 },
      });

      await expect(reportStalledLimitFailure(job, stalledErr(), h.deps)).resolves.toBe('patched');
      expect(h.update).toHaveBeenCalledTimes(1);
      expect(h.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: 'FAILED', errorCode: JOB_STALLED_ERROR_CODE }),
        { jobType: 'synthesize', queueName: 'pdf-synthesis' },
      );
    },
  );

  it.each(['COMPLETED', 'FIXABLE', 'FAILED'])('이미 종결된 잡(%s)은 PATCH 하지 않는다', async (status) => {
    const h = makeHarness({ ok: true, status });
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe(
      'alreadyTerminal',
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it('잡이 없으면(404) notFound, PATCH 없음', async () => {
    const h = makeHarness({ ok: false, reason: 'notFound' });
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe('notFound');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('상태 조회가 끝내 실패하면 statusUnavailable, PATCH 없음, 경고 1회', async () => {
    const h = makeHarness({ ok: false, reason: 'unavailable' });
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe(
      'statusUnavailable',
    );
    expect(h.update).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('완료 마커가 있고 PROCESSING 이면 캐시된 COMPLETED 를 1회 재보고하고 FAILED 는 보내지 않는다', async () => {
    const cached: JobStatusPayload = {
      status: 'COMPLETED',
      outputFileUrl: '/storage/outputs/job-1/merged.pdf',
      queueJobId: 77,
    };
    const loadCompletedPayload = jest.fn().mockResolvedValue(cached);
    const h = makeHarness({ ok: true, status: 'PROCESSING' }, {
      queueName: 'pdf-synthesis',
      routes: { 'synthesize-pdf': { jobType: 'synthesize' } },
      loadCompletedPayload,
    });

    const outcome = await reportStalledLimitFailure(
      makeJob({ name: 'synthesize-pdf' }),
      stalledErr(),
      h.deps,
    );

    expect(outcome).toBe('completedReported');
    expect(loadCompletedPayload).toHaveBeenCalledWith('job-1');
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith('job-1', cached, {
      jobType: 'synthesize',
      queueName: 'pdf-synthesis',
    });
  });

  it('완료 마커가 있어도 잡이 종결 상태면 재보고하지 않는다', async () => {
    const loadCompletedPayload = jest.fn().mockResolvedValue({ status: 'COMPLETED' });
    const h = makeHarness({ ok: true, status: 'COMPLETED' }, { loadCompletedPayload });
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe(
      'alreadyTerminal',
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it('완료 재보고가 최종 실패하면 completedReportFailed 를 돌려준다', async () => {
    const loadCompletedPayload = jest.fn().mockResolvedValue({ status: 'COMPLETED' });
    const h = makeHarness({ ok: true, status: 'PENDING' }, { loadCompletedPayload });
    h.update.mockResolvedValue(false);
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe(
      'completedReportFailed',
    );
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('PATCH 최종 실패면 patchFailed 를 돌려주고 reject 하지 않는다', async () => {
    const h = makeHarness();
    h.update.mockResolvedValue(false);
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe(
      'patchFailed',
    );
  });

  it('내부 예외가 나도 error 를 돌려주고 reject 하지 않는다', async () => {
    const h = makeHarness();
    h.fetch.mockRejectedValue(new Error('unexpected'));
    await expect(reportStalledLimitFailure(makeJob(), stalledErr(), h.deps)).resolves.toBe('error');
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('stalled 한도 초과를 Sentry 에 1회 기록하고, 일반 오류는 기록하지 않는다', async () => {
    const h = makeHarness();
    await reportStalledLimitFailure(makeJob({ failedReason: 'boom' }), new Error('boom'), h.deps);
    expect(mockedCapture).not.toHaveBeenCalled();

    await reportStalledLimitFailure(makeJob(), stalledErr(), h.deps);
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(mockedCapture).toHaveBeenCalledWith(expect.any(Error), {
      jobId: 'job-1',
      jobType: 'validate',
      queueName: 'pdf-validation',
    });
  });

  it('설치된 bull 의 stalled 한도 초과 사유 문자열과 상수가 같다', () => {
    const src = fs.readFileSync(require.resolve('bull/lib/queue.js'), 'utf8');
    expect(src).toContain(`new Error('${STALLED_LIMIT_FAILED_REASON}')`);
  });

  it('설치된 bull 의 stalled 스크립트는 한도 초과 잡을 attempts 확인 없이 failed 로 옮긴다', () => {
    // 실행되는 스크립트는 lib/scripts/*.js(lib/queue.js 가 require('./scripts/') 로 등록)다.
    const index = fs.readFileSync(require.resolve('bull/lib/scripts/index.js'), 'utf8');
    expect(index).toContain(`require('./moveStalledJobsToWait-7')`);
    const src = fs.readFileSync(
      require.resolve('bull/lib/scripts/moveStalledJobsToWait-7.js'),
      'utf8',
    );
    expect(src).toContain(`"failedReason", "${STALLED_LIMIT_FAILED_REASON}"`);
    expect(src).toContain('if(stalledCount > MAX_STALLED_JOB_COUNT) then');
    expect(src).not.toMatch(/attempt/i);
  });
});

describe('큐별 failed 리스너 배선', () => {
  const QUEUE_META = 'bull:module_queue';
  const EVENT_META = 'bull:module_on_queue_event';

  type ProcessorClass = abstract new (...args: never[]) => object;
  const classes: ProcessorClass[] = [
    ConversionProcessor,
    RenderProcessor,
    ValidationProcessor,
    SynthesisProcessor,
    CutoutProcessor,
  ];

  function failedListeners(cls: ProcessorClass): Array<{ key: string; meta: Record<string, unknown> }> {
    const proto = cls.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((key) => typeof proto[key] === 'function')
      .map((key) => ({
        key,
        meta: Reflect.getMetadata(EVENT_META, proto[key] as object) as Record<string, unknown> | undefined,
      }))
      .filter((x): x is { key: string; meta: Record<string, unknown> } => x.meta?.eventName === 'failed');
  }

  interface StatusMock {
    fetchJobStatusWithRetry: jest.Mock<Promise<JobStatusLookup>, [string]>;
    updateJobStatusWithRetry: jest.Mock<Promise<boolean>, [string, JobStatusPayload, { jobType?: string; queueName?: string }?]>;
  }

  function attachStatusMock(processor: object, lookup: JobStatusLookup): StatusMock {
    const mock: StatusMock = {
      fetchJobStatusWithRetry: jest.fn<Promise<JobStatusLookup>, [string]>().mockResolvedValue(lookup),
      updateJobStatusWithRetry: jest
        .fn<Promise<boolean>, [string, JobStatusPayload, { jobType?: string; queueName?: string }?]>()
        .mockResolvedValue(true),
    };
    Object.defineProperty(processor, 'jobStatusService', { value: mock });
    return mock;
  }

  function silenceLogger(processor: object): void {
    Object.defineProperty(processor, 'logger', {
      value: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('큐마다 failed 리스너가 정확히 1개다(pdf-conversion 공유 큐 포함)', () => {
    const perQueue = new Map<string, number>();
    for (const cls of classes) {
      const queue = (Reflect.getMetadata(QUEUE_META, cls) as { name: string }).name;
      perQueue.set(queue, (perQueue.get(queue) ?? 0) + failedListeners(cls).length);
    }
    expect(Object.fromEntries(perQueue)).toEqual({
      'pdf-conversion': 1,
      'pdf-validation': 1,
      'pdf-synthesis': 1,
      [CUTOUT_QUEUE_NAME]: 1,
    });
  });

  it('pdf-conversion 의 failed 리스너는 ConversionProcessor 에 있고 RenderProcessor 에는 없다', () => {
    expect(failedListeners(ConversionProcessor).map((x) => x.key)).toEqual(['onQueueFailed']);
    expect(failedListeners(RenderProcessor)).toHaveLength(0);
  });

  it('failed 리스너는 이름·id 필터 없이 등록된다', () => {
    for (const cls of classes) {
      for (const { meta } of failedListeners(cls)) {
        expect(meta).toEqual({ eventName: 'failed' });
      }
    }
  });

  it('ConversionProcessor 리스너는 render-pdf-pages 잡을 jobType render-pages 로, convert-pdf 잡을 convert 로 기록한다', async () => {
    const processor = new ConversionProcessor({} as never);
    silenceLogger(processor);
    const status = attachStatusMock(processor, { ok: true, status: 'PROCESSING' });

    await processor.onQueueFailed(
      makeJob({ id: 1, name: 'render-pdf-pages', data: { jobId: 'r-1' } }) as Job<unknown>,
      stalledErr(),
    );
    await processor.onQueueFailed(
      makeJob({ id: 2, name: 'convert-pdf', data: { jobId: 'c-1' } }) as Job<unknown>,
      stalledErr(),
    );

    expect(status.updateJobStatusWithRetry).toHaveBeenCalledTimes(2);
    expect(status.updateJobStatusWithRetry.mock.calls[0][0]).toBe('r-1');
    expect(status.updateJobStatusWithRetry.mock.calls[0][2]).toEqual({
      jobType: 'render-pages',
      queueName: 'pdf-conversion',
    });
    expect(status.updateJobStatusWithRetry.mock.calls[1][0]).toBe('c-1');
    expect(status.updateJobStatusWithRetry.mock.calls[1][2]).toEqual({
      jobType: 'convert',
      queueName: 'pdf-conversion',
    });
  });

  it('ConversionProcessor 리스너는 일반 오류 실패를 조회·PATCH 없이 넘긴다', async () => {
    const processor = new ConversionProcessor({} as never);
    silenceLogger(processor);
    const status = attachStatusMock(processor, { ok: true, status: 'PROCESSING' });

    await processor.onQueueFailed(
      makeJob({ name: 'convert-pdf', failedReason: 'convert failed' }) as Job<unknown>,
      new Error('convert failed'),
    );

    expect(status.fetchJobStatusWithRetry).not.toHaveBeenCalled();
    expect(status.updateJobStatusWithRetry).not.toHaveBeenCalled();
  });

  describe('SynthesisProcessor 완료 마커', () => {
    let outputsDir: string;

    beforeEach(() => {
      outputsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd4-synth-'));
    });

    afterEach(() => {
      fs.rmSync(outputsDir, { recursive: true, force: true });
    });

    function synthesisWithMarker(jobId: string, lookup: JobStatusLookup): {
      processor: SynthesisProcessor;
      status: StatusMock;
      cached: JobStatusPayload;
    } {
      const processor = new SynthesisProcessor({} as never);
      silenceLogger(processor);
      Object.defineProperty(processor, 'outputsPath', { value: outputsDir });
      const cached: JobStatusPayload = {
        status: 'COMPLETED',
        outputFileUrl: `/storage/outputs/${jobId}/merged.pdf`,
        queueJobId: 5,
      };
      fs.mkdirSync(path.join(outputsDir, jobId), { recursive: true });
      fs.writeFileSync(
        path.join(outputsDir, jobId, '.synthesis-complete.json'),
        JSON.stringify(cached),
        'utf8',
      );
      return { processor, status: attachStatusMock(processor, lookup), cached };
    }

    it('SynthesisProcessor 리스너는 완료 마커가 있고 PROCESSING 이면 캐시된 COMPLETED 를 재보고하고 FAILED 를 보내지 않는다', async () => {
      const { processor, status, cached } = synthesisWithMarker('s-1', {
        ok: true,
        status: 'PROCESSING',
      });

      await processor.onQueueFailed(
        makeJob({ id: 5, name: 'synthesize-pdf', data: { jobId: 's-1' } }) as Job<unknown>,
        stalledErr(),
      );

      expect(status.updateJobStatusWithRetry).toHaveBeenCalledTimes(1);
      expect(status.updateJobStatusWithRetry).toHaveBeenCalledWith('s-1', cached, {
        jobType: 'synthesize',
        queueName: 'pdf-synthesis',
      });
    });

    it('SynthesisProcessor 리스너는 완료 마커가 있어도 종결된 잡이면 PATCH 하지 않는다', async () => {
      const { processor, status } = synthesisWithMarker('s-2', { ok: true, status: 'COMPLETED' });

      await processor.onQueueFailed(
        makeJob({ name: 'synthesize-pdf', data: { jobId: 's-2' } }) as Job<unknown>,
        stalledErr(),
      );

      expect(status.fetchJobStatusWithRetry).toHaveBeenCalledWith('s-2');
      expect(status.updateJobStatusWithRetry).not.toHaveBeenCalled();
    });

    it('SynthesisProcessor 리스너는 완료 마커가 없으면 FAILED·JOB_STALLED 로 기록한다', async () => {
      const processor = new SynthesisProcessor({} as never);
      silenceLogger(processor);
      Object.defineProperty(processor, 'outputsPath', { value: outputsDir });
      const status = attachStatusMock(processor, { ok: true, status: 'PROCESSING' });

      await processor.onQueueFailed(
        makeJob({ name: 'synthesize-pdf', data: { jobId: 's-3' } }) as Job<unknown>,
        stalledErr(),
      );

      expect(status.updateJobStatusWithRetry).toHaveBeenCalledTimes(1);
      expect(status.updateJobStatusWithRetry.mock.calls[0][1]).toEqual(
        expect.objectContaining({ status: 'FAILED', errorCode: 'JOB_STALLED' }),
      );
    });

    it('SynthesisProcessor 리스너는 남은 시도가 있는 잡도 stalled 한도 초과면 FAILED·JOB_STALLED 로 기록한다', async () => {
      const processor = new SynthesisProcessor({} as never);
      silenceLogger(processor);
      Object.defineProperty(processor, 'outputsPath', { value: outputsDir });
      const status = attachStatusMock(processor, { ok: true, status: 'PROCESSING' });
      const job = Object.assign(
        makeJob({ name: 'synthesize-pdf', data: { jobId: 's-4' } }),
        { attemptsMade: 0, opts: { attempts: 3 } },
      );

      await processor.onQueueFailed(job as Job<unknown>, stalledErr());

      expect(status.updateJobStatusWithRetry).toHaveBeenCalledTimes(1);
      expect(status.updateJobStatusWithRetry).toHaveBeenCalledWith(
        's-4',
        expect.objectContaining({ status: 'FAILED', errorCode: 'JOB_STALLED' }),
        { jobType: 'synthesize', queueName: 'pdf-synthesis' },
      );
    });

    it.each([
      ['일반 오류', new Error('socket hang up')],
      ['재시도 DomainError', new DomainError(ErrorCodes.FILE_DOWNLOAD_FAILED, 'download failed')],
    ])(
      'SynthesisProcessor 리스너는 재시도로 넘어가는 중간 시도 실패(%s)를 조회·PATCH 없이 넘긴다',
      async (_label, err) => {
        const processor = new SynthesisProcessor({} as never);
        silenceLogger(processor);
        Object.defineProperty(processor, 'outputsPath', { value: outputsDir });
        const status = attachStatusMock(processor, { ok: true, status: 'PROCESSING' });
        const job = Object.assign(
          makeJob({ name: 'synthesize-pdf', data: { jobId: 's-5' }, failedReason: err.message }),
          { attemptsMade: 1, opts: { attempts: 3 } },
        );

        await processor.onQueueFailed(job as Job<unknown>, err);

        expect(status.fetchJobStatusWithRetry).not.toHaveBeenCalled();
        expect(status.updateJobStatusWithRetry).not.toHaveBeenCalled();
        expect(mockedCapture).not.toHaveBeenCalled();
      },
    );
  });

  it('Validation·Cutout 리스너는 PROCESSING 잡을 FAILED·JOB_STALLED 로 기록한다', async () => {
    const validation = new ValidationProcessor({} as never);
    silenceLogger(validation);
    const vStatus = attachStatusMock(validation, { ok: true, status: 'PROCESSING' });
    await validation.onQueueFailed(
      makeJob({ name: 'validate-pdf', data: { jobId: 'v-1' } }) as Job<unknown>,
      stalledErr(),
    );

    const cutout = new CutoutProcessor({} as never);
    silenceLogger(cutout);
    const cStatus = attachStatusMock(cutout, { ok: true, status: 'PROCESSING' });
    await cutout.onQueueFailed(
      makeJob({ name: CUTOUT_JOB_NAME, data: { jobId: 'k-1' } }) as Job<unknown>,
      stalledErr(),
    );

    expect(vStatus.updateJobStatusWithRetry).toHaveBeenCalledWith(
      'v-1',
      expect.objectContaining({ status: 'FAILED', errorCode: 'JOB_STALLED' }),
      { jobType: 'validate', queueName: 'pdf-validation' },
    );
    expect(cStatus.updateJobStatusWithRetry).toHaveBeenCalledWith(
      'k-1',
      expect.objectContaining({ status: 'FAILED', errorCode: 'JOB_STALLED' }),
      { jobType: 'cutout', queueName: CUTOUT_QUEUE_NAME },
    );
  });
});
