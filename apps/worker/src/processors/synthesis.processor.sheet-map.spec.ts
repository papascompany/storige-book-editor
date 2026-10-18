/**
 * P2-c (2026-10-18) — 합성 mode 'sheet-map' 골든 행렬.
 *
 * 픽스처: pdf-lib 로 25p·26p PDF(페이지 i MediaBox 폭 = 100+i → 산출 페이지 순서를 폭으로 검증).
 * 행렬: sheets {same-sheet(26p: 표지 단면 + 12짝 + 뒤표지 단면), offset-next(25p: 13시트, 마지막 back null)}
 *     × backRotation {0, 180} × output {per-sheet, merged-duplex} × 경로 {OFF(pdf-lib), ON(qpdf)}.
 * 고정하는 계약:
 *  - 산출 페이지 치수 순서·/Rotate 값·파일 수가 시트 맵에서 계산한 기대와 같다(ON == OFF == 기대).
 *  - result(outputFiles·outputFileUrl·totalPages·sheetMap echo)가 ON/OFF 에서 deep-equal.
 *  - 완료 마커(.synthesis-complete.json)에 result.sheetMap 이 실린다.
 *  - 입력 오류 4종(페이지 수 불일치·범위 밖·중복·빈 sheets)은 다운로드 전에 코드 분류되어 즉시 FAILED(discard 1회).
 *  - role 'post-process' 시트는 merged-duplex 에서도 별도 set 파일.
 * ON 경로는 qpdf 가 없으면 skip(lightweight-parity.spec 관례). 하네스는 synthesis.processor.retry.spec 선례.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { execFileSync } from 'child_process';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { SheetSpec, SynthesisResult } from '@storige/types';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { ErrorCodes } from '../common/errors';
import { VALIDATION_CONFIG } from '../config/validation.config';

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
type Output = 'per-sheet' | 'merged-duplex';
type BackRotation = 0 | 180;

function qpdfAvailable(): boolean {
  try {
    execFileSync(process.env.QPDF_PATH || 'qpdf', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_QPDF = qpdfAvailable();
const cfg = VALIDATION_CONFIG as unknown as { LIGHTWEIGHT_SYNTHESIS: boolean };

/** [label, lightweight] — qpdf 가 없으면 OFF 만. */
const ROUTES: ReadonlyArray<readonly [string, boolean]> = HAS_QPDF
  ? [
      ['OFF', false],
      ['ON', true],
    ]
  : [['OFF', false]];

const PAGE_HEIGHT = 200;
const widthOf = (page: number): number => 100 + page;

const FILE_ID = 'file-sm';
const SESSION_ID = 'session-sm';
const EDITOR_FILE = {
  id: FILE_ID,
  metadata: { generatedBy: 'editor', editSessionId: SESSION_ID },
};

/** 산출 페이지 1장의 관찰값: MediaBox 폭(회전 스왑 없음)과 /Rotate. */
interface PageShape {
  width: number;
  rotate: number;
}

// ── 시트 맵 빌더 ────────────────────────────────────────────────────────────

/** same-sheet: 표지 단면(0) + 12짝(1-2 … 23-24) + 뒤표지 단면(25) = 26p, 14시트. */
function sameSheet(backRotation: BackRotation): { sheets: SheetSpec[]; pageCount: number } {
  const sheets: SheetSpec[] = [{ index: 0, front: { page: 0 }, back: null }];
  for (let k = 1; k <= 12; k++) {
    sheets.push({
      index: k,
      front: { page: 2 * k - 1 },
      back: { page: 2 * k, rotate: backRotation },
    });
  }
  sheets.push({ index: 13, front: { page: 25 }, back: null });
  return { sheets, pageCount: 26 };
}

