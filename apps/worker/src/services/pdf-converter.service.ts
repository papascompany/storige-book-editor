import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, rgb } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  isGhostscriptAvailable,
  addBleedToPdf,
  resizePdf,
  pdfToImage,
} from '../utils/ghostscript';

export interface ConversionOptions {
  addPages: boolean;
  applyBleed: boolean;
  targetPages: number;
  bleed: number;
  /** 출력 크기 (mm) */
  targetSize?: { width: number; height: number };
}

export interface ConversionResult {
  success: boolean;
  outputFileUrl: string;
  pagesAdded: number;
  bleedApplied: boolean;
  previewUrl?: string;
  finalPageCount: number;
  finalSize?: { width: number; height: number };
}

@Injectable()
export class PdfConverterService {
  private readonly logger = new Logger(PdfConverterService.name);
  private readonly storagePath =
    process.env.STORAGE_PATH || '/app/storage';
  private gsAvailable: boolean | null = null;

  /**
   * 절대 파일시스템 경로(/app/storage/...)를 nginx에서 서빙 가능한
   * 상대 URL(/storage/...)로 변환. STORAGE_PATH 외부 경로는 그대로 반환.
   */
  private toStorageUrl(absPath: string): string {
    const base = this.storagePath.replace(/\/$/, '');
    if (absPath === base) return '/storage';
    if (absPath.startsWith(base + '/')) {
      return '/storage/' + absPath.substring(base.length + 1);
    }
    return absPath;
  }

