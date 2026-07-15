import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { JobStatusService } from '../services/job-status.service';
import { DomainError, ErrorCodes } from '../common/errors';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';
import { captureJobException } from '../sentry/sentry.init';
import { VALIDATION_CONFIG } from '../config/validation.config';
import { downloadToTempFile } from '../utils/stream-download';
import { extractPdfMetadataQpdf } from '../utils/pdf-metadata-qpdf';
import {
  assemblePdf as qpdfAssemble,
  extractPages as qpdfExtractPages,
  createBlankPdf,
} from '../utils/pdf-merge-qpdf';
import {
  SynthesisLocalResult,
  SynthesisResult,
  OutputFile,
  SplitSynthesisJobData,
  DuplexSplitSynthesisJobData,
  SpreadSynthesisJobData,
  PageTypes,
  SplitResult,
  SpreadSynthesisLocalResult,
} from '@storige/types';

interface SynthesisJobData {
  jobId: string; // domain ID (worker_jobs.id)
  mode?: 'split' | 'duplex-split' | 'spread' | 'compose-mixed'; // ★ 모드 분기 기준 (2026-06-09: duplex-split 추가)
  coverUrl?: string;
  contentUrl?: string;
  spineWidth?: number;
  bindingType?: 'perfect' | 'saddle' | 'hardcover';
  generatePreview?: boolean;
  outputFormat?: 'merged' | 'separate';
  // Split synthesis 전용
  sessionId?: string;
  pdfFileId?: string;
  pageTypes?: PageTypes;
  totalExpectedPages?: number;
  alsoGenerateMerged?: boolean;
  callbackUrl?: string;
  // Spread synthesis 전용
  spreadPdfFileId?: string;
  contentPdfFileIds?: string[];
  // ── 인쇄 워크플로우 v1 Phase 5 (2026-05-19) — compose-mixed 전용 ──
  /** 표지 PDF URL. coverEditable=false 면 worker가 빈 페이지 생성하므로 미전송 가능 */
  composeCoverUrl?: string;
  /** 표지 편집 가능 여부 (false=레더커버 → 빈 페이지) */
  composeCoverEditable?: boolean;
  /** 표지 페이지 폭 (mm) — 빈 표지 생성 시 사용 */
  composeCoverWidthMm?: number;
  /** 표지 페이지 높이 (mm) */
  composeCoverHeightMm?: number;
  /** 앞면지 URL 배열 (editable=true 면 캔버스 PDF, false 면 worker가 빈 페이지 생성) */
  composeFrontEndpaperUrls?: (string | null)[];
  /** 뒷면지 URL 배열 */
  composeBackEndpaperUrls?: (string | null)[];
  /** 내지 PDF URL (편집 결과 또는 contentPdfFileId 첨부 PDF) */
  composeContentPdfUrl?: string;
  /** 내지 페이지 폭/높이 (mm) — 빈 면지 페이지 생성 시 사용 */
  composeContentWidthMm?: number;
  composeContentHeightMm?: number;
  /** 출력 모드: separate(표지+내지), content-only(내지만), single(낱장) */
  composeOutputMode?: 'separate' | 'content-only' | 'single';
  /** P0-3: 스프레드 책 cover(펼침면 전체) MediaBox 무결성 검증 기대치 (API가 세션 metadata.spread 에서 push). 부재=비스프레드 → 검증 skip */
  composeSpreadTotalWidthMm?: number;
  composeSpreadTotalHeightMm?: number;
  composeSpreadDpi?: number;
  /**
   * D-4 (2026-07-06, C-4 Track 3): 하드커버 싸바리 등 '출력(wrap 포함) 사이즈'가 화면 trim 과
   * 다른 상품의 cover 검증 기대치 (세션 metadata.spread.outputWidthMm/outputHeightMm).
   * 존재 시 total 대신 이 값으로 검증(output 우선), 부재 시 total 폴백 = 기존 동작과 100% 동일.
   * 내부 큐 metadata 전용 — 워커 external DTO(worker-job.dto.ts) 표면 불변.
   */
  composeSpreadOutputWidthMm?: number;
  composeSpreadOutputHeightMm?: number;
  /**
   * [S2-5, 2026-07-16] test env 파트너 키 잡 마커 — API 잡 생성부가 isTest 잡에만
   * conditional spread 로 등재(live 잡 페이로드 키 집합 불변). true 면 실합성 대신
   * TEST 워터마크 더미 산출(handleTestSynthesis) — 실합성 리소스 소모 방지.
   * 현 Stage 2 는 발화 경로 없음(잡 생성 external 라우트=sites 키 live 전용),
   * 실발화는 Stage 3(v1 books 잡 생성 표면).
   */
  isTest?: boolean;
}

// FilesService 인터페이스 (Worker에서 DB 조회용)
interface FileRecord {
  id: string;
  filePath: string;
  metadata?: {
    generatedBy?: string;
    editSessionId?: string;
  };
}

@Processor('pdf-synthesis')
export class SynthesisProcessor {
  private readonly logger = new Logger(SynthesisProcessor.name);
  private readonly apiBaseUrl =
    process.env.API_BASE_URL || 'http://localhost:4000/api';
  private readonly storagePath =
    process.env.STORAGE_PATH || '/app/storage/temp';
  private readonly outputsPath =
    process.env.OUTPUTS_PATH || '/app/storage/outputs';
  // WK-4 — 상태 업데이트 재시도 공유 서비스 (DI 대신 직접 생성 — 기존 스펙 생성자 고정)
  private readonly jobStatusService = new JobStatusService();

  constructor(private readonly synthesizerService: PdfSynthesizerService) {}

  @Process('synthesize-pdf')
  async handleSynthesis(job: Job<SynthesisJobData>) {
    const { mode } = job.data;
    const jobId = job.data.jobId;

    // ⓔ(2026-06-23) 멱등 가드 — 합성 비멱등 재실행 방지(유료 인쇄 주문 중복합성 차단).
    // 완료 마커(.synthesis-complete.json, updateJobStatus COMPLETED 시 기록)가 있으면 이전 시도가
    // 이미 성공한 것 → 재합성/재다운로드/재머지 없이 단락. Bull stalled 재배달(maxStalledCount,
    // attempts=1 에서도 lock 만료 시 발생) 및 향후 attempts>1 양쪽을 커버한다.
    // fail-safe: 마커 부재/파손이면 null → 정상 합성으로 폴백(가드가 합성을 막는 일은 없음).
    const cached = await this.loadCompletionMarker(jobId);
    if (cached) {
      this.logger.warn(
        `[idempotent] synthesis job ${jobId} 이미 완료됨(mode=${mode}, queue=${job.id}) — 재합성 생략, 콜백 재발송`,
      );
      // 수신측 webhook patch 는 멱등(upsert) → 최초 콜백 유실 엣지 복구 겸 재발송. 중복은 무해.
      await this.updateJobStatus(jobId, cached);
      return cached.result ?? { success: true, idempotentSkip: true };
    }

    // [S2-5] test env 잡 — 실합성 파이프라인 대신 TEST 워터마크 더미 산출물 생성.
    // 멱등 가드 뒤·mode 분기 앞: 재배달도 완료 마커로 동일하게 단락된다.
    // 기존 3큐·프로세서 시맨틱 불변 — isTest 잡만 분기(live 잡은 이 라인 통과 비용 0).
    if (job.data.isTest === true) {
      return this.handleTestSynthesis(job);
    }

    // ★ mode 단일 진실 공급원: Queue payload의 mode만 신뢰
    if (mode === 'split') {
      return this.handleSplitSynthesis(job as Job<SplitSynthesisJobData>);
    }
    if (mode === 'duplex-split') {
      return this.handleDuplexSplitSynthesis(
        job as Job<DuplexSplitSynthesisJobData>,
      );
    }
    if (mode === 'spread') {
      return this.handleSpreadSynthesis(job as Job<SpreadSynthesisJobData>);
    }
    if (mode === 'compose-mixed') {
      // 인쇄 워크플로우 v1 Phase 5 (2026-05-19) — 표지+면지+내지 합본
      return this.handleComposeMixedSynthesis(job);
    }

    // 기존 merge 로직
    return this.handleMergeSynthesis(job);
  }

  // ============================================================================
  // [S2-5] Test env 더미 합성 (2026-07-16, 로드맵 §6 Stage 2 작업 1)
  // ============================================================================

  /** A4 세로 기본 판형(pt) — 요청 스펙에 판형 정보가 없는 mode(classic/split)의 폴백 */
  private static readonly TEST_A4_PT = { width: 595.28, height: 841.89 } as const;
  /** 더미 페이지 수 방어 상한 — 스펙 반영하되 test 잡이 디스크를 낭비하지 않도록 */
  private static readonly TEST_MAX_PAGES = 500;

