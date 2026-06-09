import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PDFDocument } from 'pdf-lib';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { DomainError, ErrorCodes } from '../common/errors';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';
import { captureJobException } from '../sentry/sentry.init';
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

  constructor(private readonly synthesizerService: PdfSynthesizerService) {}

  @Process('synthesize-pdf')
  async handleSynthesis(job: Job<SynthesisJobData>) {
    const { mode } = job.data;

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
      composeSpreadTotalWidthMm,
      composeSpreadTotalHeightMm,
      composeSpreadDpi,
    } = job.data;
    const jobId = job.data.jobId;
    const queueJobId = job.id;
    const outputMode = composeOutputMode || 'merged';

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
          if (composeSpreadTotalWidthMm && composeSpreadTotalHeightMm) {
            coverSizeValidation = this.validateSpreadCoverSize(
              jobId,
              coverDoc,
              composeSpreadTotalWidthMm,
              composeSpreadTotalHeightMm,
              composeSpreadDpi,
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
    const hardFail = process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true';
    const useDpi = dpi || 300;
    const toleranceMm = Math.max(0.2, (1 / useDpi) * 25.4);
    const mismatches: string[] = [];
    const pageCount = coverDoc.getPageCount();
    let actualWidthMm: number | undefined;
    let actualHeightMm: number | undefined;

    if (pageCount !== 1) {
      // 펼침면 cover 단일페이지 가정 위반(0페이지=손상, 2+=다면) → 명백한 cover 오류
      mismatches.push(`COVER_PAGE_COUNT: ${pageCount}쪽 (펼침면 cover 는 1쪽이어야 함)`);
    } else {
      const { width: wPt, height: hPt } = coverDoc.getPage(0).getSize();
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

      // 2. PDF 다운로드 (★ 예외 래핑: FILE_DOWNLOAD_FAILED)
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

      // 3. PDF 로드 (★ 예외 래핑: PDF_LOAD_FAILED)
      let pdfDoc: PDFDocument;
      try {
        pdfDoc = await PDFDocument.load(pdfBytes);
      } catch (error: any) {
        throw new DomainError(
          ErrorCodes.PDF_LOAD_FAILED,
          'PDF 로드 실패 (암호화/손상/지원불가)',
          { cause: error.message },
        );
      }
      const totalPages = pdfDoc.getPageCount();

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
      const splitResult = await this.synthesizerService.splitPdfByIndices(
        pdfDoc,
        coverIndices,
        contentIndices,
        jobTempDir,
      );

      // 8. ★ 무결성 검증 (P0 필수)
      await this.verifySplitResult(
        splitResult,
        coverIndices.length,
        contentIndices.length,
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

      // 2. PDF 다운로드
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

      // 3. PDF 로드
      let pdfDoc: PDFDocument;
      try {
        pdfDoc = await PDFDocument.load(pdfBytes);
      } catch (error: any) {
        throw new DomainError(
          ErrorCodes.PDF_LOAD_FAILED,
          'PDF 로드 실패 (암호화/손상/지원불가)',
          { cause: error.message },
        );
      }
      const totalPages = pdfDoc.getPageCount();

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

        const setDoc = await PDFDocument.create();
        const [frontPage, backPage] = await setDoc.copyPages(pdfDoc, [
          frontIdx,
          backIdx,
        ]);
        setDoc.addPage(frontPage);
        setDoc.addPage(backPage);

        const setFilename = `set_${setIndex}.pdf`;
        await fs.writeFile(
          path.join(outputDir, setFilename),
          await setDoc.save(),
        );

        // 무결성: 세트당 정확히 2페이지여야 함
        if (setDoc.getPageCount() !== 2) {
          throw new DomainError(
            ErrorCodes.SPLIT_VERIFICATION_FAILED,
            'duplex-split 세트 페이지 수 불일치',
            { setIndex, expected: 2, got: setDoc.getPageCount() },
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
  ): Promise<void> {
    // 파일 크기 체크
    const coverStats = await fs.stat(result.coverPath);
    const contentStats = await fs.stat(result.contentPath);

    if (coverStats.size === 0 || contentStats.size === 0) {
      throw new DomainError(ErrorCodes.EMPTY_OUTPUT_FILE, '출력 파일이 비어있습니다');
    }

    // 재로딩 + 페이지 수 확인 (★ 세분화된 errorDetail)
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

    if (coverDoc.getPageCount() !== expectedCover) {
      throw new DomainError(
        ErrorCodes.SPLIT_VERIFICATION_FAILED,
        'cover 페이지 수 불일치',
        {
          phase: 'pageCount',
          target: 'cover',
          expected: expectedCover,
          got: coverDoc.getPageCount(),
        },
      );
    }

    if (contentDoc.getPageCount() !== expectedContent) {
      throw new DomainError(
        ErrorCodes.SPLIT_VERIFICATION_FAILED,
        'content 페이지 수 불일치',
        {
          phase: 'pageCount',
          target: 'content',
          expected: expectedContent,
          got: contentDoc.getPageCount(),
        },
      );
    }
  }

  /**
   * 파일 조회 (Worker에서 API 호출)
   * ★ 실제 구현에서는 FilesService 또는 API 호출로 대체
   */
  private async getFileById(fileId: string): Promise<FileRecord | null> {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/files/${fileId}`,
        { headers: { 'X-API-Key': process.env.WORKER_API_KEY } },
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
   * 재시도 정책:
   * - 최대 3회
   * - 지수 백오프: 250ms → 1s → 3s
   * - 최종 실패 시 ERROR 로그
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
    const delays = [250, 1000, 3000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await this.updateJobStatus(jobId, payload);
        return;
      } catch (error: any) {
        lastError = error;
        if (attempt < delays.length) {
          this.logger.warn(
            `updateJobStatus attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms`,
          );
          await this.delay(delays[attempt]);
        }
      }
    }

    // 최종 실패
    this.logger.error(
      `updateJobStatus FINAL FAILURE for jobId=${jobId}: ${lastError?.message}`,
      { jobId, payload, error: lastError },
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    await axios.patch(
      `${this.apiBaseUrl}/worker-jobs/external/${jobId}/status`,
      payload,
      { headers: { 'X-API-Key': process.env.WORKER_API_KEY } },
    );
  }
}