/** offset-next: 13시트 (0-1, 2-3 … 22-23, 24-null) = 25p. */
function offsetNext(backRotation: BackRotation): { sheets: SheetSpec[]; pageCount: number } {
  const sheets: SheetSpec[] = [];
  for (let k = 0; k < 13; k++) {
    const backPage = 2 * k + 1;
    sheets.push({
      index: k,
      front: { page: 2 * k },
      back: backPage < 25 ? { page: backPage, rotate: backRotation } : null,
    });
  }
  return { sheets, pageCount: 25 };
}

const SHEET_SETS: ReadonlyArray<
  readonly [string, (rot: BackRotation) => { sheets: SheetSpec[]; pageCount: number }]
> = [
  ['same-sheet', sameSheet],
  ['offset-next', offsetNext],
];

// ── 기대 산출(파일명 → 페이지 shape 배열) ───────────────────────────────────

function faceShape(face: { page: number; rotate?: 0 | 180 }): PageShape {
  return { width: widthOf(face.page), rotate: face.rotate === 180 ? 180 : 0 };
}

function expectedFiles(sheets: SheetSpec[], output: Output): Record<string, PageShape[]> {
  const files: Record<string, PageShape[]> = {};
  const merged: PageShape[] = [];
  for (const sheet of sheets) {
    const separate = output === 'per-sheet' || sheet.role === 'post-process';
    const shapes = [faceShape(sheet.front)];
    if (sheet.back) shapes.push(faceShape(sheet.back));
    if (separate) {
      files[`set_${sheet.index}.pdf`] = shapes;
      continue;
    }
    merged.push(shapes[0]);
    merged.push(sheet.back ? shapes[1] : { width: widthOf(sheet.front.page), rotate: 0 });
  }
  if (merged.length > 0) files['sheets_duplex.pdf'] = merged;
  return files;
}

async function readShapes(file: string): Promise<PageShape[]> {
  const doc = await PDFDocument.load(await fs.readFile(file));
  return doc.getPages().map((p) => ({ width: p.getSize().width, rotate: p.getRotation().angle }));
}

async function readOutputDir(dir: string): Promise<Record<string, PageShape[]>> {
  const out: Record<string, PageShape[]> = {};
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.pdf')).sort()) {
    out[name] = await readShapes(path.join(dir, name));
  }
  return out;
}

