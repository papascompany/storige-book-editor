import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  isGhostscriptAvailable,
  mergePdfs,
  pdfToImage,
} from '../utils/ghostscript';
import { SynthesisLocalResult, SplitResult, SpreadSynthesisLocalResult } from '@storige/types';
import { DomainError, ErrorCodes } from '../common/errors';
import { isApiMarker, downloadViaApi } from './api-file-download';

export interface SynthesisOptions {
  /** 표지 PDF URL 또는 파일 경로 */
  coverUrl: string;
  /** 내지 PDF URL 또는 파일 경로 */
  contentUrl: string;
  /** 책등 너비 (mm) */
  spineWidth: number;
  /** 제본 유형 */
  bindingType?: 'perfect' | 'saddle' | 'hardcover';
  /** 미리보기 생성 여부 */
  generatePreview?: boolean;
  /** 출력 형식: merged(기본) 또는 separate */
  outputFormat?: 'merged' | 'separate';
}

/** @deprecated 하위호환용 - SynthesisLocalResult 사용 권장 */
export interface SynthesisResult {
  success: boolean;
  outputFileUrl: string;
  previewUrl?: string;
  totalPages: number;
  /** 책등 너비 (mm) */
  spineWidth: number;
  bindingType: string;
}

@Injectable()
export class PdfSynthesizerService {
  private readonly logger = new Logger(PdfSynthesizerService.name);
  private readonly storagePath =
    process.env.STORAGE_PATH || '/app/storage/temp';
  private gsAvailable: boolean | null = null;

  /**
   * Synthesize cover and content PDFs (로컬 파일 경로 반환)
   * 설계서 기준: Synthesizer는 파일 생성, Processor는 publish
   *
   * @param coverPdfUrl 표지 PDF URL
   * @param contentPdfUrl 내지 PDF URL
   * @param options 합성 옵션
   * @returns SynthesisLocalResult (로컬 파일 경로들)
   */
  async synthesizeToLocal(
    coverPdfUrl: string,
    contentPdfUrl: string,
    options: Partial<SynthesisOptions> = {},
  ): Promise<SynthesisLocalResult> {
    const { outputFormat = 'merged', bindingType = 'perfect' } = options;

    this.logger.log(
      `Synthesizing PDFs: cover=${coverPdfUrl}, content=${contentPdfUrl}, format=${outputFormat}`,
    );

    // Ghostscript 사용 가능 여부 확인
    if (this.gsAvailable === null) {
      this.gsAvailable = await isGhostscriptAvailable();
      this.logger.log(`Ghostscript available: ${this.gsAvailable}`);
    }

    // 1. 다운로드 (source 경로)
    const sourceCoverPath = path.join(
      this.storagePath,
      `source_cover_${uuidv4()}.pdf`,
    );
    const sourceContentPath = path.join(
      this.storagePath,
      `source_content_${uuidv4()}.pdf`,
    );

    const coverBytes = await this.downloadFile(coverPdfUrl);
    const contentBytes = await this.downloadFile(contentPdfUrl);

    await fs.writeFile(sourceCoverPath, coverBytes);
    await fs.writeFile(sourceContentPath, contentBytes);

    // 2. merged PDF 생성 (항상)
    const mergedPath = path.join(this.storagePath, `merged_${uuidv4()}.pdf`);

    let totalPages: number;
    if (this.gsAvailable) {
      totalPages = await this.synthesizeWithGhostscript(
        sourceCoverPath,
        sourceContentPath,
        mergedPath,
        bindingType,
      );
    } else {
      totalPages = await this.synthesizeWithPdfLib(
        sourceCoverPath,
        sourceContentPath,
        mergedPath,
        bindingType,
      );
    }

    this.logger.log(
      `Merged PDF created: ${totalPages} pages saved to ${mergedPath}`,
    );

    // 3. separate 모드면 cover/content 복사본 생성 (output 경로)
    if (outputFormat === 'separate') {
      const coverPath = path.join(this.storagePath, `cover_${uuidv4()}.pdf`);
      const contentPath = path.join(
        this.storagePath,
        `content_${uuidv4()}.pdf`,
      );
      await fs.copyFile(sourceCoverPath, coverPath);
      await fs.copyFile(sourceContentPath, contentPath);

      this.logger.log(
        `Separate mode: cover=${coverPath}, content=${contentPath}`,
      );

      return {
        success: true,
        sourceCoverPath, // 다운로드 원본
        sourceContentPath, // 다운로드 원본
        mergedPath,
        coverPath, // 복사본 (출력용)
        contentPath, // 복사본 (출력용)
        totalPages,
      };
    }

    return {
      success: true,
      sourceCoverPath, // 다운로드 원본
      sourceContentPath, // 다운로드 원본
      mergedPath,
      totalPages,
    };
  }