  /**
   * test env(isTest) 잡 — 실합성 대신 "TEST" 워터마크 더미 PDF 산출.
   *
   * 목적: test 키 파트너의 통합 개발 중 실합성(다운로드·qpdf/pdf-lib 머지) 리소스
   * 소모 방지. 페이지 수·판형은 요청 스펙을 반영(split=pageTypes 매수,
   * compose-mixed=mm 판형·면지 매수, classic=cover+content 최소 구성)하되 내용은
   * 워터마크뿐이다. 산출 파일명/URL/result shape 은 각 mode 의 실경로와 동일 계약
   * (콜백·폴링 소비자가 구분 없이 동작) + result.isTest=true 마커.
   *
   * 산출물 정리: outputs/{jobId} 는 API 측 TestJobOutputsRetentionService 가
   * 24h 후 삭제한다(파일 엔티티 미경유 직접 write 라 expires_at 재사용 불가).
   *
   * spread/duplex-split 은 isTest 스탬프 경로가 없어 여기 도달하지 않는다 —
   * 방어적으로 도달 시 classic(merged 더미) 폴백.
   */
  private async handleTestSynthesis(job: Job<SynthesisJobData>) {
    const jobId = job.data.jobId;
    const queueJobId = job.id;
    const mode = job.data.mode;

    this.logger.log(
      `[test-env] synthesis job ${jobId} (queue: ${queueJobId}, mode=${mode ?? 'merge'}) — TEST 워터마크 더미 산출(실합성 미수행)`,
    );

    try {
      await this.updateJobStatus(jobId, { status: 'PROCESSING' });

      const outputDir = path.join(this.outputsPath, jobId);
      await fs.mkdir(outputDir, { recursive: true });
      const storageKeyBase = `outputs/${jobId}`;
      const a4 = SynthesisProcessor.TEST_A4_PT;

      const writeDummy = async (
        filename: string,
        pageCount: number,
        widthPt: number,
        heightPt: number,
      ): Promise<string> => {
        const bytes = await this.buildTestWatermarkPdf(
          jobId,
          pageCount,
          widthPt,
          heightPt,
        );
        await fs.writeFile(path.join(outputDir, filename), bytes);
        return `/storage/${storageKeyBase}/${filename}`;
      };

      let result: SynthesisResult;

      if (mode === 'split') {
        // 요청 스펙 반영: pageTypes 의 cover/content 매수 그대로 더미 생성
        const data = job.data as unknown as SplitSynthesisJobData;
        const pageTypes = data.pageTypes ?? [];
        const coverPages = Math.max(1, pageTypes.filter((t) => t === 'cover').length);
        const contentPages = Math.max(
          1,
          pageTypes.filter((t) => t === 'content').length,
        );
        const totalPages = data.totalExpectedPages || coverPages + contentPages;
        const outputFormat = data.outputFormat ?? 'merged';

        result = { success: true, outputFileUrl: '', totalPages, isTest: true };

        if (outputFormat === 'separate') {
          const coverUrl = await writeDummy('cover.pdf', coverPages, a4.width, a4.height);
          const contentUrl = await writeDummy('content.pdf', contentPages, a4.width, a4.height);
          result.outputFiles = [
            { type: 'cover', url: coverUrl },
            { type: 'content', url: contentUrl },
          ];
          if (data.alsoGenerateMerged) {
            result.outputFileUrl = await writeDummy('merged.pdf', totalPages, a4.width, a4.height);
          }
        } else {
          result.outputFileUrl = await writeDummy('merged.pdf', totalPages, a4.width, a4.height);
        }
      } else if (mode === 'compose-mixed') {
        // 요청 스펙 반영: mm 판형 + 면지 매수(내지 입력 PDF 는 다운로드하지 않으므로 1p 대표)
        const MM_TO_PT = 2.834645669;
        const coverPt = {
          width: (job.data.composeCoverWidthMm ?? 210) * MM_TO_PT,
          height: (job.data.composeCoverHeightMm ?? 297) * MM_TO_PT,
        };
        const contentPt = {
          width: (job.data.composeContentWidthMm ?? 210) * MM_TO_PT,
          height: (job.data.composeContentHeightMm ?? 297) * MM_TO_PT,
        };
        const frontCount = (job.data.composeFrontEndpaperUrls ?? []).length;
        const backCount = (job.data.composeBackEndpaperUrls ?? []).length;
        const contentPages = frontCount + 1 + backCount; // [앞면지 N, 내지 대표 1, 뒷면지 K]
        const outputMode = job.data.composeOutputMode || 'merged';
        const outputFiles: OutputFile[] = [];

        if (outputMode === 'separate') {
          const coverUrl = await writeDummy('cover.pdf', 1, coverPt.width, coverPt.height);
          outputFiles.push({ type: 'cover', url: coverUrl, pageCount: 1 } as any);
          const contentUrl = await writeDummy('content.pdf', contentPages, contentPt.width, contentPt.height);
          outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
          result = {
            success: true,
            outputFileUrl: contentUrl,
            totalPages: 1 + contentPages,
            isTest: true,
          };
        } else if (outputMode === 'content-only') {
          const contentUrl = await writeDummy('content.pdf', contentPages, contentPt.width, contentPt.height);
          outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
          result = {
            success: true,
            outputFileUrl: contentUrl,
            totalPages: contentPages,
            isTest: true,
          };
        } else if (outputMode === 'single') {
          const pagesUrl = await writeDummy('pages.pdf', 1, contentPt.width, contentPt.height);
          outputFiles.push({ type: 'pages' as any, url: pagesUrl, pageCount: 1 } as any);
          result = { success: true, outputFileUrl: pagesUrl, totalPages: 1, isTest: true };
        } else {
          const mergedUrl = await writeDummy('merged.pdf', 1 + contentPages, contentPt.width, contentPt.height);
          result = {
            success: true,
            outputFileUrl: mergedUrl,
            totalPages: 1 + contentPages,
            isTest: true,
          };
        }

        // 실경로(compose-mixed COMPLETED)와 동일한 result 확장 필드 유지
        result = {
          ...result,
          capability: 'compose-mixed',
          outputMode,
          outputFiles,
        } as any;
      } else {
        // classic merge(+ 방어 폴백): 표지 1p + 내지 1p 최소 구성
        const outputFormat = job.data.outputFormat || 'merged';
        const totalPages = 2;
        const mergedUrl = await writeDummy('merged.pdf', totalPages, a4.width, a4.height);
        result = { success: true, outputFileUrl: mergedUrl, totalPages, isTest: true };

        if (outputFormat === 'separate') {
          const coverUrl = await writeDummy('cover.pdf', 1, a4.width, a4.height);
          const contentUrl = await writeDummy('content.pdf', 1, a4.width, a4.height);
          result.outputFiles = [
            { type: 'cover', url: coverUrl },
            { type: 'content', url: contentUrl },
          ];
        }
      }

      await this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        outputFileUrl: result.outputFileUrl || undefined,
        outputFiles: result.outputFiles,
        result,
        queueJobId,
      });