describe('SynthesisProcessor — sheet-map 골든 행렬', () => {
  const savedLightweight = cfg.LIGHTWEIGHT_SYNTHESIS;
  let processor: SynthesisProcessor;
  let synthesizer: { downloadFile: jest.Mock } & Record<string, jest.Mock>;
  let baseDir: string;
  let fixtures: Record<number, string> = {};

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storige-sheet-map-'));
    fixtures = {};
    for (const pageCount of [25, 26]) {
      const doc = await PDFDocument.create();
      for (let i = 0; i < pageCount; i++) doc.addPage([widthOf(i), PAGE_HEIGHT]);
      const file = path.join(baseDir, `source_${pageCount}.pdf`);
      await fs.writeFile(file, await doc.save());
      fixtures[pageCount] = file;
    }
  });

  afterAll(async () => {
    cfg.LIGHTWEIGHT_SYNTHESIS = savedLightweight;
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200 });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
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
  });

  afterEach(() => {
    cfg.LIGHTWEIGHT_SYNTHESIS = savedLightweight;
    jest.restoreAllMocks();
  });

  /** 메타는 GET /files/:id/external, 바이트는 api:// → ON 스트림 / OFF synthesizer.downloadFile. */
  function mockSource(sourceFile: string): void {
    mockedAxios.get.mockImplementation(async (url: string, opts?: { responseType?: string }) => {
      if (/\/files\/[^/]+\/download\/external$/.test(url)) {
        if (opts?.responseType === 'stream') return { data: createReadStream(sourceFile) };
        return { data: await fs.readFile(sourceFile) };
      }
      if (url.endsWith(`/files/${FILE_ID}/external`)) return { data: EDITOR_FILE };
      throw new Error(`unexpected GET ${url}`);
    });
    synthesizer.downloadFile.mockImplementation(async () => new Uint8Array(await fs.readFile(sourceFile)));
  }

  async function freshPaths(): Promise<{ outputsPath: string; storagePath: string }> {
    const caseDir = await fs.mkdtemp(path.join(baseDir, 'case-'));
    const outputsPath = path.join(caseDir, 'outputs');
    const storagePath = path.join(caseDir, 'storage');
    await fs.mkdir(outputsPath, { recursive: true });
    await fs.mkdir(storagePath, { recursive: true });
    const target = processor as unknown as { outputsPath: string; storagePath: string };
    target.outputsPath = outputsPath;
    target.storagePath = storagePath;
    return { outputsPath, storagePath };
  }

  function makeJob(
    data: Record<string, unknown>,
    attempts?: { attemptsMade: number; attempts: number },
  ): { id: string; data: Record<string, unknown>; discard: jest.Mock; attemptsMade?: number; opts?: { attempts: number } } {
    const job = { id: `queue-${String(data.jobId)}`, data, discard: jest.fn() } as {
      id: string;
      data: Record<string, unknown>;
      discard: jest.Mock;
      attemptsMade?: number;
      opts?: { attempts: number };
    };
    if (attempts) {
      job.attemptsMade = attempts.attemptsMade;
      job.opts = { attempts: attempts.attempts };
    }
    return job;
  }

  function sheetMapJob(
    jobId: string,
    sheets: SheetSpec[],
    totalExpectedPages: number,
    output: Output,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      jobId,
      mode: 'sheet-map',
      sessionId: SESSION_ID,
      pdfFileId: FILE_ID,
      totalExpectedPages,
      sheets,
      output,
      duplexFlip: 'short-edge',
      ...extra,
    };
  }

  function patches(status: string): PatchPayload[] {
    return mockedAxios.patch.mock.calls
      .map((call: unknown[]) => call[1] as PatchPayload)
      .filter((payload) => payload.status === status);
  }

  /** 한 경로(ON/OFF)로 잡을 돌리고 result·산출 디렉터리 shape 를 돌려준다. */
  async function runRoute(
    lightweight: boolean,
    data: Record<string, unknown>,
    sourceFile: string,
  ): Promise<{ result: SynthesisResult; files: Record<string, PageShape[]>; outputsPath: string }> {
    cfg.LIGHTWEIGHT_SYNTHESIS = lightweight;
    const { outputsPath, storagePath } = await freshPaths();
    mockSource(sourceFile);
    const job = makeJob(data, { attemptsMade: 0, attempts: 3 });
    const result = (await processor.handleSynthesis(job as unknown as SynthJob)) as SynthesisResult;
    const outputDir = path.join(outputsPath, String(data.jobId));
    const files = await readOutputDir(outputDir);
    // 임시 디렉터리는 정리돼야 한다.
    await expect(fs.stat(path.join(storagePath, `temp_${String(data.jobId)}`))).rejects.toBeDefined();
    return { result, files, outputsPath };
  }

  describe('골든 행렬 — sheets × backRotation × output (ON == OFF == 기대)', () => {
    const matrix: Array<[string, string, BackRotation, Output]> = [];
    for (const [setName] of SHEET_SETS) {
      for (const rot of [0, 180] as BackRotation[]) {
        for (const output of ['per-sheet', 'merged-duplex'] as Output[]) {
          matrix.push([`${setName} rot=${rot} ${output}`, setName, rot, output]);
        }
      }
    }

    it.each(matrix)('%s', async (_label, setName, rot, output) => {
      const build = SHEET_SETS.find(([n]) => n === setName)![1];
      const { sheets, pageCount } = build(rot);
      const jobId = `sm-${setName}-${rot}-${output}`;
      const data = sheetMapJob(jobId, sheets, pageCount, output);
      const expected = expectedFiles(sheets, output);

      const results: SynthesisResult[] = [];
      for (const [, lightweight] of ROUTES) {
        const { result, files } = await runRoute(lightweight, data, fixtures[pageCount]);
        expect(files).toEqual(expected);
        expect(result.success).toBe(true);
        expect(result.totalPages).toBe(pageCount);
        expect(result.sheetMap).toEqual({ output, duplexFlip: 'short-edge', sheets });
        results.push(result);
      }
      // ON/OFF 결과 payload 동일(파리티).
      for (const r of results.slice(1)) expect(r).toEqual(results[0]);

      const first = results[0];
      const fileNames = Object.keys(expected);
      expect(first.outputFiles).toHaveLength(fileNames.length);
      if (output === 'per-sheet') {
        expect(first.outputFiles!.map((f) => f.type)).toEqual(sheets.map(() => 'set'));
        expect(first.outputFiles!.map((f) => f.setIndex)).toEqual(sheets.map((s) => s.index));
        expect(first.outputFiles!.map((f) => f.pageCount)).toEqual(sheets.map((s) => (s.back ? 2 : 1)));
        expect(first.outputFileUrl).toBe(`/storage/outputs/${jobId}/set_0.pdf`);
      } else {
        expect(first.outputFiles![0]).toEqual({
          type: 'pages',
          url: `/storage/outputs/${jobId}/sheets_duplex.pdf`,
          pageCount: sheets.length * 2,
        });
        expect(first.outputFileUrl).toBe(`/storage/outputs/${jobId}/sheets_duplex.pdf`);
      }
    });
  });

  it('완료 마커(.synthesis-complete.json)에 result.sheetMap 이 실린다', async () => {
    const { sheets, pageCount } = offsetNext(180);
    const jobId = 'sm-marker';
    const data = sheetMapJob(jobId, sheets, pageCount, 'merged-duplex', { duplexFlip: 'long-edge' });
    const { outputsPath } = await runRoute(false, data, fixtures[pageCount]);
    const marker = JSON.parse(
      await fs.readFile(path.join(outputsPath, jobId, '.synthesis-complete.json'), 'utf8'),
    ) as { status: string; result: SynthesisResult };
    expect(marker.status).toBe('COMPLETED');
    expect(marker.result.sheetMap).toEqual({ output: 'merged-duplex', duplexFlip: 'long-edge', sheets });
    const completed = patches('COMPLETED');
    expect(completed).toHaveLength(1);
    expect((completed[0].result as SynthesisResult).sheetMap).toEqual(marker.result.sheetMap);
  });

  describe("role 'post-process' 시트 — 출력 모드와 무관하게 별도 set 파일", () => {
    it.each(ROUTES.map(([label, lw]) => [label, lw] as const))('%s merged-duplex', async (_label, lightweight) => {
      // 인쇄 시트 2장(0-1, 2-3) + 후가공 단면(4) = 5p. 5p 픽스처는 25p 원본의 앞 5쪽으로 대체하지 않고 직접 만든다.
      const doc = await PDFDocument.create();
      for (let i = 0; i < 5; i++) doc.addPage([widthOf(i), PAGE_HEIGHT]);
      const source = path.join(baseDir, 'source_pp.pdf');
      await fs.writeFile(source, await doc.save());
      const sheets: SheetSpec[] = [
        { index: 0, front: { page: 0 }, back: { page: 1, rotate: 180 } },
        { index: 1, front: { page: 2 }, back: { page: 3, rotate: 180 } },
        { index: 2, front: { page: 4 }, back: null, role: 'post-process', label: 'foil' },
      ];
      const jobId = `sm-pp-${lightweight ? 'on' : 'off'}`;
      const { result, files } = await runRoute(
        lightweight,
        sheetMapJob(jobId, sheets, 5, 'merged-duplex'),
        source,
      );
      expect(files).toEqual({
        'sheets_duplex.pdf': [
          { width: 100, rotate: 0 },
          { width: 101, rotate: 180 },
          { width: 102, rotate: 0 },
          { width: 103, rotate: 180 },
        ],
        'set_2.pdf': [{ width: 104, rotate: 0 }],
      });
      expect(result.outputFiles).toEqual([
        { type: 'pages', url: `/storage/outputs/${jobId}/sheets_duplex.pdf`, pageCount: 4 },
        { type: 'set', url: `/storage/outputs/${jobId}/set_2.pdf`, pageCount: 1, setIndex: 2 },
      ]);
      expect(result.outputFileUrl).toBe(`/storage/outputs/${jobId}/sheets_duplex.pdf`);
      expect(result.sheetMap).toEqual({ output: 'merged-duplex', duplexFlip: 'short-edge', sheets });
    });
  });

  describe('입력 오류 — 다운로드 전 코드 분류, 즉시 FAILED(discard 1회)', () => {
    const base = offsetNext(0);
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      [
        '페이지 수 불일치(참조 합 ≠ totalExpectedPages)',
        sheetMapJob('sm-err-count', base.sheets, 26, 'per-sheet'),
        ErrorCodes.PAGE_COUNT_MISMATCH,
      ],
      [
        '범위 밖 page',
        sheetMapJob(
          'sm-err-range',
          base.sheets.map((s) => (s.index === 12 ? { ...s, front: { page: 25 } } : s)),
          25,
          'per-sheet',
        ),
        ErrorCodes.PAGE_COUNT_MISMATCH,
      ],
      [
        '중복 page',
        sheetMapJob(
          'sm-err-dup',
          base.sheets.map((s) => (s.index === 12 ? { ...s, front: { page: 0 } } : s)),
          25,
          'per-sheet',
        ),
        ErrorCodes.PAGE_COUNT_MISMATCH,
      ],
      ['빈 sheets', sheetMapJob('sm-err-empty', [], 25, 'per-sheet'), ErrorCodes.INVALID_OUTPUT_OPTIONS],
      [
        'output 허용값 밖',
        sheetMapJob('sm-err-output', base.sheets, 25, 'zip' as unknown as Output),
        ErrorCodes.INVALID_OUTPUT_OPTIONS,
      ],
    ];

    for (const [label, lightweight] of ROUTES) {
      it.each(cases.map((c) => [`${label} ${c[0]}`, c[1], c[2]] as const))('%s', async (_name, data, code) => {
        cfg.LIGHTWEIGHT_SYNTHESIS = lightweight;
        await freshPaths();
        mockSource(fixtures[25]);
        const job = makeJob(data, { attemptsMade: 0, attempts: 3 });

        await expect(processor.handleSynthesis(job as unknown as SynthJob)).rejects.toMatchObject({ code });

        const failed = patches('FAILED');
        expect(failed).toHaveLength(1);
        expect(failed[0].errorCode).toBe(code);
        expect(job.discard).toHaveBeenCalledTimes(1);
        // 검증은 다운로드 전 — 바이트 요청이 없어야 한다.
        expect(synthesizer.downloadFile).not.toHaveBeenCalled();
        expect(
          mockedAxios.get.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/download/external')),
        ).toHaveLength(0);
      });
    }

    it('원본 페이지 수 ≠ totalExpectedPages(시트 맵은 정합) → PAGE_COUNT_MISMATCH 즉시 FAILED', async () => {
      cfg.LIGHTWEIGHT_SYNTHESIS = false;
      await freshPaths();
      mockSource(fixtures[26]); // 26p 원본에 25p 시트 맵
      const job = makeJob(sheetMapJob('sm-err-source', base.sheets, 25, 'per-sheet'), {
        attemptsMade: 0,
        attempts: 3,
      });
      await expect(processor.handleSynthesis(job as unknown as SynthJob)).rejects.toMatchObject({
        code: ErrorCodes.PAGE_COUNT_MISMATCH,
        detail: { expected: 25, got: 26 },
      });
      expect(patches('FAILED')).toHaveLength(1);
      expect(job.discard).toHaveBeenCalledTimes(1);
    });
  });
});