  /**
   * Synthesize cover and content PDFs
   * @deprecated synthesizeToLocal 사용 권장 (하위호환 유지)
   */
  async synthesize(
    options: SynthesisOptions,
    outputPath: string,
  ): Promise<SynthesisResult> {
    this.logger.log(
      `Synthesizing PDFs: cover=${options.coverUrl}, content=${options.contentUrl}`,
    );

    // Ghostscript 사용 가능 여부 확인
    if (this.gsAvailable === null) {
      this.gsAvailable = await isGhostscriptAvailable();
      this.logger.log(`Ghostscript available: ${this.gsAvailable}`);
    }

    try {
      // 임시 파일로 다운로드
      const tempCoverPath = path.join(
        this.storagePath,
        `cover_${uuidv4()}.pdf`,
      );
      const tempContentPath = path.join(
        this.storagePath,
        `content_${uuidv4()}.pdf`,
      );

      const coverBytes = await this.downloadFile(options.coverUrl);
      const contentBytes = await this.downloadFile(options.contentUrl);

      await fs.writeFile(tempCoverPath, coverBytes);
      await fs.writeFile(tempContentPath, contentBytes);

      let totalPages: number;
      const bindingType = options.bindingType || 'perfect';

      if (this.gsAvailable) {
        // Ghostscript를 사용한 PDF 병합
        totalPages = await this.synthesizeWithGhostscript(
          tempCoverPath,
          tempContentPath,
          outputPath,
          bindingType,
        );
      } else {
        // pdf-lib를 사용한 PDF 병합 (폴백)
        totalPages = await this.synthesizeWithPdfLib(
          tempCoverPath,
          tempContentPath,
          outputPath,
          bindingType,
        );
      }

      // 임시 파일 정리
      await this.safeDelete(tempCoverPath);
      await this.safeDelete(tempContentPath);

      // 미리보기 이미지 생성
      let previewUrl: string | undefined;
      if (options.generatePreview !== false) {
        previewUrl = await this.generatePreview(outputPath);
      }

      this.logger.log(
        `Synthesis complete: ${totalPages} pages saved to ${outputPath}`,
      );

      return {
        success: true,
        outputFileUrl: outputPath,
        previewUrl,
        totalPages,
        spineWidth: options.spineWidth,
        bindingType,
      };
    } catch (error) {
      this.logger.error(`Synthesis failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Ghostscript를 사용한 PDF 병합
   */
  private async synthesizeWithGhostscript(
    coverPath: string,
    contentPath: string,
    outputPath: string,
    bindingType: string,
  ): Promise<number> {
    // 표지, 내지 순서로 병합
    // perfect binding: 표지 전면 + 내지 전체 + 표지 후면
    // saddle stitch: 내지 페이지를 saddle stitch 순서로 재배열

    // pdf-lib로 표지 구조 분석
    const coverDoc = await PDFDocument.load(await fs.readFile(coverPath));
    const contentDoc = await PDFDocument.load(await fs.readFile(contentPath));

    const coverPageCount = coverDoc.getPageCount();
    const contentPageCount = contentDoc.getPageCount();

    // 임시 파일 경로들
    const tempFiles: string[] = [];

    try {
      // 표지 구조에 따라 병합 순서 결정
      if (bindingType === 'saddle') {
        // 중철 제본 (P4 v1, 2026-04-29):
        //  - 표지: 입력 4 페이지 [앞표지, 앞표지 안쪽, 뒷표지 안쪽, 뒷표지]
        //          → 출력 펼침면 2 페이지 (외부 [뒷|앞], 내부 [뒷안 |앞안])
        //  - 내지: 변경 없음 (단일 페이지 그대로)
        //  - saddle stitch 페이지 재배열은 추후 고객 요청 시 별도 작업
        // 자세한 spec: .cursor/plans/saddle-stitch-spec.md

        const composedCoverPath = path.join(
          this.storagePath,
          `saddle_cover_${uuidv4()}.pdf`,
        );
        tempFiles.push(composedCoverPath);

        await this.composeSaddleCover(
          coverPath,
          composedCoverPath,
          coverPageCount,
        );

        // 합성된 표지 + 내지 (단일 페이지) 병합
        await mergePdfs([composedCoverPath, contentPath], outputPath);
      } else {
        // Perfect binding 또는 hardcover
        if (coverPageCount >= 2) {
          // 표지가 2페이지 이상: 전면표지, 내지, 후면표지
          const frontCoverPath = path.join(
            this.storagePath,
            `front_${uuidv4()}.pdf`,
          );
          const backCoverPath = path.join(
            this.storagePath,
            `back_${uuidv4()}.pdf`,
          );

          // 표지를 전면/후면으로 분리
          await this.extractPages(coverPath, frontCoverPath, [0]);
          await this.extractPages(coverPath, backCoverPath, [
            coverPageCount - 1,
          ]);

          tempFiles.push(frontCoverPath, backCoverPath);

          // 병합: 전면표지 + 내지 + 후면표지
          await mergePdfs(
            [frontCoverPath, contentPath, backCoverPath],
            outputPath,
          );
        } else {
          // 표지가 1페이지: 그대로 병합
          await mergePdfs([coverPath, contentPath], outputPath);
        }
      }

      // 최종 페이지 수 확인
      const finalDoc = await PDFDocument.load(await fs.readFile(outputPath));
      return finalDoc.getPageCount();
    } finally {
      // 임시 파일 정리
      for (const tempFile of tempFiles) {
        await this.safeDelete(tempFile);
      }
    }
  }

  /**
   * pdf-lib를 사용한 PDF 병합 (폴백)
   */
  private async synthesizeWithPdfLib(
    coverPath: string,
    contentPath: string,
    outputPath: string,
    bindingType: string,
  ): Promise<number> {
    const coverDoc = await PDFDocument.load(await fs.readFile(coverPath));
    const contentDoc = await PDFDocument.load(await fs.readFile(contentPath));

    const mergedDoc = await PDFDocument.create();

    // 표지 페이지 복사
    const coverPages = await mergedDoc.copyPages(
      coverDoc,
      coverDoc.getPageIndices(),
    );

    // 내지 페이지 복사
    const contentPages = await mergedDoc.copyPages(
      contentDoc,
      contentDoc.getPageIndices(),
    );

    if (bindingType === 'perfect' || bindingType === 'hardcover') {
      // 전면 표지 추가
      if (coverPages.length > 0) {
        mergedDoc.addPage(coverPages[0]);
      }

      // 내지 추가
      for (const page of contentPages) {
        mergedDoc.addPage(page);
      }

      // 후면 표지 추가
      if (coverPages.length > 1) {
        mergedDoc.addPage(coverPages[coverPages.length - 1]);
      }
    } else {
      // 기타 제본: 표지 전체 + 내지 전체
      for (const page of coverPages) {
        mergedDoc.addPage(page);
      }
      for (const page of contentPages) {
        mergedDoc.addPage(page);
      }
    }

    const mergedPdfBytes = await mergedDoc.save();
    await fs.writeFile(outputPath, mergedPdfBytes);

    return mergedDoc.getPageCount();
  }

  /**
   * Saddle stitch (중철) 표지 펼침면 2-up 합성 — P4 v1
   *
   * 입력 cover.pdf 4 페이지를 펼침면 2 페이지로 합성.
   * 자세한 spec: `.cursor/plans/saddle-stitch-spec.md`
   *
   * 입력 페이지 순서 가정: [p1=앞표지, p2=앞표지 안쪽, p3=뒷표지 안쪽, p4=뒷표지]
   * 출력:
   *  - PDF p1 (외부면) = [뒷표지 | 앞표지] = [input.p4 | input.p1]
   *  - PDF p2 (내부면) = [뒷표지 안쪽 | 앞표지 안쪽] = [input.p3 | input.p2]
   * 출력 페이지 크기 = (입력 W × 2, 입력 H)
   *
   * 폴백: 입력 페이지 수가 4가 아니면 원본 그대로 복사 (warn 로그).
   */
  private async composeSaddleCover(
    inputCoverPath: string,
    outputPath: string,
    pageCount: number,
  ): Promise<void> {
    if (pageCount !== 4) {
      this.logger.warn(
        `Saddle cover expects 4 pages but got ${pageCount}; copying as-is`,
      );
      await fs.copyFile(inputCoverPath, outputPath);
      return;
    }

    const inputBytes = await fs.readFile(inputCoverPath);
    const inputDoc = await PDFDocument.load(inputBytes);
    const inputPages = inputDoc.getPages();
    const W = inputPages[0].getWidth();
    const H = inputPages[0].getHeight();

    const outDoc = await PDFDocument.create();
    // 입력 4페이지를 모두 임베드 (인덱스 0..3)
    const [eFront, eInsideFront, eInsideBack, eBack] =
      await outDoc.embedPdf(inputDoc, [0, 1, 2, 3]);

    // p1 외부면: [뒷표지 | 앞표지]
    const outerSheet = outDoc.addPage([W * 2, H]);
    outerSheet.drawPage(eBack, { x: 0, y: 0, width: W, height: H });
    outerSheet.drawPage(eFront, { x: W, y: 0, width: W, height: H });

    // p2 내부면: [뒷표지 안쪽 | 앞표지 안쪽]
    const innerSheet = outDoc.addPage([W * 2, H]);
    innerSheet.drawPage(eInsideBack, { x: 0, y: 0, width: W, height: H });
    innerSheet.drawPage(eInsideFront, { x: W, y: 0, width: W, height: H });

    const outBytes = await outDoc.save();
    await fs.writeFile(outputPath, outBytes);

    this.logger.log(
      `Saddle cover composed: 4 pages → 2 spread pages (${W * 2}×${H})`,
    );
  }

  /**
   * PDF에서 특정 페이지 추출
   */
  private async extractPages(
    inputPath: string,
    outputPath: string,
    pageIndices: number[],
  ): Promise<void> {
    const inputDoc = await PDFDocument.load(await fs.readFile(inputPath));
    const outputDoc = await PDFDocument.create();

    const pages = await outputDoc.copyPages(inputDoc, pageIndices);
    for (const page of pages) {
      outputDoc.addPage(page);
    }

    const outputBytes = await outputDoc.save();
    await fs.writeFile(outputPath, outputBytes);
  }

  /**
   * 미리보기 이미지 생성
   */
  private async generatePreview(pdfPath: string): Promise<string | undefined> {
    if (!this.gsAvailable) {
      this.logger.warn(
        'Preview generation skipped: Ghostscript not available',
      );
      return undefined;
    }

    try {
      const previewPath = pdfPath.replace('.pdf', '_preview.png');
      await pdfToImage(pdfPath, previewPath, {
        page: 1,
        resolution: 150,
        format: 'png',
      });
      return previewPath;
    } catch (error) {
      this.logger.warn(`Preview generation failed: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Calculate spine width based on page count and paper thickness
   * @param pageCount 총 페이지 수
   * @param paperThickness 종이 두께 (mm, 기본값: 0.1mm for 80gsm paper)
   * @returns 책등 너비 (mm)
   */
  calculateSpineWidth(
    pageCount: number,
    paperThickness: number = 0.1,
  ): number {
    // 양면 인쇄이므로 2로 나눔
    return (pageCount / 2) * paperThickness;
  }

  /**
   * 종이 종류에 따른 두께 반환 (mm)
   */
  getPaperThickness(
    paperType: 'newsprint' | 'offset' | 'coated' | 'artpaper',
    gsm: number,
  ): number {
    // 종이 종류 및 평량(gsm)에 따른 대략적인 두께
    const thicknessFactors: Record<string, number> = {
      newsprint: 0.0012, // 60gsm 기준 약 0.072mm
      offset: 0.0013, // 80gsm 기준 약 0.104mm
      coated: 0.00095, // 100gsm 기준 약 0.095mm
      artpaper: 0.001, // 100gsm 기준 약 0.1mm
    };

    const factor = thicknessFactors[paperType] || 0.0012;
    return gsm * factor;
  }

  // ============================================================================
  // Split Synthesis (단일 PDF 분리) - ★ v1.1.4 설계서
  // ============================================================================

  /**
   * PDF 문서에서 인덱스 기반으로 페이지 분리
   *
   * ★ 설계서 v1.1.4 기준:
   * - pdfDoc을 직접 받아 I/O 최소화
   * - jobTempDir로 jobId scoped 임시 파일 (동시 작업 안전)
   * - cover.pdf, content.pdf 생성
   *
   * @param pdfDoc 원본 PDF 문서 (이미 로드됨)
   * @param coverIndices 표지로 분류된 페이지 인덱스 배열
   * @param contentIndices 내지로 분류된 페이지 인덱스 배열
   * @param jobTempDir jobId scoped 임시 디렉토리 경로
   * @returns SplitResult (cover.pdf, content.pdf 경로 및 페이지 수)
   */
  async splitPdfByIndices(
    pdfDoc: PDFDocument,
    coverIndices: number[],
    contentIndices: number[],
    jobTempDir: string,
  ): Promise<SplitResult> {
    this.logger.log(
      `Splitting PDF: coverPages=${coverIndices.length}, contentPages=${contentIndices.length}`,
    );

    // 표지 PDF 생성
    const coverDoc = await PDFDocument.create();
    const coverPages = await coverDoc.copyPages(pdfDoc, coverIndices);
    coverPages.forEach((page) => coverDoc.addPage(page));

    const coverPath = path.join(jobTempDir, 'cover.pdf');
    await fs.writeFile(coverPath, await coverDoc.save());

    // 내지 PDF 생성
    const contentDoc = await PDFDocument.create();
    const contentPages = await contentDoc.copyPages(pdfDoc, contentIndices);
    contentPages.forEach((page) => contentDoc.addPage(page));

    const contentPath = path.join(jobTempDir, 'content.pdf');
    await fs.writeFile(contentPath, await contentDoc.save());

    this.logger.log(
      `Split complete: cover=${coverPath} (${coverIndices.length}p), content=${contentPath} (${contentIndices.length}p)`,
    );

    return {
      coverPath,
      contentPath,
      coverPageCount: coverIndices.length,
      contentPageCount: contentIndices.length,
    };
  }

  /**
   * 두 PDF를 병합하여 merged.pdf 생성 (split 모드용)
   *
   * @param coverPath 표지 PDF 경로
   * @param contentPath 내지 PDF 경로
   * @param outputPath 출력 경로
   */
  async mergeSplitPdfs(
    coverPath: string,
    contentPath: string,
    outputPath: string,
  ): Promise<void> {
    const coverDoc = await PDFDocument.load(await fs.readFile(coverPath));
    const contentDoc = await PDFDocument.load(await fs.readFile(contentPath));

    const mergedDoc = await PDFDocument.create();

    // 표지 페이지 복사
    const coverPages = await mergedDoc.copyPages(
      coverDoc,
      coverDoc.getPageIndices(),
    );
    coverPages.forEach((page) => mergedDoc.addPage(page));

    // 내지 페이지 복사
    const contentPages = await mergedDoc.copyPages(
      contentDoc,
      contentDoc.getPageIndices(),
    );
    contentPages.forEach((page) => mergedDoc.addPage(page));

    await fs.writeFile(outputPath, await mergedDoc.save());

    this.logger.log(
      `Merged PDF created: ${outputPath} (${mergedDoc.getPageCount()} pages)`,
    );
  }

  // ============================================================================
  // File Download & Utils
  // ============================================================================

  /**
   * Download file from URL or read from local storage.
   *
   * 처리 분기:
   * - `/` 또는 `./` 절대/명시적 로컬 경로 → fs.readFile
   * - `storage/...` 상대 경로 → STORAGE_PATH 기준 절대 경로로 변환 후 fs.readFile
   *   (files 테이블의 filePath 가 'storage/uploads/...' 형태로 저장돼 axios.get에
   *    그대로 넘기면 Invalid URL 에러. 이 분기로 운영 차단 버그 해소)
   * - 그 외 → axios.get HTTP 다운로드
   */
  async downloadFile(url: string): Promise<Uint8Array> {
    // API가 s3(R2) backend 파일에 넘기는 마커 → API 다운로드 라우트로 위임 (local/s3 라우팅)
    if (isApiMarker(url)) {
      return await downloadViaApi(url);
    }

    // ⚠️ 중요: '/storage/...' 와 'storage/...' 를 일반 절대경로보다 먼저 처리해야 함
    // API가 반환하는 fileUrl은 HTTP 서빙용 '/storage/...' 형태이며,
    // 이를 그대로 fs.readFile()에 넘기면 ENOENT 발생.
    // this.storagePath = STORAGE_PATH 환경변수 (보통 '/app/storage')
    if (url.startsWith('/storage/') || url.startsWith('storage/')) {
      const relative = url.replace(/^\/?storage\//, '');
      const absPath = path.join(this.storagePath, relative);
      const buffer = await fs.readFile(absPath);
      return new Uint8Array(buffer);
    }

    // 일반 절대/명시적 로컬 경로 (예: '/app/storage/...', './tmp/...')
    if (url.startsWith('/') || url.startsWith('./')) {
      const buffer = await fs.readFile(url);
      return new Uint8Array(buffer);
    }

    // 그 외: HTTP/HTTPS URL
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    });

    return new Uint8Array(response.data);
  }

  /**
   * Safely delete a file
   */
  private async safeDelete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.logger.debug(`Could not delete temp file: ${filePath}`);
    }
  }