      this.logger.log(
        `[test-env] synthesis job ${jobId} 더미 산출 완료: ${result.totalPages} pages, outputFileUrl=${result.outputFileUrl || '(none)'}`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        `[test-env] synthesis job ${jobId} 더미 산출 실패: ${error.message}`,
        error.stack,
      );
      captureJobException(error, {
        jobId,
        jobType: 'synthesize',
        queueName: 'pdf-synthesis',
      });
      await this.updateJobStatus(jobId, {
        status: 'FAILED',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * "TEST" 워터마크 더미 PDF 생성 (pdf-lib, 표준폰트 — 외부 리소스 0).
   * 각 페이지: 대형 회색 TEST + 하단 식별 문구(jobId·페이지 번호).
   */
  private async buildTestWatermarkPdf(
    jobId: string,
    pageCount: number,
    widthPt: number,
    heightPt: number,
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const footerFont = await doc.embedFont(StandardFonts.Helvetica);
    const n = Math.max(
      1,
      Math.min(Math.floor(pageCount), SynthesisProcessor.TEST_MAX_PAGES),
    );
    const gray = rgb(0.82, 0.82, 0.82);
    const darkGray = rgb(0.45, 0.45, 0.45);

    for (let i = 0; i < n; i++) {
      const page = doc.addPage([widthPt, heightPt]);
      const size = Math.min(widthPt, heightPt) / 3;
      const textWidth = font.widthOfTextAtSize('TEST', size);
      page.drawText('TEST', {
        x: (widthPt - textWidth) / 2,
        y: (heightPt - size * 0.7) / 2,
        size,
        font,
        color: gray,
      });
      const footer = `Storige test-env dummy output — not for production (job ${jobId}, page ${i + 1}/${n})`;
      const footerSize = 8;
      const footerWidth = footerFont.widthOfTextAtSize(footer, footerSize);
      page.drawText(footer, {
        x: Math.max(8, (widthPt - footerWidth) / 2),
        y: 12,
        size: footerSize,
        font: footerFont,
        color: darkGray,
      });
    }
    return doc.save();
  }

  /**
   * Compose-mixed 합성 — 인쇄 워크플로우 v1 Phase 5 (2026-05-19).
   *
   * 출력 순서 (고정):
   *   [표지, 앞면지 1..N, 내지 PDF, 뒷면지 1..K]
   *
   * 입력:
   *   - composeCoverUrl: 표지 PDF URL (composeCoverEditable=true 일 때)
   *   - composeCoverEditable=false: 빈 표지 페이지 worker 생성
   *   - composeFrontEndpaperUrls / composeBackEndpaperUrls: URL 배열. null 원소는 빈 면지 페이지 생성
   *   - composeContentPdfUrl: 내지 PDF (편집 결과 또는 고객 첨부)
   *
   * 회귀 보호: 기존 synthesis/split/spread 경로 영향 없음 (별도 mode 분기).
   */
  private async handleComposeMixedSynthesis(job: Job<SynthesisJobData>) {
    const {
      composeCoverUrl,
      composeCoverEditable,
      composeCoverWidthMm,
      composeCoverHeightMm,
      composeFrontEndpaperUrls,
      composeBackEndpaperUrls,
      composeContentPdfUrl,
      composeContentWidthMm,
      composeContentHeightMm,
      composeOutputMode,
    } = job.data;
    const jobId = job.data.jobId;
    const queueJobId = job.id;
    const outputMode = composeOutputMode || 'merged';
    // D-4: cover 검증 기대치 — output(wrap 포함) 우선, total 폴백. 부재=비스프레드 → 검증 skip(기존 동일).
    const spreadCoverExpectation = this.resolveSpreadCoverExpectation(job.data);

    this.logger.log(
      `Processing compose-mixed synthesis job ${jobId} (queue: ${queueJobId}, outputMode: ${outputMode})`,
    );

    try {
      await this.updateJobStatus(jobId, { status: 'PROCESSING' });

      const MM_TO_PT = 2.834645669;
      const coverPt = {
        width: (composeCoverWidthMm ?? 210) * MM_TO_PT,
        height: (composeCoverHeightMm ?? 297) * MM_TO_PT,
      };
      const contentPt = {
        width: (composeContentWidthMm ?? 210) * MM_TO_PT,
        height: (composeContentHeightMm ?? 297) * MM_TO_PT,
      };

      const outputDir = path.join(this.outputsPath, jobId);
      await fs.mkdir(outputDir, { recursive: true });
      const storageKeyBase = `outputs/${jobId}`;

      // ──────────────────────────────────────────────────────────────
      // 트랙 B-(f) — compose-mixed 2GB 상수메모리 ON 경로(LIGHTWEIGHT_SYNTHESIS).
      // pdf-lib copyPages 누적적재 대신 입력을 임시파일로 확보 → qpdf assemblePdf 로 순서대로
      // 이어붙임(치수/별색/오버프린트 무손실). null 면지/빈 표지는 createBlankPdf(contentPt/coverPt).
      // outputMode 별 산출(separate/content-only/single/merged)·outputFiles·result 매핑은 OFF 와 동일.
      // ──────────────────────────────────────────────────────────────
      if (VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS) {
        const r = await this.composeMixedLightweight({
          jobId,
          queueJobId,
          outputDir,
          storageKeyBase,
          outputMode,
          coverPt,
          contentPt,
          composeCoverUrl,
          composeCoverEditable,
          composeFrontEndpaperUrls,
          composeBackEndpaperUrls,
          composeContentPdfUrl,
          spreadCoverExpectation,
        });
        return r;
      }

      // 면지+내지 페이지를 하나의 PDF로 조립하는 헬퍼
      const buildContentPdf = async (): Promise<{ pdf: PDFDocument; pageCount: number }> => {
        const pdf = await PDFDocument.create();
        const frontList = composeFrontEndpaperUrls ?? [];
        for (let i = 0; i < frontList.length; i++) {
          const url = frontList[i];
          if (!url) { pdf.addPage([contentPt.width, contentPt.height]); }
          else {
            const bytes = await this.synthesizerService.downloadFile(url);
            const doc = await PDFDocument.load(bytes);
            const pages = await pdf.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => pdf.addPage(p));
          }
        }
        if (composeContentPdfUrl) {
          const bytes = await this.synthesizerService.downloadFile(composeContentPdfUrl);
          const doc = await PDFDocument.load(bytes);
          const pages = await pdf.copyPages(doc, doc.getPageIndices());
          pages.forEach((p) => pdf.addPage(p));
        }
        const backList = composeBackEndpaperUrls ?? [];
        for (let i = 0; i < backList.length; i++) {
          const url = backList[i];
          if (!url) { pdf.addPage([contentPt.width, contentPt.height]); }
          else {
            const bytes = await this.synthesizerService.downloadFile(url);
            const doc = await PDFDocument.load(bytes);
            const pages = await pdf.copyPages(doc, doc.getPageIndices());
            pages.forEach((p) => pdf.addPage(p));
          }
        }
        return { pdf, pageCount: pdf.getPageCount() };
      };

      let result: SynthesisResult;
      const outputFiles: OutputFile[] = [];
      // P0-3: 스프레드 cover MediaBox 검증 결과(있으면 result 에 기록). 비스프레드/skip 시 undefined.
      let coverSizeValidation: Record<string, unknown> | undefined;

      if (outputMode === 'separate') {
        // 일반 책자: cover.pdf + content.pdf
        const coverPdf = await PDFDocument.create();
        if (composeCoverEditable !== false && composeCoverUrl) {
          const coverBytes = await this.synthesizerService.downloadFile(composeCoverUrl);
          const coverDoc = await PDFDocument.load(coverBytes);
          // P0-3: 스프레드 책이면(API가 metadata.spread 기대치를 push) 펼침면 cover MediaBox 무결성 검증.
          // D-4: 기대치 = output(wrap 포함) 우선 · total 폴백 (resolveSpreadCoverExpectation).
          if (spreadCoverExpectation) {
            coverSizeValidation = this.validateSpreadCoverSize(
              jobId,
              coverDoc,
              spreadCoverExpectation.widthMm,
              spreadCoverExpectation.heightMm,
              spreadCoverExpectation.dpi,
            );
          }
          const pages = await coverPdf.copyPages(coverDoc, coverDoc.getPageIndices());
          pages.forEach((p) => coverPdf.addPage(p));
        } else {
          coverPdf.addPage([coverPt.width, coverPt.height]);
        }
        const coverPath = path.join(outputDir, 'cover.pdf');
        await fs.writeFile(coverPath, await coverPdf.save());
        const coverUrl = `/storage/${storageKeyBase}/cover.pdf`;
        outputFiles.push({ type: 'cover', url: coverUrl, pageCount: coverPdf.getPageCount() } as any);
        this.logger.log(`[${jobId}] cover.pdf: ${coverPdf.getPageCount()} pages`);

        const { pdf: contentPdfDoc, pageCount: contentPages } = await buildContentPdf();
        const contentPath = path.join(outputDir, 'content.pdf');
        await fs.writeFile(contentPath, await contentPdfDoc.save());
        const contentUrl = `/storage/${storageKeyBase}/content.pdf`;
        outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
        this.logger.log(`[${jobId}] content.pdf: ${contentPages} pages`);

        result = { success: true, outputFileUrl: contentUrl, totalPages: coverPdf.getPageCount() + contentPages };

      } else if (outputMode === 'content-only') {
        // 레더커버: content.pdf만
        const { pdf: contentPdfDoc, pageCount: contentPages } = await buildContentPdf();
        const contentPath = path.join(outputDir, 'content.pdf');
        await fs.writeFile(contentPath, await contentPdfDoc.save());
        const contentUrl = `/storage/${storageKeyBase}/content.pdf`;
        outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
        this.logger.log(`[${jobId}] content.pdf (content-only): ${contentPages} pages`);

        result = { success: true, outputFileUrl: contentUrl, totalPages: contentPages };

      } else if (outputMode === 'single') {
        // 낱장: 편집 페이지만 하나의 PDF
        const pagesPdf = await PDFDocument.create();
        if (composeContentPdfUrl) {
          const bytes = await this.synthesizerService.downloadFile(composeContentPdfUrl);
          const doc = await PDFDocument.load(bytes);
          const pages = await pagesPdf.copyPages(doc, doc.getPageIndices());
          pages.forEach((p) => pagesPdf.addPage(p));
        }
        const pagesPath = path.join(outputDir, 'pages.pdf');
        await fs.writeFile(pagesPath, await pagesPdf.save());
        const pagesUrl = `/storage/${storageKeyBase}/pages.pdf`;
        outputFiles.push({ type: 'pages' as any, url: pagesUrl, pageCount: pagesPdf.getPageCount() } as any);
        this.logger.log(`[${jobId}] pages.pdf (single): ${pagesPdf.getPageCount()} pages`);

        result = { success: true, outputFileUrl: pagesUrl, totalPages: pagesPdf.getPageCount() };

      } else {
        // 하위 호환: merged.pdf (기존 동작)
        const finalPdf = await PDFDocument.create();
        if (composeCoverEditable === false || !composeCoverUrl) {
          finalPdf.addPage([coverPt.width, coverPt.height]);
        } else {
          const coverBytes = await this.synthesizerService.downloadFile(composeCoverUrl);
          const coverDoc = await PDFDocument.load(coverBytes);
          const pages = await finalPdf.copyPages(coverDoc, coverDoc.getPageIndices());
          pages.forEach((p) => finalPdf.addPage(p));
        }
        const frontList = composeFrontEndpaperUrls ?? [];
        for (const url of frontList) {
          if (!url) { finalPdf.addPage([contentPt.width, contentPt.height]); }
          else { const b = await this.synthesizerService.downloadFile(url); const d = await PDFDocument.load(b); const p = await finalPdf.copyPages(d, d.getPageIndices()); p.forEach(pg => finalPdf.addPage(pg)); }
        }
        if (composeContentPdfUrl) {
          const b = await this.synthesizerService.downloadFile(composeContentPdfUrl); const d = await PDFDocument.load(b); const p = await finalPdf.copyPages(d, d.getPageIndices()); p.forEach(pg => finalPdf.addPage(pg));
        }
        const backList = composeBackEndpaperUrls ?? [];
        for (const url of backList) {
          if (!url) { finalPdf.addPage([contentPt.width, contentPt.height]); }
          else { const b = await this.synthesizerService.downloadFile(url); const d = await PDFDocument.load(b); const p = await finalPdf.copyPages(d, d.getPageIndices()); p.forEach(pg => finalPdf.addPage(pg)); }
        }
        const mergedPath = path.join(outputDir, 'merged.pdf');
        await fs.writeFile(mergedPath, await finalPdf.save());
        const mergedUrl = `/storage/${storageKeyBase}/merged.pdf`;
        result = { success: true, outputFileUrl: mergedUrl, totalPages: finalPdf.getPageCount() };
      }

      await this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        outputFileUrl: result.outputFileUrl,
        result: { ...result, capability: 'compose-mixed', outputMode, outputFiles, coverSizeValidation } as any,
        queueJobId,
      });

      this.logger.log(`Compose-mixed job ${jobId} completed (${outputMode}): ${result.totalPages} pages`);
      return result;
    } catch (error: any) {
      this.logger.error(`Compose-mixed job ${jobId} error: ${error.message}`, error.stack);
      captureJobException(error, { jobId, jobType: 'synthesize', queueName: 'pdf-synthesis' });
      await this.updateJobStatus(jobId, { status: 'FAILED', errorMessage: error.message });
      throw error;
    }
  }

  /**
   * 트랙 B-(f) — compose-mixed 2GB 상수메모리 구현(LIGHTWEIGHT_SYNTHESIS ON).
   *
   * OFF(handleComposeMixedSynthesis 본문)와 '동일 산출'을 내야 한다:
   *   - 출력 순서: [표지, 앞면지 1..N, 내지 PDF, 뒷면지 1..K] (content 조립은 면지+내지+면지 순서)
   *   - null 면지/빈 표지: 빈 페이지(면지=contentPt, 표지=coverPt) — OFF 의 addPage([w,h]) 와 동치
   *   - outputMode 별 산출/파일명/URL/pageCount, result.outputFileUrl, coverSizeValidation 매핑
   * 차이는 '메모리 적재 없이 qpdf 로 파일기반 병합'뿐. 페이지 내용/치수/인쇄속성은 무손실.
   */
  private async composeMixedLightweight(args: {
    jobId: string;
    queueJobId: string | number;
    outputDir: string;
    storageKeyBase: string;
    outputMode: string;
    coverPt: { width: number; height: number };
    contentPt: { width: number; height: number };
    composeCoverUrl?: string;
    composeCoverEditable?: boolean;
    composeFrontEndpaperUrls?: (string | null)[];
    composeBackEndpaperUrls?: (string | null)[];
    composeContentPdfUrl?: string;
    /** D-4: cover 검증 기대치(output 우선·total 폴백 해석 완료값). 부재=비스프레드 → 검증 skip */
    spreadCoverExpectation?: { widthMm: number; heightMm: number; dpi?: number };
  }): Promise<SynthesisResult> {
    const {
      jobId,
      queueJobId,
      outputDir,
      storageKeyBase,
      outputMode,
      coverPt,
      contentPt,
      composeCoverUrl,
      composeCoverEditable,
      composeFrontEndpaperUrls,
      composeBackEndpaperUrls,
      composeContentPdfUrl,
      spreadCoverExpectation,
    } = args;

    // 생성/다운로드한 임시 파일들 — finally 에서 정리(출력물은 outputDir 라 별개).
    const scratch: string[] = [];
    const scratchCleanups: Array<() => Promise<void>> = [];
    const mkTmp = (suffix: string) =>
      path.join(outputDir, `__lw_${suffix}_${Math.random().toString(36).slice(2)}.pdf`);

    // url 을 임시파일로 확보(스트림). null 이면 contentPt 빈 페이지 생성.
    const partFromEndpaper = async (url: string | null): Promise<string> => {
      if (!url) {
        const blank = mkTmp('blank');
        await createBlankPdf(contentPt.width, contentPt.height, blank);
        scratch.push(blank);
        return blank;
      }
      const dl = await downloadToTempFile(url);
      // downloadToTempFile 는 로컬 원본이면 그 경로를 반환(cleanup no-op)하므로 그대로 part 로 사용.
      // cleanup 은 finally 에서 일괄(임시면 삭제, 로컬원본이면 no-op).
      scratchCleanups.push(dl.cleanup);
      return dl.path;
    };

    // content 조립(면지+내지+면지)을 위한 part 파일 목록 생성.
    const buildContentParts = async (): Promise<string[]> => {
      const parts: string[] = [];
      for (const url of composeFrontEndpaperUrls ?? []) {
        parts.push(await partFromEndpaper(url));
      }
      if (composeContentPdfUrl) {
        const dl = await downloadToTempFile(composeContentPdfUrl);
        scratchCleanups.push(dl.cleanup);
        parts.push(dl.path);
      }
      for (const url of composeBackEndpaperUrls ?? []) {
        parts.push(await partFromEndpaper(url));
      }
      return parts;
    };

    // parts → outPath 병합 후 페이지수 반환. parts 가 비면 빈(0p) PDF.
    const assembleToFile = async (parts: string[], outPath: string): Promise<number> => {
      if (parts.length === 0) {
        const doc = await PDFDocument.create();
        await fs.writeFile(outPath, await doc.save());
        return 0;
      }
      await qpdfAssemble(parts.map((file) => ({ file })), outPath);
      return (await extractPdfMetadataQpdf(outPath)).pageCount;
    };

    let result: SynthesisResult;
    const outputFiles: OutputFile[] = [];
    let coverSizeValidation: Record<string, unknown> | undefined;

    try {
      if (outputMode === 'separate') {
        // cover.pdf + content.pdf
        const coverPath = path.join(outputDir, 'cover.pdf');
        let coverPageCount: number;
        if (composeCoverEditable !== false && composeCoverUrl) {
          const dl = await downloadToTempFile(composeCoverUrl);
          scratchCleanups.push(dl.cleanup);
          const meta = await extractPdfMetadataQpdf(dl.path);
          // P0-3: 스프레드 책이면 펼침면 cover MediaBox 무결성 검증(측정-주입판).
          // D-4: 기대치 = output(wrap 포함) 우선 · total 폴백.
          if (spreadCoverExpectation) {
            // qpdf 가 MediaBox 를 못 해석(meta.pages 비어있음)한 '정상' 표지에서 치수가
            // undefined 가 되어 허위 COVER_SIZE 불일치/HARD-FAIL 이 나는 것을 방지:
            // 표지는 소형이라 pdf-lib 로 치수만 보강한다(OFF=pdf-lib getSize 와 동일 소스).
            let coverWidthPt = meta.pages[0]?.widthPt;
            let coverHeightPt = meta.pages[0]?.heightPt;
            if ((coverWidthPt == null || coverHeightPt == null) && meta.pageCount >= 1) {
              try {
                const cdoc = await PDFDocument.load(await fs.readFile(dl.path));
                const sz = cdoc.getPage(0).getSize();
                coverWidthPt = sz.width;
                coverHeightPt = sz.height;
              } catch {
                /* 보강 실패 시 undefined 그대로 — validateSpreadCoverSizeMeasured 가 처리 */
              }
            }
            coverSizeValidation = this.validateSpreadCoverSizeMeasured(
              jobId,
              meta.pageCount,
              coverWidthPt,
              coverHeightPt,
              spreadCoverExpectation.widthMm,
              spreadCoverExpectation.heightMm,
              spreadCoverExpectation.dpi,
            );
          }
          // 표지 전체 페이지 그대로 보존(qpdf, 범위 생략=전체).
          await qpdfAssemble([{ file: dl.path }], coverPath);
          coverPageCount = (await extractPdfMetadataQpdf(coverPath)).pageCount;
        } else {
          await createBlankPdf(coverPt.width, coverPt.height, coverPath);
          coverPageCount = 1;
        }
        const coverUrl = `/storage/${storageKeyBase}/cover.pdf`;
        outputFiles.push({ type: 'cover', url: coverUrl, pageCount: coverPageCount } as any);
        this.logger.log(`[${jobId}] cover.pdf: ${coverPageCount} pages`);

        const contentPath = path.join(outputDir, 'content.pdf');
        const contentPages = await assembleToFile(await buildContentParts(), contentPath);
        const contentUrl = `/storage/${storageKeyBase}/content.pdf`;
        outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
        this.logger.log(`[${jobId}] content.pdf: ${contentPages} pages`);

        result = { success: true, outputFileUrl: contentUrl, totalPages: coverPageCount + contentPages };
      } else if (outputMode === 'content-only') {
        const contentPath = path.join(outputDir, 'content.pdf');
        const contentPages = await assembleToFile(await buildContentParts(), contentPath);
        const contentUrl = `/storage/${storageKeyBase}/content.pdf`;
        outputFiles.push({ type: 'content', url: contentUrl, pageCount: contentPages } as any);
        this.logger.log(`[${jobId}] content.pdf (content-only): ${contentPages} pages`);

        result = { success: true, outputFileUrl: contentUrl, totalPages: contentPages };
      } else if (outputMode === 'single') {
        // 낱장: 편집 내지 PDF 만(면지/표지 없음).
        const pagesPath = path.join(outputDir, 'pages.pdf');
        let pagesParts: string[] = [];
        if (composeContentPdfUrl) {
          const dl = await downloadToTempFile(composeContentPdfUrl);
          scratchCleanups.push(dl.cleanup);
          pagesParts = [dl.path];
        }
        const pagesCount = await assembleToFile(pagesParts, pagesPath);
        const pagesUrl = `/storage/${storageKeyBase}/pages.pdf`;
        outputFiles.push({ type: 'pages' as any, url: pagesUrl, pageCount: pagesCount } as any);
        this.logger.log(`[${jobId}] pages.pdf (single): ${pagesCount} pages`);

        result = { success: true, outputFileUrl: pagesUrl, totalPages: pagesCount };
      } else {
        // merged(기타): 표지 + 면지 + 내지 + 면지 단일 PDF.
        const mergedParts: string[] = [];
        if (composeCoverEditable === false || !composeCoverUrl) {
          const blankCover = mkTmp('cover');
          await createBlankPdf(coverPt.width, coverPt.height, blankCover);
          scratch.push(blankCover);
          mergedParts.push(blankCover);
        } else {
          const dl = await downloadToTempFile(composeCoverUrl);
          scratchCleanups.push(dl.cleanup);
          mergedParts.push(dl.path);
        }
        mergedParts.push(...(await buildContentParts()));
        const mergedPath = path.join(outputDir, 'merged.pdf');
        const mergedCount = await assembleToFile(mergedParts, mergedPath);
        const mergedUrl = `/storage/${storageKeyBase}/merged.pdf`;
        result = { success: true, outputFileUrl: mergedUrl, totalPages: mergedCount };
      }

      await this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        outputFileUrl: result.outputFileUrl,
        result: { ...result, capability: 'compose-mixed', outputMode, outputFiles, coverSizeValidation } as any,
        queueJobId,
      });

      this.logger.log(`Compose-mixed job ${jobId} completed (${outputMode}): ${result.totalPages} pages`);
      return result;
    } finally {
      // 임시 part/blank 정리(출력물 cover/content/merged/pages 는 제외).
      for (const c of scratchCleanups) {
        await c().catch(() => {});
      }
      for (const f of scratch) {
        await this.safeDelete(f);
      }
    }
  }

  /**
   * D-4 (2026-07-06, C-4 Track 3): compose-mixed cover 검증 기대치 해석 — output 우선 · total 폴백.
   *
   * - composeSpreadOutputWidthMm/HeightMm(하드커버 싸바리 wrap 포함 출력 사이즈)가 둘 다
   *   양수로 존재하면 그 값을 기대치로 사용(output 우선).
   * - 부재 시 기존 composeSpreadTotalWidthMm/HeightMm 폴백 → 기존 동작과 100% 동일.
   * - 둘 다 부재(비스프레드)면 undefined → 검증 skip(기존 동일).
   * SOFT/HARD 정책(SPREAD_SNAPSHOT_HARD_FAIL)·tolerance 계산은 불변 — 기대치 '값'만 바뀐다.
   */
  private resolveSpreadCoverExpectation(data: {
    composeSpreadTotalWidthMm?: number;
    composeSpreadTotalHeightMm?: number;
    composeSpreadOutputWidthMm?: number;
    composeSpreadOutputHeightMm?: number;
    composeSpreadDpi?: number;
  }): { widthMm: number; heightMm: number; dpi?: number } | undefined {
    const {
      composeSpreadTotalWidthMm,
      composeSpreadTotalHeightMm,
      composeSpreadOutputWidthMm,
      composeSpreadOutputHeightMm,
      composeSpreadDpi,
    } = data;
    if (
      typeof composeSpreadOutputWidthMm === 'number' && composeSpreadOutputWidthMm > 0 &&
      typeof composeSpreadOutputHeightMm === 'number' && composeSpreadOutputHeightMm > 0
    ) {
      return {
        widthMm: composeSpreadOutputWidthMm,
        heightMm: composeSpreadOutputHeightMm,
        dpi: composeSpreadDpi,
      };
    }
    if (composeSpreadTotalWidthMm && composeSpreadTotalHeightMm) {
      return {
        widthMm: composeSpreadTotalWidthMm,
        heightMm: composeSpreadTotalHeightMm,
        dpi: composeSpreadDpi,
      };
    }
    return undefined;
  }

  /**
   * P0-3: 스프레드 책 cover(펼침면 전체) MediaBox 무결성 검증.
   * cover.pdf 의 실제 페이지 크기(MediaBox)를 세션 metadata.spread 의 기대 펼침면 총폭/총높이와 대조.
   * 펼침면 cover 는 1페이지(뒷표지|책등|앞표지(+날개))여야 하고, 폭/높이가 기대치 ±tol(B43=max(0.2mm,1px@dpi)) 이내여야 한다.
   *
   * SOFT(기본): 불일치를 결과로 기록 + logger.warn, throw 안 함(합성 계속).
   * HARD(env SPREAD_SNAPSHOT_HARD_FAIL='true'): 불일치 시 DomainError(SPREAD_PDF_SIZE_MISMATCH) throw → 잡 FAILED(잘못된 크기 인쇄 차단).
   */
  private validateSpreadCoverSize(
    jobId: string,
    coverDoc: PDFDocument,
    expectedWidthMm: number,
    expectedHeightMm: number,
    dpi?: number,
  ): Record<string, unknown> {
    // pdf-lib 측정값을 추출해 공통 구현으로 위임(OFF 경로). getSize()=(urx-llx, ury-lly).
    const pageCount = coverDoc.getPageCount();
    const first = pageCount === 1 ? coverDoc.getPage(0).getSize() : undefined;
    return this.validateSpreadCoverSizeMeasured(
      jobId,
      pageCount,
      first ? first.width : undefined,
      first ? first.height : undefined,
      expectedWidthMm,
      expectedHeightMm,
      dpi,
    );
  }

  /**
   * 트랙 B-(f) — validateSpreadCoverSize 의 측정-주입판(파일기반 ON 경로용).
   * pageCount + 첫 페이지 치수(pt)를 직접 받아 동일 게이트(SOFT/HARD·tol·mismatches)를 적용한다.
   * qpdf widthPt/heightPt 는 pdf-lib getSize() 와 동일 보장 → 산출(검증 결과) 동일.
   */
  private validateSpreadCoverSizeMeasured(
    jobId: string,
    pageCount: number,
    firstWidthPt: number | undefined,
    firstHeightPt: number | undefined,
    expectedWidthMm: number,
    expectedHeightMm: number,
    dpi?: number,
  ): Record<string, unknown> {
    const hardFail = process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true';
    const useDpi = dpi || 300;
    const toleranceMm = Math.max(0.2, (1 / useDpi) * 25.4);
    const mismatches: string[] = [];
    let actualWidthMm: number | undefined;
    let actualHeightMm: number | undefined;

    if (pageCount !== 1 || firstWidthPt === undefined || firstHeightPt === undefined) {
      // 펼침면 cover 단일페이지 가정 위반(0페이지=손상, 2+=다면) → 명백한 cover 오류
      mismatches.push(`COVER_PAGE_COUNT: ${pageCount}쪽 (펼침면 cover 는 1쪽이어야 함)`);
    } else {
      const wPt = firstWidthPt;
      const hPt = firstHeightPt;
      actualWidthMm = Number(((wPt * 25.4) / 72).toFixed(2));
      actualHeightMm = Number(((hPt * 25.4) / 72).toFixed(2));
      if (Math.abs(actualWidthMm - expectedWidthMm) > toleranceMm) {
        mismatches.push(`WIDTH: ${actualWidthMm}mm vs 기대 ${expectedWidthMm}mm`);
      }
      if (Math.abs(actualHeightMm - expectedHeightMm) > toleranceMm) {
        mismatches.push(`HEIGHT: ${actualHeightMm}mm vs 기대 ${expectedHeightMm}mm`);
      }
    }

    const validation = {
      ok: mismatches.length === 0,
      mode: hardFail ? 'hard' : 'soft',
      expectedWidthMm,
      expectedHeightMm,
      actualWidthMm,
      actualHeightMm,
      toleranceMm: Number(toleranceMm.toFixed(2)),
      mismatches,
    };

    if (mismatches.length > 0) {
      this.logger.warn(
        `[${jobId}] SPREAD cover MediaBox ${hardFail ? 'HARD' : 'SOFT'} 불일치: ${mismatches.join(' | ')}`,
      );
      if (hardFail) {
        throw new DomainError(
          ErrorCodes.SPREAD_PDF_SIZE_MISMATCH,
          `스프레드 cover 크기 불일치: ${mismatches.join(' | ')}`,
        );
      }
    } else {
      this.logger.log(
        `[${jobId}] SPREAD cover MediaBox 검증 통과 (${actualWidthMm}x${actualHeightMm}mm, tol ${validation.toleranceMm}mm)`,
      );
    }

    return validation;
  }

  /**
   * 기존 병합 합성 처리 (2개 PDF → merged)
   */
  private async handleMergeSynthesis(job: Job<SynthesisJobData>) {
    const { coverUrl, contentUrl, spineWidth, bindingType, outputFormat } =
      job.data;
    const jobId = job.data.jobId;
    const queueJobId = job.id;

    this.logger.log(
      `Processing synthesis job ${jobId} (queue: ${queueJobId}), format=${outputFormat || 'merged'}`,
    );

    let localResult: SynthesisLocalResult | null = null;

    try {
      // Update job status to PROCESSING
      await this.updateJobStatus(jobId, { status: 'PROCESSING' });

      // 1. PDF 생성 (로컬 경로 반환)
      localResult = await this.synthesizerService.synthesizeToLocal(
        coverUrl!,
        contentUrl!,
        {
          coverUrl: coverUrl!,
          contentUrl: contentUrl!,
          spineWidth,
          bindingType,
          outputFormat,
        },
      );

      // 2. 스토리지에 파일 저장 + URL 발급
      const storageKeyBase = `outputs/${jobId}`;

      // merged는 항상 저장
      const mergedFilename = `merged.pdf`;
      const mergedStoragePath = path.join(
        this.outputsPath,
        jobId,
        mergedFilename,
      );

      // 출력 디렉토리 생성
      await fs.mkdir(path.join(this.outputsPath, jobId), { recursive: true });

      // merged 파일 복사
      await fs.copyFile(localResult.mergedPath, mergedStoragePath);
      const mergedUrl = `/storage/${storageKeyBase}/${mergedFilename}`;

      const result: SynthesisResult = {
        success: true,
        outputFileUrl: mergedUrl, // 하위호환
        totalPages: localResult.totalPages,
      };

      // 3. separate 모드면 cover/content도 저장
      if (outputFormat === 'separate' && localResult.coverPath) {
        const coverFilename = `cover.pdf`;
        const contentFilename = `content.pdf`;

        const coverStoragePath = path.join(
          this.outputsPath,
          jobId,
          coverFilename,
        );
        const contentStoragePath = path.join(
          this.outputsPath,
          jobId,
          contentFilename,
        );

        try {
          await fs.copyFile(localResult.coverPath, coverStoragePath);
          await fs.copyFile(localResult.contentPath!, contentStoragePath);

          const outputFiles: OutputFile[] = [
            { type: 'cover', url: `/storage/${storageKeyBase}/${coverFilename}` },
            {
              type: 'content',
              url: `/storage/${storageKeyBase}/${contentFilename}`,
            },
          ];

          result.outputFiles = outputFiles;

          this.logger.log(
            `Separate files saved: cover=${coverStoragePath}, content=${contentStoragePath}`,
          );
        } catch (uploadError) {
          // 부분 실패 → 전체 failed 처리
          throw new Error(`Separate upload failed: ${uploadError.message}`);
        }
      }

      // 4. 임시 파일 정리
      await this.cleanupTempFiles(localResult);

      // 5. 결과 저장 및 콜백
      await this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        outputFileUrl: result.outputFileUrl,
        outputFiles: result.outputFiles,
        result,
        queueJobId, // 디버깅용
      });

      this.logger.log(
        `Synthesis job ${jobId} completed successfully, outputFileUrl=${result.outputFileUrl}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Synthesis job ${jobId} error: ${error.message}`,
        error.stack,
      );

      // Sentry에 잡 컨텍스트와 함께 전송
      captureJobException(error, {
        jobId,
        jobType: 'synthesize',
        queueName: 'pdf-synthesis',
      });

      // 임시 파일 정리 시도
      if (localResult) {
        await this.cleanupTempFiles(localResult);
      }

      // failed 상태 업데이트 → worker-jobs.service에서 failed webhook 발송
      await this.updateJobStatus(jobId, {
        status: 'FAILED',
        errorMessage: error.message,
      });

      throw error;
    }
  }

  /**
   * 임시 파일 정리 (source + output 모두)
   */
  private async cleanupTempFiles(
    localResult: SynthesisLocalResult,
  ): Promise<void> {
    const filesToDelete = [
      localResult.mergedPath,
      localResult.coverPath,
      localResult.contentPath,
      localResult.sourceCoverPath,
      localResult.sourceContentPath,
    ].filter(Boolean) as string[];

    for (const file of filesToDelete) {
      await this.safeDelete(file);
    }

    this.logger.debug(`Cleaned up ${filesToDelete.length} temp files`);
  }

  /**
   * 안전한 파일 삭제
   */
  private async safeDelete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      this.logger.debug(`Could not delete temp file: ${filePath}`);
    }
  }

  // ============================================================================
  // Split Synthesis (단일 PDF 분리) - ★ v1.1.4 설계서
  // ============================================================================

  /**
   * 분리 합성 처리 (1개 PDF → cover.pdf + content.pdf)
   *
   * ★ 설계서 v1.1.4 핵심:
   * - mode는 Queue payload만 신뢰 (DB 참조 안 함)
   * - jobId scoped temp 디렉토리 (동시 작업 안전)
   * - 이중 검증 (API + Worker)
   * - verifySplitResult 무결성 검증
   * - updateJobStatusWithRetry 재시도 정책
   */
  private async handleSplitSynthesis(job: Job<SplitSynthesisJobData>) {
    const {
      jobId,
      sessionId,
      pdfFileId,
      pageTypes,
      totalExpectedPages,
      outputFormat,
      alsoGenerateMerged,
    } = job.data;
    const queueJobId = job.id;

    // ★ jobId scoped temp 디렉토리 (동시 작업 안전)
    const jobTempDir = path.join(this.storagePath, `temp_${jobId}`);

    // 트랙 B-(f) ON 경로의 스트림 입력 임시파일 정리 핸들(임시면 삭제, 로컬원본이면 no-op).
    let lwCleanup: (() => Promise<void>) | null = null;

    this.logger.log(
      `Processing split synthesis job ${jobId} (queue: ${queueJobId}), ` +
        `pages=${totalExpectedPages}, format=${outputFormat}`,
    );

    try {
      await this.updateJobStatusWithRetry(jobId, { status: 'PROCESSING' });

      // 0. ★ 옵션 조합 검증 (Worker 최종 방어선)
      if (outputFormat === 'merged' && alsoGenerateMerged === true) {
        throw new DomainError(
          ErrorCodes.INVALID_OUTPUT_OPTIONS,
          "outputFormat='merged' 일 때 alsoGenerateMerged는 사용할 수 없습니다",
        );
      }

      // 0-1. ★ 임시 디렉토리 클린 시작 (재처리/리플레이 안전)
      await fs.rm(jobTempDir, { recursive: true, force: true });
      await fs.mkdir(jobTempDir, { recursive: true });

      // 1. ★ 파일 조회 (Worker에서 직접 DB 조회 또는 API 호출)
      const file = await this.getFileById(pdfFileId);
      if (!file) {
        throw new DomainError(ErrorCodes.FILE_NOT_FOUND, '파일을 찾을 수 없습니다');
      }

      // 1-1. ★ 이중 검증 (Worker 최종 방어선)
      if (file.metadata?.generatedBy !== 'editor') {
        throw new DomainError(
          ErrorCodes.PDF_NOT_FROM_EDITOR,
          '편집기 산출물이 아닙니다',
        );
      }
      if (file.metadata?.editSessionId !== sessionId) {
        throw new DomainError(
          ErrorCodes.SESSION_FILE_MISMATCH,
          '세션-파일 불일치',
        );
      }

      // 2~3. PDF 다운로드 + 로드(페이지수 확보)
      //   ON (LIGHTWEIGHT_SYNTHESIS): 스트림 다운로드 → 임시파일, 페이지수는 qpdf 메타(상수메모리).
      //   OFF                       : 기존 전체버퍼 + pdf-lib load (불변).
      // 예외 래핑(FILE_DOWNLOAD_FAILED / PDF_LOAD_FAILED) 시맨틱은 양쪽 동일하게 유지.
      const lightweight = VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS;
      let pdfDoc: PDFDocument | null = null; // OFF 경로 전용(분리 입력)
      let lwInputPath: string | null = null; // ON 경로 전용(분리 입력)
      let totalPages: number;

      if (lightweight) {
        let dl;
        try {
          dl = await downloadToTempFile(file.filePath);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.FILE_DOWNLOAD_FAILED,
            '파일 다운로드 실패',
            { url: file.filePath, cause: error.message },
          );
        }
        lwInputPath = dl.path;
        lwCleanup = dl.cleanup;
        const meta = await extractPdfMetadataQpdf(dl.path);
        if (meta.corrupted || meta.pageCount <= 0) {
          // pdf-lib load 실패와 동치(암호화/손상/지원불가) → 동일 에러코드.
          throw new DomainError(
            ErrorCodes.PDF_LOAD_FAILED,
            'PDF 로드 실패 (암호화/손상/지원불가)',
            { cause: 'qpdf metadata corrupted/unreadable' },
          );
        }
        totalPages = meta.pageCount;
      } else {
        let pdfBytes: Uint8Array;
        try {
          pdfBytes = await this.synthesizerService.downloadFile(file.filePath);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.FILE_DOWNLOAD_FAILED,
            '파일 다운로드 실패',
            { url: file.filePath, cause: error.message },
          );
        }
        try {
          pdfDoc = await PDFDocument.load(pdfBytes);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.PDF_LOAD_FAILED,
            'PDF 로드 실패 (암호화/손상/지원불가)',
            { cause: error.message },
          );
        }
        totalPages = pdfDoc.getPageCount();
      }

      // 4. ★ 페이지 수 검증
      if (totalPages !== totalExpectedPages) {
        throw new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, '페이지 수 불일치', {
          expected: totalExpectedPages,
          got: totalPages,
        });
      }

      // 5. ★ pageTypes 배열 길이 검증
      if (pageTypes.length !== totalPages) {
        throw new DomainError(
          ErrorCodes.PAGETYPEMAP_INCOMPLETE,
          'pageTypes 길이 불일치',
        );
      }

      // 6. 페이지 인덱스 분류
      const coverIndices: number[] = [];
      const contentIndices: number[] = [];

      pageTypes.forEach((type, i) => {
        if (type === 'cover') {
          coverIndices.push(i);
        } else if (type === 'content') {
          contentIndices.push(i);
        } else {
          throw new DomainError(
            ErrorCodes.PAGETYPEMAP_INVALID_VALUE,
            `잘못된 타입: ${type}`,
            { index: i },
          );
        }
      });

      // 6-1. ★ cover/content 비어있음 검증 (Worker 이중 검증)
      if (coverIndices.length === 0) {
        throw new DomainError(ErrorCodes.NO_COVER_PAGES, '표지 페이지가 없습니다');
      }
      if (contentIndices.length === 0) {
        throw new DomainError(
          ErrorCodes.NO_CONTENT_PAGES,
          '내지 페이지가 없습니다',
        );
      }

      // 7. PDF 분리 (★ jobTempDir 사용)
      //   ON : qpdf 페이지범위 추출(파일기반·상수메모리·치수/인쇄속성 무손실).
      //   OFF: pdf-lib splitPdfByIndices (불변). 페이지 순서는 indices 순서 그대로 보존.
      let splitResult: SplitResult;
      if (lightweight) {
        const coverPath = path.join(jobTempDir, 'cover.pdf');
        const contentPath = path.join(jobTempDir, 'content.pdf');
        // 0-based indices → qpdf 1-based 콤마 페이지표기(순서 보존).
        await qpdfExtractPages(lwInputPath!, this.toQpdfRange(coverIndices), coverPath);
        await qpdfExtractPages(lwInputPath!, this.toQpdfRange(contentIndices), contentPath);
        splitResult = {
          coverPath,
          contentPath,
          coverPageCount: coverIndices.length,
          contentPageCount: contentIndices.length,
        };
      } else {
        splitResult = await this.synthesizerService.splitPdfByIndices(
          pdfDoc!,
          coverIndices,
          contentIndices,
          jobTempDir,
        );
      }

      // 8. ★ 무결성 검증 (P0 필수)
      await this.verifySplitResult(
        splitResult,
        coverIndices.length,
        contentIndices.length,
        lightweight,
      );

      // 9. 스토리지 업로드 (★ outputFormat 계약 일치)
      const storageKeyBase = `outputs/${jobId}`;
      await fs.mkdir(path.join(this.outputsPath, jobId), { recursive: true });

      const result: SynthesisResult = {
        success: true,
        outputFileUrl: '', // 조건부 설정
        totalPages,
      };

      if (outputFormat === 'merged') {
        // ★ merged만 업로드, cover/content는 업로드 X
        const mergedPath = path.join(jobTempDir, 'merged.pdf');
        await this.synthesizerService.mergeSplitPdfs(
          splitResult.coverPath,
          splitResult.contentPath,
          mergedPath,
        );

        const mergedStoragePath = path.join(this.outputsPath, jobId, 'merged.pdf');
        await fs.copyFile(mergedPath, mergedStoragePath);
        result.outputFileUrl = `/storage/${storageKeyBase}/merged.pdf`;
      } else if (outputFormat === 'separate') {
        // ★ cover/content 업로드
        const coverStoragePath = path.join(this.outputsPath, jobId, 'cover.pdf');
        const contentStoragePath = path.join(
          this.outputsPath,
          jobId,
          'content.pdf',
        );

        await fs.copyFile(splitResult.coverPath, coverStoragePath);
        await fs.copyFile(splitResult.contentPath, contentStoragePath);

        // ★ 순서 고정: cover → content
        result.outputFiles = [
          { type: 'cover', url: `/storage/${storageKeyBase}/cover.pdf` },
          { type: 'content', url: `/storage/${storageKeyBase}/content.pdf` },
        ];

        // ★ alsoGenerateMerged일 때만 merged 생성
        if (alsoGenerateMerged) {
          const mergedPath = path.join(jobTempDir, 'merged.pdf');
          await this.synthesizerService.mergeSplitPdfs(
            splitResult.coverPath,
            splitResult.contentPath,
            mergedPath,
          );

          const mergedStoragePath = path.join(
            this.outputsPath,
            jobId,
            'merged.pdf',
          );
          await fs.copyFile(mergedPath, mergedStoragePath);
          result.outputFileUrl = `/storage/${storageKeyBase}/merged.pdf`;
        }
      }

      // 10. 완료 처리 (★ 재시도 정책)
      await this.updateJobStatusWithRetry(jobId, {
        status: 'COMPLETED',
        result,
        outputFileUrl: result.outputFileUrl || undefined,
        outputFiles: result.outputFiles,
        queueJobId,
      });

      this.logger.log(
        `Split synthesis job ${jobId} completed: format=${outputFormat}, ` +
          `coverPages=${coverIndices.length}, contentPages=${contentIndices.length}`,
      );

      return result;
    } catch (error: any) {
      const domainError =
        error instanceof DomainError
          ? error
          : new DomainError(ErrorCodes.INTERNAL_ERROR, error.message);

      this.logger.error(
        `Split synthesis job ${jobId} failed: ${domainError.code} - ${domainError.message}`,
        error.stack,
      );

      // ★ FAILED도 재시도 정책 적용
      await this.updateJobStatusWithRetry(jobId, {
        status: 'FAILED',
        errorCode: domainError.code,
        errorMessage: domainError.message,
        errorDetail: domainError.detail,
      });

      throw error;
    } finally {
      // ON 경로 스트림 입력 임시파일 정리(임시면 삭제, 로컬원본이면 no-op)
      if (lwCleanup) await lwCleanup().catch(() => {});
      // ★ cleanup은 jobId scoped temp 디렉토리만 삭제
      await this.cleanupJobTempDir(jobTempDir);
    }
  }

  // ============================================================================
  // Duplex-split Synthesis (낱장 양면 단일 PDF → 앞/뒤 2페이지 세트별 개별 PDF) - 2026-06-09
  // ============================================================================

  /**
   * Duplex-split 처리 (1개 PDF[앞,뒤,앞,뒤…] → set_0.pdf, set_1.pdf, … 각 2페이지).
   *
   * TemplateSet.pdfOutputMode='duplex-split' 일 때 API가 발행.
   * 편집기 페이지 순서를 그대로 보존(앞=먼저, 뒤=다음). 뒷면 회전은 인쇄소 RIP 책임이므로
   * 여기서는 페이지 순서만 보장하고 회전은 적용하지 않는다(설계 제약).
   *
   * split(cover/content) 머신과 동일한 검증/temp/상태재시도 패턴을 따르되,
   * 산출은 2파일이 아니라 2페이지 × n세트의 n파일이라는 점만 다르다.
   */
  private async handleDuplexSplitSynthesis(
    job: Job<DuplexSplitSynthesisJobData>,
  ) {
    const { jobId, sessionId, pdfFileId, totalExpectedPages } = job.data;
    const queueJobId = job.id;

    const jobTempDir = path.join(this.storagePath, `temp_${jobId}`);

    // 트랙 B-(f) ON 경로의 스트림 입력 임시파일 정리 핸들.
    let lwCleanup: (() => Promise<void>) | null = null;

    this.logger.log(
      `Processing duplex-split synthesis job ${jobId} (queue: ${queueJobId}), ` +
        `expectedPages=${totalExpectedPages}`,
    );

    try {
      await this.updateJobStatusWithRetry(jobId, { status: 'PROCESSING' });

      // 0. 임시 디렉토리 클린 시작 (재처리/리플레이 안전)
      await fs.rm(jobTempDir, { recursive: true, force: true });
      await fs.mkdir(jobTempDir, { recursive: true });

      // 1. 파일 조회 + 이중 검증 (split 과 동일 계약: 편집기 산출물 + 세션 일치)
      const file = await this.getFileById(pdfFileId);
      if (!file) {
        throw new DomainError(ErrorCodes.FILE_NOT_FOUND, '파일을 찾을 수 없습니다');
      }
      if (file.metadata?.generatedBy !== 'editor') {
        throw new DomainError(
          ErrorCodes.PDF_NOT_FROM_EDITOR,
          '편집기 산출물이 아닙니다',
        );
      }
      if (file.metadata?.editSessionId !== sessionId) {
        throw new DomainError(ErrorCodes.SESSION_FILE_MISMATCH, '세션-파일 불일치');
      }

      // 2~3. PDF 다운로드 + 로드(페이지수 확보)
      //   ON : 스트림 다운로드 → 임시파일, 페이지수 qpdf 메타(상수메모리). 세트추출도 qpdf.
      //   OFF: 기존 전체버퍼 + pdf-lib load (불변).
      const lightweight = VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS;
      let pdfDoc: PDFDocument | null = null;
      let lwInputPath: string | null = null;
      let totalPages: number;

      if (lightweight) {
        let dl;
        try {
          dl = await downloadToTempFile(file.filePath);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.FILE_DOWNLOAD_FAILED,
            '파일 다운로드 실패',
            { url: file.filePath, cause: error.message },
          );
        }
        lwInputPath = dl.path;
        lwCleanup = dl.cleanup;
        const meta = await extractPdfMetadataQpdf(dl.path);
        if (meta.corrupted || meta.pageCount <= 0) {
          throw new DomainError(
            ErrorCodes.PDF_LOAD_FAILED,
            'PDF 로드 실패 (암호화/손상/지원불가)',
            { cause: 'qpdf metadata corrupted/unreadable' },
          );
        }
        totalPages = meta.pageCount;
      } else {
        let pdfBytes: Uint8Array;
        try {
          pdfBytes = await this.synthesizerService.downloadFile(file.filePath);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.FILE_DOWNLOAD_FAILED,
            '파일 다운로드 실패',
            { url: file.filePath, cause: error.message },
          );
        }
        try {
          pdfDoc = await PDFDocument.load(pdfBytes);
        } catch (error: any) {
          throw new DomainError(
            ErrorCodes.PDF_LOAD_FAILED,
            'PDF 로드 실패 (암호화/손상/지원불가)',
            { cause: error.message },
          );
        }
        totalPages = pdfDoc.getPageCount();
      }

      // 4. 페이지 수 검증 (API 기대치와 일치 + 짝수 = 2 × 세트 수)
      if (totalPages !== totalExpectedPages) {
        throw new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, '페이지 수 불일치', {
          expected: totalExpectedPages,
          got: totalPages,
        });
      }
      if (totalPages === 0 || totalPages % 2 !== 0) {
        throw new DomainError(
          ErrorCodes.PAGE_COUNT_MISMATCH,
          'duplex-split은 짝수 페이지만 지원합니다',
          { got: totalPages },
        );
      }

      // 5. 2페이지씩 그룹핑하여 세트별 개별 PDF 생성 (synthesizer copyPages 프리미티브 재사용)
      const setCount = totalPages / 2;
      const storageKeyBase = `outputs/${jobId}`;
      const outputDir = path.join(this.outputsPath, jobId);
      await fs.mkdir(outputDir, { recursive: true });

      const outputFiles: OutputFile[] = [];
      for (let setIndex = 0; setIndex < setCount; setIndex++) {
        const frontIdx = setIndex * 2; // 앞 (편집기에서 먼저 보인 페이지)
        const backIdx = setIndex * 2 + 1; // 뒤 (다음 페이지)
        const setFilename = `set_${setIndex}.pdf`;
        const setOutPath = path.join(outputDir, setFilename);

        let setPageCount: number;
        if (lightweight) {
          // ON: qpdf 로 [앞,뒤] 2페이지 추출(순서 보존·치수/인쇄속성 무손실). 1-based 표기.
          await qpdfExtractPages(
            lwInputPath!,
            `${frontIdx + 1},${backIdx + 1}`,
            setOutPath,
          );
          setPageCount = (await extractPdfMetadataQpdf(setOutPath)).pageCount;
        } else {
          const setDoc = await PDFDocument.create();
          const [frontPage, backPage] = await setDoc.copyPages(pdfDoc!, [
            frontIdx,
            backIdx,
          ]);
          setDoc.addPage(frontPage);
          setDoc.addPage(backPage);
          await fs.writeFile(setOutPath, await setDoc.save());
          setPageCount = setDoc.getPageCount();
        }

        // 무결성: 세트당 정확히 2페이지여야 함
        if (setPageCount !== 2) {
          throw new DomainError(
            ErrorCodes.SPLIT_VERIFICATION_FAILED,
            'duplex-split 세트 페이지 수 불일치',
            { setIndex, expected: 2, got: setPageCount },
          );
        }

        outputFiles.push({
          type: 'set',
          url: `/storage/${storageKeyBase}/${setFilename}`,
          pageCount: 2,
          setIndex,
        });
      }

      // 6. 완료 처리 (★ 재시도 정책). outputFileUrl 은 첫 세트(하위호환용 단일 URL).
      const result: SynthesisResult = {
        success: true,
        outputFileUrl: outputFiles[0]?.url,
        outputFiles,
        totalPages,
      };

      await this.updateJobStatusWithRetry(jobId, {
        status: 'COMPLETED',
        result,
        outputFileUrl: result.outputFileUrl,
        outputFiles,
        queueJobId,
      });

      this.logger.log(
        `Duplex-split job ${jobId} completed: ${setCount} sets (${totalPages} pages → ${setCount} PDFs)`,
      );

      return result;
    } catch (error: any) {
      const domainError =
        error instanceof DomainError
          ? error
          : new DomainError(ErrorCodes.INTERNAL_ERROR, error.message);

      this.logger.error(
        `Duplex-split job ${jobId} failed: ${domainError.code} - ${domainError.message}`,
        error.stack,
      );

      await this.updateJobStatusWithRetry(jobId, {
        status: 'FAILED',
        errorCode: domainError.code,
        errorMessage: domainError.message,
        errorDetail: domainError.detail,
      });

      throw error;
    } finally {
      if (lwCleanup) await lwCleanup().catch(() => {});
      await this.cleanupJobTempDir(jobTempDir);
    }
  }

  /**
   * ★ 무결성 검증 (P0 필수)
   *
   * 트레이드오프:
   * - 비용: PDF 재로딩 I/O 2회 추가
   * - 이득: 손상/불완전 PDF 방지
   */
  private async verifySplitResult(
    result: SplitResult,
    expectedCover: number,
    expectedContent: number,
    lightweight = false,
  ): Promise<void> {
    // 파일 크기 체크
    const coverStats = await fs.stat(result.coverPath);
    const contentStats = await fs.stat(result.contentPath);

    if (coverStats.size === 0 || contentStats.size === 0) {
      throw new DomainError(ErrorCodes.EMPTY_OUTPUT_FILE, '출력 파일이 비어있습니다');
    }

    // 재로딩 + 페이지 수 확인 (★ 세분화된 errorDetail)
    //   ON : qpdf 메타(파일기반·상수메모리). 손상이면 동일 SPLIT_VERIFICATION_FAILED.
    //   OFF: pdf-lib 재로딩 (불변).
    let coverPages: number;
    let contentPages: number;

    if (lightweight) {
      const coverMeta = await extractPdfMetadataQpdf(result.coverPath);
      if (coverMeta.corrupted || coverMeta.pageCount < 0) {
        throw new DomainError(
          ErrorCodes.SPLIT_VERIFICATION_FAILED,
          'cover.pdf 재로딩 실패',
          { phase: 'load', target: 'cover', cause: 'qpdf metadata unreadable' },
        );
      }
      const contentMeta = await extractPdfMetadataQpdf(result.contentPath);
      if (contentMeta.corrupted || contentMeta.pageCount < 0) {
        throw new DomainError(
          ErrorCodes.SPLIT_VERIFICATION_FAILED,
          'content.pdf 재로딩 실패',
          { phase: 'load', target: 'content', cause: 'qpdf metadata unreadable' },
        );
      }
      coverPages = coverMeta.pageCount;
      contentPages = contentMeta.pageCount;
    } else {
      let coverDoc: PDFDocument;
      let contentDoc: PDFDocument;

      try {
        coverDoc = await PDFDocument.load(await fs.readFile(result.coverPath));
      } catch (error: any) {
        throw new DomainError(
          ErrorCodes.SPLIT_VERIFICATION_FAILED,
          'cover.pdf 재로딩 실패',
          { phase: 'load', target: 'cover', cause: error.message },
        );
      }

      try {
        contentDoc = await PDFDocument.load(await fs.readFile(result.contentPath));
      } catch (error: any) {
        throw new DomainError(
          ErrorCodes.SPLIT_VERIFICATION_FAILED,
          'content.pdf 재로딩 실패',
          { phase: 'load', target: 'content', cause: error.message },
        );
      }
      coverPages = coverDoc.getPageCount();
      contentPages = contentDoc.getPageCount();
    }

    if (coverPages !== expectedCover) {
      throw new DomainError(
        ErrorCodes.SPLIT_VERIFICATION_FAILED,
        'cover 페이지 수 불일치',
        {
          phase: 'pageCount',
          target: 'cover',
          expected: expectedCover,
          got: coverPages,
        },
      );
    }

    if (contentPages !== expectedContent) {
      throw new DomainError(
        ErrorCodes.SPLIT_VERIFICATION_FAILED,
        'content 페이지 수 불일치',
        {
          phase: 'pageCount',
          target: 'content',
          expected: expectedContent,
          got: contentPages,
        },
      );
    }
  }

  /**
   * 트랙 B-(f) — 0-based 페이지 인덱스 배열을 qpdf 1-based 콤마 페이지표기로 변환.
   * 순서를 그대로 보존한다(예: [0,2,1] → "1,3,2"). 빈 배열은 호출 전에 걸러져야 한다
   * (split 은 cover/content 비어있음을 이미 NO_*_PAGES 로 차단).
   */
  private toQpdfRange(indices: number[]): string {
    return indices.map((i) => String(i + 1)).join(',');
  }

  /**
   * 파일 조회 (Worker에서 API 호출)
   * ★ 실제 구현에서는 FilesService 또는 API 호출로 대체
   */
  private async getFileById(fileId: string): Promise<FileRecord | null> {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/files/${fileId}`,
        {
          headers: { 'X-API-Key': process.env.WORKER_API_KEY },
          timeout: 30000, // EH-005: API 무응답 시 split/duplex 잡 무한대기 방지
        },
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * ★ jobId scoped temp 디렉토리 정리
   */
  private async cleanupJobTempDir(jobTempDir: string): Promise<void> {
    try {
      await fs.rm(jobTempDir, { recursive: true, force: true });
      this.logger.debug(`Cleaned up temp dir: ${jobTempDir}`);
    } catch {
      this.logger.warn(`Failed to cleanup temp dir: ${jobTempDir}`);
    }
  }

  // ============================================================================
  // Status Update with Retry
  // ============================================================================

  /**
   * ★ 상태 업데이트 재시도 래퍼 (설계서 v1.1.4)
   *
   * WK-4 (2026-06-13): 본 프로세서에만 있던 재시도 로직(3회/최대 3s)을
   * 공유 JobStatusService 로 추출 — 재시도 5회·최대 30s 백오프·최종 실패 시
   * Sentry capture 로 강화되었고 validation/conversion/render 도 동일 정책을 쓴다.
   */
  private async updateJobStatusWithRetry(
    jobId: string,
    payload: {
      status: string;
      result?: SynthesisResult;
      outputFileUrl?: string;
      outputFiles?: OutputFile[];
      queueJobId?: string | number;
      errorCode?: string;
      errorMessage?: string;
      errorDetail?: Record<string, any>;
    },
  ): Promise<void> {
    await this.jobStatusService.updateJobStatusWithRetry(jobId, payload, {
      jobType: 'synthesize',
      queueName: 'pdf-synthesis',
    });
    if (payload.status === 'COMPLETED') {
      await this.writeCompletionMarker(jobId, payload);
    }
  }

  // ============================================================================
  // Spread Synthesis (스프레드 PDF 합성) - ★ v2.5 설계서
  // ============================================================================

  /**
   * 스프레드 합성 처리 (spread PDF 1개 + content PDF들 → cover.pdf + content.pdf)
   *
   * ★ 설계서 v2.5 핵심:
   * - spreadPdfFileId: 스프레드 캔버스 PDF (1페이지, 표지 전체)
   * - contentPdfFileIds: 내지 PDF들 (순서대로 병합)
   * - 항상 2개 PDF 분리 출력: cover.pdf + content.pdf
   * - (선택) alsoGenerateMerged=true → merged.pdf 추가 생성
   * - 스냅샷 검증: metadata.spine, metadata.spread 필수
   */
  private async handleSpreadSynthesis(job: Job<SpreadSynthesisJobData>) {
    const {
      jobId,
      sessionId,
      spreadPdfFileId,
      contentPdfFileIds,
      totalExpectedPages,
      outputFormat,
      alsoGenerateMerged,
    } = job.data;
    const queueJobId = job.id;

    const jobTempDir = path.join(this.storagePath, `temp_${jobId}`);

    this.logger.log(
      `Processing spread synthesis job ${jobId} (queue: ${queueJobId}), ` +
        `spreadPdf=${spreadPdfFileId}, contentPdfs=${contentPdfFileIds.length}`,
    );

    try {
      await this.updateJobStatusWithRetry(jobId, { status: 'PROCESSING' });

      // 0. 임시 디렉토리 클린 시작
      await fs.rm(jobTempDir, { recursive: true, force: true });
      await fs.mkdir(jobTempDir, { recursive: true });

      // 1. spread 모드 처리 (pdf-synthesizer.service.ts에 위임)
      const localResult: SpreadSynthesisLocalResult =
        await this.synthesizerService.handleSpreadSynthesis({
          sessionId,
          spreadPdfFileId,
          contentPdfFileIds,
          jobTempDir,
          alsoGenerateMerged: alsoGenerateMerged ?? false,
        });

      // 2. 스토리지에 파일 저장 + URL 발급
      const storageKeyBase = `outputs/${jobId}`;
      const outputDir = path.join(this.outputsPath, jobId);
      await fs.mkdir(outputDir, { recursive: true });

      // cover.pdf 저장
      const coverStoragePath = path.join(outputDir, 'cover.pdf');
      await fs.copyFile(localResult.coverPath, coverStoragePath);

      // content.pdf 저장
      const contentStoragePath = path.join(outputDir, 'content.pdf');
      await fs.copyFile(localResult.contentPath, contentStoragePath);

      // merged.pdf 저장 (선택)
      let mergedStoragePath: string | null = null;
      if (localResult.mergedPath) {
        mergedStoragePath = path.join(outputDir, 'merged.pdf');
        await fs.copyFile(localResult.mergedPath, mergedStoragePath);
      }

      // 3. outputFiles 배열 생성
      const outputFiles: OutputFile[] = [
        {
          type: 'cover',
          url: `/storage/${storageKeyBase}/cover.pdf`,
          pageCount: localResult.coverPageCount,
        },
        {
          type: 'content',
          url: `/storage/${storageKeyBase}/content.pdf`,
          pageCount: localResult.contentPageCount,
        },
      ];

      // 4. Job 완료 상태 업데이트
      await this.updateJobStatusWithRetry(jobId, {
        status: 'COMPLETED',
        outputFiles,
        outputFileUrl: mergedStoragePath
          ? `/storage/${storageKeyBase}/merged.pdf`
          : undefined,
        queueJobId,
      });

      // 5. 웹훅 콜백은 API의 WebhookService가 단일 채널로 송신.
      //    (updateJobStatus 호출 시 sendSynthesisCallback이 자동 트리거되며,
      //     X-Storige-Signature, X-Storige-Event 등 표준 헤더와 동일 payload schema 보장)
      //    워커가 직접 axios로 보내던 sendSpreadWebhook은 중복/비표준이므로 제거.

      // 6. 임시 파일 정리
      await this.cleanupSpreadTempFiles(localResult, jobTempDir);

      this.logger.log(`Spread synthesis completed: ${jobId}`);

      const result: SynthesisResult = {
        success: true,
        outputFileUrl: mergedStoragePath
          ? `/storage/${storageKeyBase}/merged.pdf`
          : undefined,
        outputFiles,
        totalPages: (localResult.coverPageCount || 1) + (localResult.contentPageCount || 0),
      };

      return result;
    } catch (error: any) {
      this.logger.error(
        `Spread synthesis failed for job ${jobId}: ${error.message}`,
        error.stack,
      );

      // EH-001: 스프레드 합성 실패도 다른 합성 핸들러와 동일하게 Sentry 로 보고(과거 누락).
      captureJobException(error, {
        jobId,
        jobType: 'synthesize',
        queueName: 'pdf-synthesis',
      });

      await this.updateJobStatusWithRetry(jobId, {
        status: 'FAILED',
        errorCode: error.code || 'SYNTHESIS_FAILED',
        errorMessage: error.message,
        errorDetail: {
          stack: error.stack,
          jobData: job.data,
        },
        queueJobId,
      });

      // 임시 디렉토리 정리
      await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});

      throw error;
    }
  }

  /**
   * Spread 임시 파일 정리
   */
  private async cleanupSpreadTempFiles(
    localResult: SpreadSynthesisLocalResult,
    jobTempDir: string,
  ): Promise<void> {
    // temp 디렉토리 전체 삭제
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
    this.logger.debug(`Cleaned up spread temp dir: ${jobTempDir}`);
  }

  /**
   * Update job status in API (★ payload 객체 형태로만 호출)
   *
   * WK-4: 공유 JobStatusService 의 재시도 경로로 위임 — merge/compose-mixed
   * 경로가 쓰던 무재시도 단발 PATCH 도 동일 재시도 정책(5회·최대 30s·Sentry)을 얻는다.
   * 최종 실패 시 throw 하지 않음(상태 미반영이 잡 결과 자체를 삼키지 않도록).
   */
  private async updateJobStatus(
    jobId: string,
    payload: {
      status: string;
      result?: SynthesisResult;
      outputFileUrl?: string | null;
      outputFiles?: OutputFile[];
      queueJobId?: string | number;
      errorCode?: string;
      errorMessage?: string;
      errorDetail?: Record<string, any>;
    },
  ): Promise<void> {
    await this.jobStatusService.updateJobStatusWithRetry(jobId, payload, {
      jobType: 'synthesize',
      queueName: 'pdf-synthesis',
    });
    if (payload.status === 'COMPLETED') {
      await this.writeCompletionMarker(jobId, payload);
    }
  }

  // ── ⓔ 멱등 가드 헬퍼 (2026-06-23) ──
  // 마커는 outputsPath/<jobId>/.synthesis-complete.json (마운트 볼륨=재시도/재시작 간 영속).
  private completionMarkerPath(jobId: string): string {
    return path.join(this.outputsPath, jobId, '.synthesis-complete.json');
  }

  /** COMPLETED payload 를 마커로 기록. fail-safe: 실패해도 throw 안 함(다음 재시도 시 재합성될 뿐). */
  private async writeCompletionMarker(
    jobId: string,
    payload: Record<string, any>,
  ): Promise<void> {
    try {
      await fs.mkdir(path.join(this.outputsPath, jobId), { recursive: true });
      await fs.writeFile(
        this.completionMarkerPath(jobId),
        JSON.stringify(payload),
        'utf8',
      );
    } catch (e: any) {
      this.logger.warn(
        `[idempotent] 완료 마커 기록 실패 jobId=${jobId}: ${e?.message ?? e}`,
      );
    }
  }

  /** 마커가 있고 COMPLETED 면 payload 반환(=이미 완료). 없음/파손/오류 → null(정상 합성 폴백). */
  private async loadCompletionMarker(
    jobId: string,
  ): Promise<({ status: string } & Record<string, any>) | null> {
    try {
      const raw = await fs.readFile(this.completionMarkerPath(jobId), 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && parsed.status === 'COMPLETED' ? parsed : null;
    } catch {
      return null;
    }
  }
}