  /**
   * Convert PDF (add pages, apply bleed)
   */
  async convert(
    fileUrl: string,
    options: ConversionOptions,
    outputPath: string,
  ): Promise<ConversionResult> {
    this.logger.log(`Converting PDF: ${fileUrl}`);

    try {
      // Ghostscript 사용 가능 여부 확인
      if (this.gsAvailable === null) {
        this.gsAvailable = await isGhostscriptAvailable();
        this.logger.log(`Ghostscript available: ${this.gsAvailable}`);
      }

      // 임시 파일로 다운로드
      const tempInputPath = path.join(this.storagePath, `input_${uuidv4()}.pdf`);
      const pdfBytes = await this.downloadFile(fileUrl);
      await fs.writeFile(tempInputPath, pdfBytes);

      let currentPath = tempInputPath;
      let pagesAdded = 0;
      let bleedApplied = false;

      // 1. 페이지 추가 (pdf-lib 사용)
      if (options.addPages && options.targetPages > 0) {
        const pdfDoc = await PDFDocument.load(await fs.readFile(currentPath));
        pagesAdded = await this.addPages(pdfDoc, options.targetPages);

        if (pagesAdded > 0) {
          const tempPagesPath = path.join(this.storagePath, `pages_${uuidv4()}.pdf`);
          const modifiedBytes = await pdfDoc.save();
          await fs.writeFile(tempPagesPath, modifiedBytes);

          // 이전 임시 파일 삭제
          if (currentPath !== tempInputPath) {
            await this.safeDelete(currentPath);
          }
          currentPath = tempPagesPath;

          this.logger.log(`Added ${pagesAdded} blank pages`);
        }
      }

      // 2. 블리드 적용
      if (options.applyBleed && options.bleed > 0) {
        const tempBleedPath = path.join(this.storagePath, `bleed_${uuidv4()}.pdf`);

        if (this.gsAvailable) {
          // Ghostscript로 블리드 적용 (더 정확함)
          await addBleedToPdf(currentPath, tempBleedPath, options.bleed);
        } else {
          // pdf-lib로 폴백 (기본 기능만)
          await this.applyBleedWithPdfLib(currentPath, tempBleedPath, options.bleed);
        }

        // 이전 임시 파일 삭제
        await this.safeDelete(currentPath);
        currentPath = tempBleedPath;
        bleedApplied = true;

        this.logger.log(`Applied ${options.bleed}mm bleed`);
      }

      // 3. 크기 조정 (옵션)
      if (options.targetSize) {
        const tempResizePath = path.join(this.storagePath, `resize_${uuidv4()}.pdf`);

        if (this.gsAvailable) {
          await resizePdf(
            currentPath,
            tempResizePath,
            options.targetSize.width + (bleedApplied ? options.bleed * 2 : 0),
            options.targetSize.height + (bleedApplied ? options.bleed * 2 : 0),
          );

          await this.safeDelete(currentPath);
          currentPath = tempResizePath;
        }
      }

      // 4. 최종 파일로 복사
      await fs.copyFile(currentPath, outputPath);
      await this.safeDelete(currentPath);

      // 5. 미리보기 이미지 생성
      let previewUrl: string | undefined;
      if (this.gsAvailable) {
        try {
          const previewPath = outputPath.replace('.pdf', '_preview.png');
          await pdfToImage(outputPath, previewPath, { page: 1, resolution: 150 });
          previewUrl = previewPath;
        } catch (previewError) {
          this.logger.warn(`Preview generation failed: ${previewError.message}`);
        }
      }

      // 6. 최종 PDF 정보 추출
      const finalPdf = await PDFDocument.load(await fs.readFile(outputPath));
      const finalPageCount = finalPdf.getPageCount();
      const firstPage = finalPdf.getPage(0);
      const { width, height } = firstPage.getSize();

      // 임시 입력 파일 삭제
      await this.safeDelete(tempInputPath);

      this.logger.log(`Conversion complete: ${outputPath}`);

      return {
        success: true,
        outputFileUrl: this.toStorageUrl(outputPath),
        pagesAdded,
        bleedApplied,
        previewUrl: previewUrl ? this.toStorageUrl(previewUrl) : undefined,
        finalPageCount,
        finalSize: {
          width: Math.round(width / 2.83465), // points to mm
          height: Math.round(height / 2.83465),
        },
      };
    } catch (error) {
      this.logger.error(`Conversion failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Add blank pages to reach target count
   */
  private async addPages(
    pdfDoc: PDFDocument,
    targetPages: number,
  ): Promise<number> {
    const currentPages = pdfDoc.getPageCount();

    if (currentPages >= targetPages) {
      return 0;
    }

    const pagesToAdd = targetPages - currentPages;
    const firstPage = pdfDoc.getPage(0);
    const { width, height } = firstPage.getSize();

    for (let i = 0; i < pagesToAdd; i++) {
      const blankPage = pdfDoc.addPage([width, height]);

      // Fill with white background
      blankPage.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(1, 1, 1),
      });
    }

    return pagesToAdd;
  }

  /**
   * Apply bleed using pdf-lib (fallback when Ghostscript not available)
   * Note: This is a simplified implementation that only extends page size
   */
  private async applyBleedWithPdfLib(
    inputPath: string,
    outputPath: string,
    bleedMm: number,
  ): Promise<void> {
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Convert mm to points (1mm = 2.83465 points)
    const bleedPoints = bleedMm * 2.83465;

    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();

      // Extend page size by bleed amount on all sides
      const newWidth = width + bleedPoints * 2;
      const newHeight = height + bleedPoints * 2;

      page.setSize(newWidth, newHeight);

      // Note: pdf-lib cannot easily move existing content
      // This is a simplified version - Ghostscript is preferred
      // For production, you'd use more sophisticated image processing
    }

    const modifiedBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, modifiedBytes);

    this.logger.warn(
      'Used pdf-lib fallback for bleed - Ghostscript provides better results',
    );
  }

  /**
   * Safely delete a file (ignore errors if file doesn't exist)
   */
  private async safeDelete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors (file may not exist)
      this.logger.debug(`Could not delete temp file: ${filePath}`);
    }
  }

  /**
   * Download file from URL
   *
   * 경로 처리 우선순위:
   *  1. '/storage/...' 또는 'storage/...' → WORKER_STORAGE_PATH 기준 정규화 (API의 fileUrl 형식)
   *  2. 일반 절대/상대 경로 → 그대로 읽기
   *  3. HTTP/HTTPS URL → axios로 다운로드
   *
   * ⚠️ 1번 체크가 2번보다 먼저 와야 함. 그렇지 않으면 '/storage/...' 가
   *    절대경로로 처리되어 ENOENT 발생.
   */
  private async downloadFile(url: string): Promise<Uint8Array> {
    // storige 내부 storage 경로 (API에서 받는 fileUrl이 보통 이 형태)
    if (url.startsWith('/storage/') || url.startsWith('storage/')) {
      const storageBase = process.env.WORKER_STORAGE_PATH || '../api';
      const filePath = url.startsWith('/storage/')
        ? `${storageBase}${url}`           // '/app' + '/storage/...' = '/app/storage/...'
        : `${storageBase}/${url}`;         // '/app' + '/' + 'storage/...' = '/app/storage/...'
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    }

    // 일반 절대/상대 경로
    if (url.startsWith('/') || url.startsWith('./')) {
      const buffer = await fs.readFile(url);
      return new Uint8Array(buffer);
    }

    // Download from URL
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    });

    return new Uint8Array(response.data);
  }
}