  // ============================================================================
  // Spread Synthesis (스프레드 PDF 합성) - ★ v2.5 설계서
  // ============================================================================

  /**
   * 스프레드 합성 처리
   *
   * @param options.sessionId EditSession ID (스냅샷 검증용)
   * @param options.spreadPdfFileId 스프레드 PDF 파일 ID (1페이지)
   * @param options.contentPdfFileIds 내지 PDF 파일 ID 배열 (순서 보장)
   * @param options.jobTempDir 임시 디렉토리 경로
   * @param options.alsoGenerateMerged merged.pdf도 생성할지 여부
   * @returns SpreadSynthesisLocalResult
   */
  async handleSpreadSynthesis(options: {
    sessionId: string;
    spreadPdfFileId: string;
    contentPdfFileIds: string[];
    jobTempDir: string;
    alsoGenerateMerged: boolean;
  }): Promise<SpreadSynthesisLocalResult> {
    const {
      sessionId,
      spreadPdfFileId,
      contentPdfFileIds,
      jobTempDir,
      alsoGenerateMerged,
    } = options;

    this.logger.log(
      `Spread synthesis: session=${sessionId}, spreadPdf=${spreadPdfFileId}, contentPdfs=${contentPdfFileIds.length}`,
    );

    // 1. EditSession 조회 (스냅샷 검증용)
    const session = await this.getEditSession(sessionId);
    if (!session) {
      throw new DomainError(
        ErrorCodes.SESSION_NOT_FOUND,
        'EditSession을 찾을 수 없습니다',
      );
    }

    // 1-1. 스냅샷 검증 (하드 실패)
    this.validateSpreadSnapshot(session);

    const { spine, spread } = session.metadata;

    // 2. 스프레드 PDF 다운로드 + 검증
    const spreadFile = await this.getFileById(spreadPdfFileId);
    if (!spreadFile) {
      throw new DomainError(
        ErrorCodes.FILE_NOT_FOUND,
        '스프레드 PDF 파일을 찾을 수 없습니다',
      );
    }

    const spreadPdfPath = path.join(jobTempDir, `spread_${spreadPdfFileId}.pdf`);
    const spreadBytes = await this.downloadFile(
      spreadFile.storageBackend === 's3' ? `api://${spreadFile.id}` : spreadFile.filePath,
    );
    await fs.writeFile(spreadPdfPath, spreadBytes);

    // 2-1. 스프레드 PDF 검증: 1페이지 + MediaBox 일치
    const spreadPdf = await PDFDocument.load(spreadBytes);
    const spreadPageCount = spreadPdf.getPageCount();

    if (spreadPageCount !== 1) {
      throw new DomainError(
        ErrorCodes.SPREAD_PDF_INVALID_PAGE_COUNT,
        `스프레드 PDF는 1페이지여야 합니다 (현재: ${spreadPageCount}페이지)`,
      );
    }

    // MediaBox 사이즈 검증 (오차 허용: 0.2mm 또는 1px@dpi)
    const spreadPage = spreadPdf.getPage(0);
    const { width: pdfWidthPt, height: pdfHeightPt } = spreadPage.getSize();
    const pdfWidthMm = pdfWidthPt * 25.4 / 72;
    const pdfHeightMm = pdfHeightPt * 25.4 / 72;

    const expectedWidthMm = spread.totalWidthMm;
    const expectedHeightMm = spread.totalHeightMm;
    const dpi = spread.dpi || 300;
    const toleranceMm = Math.max(0.2, (1 / dpi) * 25.4);

    if (
      Math.abs(pdfWidthMm - expectedWidthMm) > toleranceMm ||
      Math.abs(pdfHeightMm - expectedHeightMm) > toleranceMm
    ) {
      throw new DomainError(
        ErrorCodes.SPREAD_PDF_SIZE_MISMATCH,
        `스프레드 PDF 사이즈가 일치하지 않습니다. ` +
          `예상: ${expectedWidthMm}x${expectedHeightMm}mm, ` +
          `실제: ${pdfWidthMm.toFixed(2)}x${pdfHeightMm.toFixed(2)}mm (허용 오차: ${toleranceMm.toFixed(2)}mm)`,
      );
    }

    // 3. 내지 PDF들 다운로드
    const contentPdfPaths: string[] = [];
    for (const fileId of contentPdfFileIds) {
      const contentFile = await this.getFileById(fileId);
      if (!contentFile) {
        throw new DomainError(
          ErrorCodes.FILE_NOT_FOUND,
          `내지 PDF 파일을 찾을 수 없습니다: ${fileId}`,
        );
      }

      const contentPdfPath = path.join(jobTempDir, `content_${fileId}.pdf`);
      const contentBytes = await this.downloadFile(
        contentFile.storageBackend === 's3' ? `api://${contentFile.id}` : contentFile.filePath,
      );
      await fs.writeFile(contentPdfPath, contentBytes);
      contentPdfPaths.push(contentPdfPath);
    }

    // 4. cover.pdf 생성 (스프레드 PDF 그대로 복사)
    const coverPath = path.join(jobTempDir, 'cover.pdf');
    await fs.copyFile(spreadPdfPath, coverPath);

    // 5. content.pdf 생성 (내지 PDF들 순서대로 병합)
    const contentPath = path.join(jobTempDir, 'content.pdf');
    const mergedContentPdf = await PDFDocument.create();

    let totalContentPages = 0;
    for (const contentPdfPath of contentPdfPaths) {
      const contentPdfBytes = await fs.readFile(contentPdfPath);
      const contentPdf = await PDFDocument.load(contentPdfBytes);
      const pageCount = contentPdf.getPageCount();

      for (let i = 0; i < pageCount; i++) {
        const [copiedPage] = await mergedContentPdf.copyPages(contentPdf, [i]);
        mergedContentPdf.addPage(copiedPage);
        totalContentPages++;
      }
    }

    const mergedContentBytes = await mergedContentPdf.save();
    await fs.writeFile(contentPath, mergedContentBytes);

    // 6. merged.pdf 생성 (선택)
    let mergedPath: string | undefined = undefined;
    if (alsoGenerateMerged) {
      mergedPath = path.join(jobTempDir, 'merged.pdf');
      const finalMergedPdf = await PDFDocument.create();

      // cover.pdf 추가 (1페이지)
      const coverPdfBytes = await fs.readFile(coverPath);
      const coverPdf = await PDFDocument.load(coverPdfBytes);
      const [copiedCoverPage] = await finalMergedPdf.copyPages(coverPdf, [0]);
      finalMergedPdf.addPage(copiedCoverPage);

      // content.pdf 추가 (N페이지)
      const contentPdfBytes = await fs.readFile(contentPath);
      const contentPdf = await PDFDocument.load(contentPdfBytes);
      const contentPageCount = contentPdf.getPageCount();

      for (let i = 0; i < contentPageCount; i++) {
        const [copiedPage] = await finalMergedPdf.copyPages(contentPdf, [i]);
        finalMergedPdf.addPage(copiedPage);
      }

      const finalMergedBytes = await finalMergedPdf.save();
      await fs.writeFile(mergedPath, finalMergedBytes);

      this.logger.log(`Generated merged.pdf with ${1 + totalContentPages} pages`);
    }

    this.logger.log(
      `Spread synthesis completed: cover (1p) + content (${totalContentPages}p)`,
    );

    return {
      success: true,
      coverPath,
      contentPath,
      mergedPath,
      coverPageCount: 1,
      contentPageCount: totalContentPages,
    };
  }

