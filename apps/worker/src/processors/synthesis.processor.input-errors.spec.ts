/**
 * 합성 입력 오류 — 실제 PdfSynthesizerService·임시 실파일로 첫 시도 결과를 고정한다.
 *
 * [pdf-lib 경로, qpdf 경로(LIGHTWEIGHT_SYNTHESIS, qpdf 있을 때)] × [compose-mixed merged·separate, merge] 에서
 * 내지 입력별로: 열 수 없는 입력(끝까지 받은 손상·열기 암호·PDF 아님) → PDF_LOAD_FAILED, 저장소의 없는 파일 → FILE_NOT_FOUND,
 * 쓸 수 없는 입력 주소 → INPUT_URL_REJECTED 로 첫 시도에 FAILED. 받다 끊긴 입력·빈 입력·상위 디렉터리가 없는 경로는
 * FAILED 없이 다음 시도로 넘긴다. 표지 입력(compose-mixed separate, merge 무선·중철)이 열 수 없는 PDF 면
 * PDF_LOAD_FAILED(cover). compose-mixed separate 는 펼침면 표지 기대치 없이 구성한다.
 * spread 는 세션·파일 조회를 axios 목으로 성공시키고 펼침면 파일·내지 파일 입력을 확인한다.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { VALIDATION_CONFIG } from '../config/validation.config';
import { ErrorCodes } from '../common/errors';

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

type SynthJob = Parameters<SynthesisProcessor['handleSynthesis']>[0];
type PatchPayload = Record<string, unknown> & { status: string };

function binAvailable(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const QPDF_BIN = process.env.QPDF_PATH || 'qpdf';
const HAS_QPDF = binAvailable(QPDF_BIN, ['--version']);

const cfg = VALIDATION_CONFIG as unknown as { LIGHTWEIGHT_SYNTHESIS: boolean };

const LOAD_FAILED = 'PDF 로드 실패 (암호화/손상/지원불가)';

/** 펼침면 파일 치수(pt) — 세션 metadata.spread 기대치(mm)와 맞춘다. */
const SPREAD_PT = { width: 600, height: 300 };
const PT_TO_MM = 25.4 / 72;

type Fixture =
  | 'good'
  | 'corrupt'
  | 'encrypted'
  | 'html'
  | 'truncated'
  | 'empty'
  | 'missing'
  | 'missingNoParent'
  | 'ftp';

interface Expectation {
  code: string | null;
}

/** 내지 입력별 기대: code 가 null 이면 FAILED 없이 다음 시도. */
const CONTENT_CASES: ReadonlyArray<readonly [Fixture, Expectation]> = [
  ['corrupt', { code: ErrorCodes.PDF_LOAD_FAILED }],
  ['encrypted', { code: ErrorCodes.PDF_LOAD_FAILED }],
  ['html', { code: ErrorCodes.PDF_LOAD_FAILED }],
  ['truncated', { code: null }],
  ['empty', { code: null }],
  ['missing', { code: ErrorCodes.FILE_NOT_FOUND }],
  ['missingNoParent', { code: null }],
  ['ftp', { code: ErrorCodes.INPUT_URL_REJECTED }],
];

/** 표지 입력 사례 — 모두 PDF_LOAD_FAILED(cover). */
const COVER_FIXTURES: ReadonlyArray<Fixture> = ['corrupt', 'encrypted'];

const MESSAGES: Record<string, string> = {
  [ErrorCodes.PDF_LOAD_FAILED]: LOAD_FAILED,
  [ErrorCodes.FILE_NOT_FOUND]: '파일을 찾을 수 없습니다',
  [ErrorCodes.INPUT_URL_REJECTED]: '입력 파일 주소를 사용할 수 없습니다',
};

const LIGHTWEIGHT_MODES: ReadonlyArray<readonly [string, boolean]> = HAS_QPDF
  ? [
      ['pdf-lib', false],
      ['qpdf', true],
    ]
  : [['pdf-lib', false]];

