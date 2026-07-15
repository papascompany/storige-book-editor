/**
 * S2-5 (2026-07-16) — 워커 test env(isTest) 더미 합성 분기.
 *
 * 잠그는 계약:
 *  1. job.data.isTest===true → 실합성 미수행(synthesizer 서비스 무호출) +
 *     "TEST" 워터마크 더미 PDF 를 실경로와 동일한 파일명/URL 계약으로 산출.
 *  2. 페이지 수·판형은 요청 스펙 반영 — split=pageTypes 매수, compose-mixed=mm 판형.
 *  3. result.isTest=true 마커 + COMPLETED 상태 PATCH(웹훅 경로는 API 가 단일 채널).
 *  4. isTest 부재(기존 잡 전원) → 기존 파이프라인 그대로(분기 미진입).
 *
 * 테스트 하네스는 synthesis.processor.spec.ts 선례(axios mock + /tmp 실파일).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('axios', () => ({
  default: {
    patch: jest.fn().mockResolvedValue({ status: 200 }),
    get: jest.fn().mockResolvedValue({ data: {} }),
  },
  __esModule: true,
}));

const axios = require('axios').default;

describe('SynthesisProcessor — S2-5 test env(isTest) 더미 합성 분기', () => {
  let processor: SynthesisProcessor;
  let synthesizerService: jest.Mocked<PdfSynthesizerService>;

  const testOutputsPath = '/tmp/storige-test-env-outputs';
  const testStoragePath = '/tmp/storige-test-env-storage';

  beforeAll(async () => {
    await fs.mkdir(testOutputsPath, { recursive: true });
    await fs.mkdir(testStoragePath, { recursive: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    axios.patch.mockResolvedValue({ status: 200 });

    const mockSynthesizerService = {
      synthesizeToLocal: jest.fn(),
      splitPdfByIndices: jest.fn(),
      mergeSplitPdfs: jest.fn(),
      downloadFile: jest.fn(),
      handleSpreadSynthesis: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SynthesisProcessor,
        { provide: PdfSynthesizerService, useValue: mockSynthesizerService },
      ],
    }).compile();

    processor = module.get<SynthesisProcessor>(SynthesisProcessor);
    synthesizerService = module.get(PdfSynthesizerService);

    (processor as any).outputsPath = testOutputsPath;
    (processor as any).storagePath = testStoragePath;
  });

  afterAll(async () => {
    await fs.rm(testOutputsPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(testStoragePath, { recursive: true, force: true }).catch(() => {});
  });

  function mockJob(data: Record<string, unknown>) {
    return { id: 'queue-1', data } as any;
  }

  async function loadOutputPdf(jobId: string, filename: string) {
    const bytes = await fs.readFile(path.join(testOutputsPath, jobId, filename));
    return PDFDocument.load(bytes);
  }

  it('classic merge isTest 잡 — 실합성 무호출 + merged.pdf 더미(2p) + result.isTest', async () => {
    const jobId = 'test-env-merge-1';
    const result = await processor.handleSynthesis(
      mockJob({
        jobId,
        isTest: true,
        coverUrl: 'https://example.com/cover.pdf',
        contentUrl: 'https://example.com/content.pdf',
        spineWidth: 3,
      }),
    );

    // 실합성 파이프라인 미호출(리소스 소모 방지 목적 그 자체)
    expect(synthesizerService.synthesizeToLocal).not.toHaveBeenCalled();
    expect(synthesizerService.downloadFile).not.toHaveBeenCalled();

    expect(result.success).toBe(true);
    expect(result.isTest).toBe(true);
    expect(result.outputFileUrl).toBe(`/storage/outputs/${jobId}/merged.pdf`);

    const pdf = await loadOutputPdf(jobId, 'merged.pdf');
    expect(pdf.getPageCount()).toBe(2);

    // COMPLETED 상태 PATCH 발신(웹훅은 API 단일 채널 — 기존 경로 재사용)
    const completed = axios.patch.mock.calls.find(
      (c: unknown[]) => (c[1] as any).status === 'COMPLETED',
    );
    expect(completed).toBeDefined();
    expect((completed![1] as any).result.isTest).toBe(true);
  });

  it('split isTest 잡 — pageTypes 매수 반영(cover 2p/content 6p) + separate 파일 계약', async () => {
    const jobId = 'test-env-split-1';
    const result = await processor.handleSynthesis(
      mockJob({
        jobId,
        isTest: true,
        mode: 'split',
        sessionId: 'sess-1',
        pdfFileId: 'file-1',
        pageTypes: ['cover', 'content', 'content', 'content', 'content', 'content', 'content', 'cover'],
        totalExpectedPages: 8,
        outputFormat: 'separate',
      }),
    );

    expect(synthesizerService.splitPdfByIndices).not.toHaveBeenCalled();
    expect(synthesizerService.downloadFile).not.toHaveBeenCalled();

    expect(result.isTest).toBe(true);
    expect(result.totalPages).toBe(8);
    expect(result.outputFiles).toEqual([
      { type: 'cover', url: `/storage/outputs/${jobId}/cover.pdf` },
      { type: 'content', url: `/storage/outputs/${jobId}/content.pdf` },
    ]);

    const cover = await loadOutputPdf(jobId, 'cover.pdf');
    const content = await loadOutputPdf(jobId, 'content.pdf');
    expect(cover.getPageCount()).toBe(2);
    expect(content.getPageCount()).toBe(6);
  });

  it('compose-mixed isTest 잡(separate) — mm 판형 반영 + 면지 매수 + capability 결과 필드', async () => {
    const jobId = 'test-env-compose-1';
    const result: any = await processor.handleSynthesis(
      mockJob({
        jobId,
        isTest: true,
        mode: 'compose-mixed',
        composeCoverWidthMm: 100,
        composeCoverHeightMm: 150,
        composeContentWidthMm: 100,
        composeContentHeightMm: 150,
        composeFrontEndpaperUrls: [null, null],
        composeBackEndpaperUrls: [null],
        composeContentPdfUrl: 'https://example.com/content.pdf',
        composeOutputMode: 'separate',
      }),
    );

    expect(synthesizerService.downloadFile).not.toHaveBeenCalled();

    expect(result.isTest).toBe(true);
    expect(result.capability).toBe('compose-mixed');
    expect(result.outputMode).toBe('separate');
    // content = 앞면지 2 + 내지 대표 1 + 뒷면지 1 = 4p
    const content = await loadOutputPdf(jobId, 'content.pdf');
    expect(content.getPageCount()).toBe(4);

    // 판형(mm→pt) 반영 확인 — 100x150mm ≈ 283.46x425.20pt
    const cover = await loadOutputPdf(jobId, 'cover.pdf');
    const { width, height } = cover.getPage(0).getSize();
    expect(width).toBeCloseTo(283.46, 0);
    expect(height).toBeCloseTo(425.2, 0);
  });

  it('isTest 부재(기존 잡) — 분기 미진입, 기존 merge 파이프라인 호출(시맨틱 불변)', async () => {
    const jobId = 'test-env-live-1';
    const mergedPath = `${testStoragePath}/live-merged.pdf`;
    const doc = await PDFDocument.create();
    doc.addPage();
    await fs.writeFile(mergedPath, await doc.save());

    synthesizerService.synthesizeToLocal.mockResolvedValue({
      success: true,
      mergedPath,
      totalPages: 1,
    } as any);

    await processor.handleSynthesis(
      mockJob({
        jobId,
        coverUrl: 'https://example.com/cover.pdf',
        contentUrl: 'https://example.com/content.pdf',
        spineWidth: 3,
      }),
    );

    // 기존 파이프라인이 그대로 호출됐다(= isTest 분기 무영향)
    expect(synthesizerService.synthesizeToLocal).toHaveBeenCalledTimes(1);
  });
});