  /**
   * EditSession 조회 (API 호출)
   */
  private async getEditSession(sessionId: string): Promise<any> {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000/api';
    try {
      const response = await axios.get(
        `${apiBaseUrl}/edit-sessions/${sessionId}`,
        {
          headers: { 'X-API-Key': process.env.WORKER_API_KEY },
        },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to get EditSession ${sessionId}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * File 조회 (API 호출)
   */
  private async getFileById(fileId: string): Promise<any> {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000/api';
    try {
      const response = await axios.get(`${apiBaseUrl}/files/${fileId}`, {
        headers: { 'X-API-Key': process.env.WORKER_API_KEY },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get File ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * 스프레드 스냅샷 검증 (하드 실패)
   */
  private validateSpreadSnapshot(session: any): void {
    if (!session.metadata?.spine) {
      throw new DomainError(
        ErrorCodes.SPREAD_SNAPSHOT_MISSING,
        'metadata.spine이 누락되었습니다',
      );
    }

    const { spine } = session.metadata;
    if (
      !spine.spineWidthMm ||
      !spine.pageCount ||
      !spine.paperType ||
      !spine.bindingType ||
      !spine.formulaVersion
    ) {
      throw new DomainError(
        ErrorCodes.SPREAD_SNAPSHOT_INVALID,
        'metadata.spine의 필수 필드가 누락되었습니다',
      );
    }

    if (!session.metadata?.spread) {
      throw new DomainError(
        ErrorCodes.SPREAD_SNAPSHOT_MISSING,
        'metadata.spread가 누락되었습니다',
      );
    }

    const { spread } = session.metadata;
    if (
      !spread.spec ||
      !spread.totalWidthMm ||
      !spread.totalHeightMm ||
      !spread.dpi
    ) {
      throw new DomainError(
        ErrorCodes.SPREAD_SNAPSHOT_INVALID,
        'metadata.spread의 필수 필드가 누락되었습니다',
      );
    }

    this.logger.log(`Spread snapshot validated for session ${session.id}`);
  }
}
