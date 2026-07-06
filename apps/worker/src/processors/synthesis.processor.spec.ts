import { Test, TestingModule } from '@nestjs/testing';
import { SynthesisProcessor } from './synthesis.processor';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { Job } from 'bull';
import {
  SynthesisLocalResult,
  OutputFile,
  SplitResult,
  PageTypes,
} from '@storige/types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock axios - jest.mock은 호이스팅되므로 인라인으로 정의
jest.mock('axios', () => ({
  default: {
    patch: jest.fn().mockResolvedValue({ status: 200 }),
    get: jest.fn().mockResolvedValue({
      data: {
        id: 'test-file-id',
        filePath: '/tmp/test.pdf',
        metadata: {
          generatedBy: 'editor',
          editSessionId: 'test-session-id',
        },
      },
    }),
  },
  __esModule: true,
}));

describe('SynthesisProcessor', () => {
  let processor: SynthesisProcessor;
  let synthesizerService: jest.Mocked<PdfSynthesizerService>;

  const testOutputsPath = '/tmp/storige-test-outputs';
  const testStoragePath = '/tmp/storige-test-storage';

  beforeAll(async () => {
    await fs.mkdir(testOutputsPath, { recursive: true });
    await fs.mkdir(testStoragePath, { recursive: true });
  });

  beforeEach(async () => {
    const mockSynthesizerService = {
      synthesizeToLocal: jest.fn(),
      synthesize: jest.fn(),
      calculateSpineWidth: jest.fn(),
      getPaperThickness: jest.fn(),
      splitPdfByIndices: jest.fn(),
      mergeSplitPdfs: jest.fn(),
      downloadFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SynthesisProcessor,
        {
          provide: PdfSynthesizerService,
          useValue: mockSynthesizerService,
        },
      ],
    }).compile();

    processor = module.get<SynthesisProcessor>(SynthesisProcessor);
    synthesizerService = module.get(PdfSynthesizerService);

    // private 멤버 오버라이드
    (processor as any).outputsPath = testOutputsPath;
    (processor as any).storagePath = testStoragePath;
  });

  afterAll(async () => {
    try {
      await fs.rm(testOutputsPath, { recursive: true, force: true });
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // 무시
    }
  });

  describe('handleSynthesis', () => {
    describe('merged 모드 (기본)', () => {
      it('outputFormat 미지정 시 merged로 처리', async () => {
        const jobId = 'test-job-merged';
        const mockJob = createMockJob({
          jobId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          // outputFormat 미지정
        });

        const mockLocalResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: `${testStoragePath}/source_cover.pdf`,
          sourceContentPath: `${testStoragePath}/source_content.pdf`,
          mergedPath: `${testStoragePath}/merged.pdf`,
          totalPages: 104,
        };

        // Mock 파일 생성
        await createMockPdfFile(mockLocalResult.sourceCoverPath);
        await createMockPdfFile(mockLocalResult.sourceContentPath);
        await createMockPdfFile(mockLocalResult.mergedPath);

        synthesizerService.synthesizeToLocal.mockResolvedValue(mockLocalResult);

        try {
          const result = await processor.handleSynthesis(mockJob as any);

          // merged URL만 반환
          expect(result.outputFileUrl).toContain('merged.pdf');
          expect(result.outputFiles).toBeUndefined();
        } finally {
          // 정리
          await cleanupMockFiles([
            mockLocalResult.sourceCoverPath,
            mockLocalResult.sourceContentPath,
            mockLocalResult.mergedPath,
          ]);
        }
      });
    });

    describe('separate 모드', () => {
      it('outputFormat: separate 요청 시 outputFiles 포함', async () => {
        const jobId = 'test-job-separate';
        const mockJob = createMockJob({
          jobId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'separate',
        });

        const mockLocalResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: `${testStoragePath}/source_cover_sep.pdf`,
          sourceContentPath: `${testStoragePath}/source_content_sep.pdf`,
          mergedPath: `${testStoragePath}/merged_sep.pdf`,
          coverPath: `${testStoragePath}/cover_sep.pdf`,
          contentPath: `${testStoragePath}/content_sep.pdf`,
          totalPages: 104,
        };

        // Mock 파일 생성
        await createMockPdfFile(mockLocalResult.sourceCoverPath);
        await createMockPdfFile(mockLocalResult.sourceContentPath);
        await createMockPdfFile(mockLocalResult.mergedPath);
        await createMockPdfFile(mockLocalResult.coverPath!);
        await createMockPdfFile(mockLocalResult.contentPath!);

        synthesizerService.synthesizeToLocal.mockResolvedValue(mockLocalResult);

        try {
          const result = await processor.handleSynthesis(mockJob as any);

          // merged URL 항상 포함 (하위호환)
          expect(result.outputFileUrl).toContain('merged.pdf');

          // outputFiles 포함
          expect(result.outputFiles).toBeDefined();
          expect(result.outputFiles).toHaveLength(2);

          // 순서 검증: cover → content
          expect(result.outputFiles![0].type).toBe('cover');
          expect(result.outputFiles![1].type).toBe('content');
        } finally {
          // 정리
          await cleanupMockFiles([
            mockLocalResult.sourceCoverPath,
            mockLocalResult.sourceContentPath,
            mockLocalResult.mergedPath,
            mockLocalResult.coverPath!,
            mockLocalResult.contentPath!,
          ]);
        }
      });
    });

    describe('에러 처리', () => {
      it('synthesizeToLocal 실패 시 에러 발생', async () => {
        const jobId = 'test-job-error';
        const mockJob = createMockJob({
          jobId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        });

        synthesizerService.synthesizeToLocal.mockRejectedValue(
          new Error('Download failed'),
        );

        await expect(processor.handleSynthesis(mockJob as any)).rejects.toThrow(
          'Download failed',
        );
      });
    });
  });

  describe('OutputFile 타입 검증', () => {
    it('cover 타입 검증', () => {
      const coverFile: OutputFile = {
        type: 'cover',
        url: '/storage/outputs/test/cover.pdf',
      };
      expect(coverFile.type).toBe('cover');
      expect(coverFile.url).toContain('cover.pdf');
    });

    it('content 타입 검증', () => {
      const contentFile: OutputFile = {
        type: 'content',
        url: '/storage/outputs/test/content.pdf',
      };
      expect(contentFile.type).toBe('content');
      expect(contentFile.url).toContain('content.pdf');
    });
  });

  // ============================================================================
  // Split Synthesis 테스트 (★ v1.1.4 설계서)
  // ============================================================================

  describe('handleSplitSynthesis (mode: split)', () => {
    describe('mode 분기 검증', () => {
      it('mode === "split" 시 handleSplitSynthesis 호출', async () => {
        const mockJob = createMockJob({
          jobId: 'test-split-job',
          mode: 'split',
          sessionId: 'test-session-id',
          pdfFileId: 'test-file-id',
          pageTypes: ['cover', 'content', 'content', 'cover'] as PageTypes,
          totalExpectedPages: 4,
          outputFormat: 'separate',
        });

        // handleSplitSynthesis가 호출되면 파일 조회를 시도함
        // axios mock이 설정되어 있으므로 getFileById 호출 확인
        const axios = require('axios').default;

        try {
          await processor.handleSynthesis(mockJob as any);
        } catch {
          // 파일 다운로드 실패는 예상됨
        }

        // getFileById가 호출되었는지 확인 (split 모드 분기 확인)
        expect(axios.get).toHaveBeenCalled();
      });

      it('mode 없으면 기존 merge 로직 실행', async () => {
        const mockJob = createMockJob({
          jobId: 'test-merge-job',
          // mode 없음
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        });

        const mockLocalResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: `${testStoragePath}/source_cover.pdf`,
          sourceContentPath: `${testStoragePath}/source_content.pdf`,
          mergedPath: `${testStoragePath}/merged.pdf`,
          totalPages: 10,
        };

        await createMockPdfFile(mockLocalResult.sourceCoverPath);
        await createMockPdfFile(mockLocalResult.sourceContentPath);
        await createMockPdfFile(mockLocalResult.mergedPath);

        synthesizerService.synthesizeToLocal.mockResolvedValue(mockLocalResult);

        try {
          const result = await processor.handleSynthesis(mockJob as any);
          // synthesizeToLocal이 호출되었다면 merge 로직 실행됨
          expect(synthesizerService.synthesizeToLocal).toHaveBeenCalled();
        } finally {
          await cleanupMockFiles([
            mockLocalResult.sourceCoverPath,
            mockLocalResult.sourceContentPath,
            mockLocalResult.mergedPath,
          ]);
        }
      });

      it('mode === undefined 시 기존 merge 로직 실행', async () => {
        const mockJob = createMockJob({
          jobId: 'test-undefined-mode',
          mode: undefined,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        });

        const mockLocalResult: SynthesisLocalResult = {
          success: true,
          sourceCoverPath: `${testStoragePath}/src_cover.pdf`,
          sourceContentPath: `${testStoragePath}/src_content.pdf`,
          mergedPath: `${testStoragePath}/merged.pdf`,
          totalPages: 10,
        };

        await createMockPdfFile(mockLocalResult.sourceCoverPath);
        await createMockPdfFile(mockLocalResult.sourceContentPath);
        await createMockPdfFile(mockLocalResult.mergedPath);

        synthesizerService.synthesizeToLocal.mockResolvedValue(mockLocalResult);

        try {
          await processor.handleSynthesis(mockJob as any);
          expect(synthesizerService.synthesizeToLocal).toHaveBeenCalled();
        } finally {
          await cleanupMockFiles([
            mockLocalResult.sourceCoverPath,
            mockLocalResult.sourceContentPath,
            mockLocalResult.mergedPath,
          ]);
        }
      });
    });

    describe('옵션 조합 검증', () => {
      it('INVALID_OUTPUT_OPTIONS: merged + alsoGenerateMerged=true', async () => {
        const mockJob = createMockJob({
          jobId: 'test-invalid-options',
          mode: 'split',
          sessionId: 'test-session-id',
          pdfFileId: 'test-file-id',
          pageTypes: ['cover', 'content'] as PageTypes,
          totalExpectedPages: 2,
          outputFormat: 'merged',
          alsoGenerateMerged: true, // ★ 무효한 조합
        });

        await expect(processor.handleSynthesis(mockJob as any)).rejects.toThrow(
          /INVALID_OUTPUT_OPTIONS|alsoGenerateMerged/,
        );
      });
    });
  });

  describe('PageTypes 타입 검증', () => {
    it('pageTypes 배열 생성 검증', () => {
      const pageTypes: PageTypes = ['cover', 'content', 'content', 'content', 'cover'];

      expect(pageTypes).toHaveLength(5);
      expect(pageTypes[0]).toBe('cover');
      expect(pageTypes[1]).toBe('content');
      expect(pageTypes[4]).toBe('cover');
    });

    it('cover/content만 허용', () => {
      const pageTypes: PageTypes = ['cover', 'content'];

      pageTypes.forEach((type) => {
        expect(['cover', 'content']).toContain(type);
      });
    });
  });

  describe('SplitResult 타입 검증', () => {
    it('SplitResult 구조 검증', () => {
      const splitResult: SplitResult = {
        coverPath: '/tmp/cover.pdf',
        contentPath: '/tmp/content.pdf',
        coverPageCount: 2,
        contentPageCount: 8,
      };

      expect(splitResult.coverPath).toContain('cover.pdf');
      expect(splitResult.contentPath).toContain('content.pdf');
      expect(splitResult.coverPageCount + splitResult.contentPageCount).toBe(10);
    });
  });

  // ── ⓔ 멱등 가드 (2026-06-23): 재시도/stalled 재배달 시 유료주문 중복합성 방지 ──
  describe('ⓔ 멱등 가드 (completion marker)', () => {
    it('writeCompletionMarker → loadCompletionMarker 왕복(COMPLETED 만 반환)', async () => {
      const jobId = 'idem-roundtrip';
      const payload = {
        status: 'COMPLETED',
        outputFileUrl: `/storage/outputs/${jobId}/merged.pdf`,
        result: { success: true, outputFileUrl: `/storage/outputs/${jobId}/merged.pdf`, totalPages: 7 },
      };
      await (processor as any).writeCompletionMarker(jobId, payload);
      const loaded = await (processor as any).loadCompletionMarker(jobId);
      expect(loaded).toMatchObject({ status: 'COMPLETED' });
      expect(loaded.result.totalPages).toBe(7);
    });

    it('마커 부재 → null(정상 합성 폴백)', async () => {
      const loaded = await (processor as any).loadCompletionMarker('idem-absent-xyz');
      expect(loaded).toBeNull();
    });

    it('COMPLETED 아닌 마커 → null(미완료로 간주, 재합성 허용)', async () => {
      const jobId = 'idem-processing';
      await (processor as any).writeCompletionMarker(jobId, { status: 'PROCESSING' });
      expect(await (processor as any).loadCompletionMarker(jobId)).toBeNull();
    });

    it('마커가 있으면 handleSynthesis 가 재합성 없이 단락하고 캐시 결과를 반환한다', async () => {
      const jobId = 'idem-shortcircuit';
      const cachedResult = { success: true, outputFileUrl: `/storage/outputs/${jobId}/merged.pdf`, totalPages: 99 };
      await (processor as any).writeCompletionMarker(jobId, {
        status: 'COMPLETED',
        outputFileUrl: cachedResult.outputFileUrl,
        result: cachedResult,
      });

      const job = createMockJob({
        jobId,
        coverUrl: 'https://example.com/cover.pdf',
        contentUrl: 'https://example.com/content.pdf',
        spineWidth: 5,
      });

      const result = await processor.handleSynthesis(job as any);

      // 재합성 경로(synthesizer)가 호출되지 않아야 한다(=중복합성 방지)
      expect(synthesizerService.synthesizeToLocal).not.toHaveBeenCalled();
      expect(synthesizerService.downloadFile).not.toHaveBeenCalled();
      // 캐시된 결과 반환
      expect(result.totalPages).toBe(99);
      expect(result.outputFileUrl).toContain('merged.pdf');
    });

    it('성공 합성 후 마커가 기록된다(다음 재시도 단락 보장)', async () => {
      const jobId = 'idem-writes-marker';
      const mockLocalResult: SynthesisLocalResult = {
        success: true,
        sourceCoverPath: `${testStoragePath}/m_cover.pdf`,
        sourceContentPath: `${testStoragePath}/m_content.pdf`,
        mergedPath: `${testStoragePath}/m_merged.pdf`,
        totalPages: 12,
      };
      await createMockPdfFile(mockLocalResult.sourceCoverPath);
      await createMockPdfFile(mockLocalResult.sourceContentPath);
      await createMockPdfFile(mockLocalResult.mergedPath);
      synthesizerService.synthesizeToLocal.mockResolvedValue(mockLocalResult);

      try {
        await processor.handleSynthesis(
          createMockJob({
            jobId,
            coverUrl: 'https://example.com/cover.pdf',
            contentUrl: 'https://example.com/content.pdf',
            spineWidth: 5,
          }) as any,
        );
        const marker = await (processor as any).loadCompletionMarker(jobId);
        expect(marker).not.toBeNull();
        expect(marker.status).toBe('COMPLETED');
      } finally {
        await cleanupMockFiles([
          mockLocalResult.sourceCoverPath,
          mockLocalResult.sourceContentPath,
          mockLocalResult.mergedPath,
        ]);
      }
    });
  });

  // ── D-4 (2026-07-06, C-4 Track 3): compose-mixed cover 검증 output 우선·total 폴백 + 커버 3종 정합 ──
  describe('D-4 스프레드 cover 기대치 — output 우선 · total 폴백', () => {
    it('output(wrap 포함) 사이즈가 있으면 output 을 기대치로 사용 (total 무시)', () => {
      const exp = (processor as any).resolveSpreadCoverExpectation({
        composeSpreadTotalWidthMm: 450,
        composeSpreadTotalHeightMm: 300,
        composeSpreadOutputWidthMm: 466,
        composeSpreadOutputHeightMm: 316,
        composeSpreadDpi: 300,
      });
      expect(exp).toEqual({ widthMm: 466, heightMm: 316, dpi: 300 });
    });

    it('output 부재 시 totalWidthMm 폴백 — 기존 검증과 동일 결과', () => {
      const exp = (processor as any).resolveSpreadCoverExpectation({
        composeSpreadTotalWidthMm: 450,
        composeSpreadTotalHeightMm: 300,
        composeSpreadDpi: 300,
      });
      expect(exp).toEqual({ widthMm: 450, heightMm: 300, dpi: 300 });
    });

    it('output 이 한쪽만 있거나 0/비수치면 무시하고 total 폴백', () => {
      const base = { composeSpreadTotalWidthMm: 450, composeSpreadTotalHeightMm: 300 };
      expect(
        (processor as any).resolveSpreadCoverExpectation({ ...base, composeSpreadOutputWidthMm: 466 }),
      ).toMatchObject({ widthMm: 450, heightMm: 300 });
      expect(
        (processor as any).resolveSpreadCoverExpectation({
          ...base,
          composeSpreadOutputWidthMm: 0,
          composeSpreadOutputHeightMm: 316,
        }),
      ).toMatchObject({ widthMm: 450, heightMm: 300 });
      expect(
        (processor as any).resolveSpreadCoverExpectation({
          ...base,
          composeSpreadOutputWidthMm: 'x' as any,
          composeSpreadOutputHeightMm: 316,
        }),
      ).toMatchObject({ widthMm: 450, heightMm: 300 });
    });

    it('total/output 모두 부재(비스프레드) → undefined (검증 skip, 기존 동일)', () => {
      expect((processor as any).resolveSpreadCoverExpectation({})).toBeUndefined();
    });

    it('SOFT(기본) 정책 불변: 불일치 시 throw 없이 ok=false 기록', () => {
      const mmToPt = (mm: number) => (mm * 72) / 25.4;
      const v = (processor as any).validateSpreadCoverSizeMeasured(
        'd4-soft', 1, mmToPt(450), mmToPt(300), 466, 316, 300,
      );
      expect(v.ok).toBe(false);
      expect(v.mode).toBe('soft');
      expect(v.mismatches.length).toBeGreaterThan(0);
    });

    it('HARD(SPREAD_SNAPSHOT_HARD_FAIL=true) 정책 불변: 불일치 시 throw', () => {
      const mmToPt = (mm: number) => (mm * 72) / 25.4;
      process.env.SPREAD_SNAPSHOT_HARD_FAIL = 'true';
      try {
        expect(() =>
          (processor as any).validateSpreadCoverSizeMeasured(
            'd4-hard', 1, mmToPt(450), mmToPt(300), 466, 316, 300,
          ),
        ).toThrow();
      } finally {
        delete process.env.SPREAD_SNAPSHOT_HARD_FAIL;
      }
    });

    it('wrap 사이즈 cover + output 기대치 = 검증 통과 (tol 내)', () => {
      const mmToPt = (mm: number) => (mm * 72) / 25.4;
      const v = (processor as any).validateSpreadCoverSizeMeasured(
        'd4-ok', 1, mmToPt(466), mmToPt(316), 466, 316, 300,
      );
      expect(v.ok).toBe(true);
      expect(v.expectedWidthMm).toBe(466);
      expect(v.expectedHeightMm).toBe(316);
    });
  });

  describe('D-4 compose-mixed 통합 — 커버 3종 정합 회귀', () => {
    const { PDFDocument } = require('pdf-lib');
    const mmToPt = (mm: number) => (mm * 72) / 25.4;

    const makePdfBytes = async (widthMm: number, heightMm: number, pages: number): Promise<Buffer> => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < pages; i++) {
        doc.addPage([mmToPt(widthMm), mmToPt(heightMm)]);
      }
      return Buffer.from(await doc.save());
    };

    it('하드커버(wrap 466x316 cover) + output 기대치 push → output 기준 검증 통과', async () => {
      const jobId = 'd4-cm-hardcover-output';
      const coverBytes = await makePdfBytes(466, 316, 1); // 싸바리 wrap 포함 출력 사이즈
      const contentBytes = await makePdfBytes(210, 297, 4);
      synthesizerService.downloadFile.mockImplementation(async (url: string) =>
        url.includes('cover') ? coverBytes : contentBytes,
      );

      const result = await processor.handleSynthesis(
        createMockJob({
          jobId,
          mode: 'compose-mixed',
          composeCoverUrl: 'https://example.com/cover.pdf',
          composeCoverEditable: true,
          composeCoverWidthMm: 216,
          composeCoverHeightMm: 303,
          composeContentPdfUrl: 'https://example.com/content.pdf',
          composeContentWidthMm: 210,
          composeContentHeightMm: 297,
          composeOutputMode: 'separate',
          // 기존(trim 기준 total) + D-4 신규(output wrap) 동시 존재 → output 우선
          composeSpreadTotalWidthMm: 450,
          composeSpreadTotalHeightMm: 300,
          composeSpreadOutputWidthMm: 466,
          composeSpreadOutputHeightMm: 316,
          composeSpreadDpi: 300,
        }) as any,
      );

      expect(result.success).toBe(true);
      const marker = await (processor as any).loadCompletionMarker(jobId);
      expect(marker?.result?.coverSizeValidation).toMatchObject({
        ok: true,
        expectedWidthMm: 466,
        expectedHeightMm: 316,
      });
      // 계약 회귀: separate = cover.pdf + content.pdf 2파일
      const types = (marker?.result?.outputFiles ?? []).map((f: any) => f.type);
      expect(types).toEqual(['cover', 'content']);
    });

    it('output 부재(기존 페이로드) → total 기준 검증 = 기존 동작 100% 동일 (wrap cover 는 SOFT 불일치·비차단)', async () => {
      const jobId = 'd4-cm-total-fallback';
      const coverBytes = await makePdfBytes(466, 316, 1);
      const contentBytes = await makePdfBytes(210, 297, 4);
      synthesizerService.downloadFile.mockImplementation(async (url: string) =>
        url.includes('cover') ? coverBytes : contentBytes,
      );

      const result = await processor.handleSynthesis(
        createMockJob({
          jobId,
          mode: 'compose-mixed',
          composeCoverUrl: 'https://example.com/cover.pdf',
          composeCoverEditable: true,
          composeCoverWidthMm: 216,
          composeCoverHeightMm: 303,
          composeContentPdfUrl: 'https://example.com/content.pdf',
          composeContentWidthMm: 210,
          composeContentHeightMm: 297,
          composeOutputMode: 'separate',
          composeSpreadTotalWidthMm: 450,
          composeSpreadTotalHeightMm: 300,
          composeSpreadDpi: 300,
        }) as any,
      );

      // SOFT: 불일치여도 합성 계속(비차단) — 기존 정책 그대로
      expect(result.success).toBe(true);
      const marker = await (processor as any).loadCompletionMarker(jobId);
      expect(marker?.result?.coverSizeValidation).toMatchObject({
        ok: false,
        mode: 'soft',
        expectedWidthMm: 450,
        expectedHeightMm: 300,
      });
    });

    it('기성커버(coverEditable=false) separate: 빈 표지 1쪽 생성 + cover 사이즈 검증 skip', async () => {
      const jobId = 'd4-cm-readymade-skip';
      const contentBytes = await makePdfBytes(210, 297, 4);
      synthesizerService.downloadFile.mockResolvedValue(contentBytes as any);

      const result = await processor.handleSynthesis(
        createMockJob({
          jobId,
          mode: 'compose-mixed',
          // 기성커버: 편집 표지 없음 — coverPreviewImage 는 편집기 표시용, 출력은 빈 표지
          composeCoverEditable: false,
          composeCoverWidthMm: 216,
          composeCoverHeightMm: 303,
          composeContentPdfUrl: 'https://example.com/content.pdf',
          composeContentWidthMm: 210,
          composeContentHeightMm: 297,
          composeOutputMode: 'separate',
          // 스프레드/output 기대치가 있어도 기성커버는 검증 대상 아님(빈 표지)
          composeSpreadTotalWidthMm: 450,
          composeSpreadTotalHeightMm: 300,
          composeSpreadOutputWidthMm: 466,
          composeSpreadOutputHeightMm: 316,
        }) as any,
      );

      expect(result.success).toBe(true);
      const marker = await (processor as any).loadCompletionMarker(jobId);
      // 검증 skip — 허위 SIZE_MISMATCH/HARD-FAIL 없음
      expect(marker?.result?.coverSizeValidation).toBeUndefined();
      // 분리 2파일 계약 유지 + 빈 표지 1쪽
      const coverFile = (marker?.result?.outputFiles ?? []).find((f: any) => f.type === 'cover');
      const contentFile = (marker?.result?.outputFiles ?? []).find((f: any) => f.type === 'content');
      expect(coverFile?.pageCount).toBe(1);
      expect(contentFile?.pageCount).toBe(4);
      // 빈 표지 크기 = composeCoverWidthMm/HeightMm (coverPt)
      const coverPdf = await PDFDocument.load(
        await fs.readFile(path.join(testOutputsPath, jobId, 'cover.pdf')),
      );
      const size = coverPdf.getPage(0).getSize();
      expect(size.width).toBeCloseTo(mmToPt(216), 0);
      expect(size.height).toBeCloseTo(mmToPt(303), 0);
    });
  });
});

// Helper functions
function createMockJob(data: any): Partial<Job<any>> {
  return {
    id: data.jobId,
    data,
    progress: jest.fn(),
    log: jest.fn(),
  };
}

async function createMockPdfFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // 최소한의 PDF 헤더
  await fs.writeFile(filePath, '%PDF-1.4\n%%EOF');
}

async function cleanupMockFiles(files: string[]): Promise<void> {
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch {
      // 무시
    }
  }
}