describe('SynthesisProcessor — 합성 입력 오류(실파일)', () => {
  const savedLightweight = cfg.LIGHTWEIGHT_SYNTHESIS;
  const savedWorkerStorage = process.env.WORKER_STORAGE_PATH;
  let baseDir: string;
  let storageRoot: string;
  let uploadsDir: string;
  let outputsDir: string;
  const files: Record<Fixture, string> = {
    good: '',
    corrupt: '',
    encrypted: '',
    html: '',
    truncated: '',
    empty: '',
    missing: '',
    missingNoParent: '',
    ftp: 'ftp://files.example.com/content.pdf',
  };
  let spreadPath: string;
  let seq = 0;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synth-input-errors-'));
    storageRoot = path.join(baseDir, 'storage');
    uploadsDir = path.join(storageRoot, 'uploads');
    outputsDir = path.join(baseDir, 'outputs');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(outputsDir, { recursive: true });
    process.env.WORKER_STORAGE_PATH = baseDir;

    const doc = await PDFDocument.create();
    doc.addPage([420, 595]);
    doc.addPage([420, 595]);
    const good = await doc.save();
    files.good = path.join(uploadsDir, 'good.pdf');
    files.corrupt = path.join(uploadsDir, 'corrupt.pdf');
    files.encrypted = path.join(uploadsDir, 'encrypted.pdf');
    files.html = path.join(uploadsDir, 'error.pdf');
    files.truncated = path.join(uploadsDir, 'truncated.pdf');
    files.empty = path.join(uploadsDir, 'empty.pdf');
    files.missing = path.join(uploadsDir, 'missing.pdf');
    files.missingNoParent = path.join(storageRoot, 'nodir', 'missing.pdf');
    await fs.writeFile(files.good, good);
    await fs.writeFile(files.corrupt, Buffer.from('%PDF-1.4\nnot a pdf\n%%EOF\n', 'latin1'));
    await fs.writeFile(files.html, '<html><body>Not Found</body></html>\n');
    await fs.writeFile(files.truncated, good.subarray(0, 64));
    await fs.writeFile(files.empty, new Uint8Array(0));
    if (HAS_QPDF) {
      execFileSync(QPDF_BIN, ['--encrypt', 'u', 'o', '256', '--', files.good, files.encrypted], { stdio: 'ignore' });
    }

    const spread = await PDFDocument.create();
    spread.addPage([SPREAD_PT.width, SPREAD_PT.height]);
    spreadPath = path.join(uploadsDir, 'spread.pdf');
    await fs.writeFile(spreadPath, await spread.save());
  });

  afterAll(async () => {
    cfg.LIGHTWEIGHT_SYNTHESIS = savedLightweight;
    if (savedWorkerStorage === undefined) delete process.env.WORKER_STORAGE_PATH;
    else process.env.WORKER_STORAGE_PATH = savedWorkerStorage;
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200 });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cfg.LIGHTWEIGHT_SYNTHESIS = savedLightweight;
    jest.restoreAllMocks();
  });

  function makeProcessor(): SynthesisProcessor {
    const synthesizer = new PdfSynthesizerService();
    (synthesizer as unknown as { storagePath: string }).storagePath = storageRoot;
    const processor = new SynthesisProcessor(synthesizer);
    const internals = processor as unknown as { outputsPath: string; storagePath: string };
    internals.outputsPath = outputsDir;
    internals.storagePath = storageRoot;
    return processor;
  }

  async function runFirstAttempt(
    data: Record<string, unknown>,
  ): Promise<{ failed: PatchPayload[]; discard: jest.Mock }> {
    const processor = makeProcessor();
    const discard = jest.fn();
    const job = { id: `queue-${String(data.jobId)}`, data, attemptsMade: 0, opts: { attempts: 3 }, discard };
    const outcome = await processor.handleSynthesis(job as unknown as SynthJob).then(
      () => 'resolved',
      () => 'rejected',
    );
    expect(outcome).toBe('rejected');
    const failed = mockedAxios.patch.mock.calls
      .map((call: unknown[]) => call[1] as PatchPayload)
      .filter((payload) => payload.status === 'FAILED');
    return { failed, discard };
  }

  function expectOutcome(
    result: { failed: PatchPayload[]; discard: jest.Mock },
    expectation: Expectation,
    input: string,
    extra: Record<string, unknown> = {},
  ): void {
    if (expectation.code === null) {
      expect(result.failed).toEqual([]);
      expect(result.discard).not.toHaveBeenCalled();
      return;
    }
    expect(result.failed).toEqual([
      {
        status: 'FAILED',
        errorCode: expectation.code,
        errorMessage: MESSAGES[expectation.code],
        errorDetail: { input },
        ...extra,
      },
    ]);
    expect(result.discard).toHaveBeenCalledTimes(1);
  }

  const usable = (fixture: Fixture): boolean => fixture !== 'encrypted' || HAS_QPDF;

  describe.each(LIGHTWEIGHT_MODES)('%s 경로', (_label, lightweight) => {
    beforeEach(() => {
      cfg.LIGHTWEIGHT_SYNTHESIS = lightweight;
    });

    const cases = CONTENT_CASES.filter(([fixture]) => usable(fixture));

    it.each(cases)('compose-mixed merged 내지 %s', async (fixture, expectation) => {
      const result = await runFirstAttempt({
        jobId: `cm-merged-${fixture}-${seq++}`,
        mode: 'compose-mixed',
        composeCoverEditable: true,
        composeCoverUrl: files.good,
        composeFrontEndpaperUrls: [null],
        composeContentPdfUrl: files[fixture],
      });
      expectOutcome(result, expectation, 'content');
    });

    it.each(cases)('compose-mixed separate 내지 %s', async (fixture, expectation) => {
      const result = await runFirstAttempt({
        jobId: `cm-separate-${fixture}-${seq++}`,
        mode: 'compose-mixed',
        composeOutputMode: 'separate',
        composeCoverEditable: true,
        composeCoverUrl: files.good,
        composeContentPdfUrl: files[fixture],
      });
      expectOutcome(result, expectation, 'content');
    });

    it.each(cases)('merge 내지 %s', async (fixture, expectation) => {
      const result = await runFirstAttempt({
        jobId: `merge-${fixture}-${seq++}`,
        coverUrl: files.good,
        contentUrl: files[fixture],
        spineWidth: 5,
      });
      expectOutcome(result, expectation, 'content');
    });

    const coverFixtures = COVER_FIXTURES.filter((fixture) => usable(fixture));
    const coverFailure: Expectation = { code: ErrorCodes.PDF_LOAD_FAILED };

    it.each(coverFixtures)('compose-mixed separate 표지 %s → PDF_LOAD_FAILED(cover)', async (fixture) => {
      const result = await runFirstAttempt({
        jobId: `cm-separate-cover-${fixture}-${seq++}`,
        mode: 'compose-mixed',
        composeOutputMode: 'separate',
        composeCoverEditable: true,
        composeCoverUrl: files[fixture],
        composeContentPdfUrl: files.good,
      });
      expectOutcome(result, coverFailure, 'cover');
    });

    it.each(coverFixtures)('merge 무선 표지 %s → PDF_LOAD_FAILED(cover)', async (fixture) => {
      const result = await runFirstAttempt({
        jobId: `merge-cover-${fixture}-${seq++}`,
        coverUrl: files[fixture],
        contentUrl: files.good,
        spineWidth: 5,
      });
      expectOutcome(result, coverFailure, 'cover');
    });

    it.each(coverFixtures)('merge 중철 표지 %s → PDF_LOAD_FAILED(cover)', async (fixture) => {
      const result = await runFirstAttempt({
        jobId: `merge-saddle-cover-${fixture}-${seq++}`,
        coverUrl: files[fixture],
        contentUrl: files.good,
        spineWidth: 5,
        bindingType: 'saddle',
      });
      expectOutcome(result, coverFailure, 'cover');
    });

    it('compose-mixed 면지 입력이 열 수 없는 PDF 면 endpaper 로 표시한다', async () => {
      const result = await runFirstAttempt({
        jobId: `cm-endpaper-${seq++}`,
        mode: 'compose-mixed',
        composeCoverEditable: false,
        composeFrontEndpaperUrls: [files.corrupt],
        composeContentPdfUrl: files.good,
      });
      expectOutcome(result, { code: ErrorCodes.PDF_LOAD_FAILED }, 'endpaper');
    });

    it('저장소 경로 표기(/storage/…)의 없는 파일도 FILE_NOT_FOUND', async () => {
      const result = await runFirstAttempt({
        jobId: `merge-storage-ref-${seq++}`,
        coverUrl: '/storage/uploads/missing-cover.pdf',
        contentUrl: files.good,
        spineWidth: 5,
      });
      expectOutcome(result, { code: ErrorCodes.FILE_NOT_FOUND }, 'cover');
    });

    describe('spread', () => {
      function mockLookups(spreadFile: string, contentFile: string): void {
        const widthMm = SPREAD_PT.width * PT_TO_MM;
        const heightMm = SPREAD_PT.height * PT_TO_MM;
        mockedAxios.get.mockImplementation(async (url: string) => {
          if (url.includes('/edit-sessions/')) {
            return {
              data: {
                id: 'session-1',
                metadata: {
                  spine: {
                    spineWidthMm: 5,
                    pageCount: 10,
                    paperType: 'mojo_80g',
                    bindingType: 'perfect',
                    formulaVersion: 'v1',
                  },
                  spread: { spec: {}, totalWidthMm: widthMm, totalHeightMm: heightMm, dpi: 300 },
                },
              },
            };
          }
          if (url.endsWith('/files/spread-1')) {
            return { data: { id: 'spread-1', filePath: spreadFile, storageBackend: 'local' } };
          }
          if (url.endsWith('/files/content-1')) {
            return { data: { id: 'content-1', filePath: contentFile, storageBackend: 'local' } };
          }
          throw Object.assign(new Error('not found'), { response: { status: 404 } });
        });
      }

      const spreadData = (jobId: string): Record<string, unknown> => ({
        jobId,
        mode: 'spread',
        sessionId: 'session-1',
        spreadPdfFileId: 'spread-1',
        contentPdfFileIds: ['content-1'],
        totalExpectedPages: 3,
        alsoGenerateMerged: true,
      });

      it('열 수 없는 펼침면 파일 → PDF_LOAD_FAILED(spread)', async () => {
        mockLookups(files.corrupt, files.good);
        const jobId = `spread-corrupt-${seq++}`;
        const result = await runFirstAttempt(spreadData(jobId));
        expectOutcome(result, { code: ErrorCodes.PDF_LOAD_FAILED }, 'spread', { queueJobId: `queue-${jobId}` });
      });

      it('저장소의 없는 내지 파일 → FILE_NOT_FOUND(content)', async () => {
        mockLookups(spreadPath, files.missing);
        const jobId = `spread-missing-${seq++}`;
        const result = await runFirstAttempt(spreadData(jobId));
        expectOutcome(result, { code: ErrorCodes.FILE_NOT_FOUND }, 'content', { queueJobId: `queue-${jobId}` });
      });

      it('열 수 없는 내지 파일 → PDF_LOAD_FAILED(content)', async () => {
        mockLookups(spreadPath, files.corrupt);
        const jobId = `spread-content-${seq++}`;
        const result = await runFirstAttempt(spreadData(jobId));
        expectOutcome(result, { code: ErrorCodes.PDF_LOAD_FAILED }, 'content', { queueJobId: `queue-${jobId}` });
      });

      it('받다 끊긴 내지 파일은 다음 시도로 넘긴다', async () => {
        mockLookups(spreadPath, files.truncated);
        const result = await runFirstAttempt(spreadData(`spread-truncated-${seq++}`));
        expectOutcome(result, { code: null }, 'content');
      });
    });
  });
});
