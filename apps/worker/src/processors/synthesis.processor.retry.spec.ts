/**
 * JD-2 (2026-10) — 합성 프로세서 실패 시도 정리(settleFailedAttempt) 고정.
 *
 * 잠그는 계약:
 *  1. attempts 미지정 잡(옛 api): 6개 경로 모두 FAILED payload·Sentry 횟수가 그대로, discard 없음, [SYNTH_RETRY] 없음.
 *  2. attempts 3 잡: 재시도 가능 + 남은 시도 → FAILED PATCH 없이 같은 오류로 reject, [SYNTH_RETRY] action=retry 1줄.
 *  3. 입력 오류 → discard 후 FAILED PATCH 1회. 마지막 시도 → discard + FAILED PATCH 1회 + Sentry(경로별).
 *  4. 실패 처리 시점에 완료 마커가 있으면 저장된 COMPLETED 를 1회 재보고, FAILED 없음.
 *
 * 테스트 하네스는 synthesis.processor.test-env.spec.ts 선례(axios mock + 임시 디렉터리 실파일).
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { captureJobException } from '../sentry/sentry.init';
import { DomainError, ErrorCodes } from '../common/errors';

jest.mock('axios', () => ({
  default: {
    patch: jest.fn(),
    get: jest.fn(),
  },
  __esModule: true,
}));
jest.mock('../sentry/sentry.init', () => ({
  captureJobException: jest.fn(),
  initSentry: jest.fn(),
}));

type MockedAxios = { patch: jest.Mock; get: jest.Mock };
const mockedAxios = jest.requireMock<{ default: MockedAxios }>('axios').default;
const mockedCapture = captureJobException as jest.MockedFunction<typeof captureJobException>;

type SynthJob = Parameters<SynthesisProcessor['handleSynthesis']>[0];
type PatchPayload = Record<string, unknown> & { status: string };

interface SynthesizerMock {
  synthesizeToLocal: jest.Mock;
  splitPdfByIndices: jest.Mock;
  mergeSplitPdfs: jest.Mock;
  downloadFile: jest.Mock;
  handleSpreadSynthesis: jest.Mock;
}

interface MockJob {
  id: string;
  data: Record<string, unknown>;
  attemptsMade?: number;
  opts?: { attempts?: number };
  discard?: jest.Mock;
}

const EDITOR_FILE = {
  id: 'file-1',
  filePath: '/tmp/editor-output.pdf',
  metadata: { generatedBy: 'editor', editSessionId: 'session-1' },
};

describe('SynthesisProcessor — 합성 실패 시도 정리(재시도 의미론)', () => {
  let processor: SynthesisProcessor;
  let synthesizer: SynthesizerMock;
  let baseDir: string;
  let outputsPath: string;
  let storagePath: string;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storige-synth-retry-'));
  });

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200 });
    mockedAxios.get.mockResolvedValue({ data: EDITOR_FILE });
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    synthesizer = {
      synthesizeToLocal: jest.fn(),
      splitPdfByIndices: jest.fn(),
      mergeSplitPdfs: jest.fn(),
      downloadFile: jest.fn(),
      handleSpreadSynthesis: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SynthesisProcessor, { provide: PdfSynthesizerService, useValue: synthesizer }],
    }).compile();
    processor = module.get<SynthesisProcessor>(SynthesisProcessor);

    const caseDir = await fs.mkdtemp(path.join(baseDir, 'case-'));
    outputsPath = path.join(caseDir, 'outputs');
    storagePath = path.join(caseDir, 'storage');
    await fs.mkdir(outputsPath, { recursive: true });
    await fs.mkdir(storagePath, { recursive: true });
    setPaths(outputsPath, storagePath);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setPaths(outputs: string, storage: string): void {
    const target = processor as unknown as { outputsPath: string; storagePath: string };
    target.outputsPath = outputs;
    target.storagePath = storage;
  }

  function makeJob(
    data: Record<string, unknown>,
    attempts?: { attemptsMade: number; attempts: number },
  ): MockJob {
    const job: MockJob = { id: `queue-${String(data.jobId)}`, data, discard: jest.fn() };
    if (attempts) {
      job.attemptsMade = attempts.attemptsMade;
      job.opts = { attempts: attempts.attempts };
    }
    return job;
  }

  /** 잡이 reject 되는지 확인하고 그 오류를 돌려준다(fs 오류는 다른 realm 의 Error 라 message 로 확인). */
  async function runFailing(job: MockJob): Promise<Error> {
    const outcome = await processor.handleSynthesis(job as unknown as SynthJob).then(
      () => ({ resolved: true as const }),
      (err: unknown) => ({ resolved: false as const, err }),
    );
    expect(outcome.resolved).toBe(false);
    const err = outcome.resolved ? undefined : outcome.err;
    expect(typeof (err as { message?: unknown } | undefined)?.message).toBe('string');
    return err as Error;
  }

  function patches(status: string): PatchPayload[] {
    return mockedAxios.patch.mock.calls
      .map((call: unknown[]) => call[1] as PatchPayload)
      .filter((payload) => payload.status === status);
  }

  function synthRetryLines(): string[] {
    return warnSpy.mock.calls
      .map((call: unknown[]) => call[0])
      .filter((line): line is string => typeof line === 'string' && line.startsWith('[SYNTH_RETRY]'));
  }

  // ── 6개 경로 정의: 실패를 만드는 준비, 잡 데이터, 기대 FAILED payload, Sentry 횟수 ──
  interface PathCase {
    name: string;
    data: (jobId: string) => Record<string, unknown>;
    arrange: (ctx: { outputsPath: string }) => Promise<void>;
    expectedPayload: (err: Error, job: MockJob) => PatchPayload;
    captures: number;
  }

  const PATHS: PathCase[] = [
    {
      name: 'test-env',
      data: (jobId) => ({ jobId, isTest: true }),
      arrange: async ({ outputsPath: outputs }) => {
        // outputs 를 파일로 바꿔 더미 산출 디렉터리 생성이 실패하게 한다.
        const blocker = path.join(path.dirname(outputs), 'outputs-file');
        await fs.writeFile(blocker, 'x');
        setPaths(blocker, storagePath);
      },
      expectedPayload: (err) => ({ status: 'FAILED', errorMessage: err.message }),
      captures: 1,
    },
    {
      name: 'compose-mixed',
      data: (jobId) => ({
        jobId,
        mode: 'compose-mixed',
        composeOutputMode: 'separate',
        composeCoverEditable: true,
        composeCoverUrl: 'https://example.com/cover.pdf',
      }),
      arrange: async () => {
        synthesizer.downloadFile.mockRejectedValue(new Error('socket hang up'));
      },
      expectedPayload: (err) => ({ status: 'FAILED', errorMessage: err.message }),
      captures: 1,
    },
    {
      name: 'merge',
      data: (jobId) => ({
        jobId,
        coverUrl: 'https://example.com/cover.pdf',
        contentUrl: 'https://example.com/content.pdf',
        spineWidth: 5,
      }),
      arrange: async () => {
        synthesizer.synthesizeToLocal.mockRejectedValue(new Error('Download failed'));
      },
      expectedPayload: (err) => ({ status: 'FAILED', errorMessage: err.message }),
      captures: 1,
    },
    {
      name: 'split',
      data: (jobId) => ({
        jobId,
        mode: 'split',
        sessionId: 'session-1',
        pdfFileId: 'file-1',
        pageTypes: ['cover', 'content'],
        totalExpectedPages: 2,
        outputFormat: 'merged',
        alsoGenerateMerged: true,
      }),
      arrange: async () => undefined,
      expectedPayload: () => ({
        status: 'FAILED',
        errorCode: ErrorCodes.INVALID_OUTPUT_OPTIONS,
        errorMessage: "outputFormat='merged' 일 때 alsoGenerateMerged는 사용할 수 없습니다",
        errorDetail: undefined,
      }),
      captures: 0,
    },
    {
      name: 'duplex-split',
      data: (jobId) => ({
        jobId,
        mode: 'duplex-split',
        sessionId: 'other-session',
        pdfFileId: 'file-1',
        totalExpectedPages: 2,
      }),
      arrange: async () => undefined,
      expectedPayload: () => ({
        status: 'FAILED',
        errorCode: ErrorCodes.SESSION_FILE_MISMATCH,
        errorMessage: '세션-파일 불일치',
        errorDetail: undefined,
      }),
      captures: 0,
    },
    {
      name: 'spread',
      data: (jobId) => ({
        jobId,
        mode: 'spread',
        sessionId: 'session-1',
        spreadPdfFileId: 'spread-1',
        contentPdfFileIds: ['content-1'],
        totalExpectedPages: 2,
      }),
      arrange: async () => {
        synthesizer.handleSpreadSynthesis.mockRejectedValue(new Error('spread failed'));
      },
      expectedPayload: (err, job) => ({
        status: 'FAILED',
        errorCode: 'SYNTHESIS_FAILED',
        errorMessage: err.message,
        errorDetail: { stack: err.stack, jobData: job.data },
        queueJobId: job.id,
      }),
      captures: 1,
    },
  ];

  describe('attempts 미지정 잡(옛 api)', () => {
    it.each(PATHS.map((c) => [c.name, c] as const))(
      '%s: FAILED payload·Sentry 횟수 유지, discard 없음, [SYNTH_RETRY] 없음',
      async (_name, c) => {
        await c.arrange({ outputsPath });
        const job = makeJob(c.data(`legacy-${c.name}`));

        const err = await runFailing(job);

        expect(patches('FAILED')).toEqual([c.expectedPayload(err, job)]);
        expect(mockedCapture).toHaveBeenCalledTimes(c.captures);
        expect(job.discard).not.toHaveBeenCalled();
        expect(synthRetryLines()).toEqual([]);
      },
    );
  });

  describe('attempts 3 잡', () => {
    it.each(PATHS.filter((c) => c.name !== 'split' && c.name !== 'duplex-split').map((c) => [c.name, c] as const))(
      '%s: 재시도 가능 오류 + 남은 시도 → FAILED PATCH 없이 같은 오류로 reject',
      async (_name, c) => {
        await c.arrange({ outputsPath });
        const job = makeJob(c.data(`retry-${c.name}`), { attemptsMade: 0, attempts: 3 });

        const err = await runFailing(job);

        expect(patches('FAILED')).toEqual([]);
        expect(mockedCapture).not.toHaveBeenCalled();
        expect(job.discard).not.toHaveBeenCalled();
        const lines = synthRetryLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('attempt=1/3 action=retry reason=retryable');
        expect(lines[0]).not.toContain(err.message);
      },
    );

    it('merge 마지막 시도 → discard 후 FAILED PATCH 1회, Sentry 1회', async () => {
      synthesizer.synthesizeToLocal.mockRejectedValue(new Error('socket hang up'));
      const job = makeJob(
        { jobId: 'last-merge', coverUrl: 'a', contentUrl: 'b', spineWidth: 5 },
        { attemptsMade: 2, attempts: 3 },
      );

      await runFailing(job);

      expect(patches('FAILED')).toEqual([{ status: 'FAILED', errorMessage: 'socket hang up' }]);
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(job.discard).toHaveBeenCalledTimes(1);
      const failedCall = mockedAxios.patch.mock.calls.findIndex(
        (call: unknown[]) => (call[1] as PatchPayload).status === 'FAILED',
      );
      expect(job.discard!.mock.invocationCallOrder[0]).toBeLessThan(
        mockedAxios.patch.mock.invocationCallOrder[failedCall],
      );
      expect(synthRetryLines()).toEqual([
        expect.stringContaining('attempt=3/3 action=fail reason=exhausted code=- http=- discard=no'),
      ]);
    });

    it('split 입력 오류(INVALID_OUTPUT_OPTIONS) 첫 시도 → discard 1회, FAILED PATCH 1회, Sentry 없음', async () => {
      const c = PATHS.find((p) => p.name === 'split')!;
      const job = makeJob(c.data('input-split'), { attemptsMade: 0, attempts: 3 });

      const err = await runFailing(job);

      expect(patches('FAILED')).toEqual([c.expectedPayload(err, job)]);
      expect(job.discard).toHaveBeenCalledTimes(1);
      expect(mockedCapture).not.toHaveBeenCalled();
      expect(synthRetryLines()).toEqual([
        expect.stringContaining('action=fail reason=non-retryable code=INVALID_OUTPUT_OPTIONS http=- discard=yes'),
      ]);
    });

    it('split 다운로드 실패(FILE_DOWNLOAD_FAILED) 첫 시도 → FAILED PATCH 없음, discard 없음', async () => {
      synthesizer.downloadFile.mockRejectedValue(new Error('socket hang up'));
      const job = makeJob(
        {
          jobId: 'dl-split',
          mode: 'split',
          sessionId: 'session-1',
          pdfFileId: 'file-1',
          pageTypes: ['cover', 'content'],
          totalExpectedPages: 2,
          outputFormat: 'separate',
        },
        { attemptsMade: 0, attempts: 3 },
      );

      await runFailing(job);

      expect(patches('FAILED')).toEqual([]);
      expect(patches('PROCESSING')).toHaveLength(1);
      expect(job.discard).not.toHaveBeenCalled();
      expect(synthRetryLines()).toEqual([
        expect.stringContaining('action=retry reason=retryable code=FILE_DOWNLOAD_FAILED'),
      ]);
    });

    it('split 페이지 수 불일치(PAGE_COUNT_MISMATCH) 첫 시도 → discard 1회, FAILED PATCH 1회', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      synthesizer.downloadFile.mockResolvedValue(await doc.save());
      const job = makeJob(
        {
          jobId: 'pc-split',
          mode: 'split',
          sessionId: 'session-1',
          pdfFileId: 'file-1',
          pageTypes: ['cover', 'content'],
          totalExpectedPages: 2,
          outputFormat: 'separate',
        },
        { attemptsMade: 0, attempts: 3 },
      );

      await runFailing(job);

      const failed = patches('FAILED');
      expect(failed).toHaveLength(1);
      expect(failed[0].errorCode).toBe(ErrorCodes.PAGE_COUNT_MISMATCH);
      expect(job.discard).toHaveBeenCalledTimes(1);
    });

    it('duplex-split 다운로드 실패 두 번째 시도 → FAILED PATCH 없음', async () => {
      synthesizer.downloadFile.mockRejectedValue(new Error('socket hang up'));
      const job = makeJob(
        { jobId: 'dl-duplex', mode: 'duplex-split', sessionId: 'session-1', pdfFileId: 'file-1', totalExpectedPages: 2 },
        { attemptsMade: 1, attempts: 3 },
      );

      await runFailing(job);

      expect(patches('FAILED')).toEqual([]);
      expect(job.discard).not.toHaveBeenCalled();
      expect(synthRetryLines()).toEqual([expect.stringContaining('attempt=2/3 action=retry')]);
    });

    it('duplex-split 세션·파일 불일치 첫 시도 → discard 1회, FAILED PATCH 1회', async () => {
      const c = PATHS.find((p) => p.name === 'duplex-split')!;
      const job = makeJob(c.data('input-duplex'), { attemptsMade: 0, attempts: 3 });

      const err = await runFailing(job);

      expect(patches('FAILED')).toEqual([c.expectedPayload(err, job)]);
      expect(job.discard).toHaveBeenCalledTimes(1);
    });

    it('compose-mixed 입력 URL 404 첫 시도 → discard 1회, FAILED PATCH 1회, Sentry 1회', async () => {
      synthesizer.downloadFile.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }),
      );
      const c = PATHS.find((p) => p.name === 'compose-mixed')!;
      const job = makeJob(c.data('nf-compose'), { attemptsMade: 0, attempts: 3 });

      await runFailing(job);

      expect(patches('FAILED')).toEqual([
        { status: 'FAILED', errorMessage: 'Request failed with status code 404' },
      ]);
      expect(job.discard).toHaveBeenCalledTimes(1);
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(synthRetryLines()).toEqual([expect.stringContaining('reason=non-retryable code=- http=404 discard=yes')]);
    });

    it('spread 재시도 시도에서 작업 임시 디렉터리를 지운다', async () => {
      synthesizer.handleSpreadSynthesis.mockImplementation(async (opts: { jobTempDir: string }) => {
        await fs.writeFile(path.join(opts.jobTempDir, 'partial.pdf'), 'x');
        throw new Error('spread failed');
      });
      const c = PATHS.find((p) => p.name === 'spread')!;
      const job = makeJob(c.data('tmp-spread'), { attemptsMade: 0, attempts: 3 });

      await runFailing(job);

      expect(patches('FAILED')).toEqual([]);
      await expect(fs.access(path.join(storagePath, 'temp_tmp-spread'))).rejects.toThrow();
    });

    it('discard 함수가 없는 잡도 입력 오류면 FAILED PATCH 1회', async () => {
      const c = PATHS.find((p) => p.name === 'split')!;
      const job = makeJob(c.data('nodiscard-split'), { attemptsMade: 0, attempts: 3 });
      delete job.discard;

      await runFailing(job);

      expect(patches('FAILED')).toHaveLength(1);
      expect(synthRetryLines()).toEqual(
        expect.arrayContaining([expect.stringContaining('discard=unavailable')]),
      );
    });

    it('판정 중 예외가 나면 discard 후 FAILED PATCH 1회로 정리한다', async () => {
      synthesizer.synthesizeToLocal.mockRejectedValue(new Error('socket hang up'));
      jest
        .spyOn(processor as unknown as { loadCompletionMarker: () => Promise<null> }, 'loadCompletionMarker')
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('marker read'));
      const job = makeJob(
        { jobId: 'fallback-merge', coverUrl: 'a', contentUrl: 'b', spineWidth: 5 },
        { attemptsMade: 0, attempts: 3 },
      );

      await runFailing(job);

      expect(patches('FAILED')).toEqual([{ status: 'FAILED', errorMessage: 'socket hang up' }]);
      expect(job.discard).toHaveBeenCalledTimes(1);
      expect(synthRetryLines()).toEqual([expect.stringContaining('settle-fallback=yes')]);
    });
  });

  describe('완료 마커', () => {
    const COMPLETED = {
      status: 'COMPLETED',
      outputFileUrl: '/storage/outputs/marker-job/merged.pdf',
      result: { success: true, outputFileUrl: '/storage/outputs/marker-job/merged.pdf', totalPages: 4 },
    };

    async function writeMarker(jobId: string): Promise<void> {
      await fs.mkdir(path.join(outputsPath, jobId), { recursive: true });
      await fs.writeFile(path.join(outputsPath, jobId, '.synthesis-complete.json'), JSON.stringify(COMPLETED));
    }

    it.each([
      ['attempts 3·마지막 시도', { attemptsMade: 2, attempts: 3 }, 1, (): Error => new Error('late failure')],
      ['attempts 3·남은 시도 있음', { attemptsMade: 0, attempts: 3 }, 1, (): Error => new Error('late failure')],
      [
        'attempts 3·입력 오류',
        { attemptsMade: 0, attempts: 3 },
        1,
        (): Error => new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, 'page count mismatch'),
      ],
      ['attempts 미지정', undefined, 0, (): Error => new Error('late failure')],
    ])('%s: 실패 처리 시점에 마커가 있으면 COMPLETED 1회 재보고, FAILED 없음', async (_t, attempts, lines, makeError) => {
      const jobId = 'marker-job';
      synthesizer.synthesizeToLocal.mockImplementation(async () => {
        await writeMarker(jobId);
        throw makeError();
      });
      const job = makeJob({ jobId, coverUrl: 'a', contentUrl: 'b', spineWidth: 5 }, attempts);

      await runFailing(job);

      expect(patches('FAILED')).toEqual([]);
      expect(patches('COMPLETED')).toEqual([COMPLETED]);
      expect(job.discard).not.toHaveBeenCalled();
      expect(mockedCapture).not.toHaveBeenCalled();
      expect(synthRetryLines()).toHaveLength(lines);
      if (lines > 0) expect(synthRetryLines()[0]).toContain('action=completed reason=completed-marker');
    });

    it('재시도 시도 시작 때 마커가 있으면 합성 없이 COMPLETED 재보고 후 저장된 결과를 반환', async () => {
      await writeMarker('entry-marker');
      const job = makeJob(
        { jobId: 'entry-marker', coverUrl: 'a', contentUrl: 'b', spineWidth: 5 },
        { attemptsMade: 1, attempts: 3 },
      );

      const result = await processor.handleSynthesis(job as unknown as SynthJob);

      expect(result).toEqual(COMPLETED.result);
      expect(synthesizer.synthesizeToLocal).not.toHaveBeenCalled();
      expect(patches('COMPLETED')).toEqual([COMPLETED]);
      expect(patches('FAILED')).toEqual([]);
    });
  });
});
