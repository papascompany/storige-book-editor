/**
 * 합성 mode 'photo-jpeg'(사진인화 인화형 사진별 JPEG, 계약 v1.36).
 *
 * 픽스처: pdf-lib 3쪽 PDF(54×86mm, 쪽마다 다른 색). gs·qpdf 가 있어야 실렌더하므로 없으면 skip.
 * 고정하는 계약:
 *  - 사진당 JPEG 1파일(이름 = PhotoJpegSpec.filename), outputFiles type 'photo'·photoIndex·pageCount 1, outputFileUrl = 첫 사진.
 *  - result.photoJpeg = { dpi, quality, photos } echo, COMPLETED 패치에 outputFiles 동봉.
 *  - 쪽 i 를 사진 i 로 렌더(색으로 확인), 임시 디렉터리 정리.
 *  - 입력 오류(사진 수 ≠ 쪽 수)는 다운로드 전에 PAGE_COUNT_MISMATCH 로 즉시 FAILED.
 *  - PDF 쪽 수 ≠ 기대 쪽 수 → PAGE_COUNT_MISMATCH.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { spawnSync } from 'child_process';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { PhotoJpegSpec, SynthesisResult } from '@storige/types';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { ErrorCodes } from '../common/errors';

jest.mock('axios', () => ({
  default: { patch: jest.fn(), get: jest.fn() },
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

const bin = (cmd: string): boolean => spawnSync(cmd, ['--version']).status === 0;
const HAS_TOOLS = bin(process.env.GHOSTSCRIPT_PATH || 'gs') && bin(process.env.QPDF_PATH || 'qpdf');

const MM = 72 / 25.4;
const FILE_ID = 'file-pj';
const SESSION_ID = 'session-pj';
const EDITOR_FILE = { id: FILE_ID, metadata: { generatedBy: 'editor', editSessionId: SESSION_ID } };
const COLORS: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const specOf = (i: number, copies: number): PhotoJpegSpec => ({
  index: i,
  page: i,
  copies,
  label: `사진 ${i + 1}`,
  filename: `photo_${String(i + 1).padStart(3, '0')}_instax-mini_x${copies}.jpg`,
});

(HAS_TOOLS ? describe : describe.skip)('SynthesisProcessor — photo-jpeg', () => {
  let processor: SynthesisProcessor;
  let baseDir: string;
  let source: string;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storige-photo-jpeg-'));
    const doc = await PDFDocument.create();
    for (const [r, g, b] of COLORS) {
      const page = doc.addPage([54 * MM, 86 * MM]);
      page.drawRectangle({ x: 0, y: 0, width: 54 * MM, height: 86 * MM, color: rgb(r, g, b) });
    }
    source = path.join(baseDir, 'source.pdf');
    await fs.writeFile(source, await doc.save());
  });

  afterAll(async () => {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200 });
    for (const level of ['warn', 'error', 'log', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    const synthesizer = {
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

    mockedAxios.get.mockImplementation(async (url: string, opts?: { responseType?: string }) => {
      if (/\/files\/[^/]+\/download\/external$/.test(url)) {
        if (opts?.responseType === 'stream') return { data: createReadStream(source) };
        return { data: await fs.readFile(source) };
      }
      if (url.endsWith(`/files/${FILE_ID}/external`)) return { data: EDITOR_FILE };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  const makeJob = (data: Record<string, unknown>) => ({
    id: `queue-${String(data.jobId)}`,
    data,
    discard: jest.fn(),
    attemptsMade: 0,
    opts: { attempts: 3 },
  });

  const patches = (status: string): PatchPayload[] =>
    mockedAxios.patch.mock.calls.map((c: unknown[]) => c[1] as PatchPayload).filter((p) => p.status === status);

  it('쪽마다 사진 JPEG 1장 — 이름·photoIndex·echo·색', async () => {
    const { outputsPath, storagePath } = await freshPaths();
    const photos = [specOf(0, 2), specOf(1, 1), specOf(2, 5)];
    const data = {
      jobId: 'job-pj-1',
      mode: 'photo-jpeg',
      sessionId: SESSION_ID,
      pdfFileId: FILE_ID,
      totalExpectedPages: 3,
      photos,
      dpi: 150,
      quality: 90,
    };
    const result = (await processor.handleSynthesis(makeJob(data) as unknown as SynthJob)) as SynthesisResult;

    expect(result.success).toBe(true);
    expect(result.totalPages).toBe(3);
    expect(result.photoJpeg).toEqual({ dpi: 150, quality: 90, photos });
    expect(result.outputFiles).toEqual(
      photos.map((p) => ({ type: 'photo', url: `/storage/outputs/job-pj-1/${p.filename}`, pageCount: 1, photoIndex: p.index })),
    );
    expect(result.outputFileUrl).toBe(`/storage/outputs/job-pj-1/${photos[0].filename}`);

    const outDir = path.join(outputsPath, 'job-pj-1');
    expect((await fs.readdir(outDir)).filter((n) => n.endsWith('.jpg')).sort()).toEqual(photos.map((p) => p.filename).sort());
    for (const [i, photo] of photos.entries()) {
      const file = path.join(outDir, photo.filename);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.density).toBe(150);
      const { data: px } = await sharp(file).extract({ left: 150, top: 250, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      const want = COLORS[i].map((c) => c * 255);
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(px[ch] - want[ch])).toBeLessThan(60);
    }

    const done = patches('COMPLETED');
    expect(done).toHaveLength(1);
    expect(done[0].outputFiles).toEqual(result.outputFiles);
    await expect(fs.stat(path.join(storagePath, 'temp_job-pj-1'))).rejects.toBeDefined();
  });

  it('사진 수 ≠ 기대 쪽 수 → 다운로드 전 PAGE_COUNT_MISMATCH 즉시 FAILED', async () => {
    await freshPaths();
    const job = makeJob({
      jobId: 'job-pj-2',
      mode: 'photo-jpeg',
      sessionId: SESSION_ID,
      pdfFileId: FILE_ID,
      totalExpectedPages: 3,
      photos: [specOf(0, 1)],
      dpi: 300,
      quality: 95,
    });
    await expect(processor.handleSynthesis(job as unknown as SynthJob)).rejects.toBeDefined();
    const failed = patches('FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].errorCode).toBe(ErrorCodes.PAGE_COUNT_MISMATCH);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('PDF 쪽 수 ≠ 기대 쪽 수 → PAGE_COUNT_MISMATCH', async () => {
    await freshPaths();
    const job = makeJob({
      jobId: 'job-pj-3',
      mode: 'photo-jpeg',
      sessionId: SESSION_ID,
      pdfFileId: FILE_ID,
      totalExpectedPages: 4,
      photos: [specOf(0, 1), specOf(1, 1), specOf(2, 1), specOf(3, 1)],
      dpi: 300,
      quality: 95,
    });
    await expect(processor.handleSynthesis(job as unknown as SynthJob)).rejects.toBeDefined();
    const failed = patches('FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].errorCode).toBe(ErrorCodes.PAGE_COUNT_MISMATCH);
  });
});
