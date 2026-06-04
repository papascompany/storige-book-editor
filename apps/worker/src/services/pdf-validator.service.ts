import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFPage } from 'pdf-lib';
import * as fs from 'fs/promises';
import axios from 'axios';
import {
  ErrorCode,
  WarningCode,
  ValidationError,
  ValidationWarning,
  ValidationResultDto,
  ValidationOptions,
  PdfMetadata,
  SpreadDetectionResult,
  CmykStructureResult,
  ColorModeResult,
} from '../dto/validation-result.dto';
import { VALIDATION_CONFIG } from '../config/validation.config';
import {
  detectCmykUsage,
  isGhostscriptAvailable,
  detectSpotColors,
  detectTransparencyAndOverprint,
  detectImageResolutionFromPdf,
} from '../utils/ghostscript';

// 기본 설정 (VALIDATION_CONFIG에서 가져오거나 폴백)
const DEFAULT_MAX_FILE_SIZE = VALIDATION_CONFIG.MAX_FILE_SIZE;
const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_BLEED = 3; // mm

@Injectable()
export class PdfValidatorService {
  private readonly logger = new Logger(PdfValidatorService.name);

  /**
   * PDF 파일 검증
   */
  async validate(
    fileUrl: string,
    options: ValidationOptions,
  ): Promise<ValidationResultDto> {
    this.logger.log(`Validating PDF: ${fileUrl}`);

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const metadata: PdfMetadata = {
      pageCount: 0,
      pageSize: { width: 0, height: 0 },
      hasBleed: false,
      colorMode: 'RGB',
      resolution: 300,
    };

    try {
      // 1. 파일 다운로드 및 기본 검증
      const pdfBytes = await this.downloadFile(fileUrl);
      const fileSize = pdfBytes.length;

      // 2. 파일 크기 검증
      const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
      if (fileSize > maxFileSize) {
        errors.push({
          code: ErrorCode.FILE_TOO_LARGE,
          message: `파일 크기가 ${Math.round(maxFileSize / 1024 / 1024)}MB를 초과합니다.`,
          details: {
            expected: maxFileSize,
            actual: fileSize,
          },
          autoFixable: false,
        });
        // 파일이 너무 크면 추가 검증 불필요
        return { isValid: false, errors, warnings, metadata };
      }

      // 3. PDF 로드 및 무결성 검증
      let pdfDoc: PDFDocument;
      try {
        pdfDoc = await PDFDocument.load(pdfBytes);
      } catch (error) {
        errors.push({
          code: ErrorCode.FILE_CORRUPTED,
          message: '파일이 손상되었습니다. 다시 업로드해주세요.',
          details: {
            actual: error.message,
          },
          autoFixable: false,
        });
        return { isValid: false, errors, warnings, metadata };
      }

      // 4. 메타데이터 추출
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      // Points to mm 변환 (1 point = 0.352778 mm)
      const widthMm = width * 0.352778;
      const heightMm = height * 0.352778;

      metadata.pageCount = pages.length;
      metadata.pageSize = {
        width: Math.round(widthMm * 10) / 10,
        height: Math.round(heightMm * 10) / 10,
      };

      // 5. 페이지 수 검증
      this.validatePageCount(pages.length, options, errors, warnings);

      // 6. 페이지 크기 검증
      this.validatePageSize(widthMm, heightMm, options, errors, metadata);

      // 7. 재단 여백 검증
      this.validateBleed(widthMm, heightMm, options, warnings, metadata);

      // 8. 책등 크기 검증 (표지인 경우)
      if (options.fileType === 'cover') {
        this.validateSpine(widthMm, options, errors, metadata);
      }

      // 9. 가로형 페이지 감지 (WBS 2.1)
      this.validatePageOrientation(pages, warnings);

      // 10. 사철 제본 검증 (WBS 2.2)
      if (options.orderOptions.binding === 'saddle') {
        this.validateSaddleStitch(pages.length, errors, warnings);
      }

      // 11. 스프레드(펼침면) 감지 (WBS 2.3)
      const spreadResult = this.detectSpreadFormat(
        pages,
        options.orderOptions.size.width,
        options.orderOptions.size.height,
        options.orderOptions.bleed ?? DEFAULT_BLEED,
      );

      // 스프레드 정보를 메타데이터에 추가
      metadata.spreadInfo = {
        isSpread: spreadResult.isSpread,
        score: spreadResult.score,
        confidence: spreadResult.confidence,
        detectedType: spreadResult.detectedType,
      };

      if (spreadResult.warnings.length > 0) {
        spreadResult.warnings.forEach((msg) => {
          warnings.push({
            code: WarningCode.MIXED_PDF,
            message: msg,
            autoFixable: false,
          });
        });
      }

      // 12. CMYK 2단계 검증 (WBS 3.0)
      // 파일 경로 계산 (Ghostscript inkcov용) — `/storage/`, `storage/` 양쪽 모두 정규화
      const inputPath = this.resolveLocalPath(fileUrl);

      const colorModeResult = await this.detectColorMode(
        pdfBytes,
        inputPath,
        options.fileType,
      );
      metadata.colorMode = colorModeResult.colorMode;

      // 후가공 파일 + CMYK 사용 = 에러 (별색만 허용)
      if (options.fileType === 'post_process' && colorModeResult.colorMode === 'CMYK') {
        errors.push({
          code: ErrorCode.POST_PROCESS_CMYK,
          message: '후가공 파일에 CMYK 색상이 사용되었습니다. 별색(Spot Color)만 허용됩니다.',
          details: {
            colorMode: colorModeResult.colorMode,
            signatures: colorModeResult.cmykStructure?.signatures,
          },
          autoFixable: false,
        });
      } else if (colorModeResult.colorMode === 'CMYK') {
        // 일반 인쇄 파일의 CMYK는 경고만
        warnings.push({
          code: WarningCode.CMYK_STRUCTURE_DETECTED,
          message: 'CMYK 색상 모드가 감지되었습니다. 인쇄 품질을 위해 확인해주세요.',
          details: {
            signatures: colorModeResult.cmykStructure?.signatures,
            confidence: colorModeResult.confidence,
          },
          autoFixable: false,
        });
      }

      // 13. 별색(Spot Color) 감지 (WBS 4.1)
      const spotColorResult = await detectSpotColors('', pdfBytes);
      metadata.hasSpotColors = spotColorResult.hasSpotColors;
      metadata.spotColors = spotColorResult.spotColorNames;

      if (spotColorResult.hasSpotColors) {
        this.logger.debug(
          `Spot colors detected: ${spotColorResult.spotColorNames.join(', ')}`,
        );
        // 별색은 후가공 파일에서는 정상, 일반 파일에서는 정보성 메시지
      }

      // 14. 투명도/오버프린트 감지 (WBS 4.2)
      const transparencyResult = await detectTransparencyAndOverprint('', pdfBytes);
      metadata.hasTransparency = transparencyResult.hasTransparency;
      metadata.hasOverprint = transparencyResult.hasOverprint;

      if (transparencyResult.hasTransparency) {
        warnings.push({
          code: WarningCode.TRANSPARENCY_DETECTED,
          message: '투명도 효과가 포함되어 있습니다. 인쇄 시 예상과 다른 결과가 나올 수 있습니다.',
          details: { pages: transparencyResult.pages },
          autoFixable: false,
        });
      }
      if (transparencyResult.hasOverprint) {
        warnings.push({
          code: WarningCode.OVERPRINT_DETECTED,
          message: '오버프린트 설정이 포함되어 있습니다. 인쇄 시 색상이 혼합될 수 있습니다.',
          details: { pages: transparencyResult.pages },
          autoFixable: false,
        });
      }

      // 15. 이미지 해상도 감지
      const resolutionResult = await detectImageResolutionFromPdf(
        pdfBytes,
        VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
      );

      // 메타데이터에 해상도 정보 업데이트
      metadata.imageCount = resolutionResult.imageCount;
      if (resolutionResult.imageCount > 0) {
        metadata.resolution = resolutionResult.minResolution;

        if (resolutionResult.hasLowResolution) {
          const lowResCount = resolutionResult.lowResImages.length;
          warnings.push({
            code: WarningCode.RESOLUTION_LOW,
            message: `${lowResCount}개의 이미지가 권장 해상도(${VALIDATION_CONFIG.RECOMMENDED_DPI}DPI) 미만입니다. 인쇄 품질이 저하될 수 있습니다.`,
            details: {
              minResolution: resolutionResult.minResolution,
              avgResolution: resolutionResult.avgResolution,
              recommendedDpi: VALIDATION_CONFIG.RECOMMENDED_DPI,
              lowResImages: resolutionResult.lowResImages.map((img) => ({
                index: img.index,
                pixelSize: `${img.pixelWidth}x${img.pixelHeight}`,
                effectiveDpi: img.minEffectiveDpi,
              })),
            },
            autoFixable: false,
          });
        }
      }

      this.logger.log(
        `Validation complete: ${errors.length === 0 ? 'PASS' : 'FAIL'} (errors: ${errors.length}, warnings: ${warnings.length})`,
      );

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        metadata,
      };
    } catch (error) {
      this.logger.error(`Validation failed: ${error.message}`, error.stack);
      errors.push({
        code: ErrorCode.FILE_CORRUPTED,
        message: `파일 처리 중 오류가 발생했습니다: ${error.message}`,
        details: { actual: error.message },
        autoFixable: false,
      });
      return { isValid: false, errors, warnings, metadata };
    }
  }

  /**
   * 페이지 수 검증
   */
  private validatePageCount(
    actualPages: number,
    options: ValidationOptions,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const expectedPages = options.orderOptions.pages;

    // 최대 페이지 수 초과
    if (actualPages > maxPages) {
      errors.push({
        code: ErrorCode.PAGE_COUNT_EXCEEDED,
        message: `페이지 수가 최대 허용치(${maxPages}페이지)를 초과합니다.`,
        details: {
          expected: maxPages,
          actual: actualPages,
        },
        autoFixable: false,
      });
      return;
    }

    if (options.fileType === 'cover') {
      // 표지: 2페이지 (앞뒤) 또는 4페이지 (펼침면)
      if (actualPages !== 2 && actualPages !== 4 && actualPages !== 1) {
        errors.push({
          code: ErrorCode.PAGE_COUNT_INVALID,
          message: `표지 PDF는 1, 2 또는 4페이지여야 합니다. (현재: ${actualPages}페이지)`,
          details: {
            expected: [1, 2, 4],
            actual: actualPages,
          },
          autoFixable: false,
        });
      }
    } else if (options.fileType === 'content') {
      const binding = options.orderOptions.binding;

      // 무선제본: 4의 배수
      if (binding === 'perfect' && actualPages % 4 !== 0) {
        errors.push({
          code: ErrorCode.PAGE_COUNT_INVALID,
          message: `무선제본은 페이지 수가 4의 배수여야 합니다. (현재: ${actualPages}페이지)`,
          details: {
            expected: Math.ceil(actualPages / 4) * 4,
            actual: actualPages,
          },
          autoFixable: true,
          fixMethod: 'addBlankPages',
        });
      }

      // 중철제본: 4의 배수, 최대 64페이지
      if (binding === 'saddle') {
        if (actualPages % 4 !== 0) {
          errors.push({
            code: ErrorCode.PAGE_COUNT_INVALID,
            message: `중철제본은 페이지 수가 4의 배수여야 합니다. (현재: ${actualPages}페이지)`,
            details: {
              expected: Math.ceil(actualPages / 4) * 4,
              actual: actualPages,
            },
            autoFixable: true,
            fixMethod: 'addBlankPages',
          });
        }
        if (actualPages > 64) {
          errors.push({
            code: ErrorCode.PAGE_COUNT_EXCEEDED,
            message: `중철제본은 최대 64페이지까지 가능합니다. (현재: ${actualPages}페이지)`,
            details: {
              expected: 64,
              actual: actualPages,
            },
            autoFixable: false,
          });
        }
      }

      // 주문 페이지 수와 다른 경우 경고
      if (actualPages !== expectedPages) {
        warnings.push({
          code: WarningCode.PAGE_COUNT_MISMATCH,
          message: `주문한 페이지 수(${expectedPages}페이지)와 다릅니다. (현재: ${actualPages}페이지)`,
          details: {
            expected: expectedPages,
            actual: actualPages,
          },
          autoFixable: actualPages < expectedPages,
          fixMethod: actualPages < expectedPages ? 'addBlankPages' : undefined,
        });
      }
    }
  }

  /**
   * 페이지 크기 검증
   */
  private validatePageSize(
    widthMm: number,
    heightMm: number,
    options: ValidationOptions,
    errors: ValidationError[],
    metadata: PdfMetadata,
  ): void {
    const expectedWidth = options.orderOptions.size.width;
    const expectedHeight = options.orderOptions.size.height;
    const bleed = options.orderOptions.bleed ?? DEFAULT_BLEED;

    // 허용 오차 1mm
    const tolerance = 1;

    // 재단 여백 포함 크기
    const expectedWidthWithBleed = expectedWidth + bleed * 2;
    const expectedHeightWithBleed = expectedHeight + bleed * 2;

    // 크기 비교
    const widthDiff = Math.abs(widthMm - expectedWidth);
    const heightDiff = Math.abs(heightMm - expectedHeight);
    const widthDiffWithBleed = Math.abs(widthMm - expectedWidthWithBleed);
    const heightDiffWithBleed = Math.abs(heightMm - expectedHeightWithBleed);

    const matchesWithoutBleed = widthDiff <= tolerance && heightDiff <= tolerance;
    const matchesWithBleed =
      widthDiffWithBleed <= tolerance && heightDiffWithBleed <= tolerance;

    if (!matchesWithoutBleed && !matchesWithBleed) {
      errors.push({
        code: ErrorCode.SIZE_MISMATCH,
        message: `페이지 크기가 맞지 않습니다. (기대: ${expectedWidth}x${expectedHeight}mm 또는 ${expectedWidthWithBleed}x${expectedHeightWithBleed}mm, 현재: ${Math.round(widthMm)}x${Math.round(heightMm)}mm)`,
        details: {
          expected: {
            withoutBleed: { width: expectedWidth, height: expectedHeight },
            withBleed: { width: expectedWidthWithBleed, height: expectedHeightWithBleed },
          },
          actual: { width: Math.round(widthMm * 10) / 10, height: Math.round(heightMm * 10) / 10 },
        },
        autoFixable: true,
        fixMethod: 'resizeWithPadding',
      });
    } else if (matchesWithBleed) {
      metadata.hasBleed = true;
      metadata.bleedSize = bleed;
    }
  }

  /**
   * 재단 여백 검증
   */
  private validateBleed(
    widthMm: number,
    heightMm: number,
    options: ValidationOptions,
    warnings: ValidationWarning[],
    metadata: PdfMetadata,
  ): void {
    const expectedBleed = options.orderOptions.bleed ?? DEFAULT_BLEED;

    if (expectedBleed > 0 && !metadata.hasBleed) {
      warnings.push({
        code: WarningCode.BLEED_MISSING,
        message: `${expectedBleed}mm 재단 여백이 권장되지만 포함되어 있지 않습니다. 재단 시 테두리가 잘릴 수 있습니다.`,
        details: {
          expected: expectedBleed,
          actual: 0,
        },
        autoFixable: true,
        fixMethod: 'extendBleed',
      });
    }
  }

  /**
   * 책등 크기 검증 (표지용)
   */
  private validateSpine(
    widthMm: number,
    options: ValidationOptions,
    errors: ValidationError[],
    metadata: PdfMetadata,
  ): void {
    const { size, pages, paperThickness, spineWidthMm, wingEnabled, wingWidthMm } =
      options.orderOptions;

    // 책등 폭 결정:
    //  1) spineWidthMm (프런트가 /products/spine/calculate 로 계산한 권위 값, bindingMargin 포함) 우선
    //  2) 없으면 paperThickness 로 fallback 재계산 (레거시 호환). 둘 다 없으면 검증 생략.
    let expectedSpine: number;
    if (typeof spineWidthMm === 'number' && spineWidthMm >= 0) {
      expectedSpine = Math.round(spineWidthMm * 10) / 10;
    } else if (paperThickness) {
      // ⚠️ fallback 공식은 bindingMargin 을 모르므로 권위 공식보다 작을 수 있음(허용 오차로 흡수).
      expectedSpine = Math.round(paperThickness * (pages / 2) * 10) / 10;
    } else {
      return; // 책등 정보 없음 → 검증 생략
    }
    metadata.spineSize = expectedSpine;

    // 날개(wing) 폭: 사용 시 양쪽(×2) 가산. 미사용/미전달이면 0 → 레거시 동작 동일.
    const wingTotal =
      wingEnabled && typeof wingWidthMm === 'number' && wingWidthMm > 0
        ? wingWidthMm * 2
        : 0;

    // 표지 전체 너비 (앞표지 + 책등 + 뒤표지 + 날개×2 + 재단여백×2)
    const bleed = options.orderOptions.bleed ?? DEFAULT_BLEED;
    const expectedTotalWidth = size.width * 2 + expectedSpine + wingTotal + bleed * 2;

    // 허용 오차 2mm (책등은 좀 더 여유롭게)
    const tolerance = 2;

    if (Math.abs(widthMm - expectedTotalWidth) > tolerance) {
      errors.push({
        code: ErrorCode.SPINE_SIZE_MISMATCH,
        message: `표지 크기가 책등${wingTotal > 0 ? '·날개' : ''} 크기와 맞지 않습니다. (예상 전체 너비: ${Math.round(expectedTotalWidth)}mm, 현재: ${Math.round(widthMm)}mm)`,
        details: {
          expected: {
            totalWidth: Math.round(expectedTotalWidth),
            spine: expectedSpine,
            spineSource: typeof spineWidthMm === 'number' ? 'provided' : 'recalculated',
            wingTotal,
          },
          actual: {
            totalWidth: Math.round(widthMm),
          },
        },
        autoFixable: true,
        fixMethod: 'adjustSpine',
      });
    }
  }

  /**
   * 로컬 파일 경로 정규화
   *
   * 입력 URL/경로 종류:
   *  - "storage/uploads/..."   → ${WORKER_STORAGE_PATH}/storage/uploads/...
   *  - "/storage/uploads/..."  → ${WORKER_STORAGE_PATH}/storage/uploads/...  (선행 슬래시 제거 후 동일)
   *  - "/app/storage/..."      → 그대로 (이미 절대 경로)
   *  - "./relative/..."        → 그대로
   *
   * API가 반환하는 fileUrl은 HTTP 서빙용 `/storage/...` 형태이므로 워커가 받으면 ENOENT가 발생.
   * 본 메서드가 두 형태(`/storage/...`, `storage/...`)를 모두 WORKER_STORAGE_PATH 기준으로 정규화.
   */
  resolveLocalPath(url: string): string {
    const storageBase = process.env.WORKER_STORAGE_PATH || '../api';
    // /storage/... 또는 storage/... 양쪽 모두 처리
    if (url.startsWith('/storage/')) {
      return `${storageBase}${url}`; // /app + /storage/... → /app/storage/...
    }
    if (url.startsWith('storage/')) {
      return `${storageBase}/${url}`;
    }
    return url;
  }

  /**
   * 파일 다운로드
   */
  private async downloadFile(url: string): Promise<Uint8Array> {
    // 로컬 파일 경로인 경우 (절대 경로, 상대 경로, storage/ 또는 /storage/ 경로)
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('storage/')) {
      const filePath = this.resolveLocalPath(url);
      this.logger.log(`Reading local file: ${filePath}`);
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    }

    // URL에서 다운로드
    this.logger.log(`Downloading from URL: ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60초 타임아웃
    });

    return new Uint8Array(response.data);
  }

  // ============================================================
  // WBS 2.0: pdf-lib 기반 기능
  // @see docs/PDF_VALIDATION_WBS.md
  // ============================================================

  /**
   * WBS 2.1: 가로형 페이지 감지
   * 모든 페이지를 검사하여 가로형(landscape) 페이지가 있으면 경고
   */
  private validatePageOrientation(
    pages: PDFPage[],
    warnings: ValidationWarning[],
  ): void {
    const { PT_TO_MM } = VALIDATION_CONFIG;

    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      const widthMm = width * PT_TO_MM;
      const heightMm = height * PT_TO_MM;

      const isLandscape = widthMm > heightMm;

      if (isLandscape) {
        warnings.push({
          code: WarningCode.LANDSCAPE_PAGE,
          message: `${index + 1}페이지가 가로형입니다.`,
          details: {
            page: index + 1,
            width: Math.round(widthMm * 10) / 10,
            height: Math.round(heightMm * 10) / 10,
            orientation: 'landscape',
          },
          autoFixable: false,
        });
      }
    });
  }

  /**
   * WBS 2.2: 사철 제본 검증
   * 사철 제본은 4의 배수, 최대 64페이지
   */
  private validateSaddleStitch(
    pageCount: number,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const { SADDLE_STITCH_MAX_PAGES } = VALIDATION_CONFIG;

    // 4의 배수 검증
    if (pageCount % 4 !== 0) {
      errors.push({
        code: ErrorCode.SADDLE_STITCH_INVALID,
        message: `사철 제본은 페이지 수가 4의 배수여야 합니다. (현재: ${pageCount}페이지)`,
        details: {
          pageCount,
          required: 'multiple of 4',
          suggestion: Math.ceil(pageCount / 4) * 4,
        },
        autoFixable: true,
        fixMethod: 'addBlankPages',
      });
    }

    // 최대 페이지 수 검증
    if (pageCount > SADDLE_STITCH_MAX_PAGES) {
      errors.push({
        code: ErrorCode.PAGE_COUNT_EXCEEDED,
        message: `사철 제본은 최대 ${SADDLE_STITCH_MAX_PAGES}페이지까지 가능합니다. (현재: ${pageCount}페이지)`,
        details: {
          pageCount,
          maxAllowed: SADDLE_STITCH_MAX_PAGES,
        },
        autoFixable: false,
      });
    }

    // 중앙부 객체 확인 경고
    warnings.push({
      code: WarningCode.CENTER_OBJECT_CHECK,
      message: '사철 제본 시 중앙부(접지 부분)에 중요 객체가 배치되어 있는지 확인해주세요.',
      autoFixable: false,
    });
  }

  /**
   * WBS 2.3: 스프레드(펼침면) 감지
   * 점수 기반으로 스프레드 형식 여부를 판별
   */
  private detectSpreadFormat(
    pages: PDFPage[],
    expectedSingleWidthMm?: number,
    expectedHeightMm?: number,
    bleedMm: number = 3,
  ): SpreadDetectionResult {
    const { PT_TO_MM, SPREAD_SCORE_THRESHOLD, SIZE_TOLERANCE_MM } = VALIDATION_CONFIG;

    let score = 0;
    const warnings: string[] = [];

    // 스프레드는 양쪽 페이지에 각각 재단여백이 적용되므로 허용 오차 계산 수정
    // 높이: 상하 재단여백 (bleed * 2) + 허용오차
    const heightTolerance = bleedMm * 2 + SIZE_TOLERANCE_MM;
    // 너비: 스프레드의 경우 좌우 각 페이지에 재단여백 (bleed * 4) + 허용오차
    const spreadWidthTolerance = bleedMm * 4 + SIZE_TOLERANCE_MM;

    // 페이지별 크기 수집
    const pageSizes = pages.map((page, idx) => {
      const { width, height } = page.getSize();
      return {
        index: idx,
        widthMm: width * PT_TO_MM,
        heightMm: height * PT_TO_MM,
        ratio: width / height,
      };
    });

    // 1차: 규격 기반 판별 (+60점)
    if (expectedSingleWidthMm && expectedHeightMm) {
      // 이미 스프레드 너비로 전달된 경우 (너비 > 높이) 그대로 사용
      // 단일 페이지 너비로 전달된 경우 2배로 계산
      const isAlreadySpreadWidth = expectedSingleWidthMm > expectedHeightMm * 1.2;
      const expectedSpreadWidth = isAlreadySpreadWidth
        ? expectedSingleWidthMm
        : expectedSingleWidthMm * 2;

      const matchingPages = pageSizes.filter(
        (p) =>
          Math.abs(p.widthMm - expectedSpreadWidth) <= spreadWidthTolerance &&
          Math.abs(p.heightMm - expectedHeightMm) <= heightTolerance,
      );

      if (matchingPages.length === pageSizes.length) {
        score += 60;
      } else if (matchingPages.length / pageSizes.length >= 0.9) {
        score += 50;
      }

      // 높이 일치 (+20점)
      const heightMatch = pageSizes.filter(
        (p) => Math.abs(p.heightMm - expectedHeightMm) <= heightTolerance,
      );
      if (heightMatch.length === pageSizes.length) {
        score += 20;
      }
    }

    // 2차: 비율 기반 판별 (+15점)
    const avgRatio =
      pageSizes.reduce((sum, p) => sum + p.ratio, 0) / pageSizes.length;
    if (avgRatio > 1.25) {
      score += 15;
    }

    // 3차: 페이지 일관성 (+10점)
    const widths = pageSizes.map((p) => p.widthMm);
    const widthStd = this.standardDeviation(widths);
    if (widthStd < 1) {
      score += 10;
    }

    // 판정
    const isSpread = score >= SPREAD_SCORE_THRESHOLD;
    const confidence: 'high' | 'medium' | 'low' =
      score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';

    // 혼합 PDF 감지
    let detectedType: 'single' | 'spread' | 'mixed' = isSpread
      ? 'spread'
      : 'single';
    if (widthStd > 10) {
      detectedType = 'mixed';
      warnings.push('표지/내지 혼합 PDF로 감지되었습니다.');
    }

    this.logger.debug(
      `Spread detection: score=${score}, isSpread=${isSpread}, type=${detectedType}, confidence=${confidence}`,
    );

    return {
      isSpread,
      score,
      confidence,
      detectedType,
      warnings,
    };
  }

  /**
   * 표준편차 계산 유틸리티
   */
  private standardDeviation(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(
      arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length,
    );
  }

  // ============================================================
  // WBS 3.0: CMYK 2단계 검증
  // @see docs/PDF_VALIDATION_WBS.md
  // ============================================================

  /**
   * WBS 3.1: 1차 구조적 CMYK 감지
   * PDF 바이너리에서 CMYK 관련 시그니처를 검색
   */
  private detectCmykStructure(pdfBytes: Uint8Array): CmykStructureResult {
    const signatures: string[] = [];

    // PDF를 latin1 문자열로 디코딩 (바이너리 안전)
    const pdfString = new TextDecoder('latin1').decode(pdfBytes);

    // DeviceCMYK 검색 - 직접 CMYK 색상 공간 사용
    if (pdfString.includes('/DeviceCMYK')) {
      signatures.push('DeviceCMYK');
    }

    // CMYK ICC 프로파일 검색 (/ICCBased + /N 4)
    if (pdfString.includes('/ICCBased') && pdfString.includes('/N 4')) {
      signatures.push('CMYK_ICC_Profile');
    }

    // CMYK 이미지 검색
    if (/\/ColorSpace\s*\/DeviceCMYK/.test(pdfString)) {
      signatures.push('CMYK_Image');
    }

    // 별색(Separation) 검색
    if (pdfString.includes('/Separation')) {
      signatures.push('Separation_SpotColor');
    }

    // DeviceN (다중 색상) 검색
    if (pdfString.includes('/DeviceN')) {
      signatures.push('DeviceN');
    }

    const hasCmykSignature = signatures.length > 0;
    const suspectedCmyk = signatures.some(
      (s) =>
        s === 'DeviceCMYK' || s === 'CMYK_ICC_Profile' || s === 'CMYK_Image',
    );

    this.logger.debug(
      `CMYK structure detection: signatures=${signatures.join(', ')}, suspected=${suspectedCmyk}`,
    );

    return {
      hasCmykSignature,
      suspectedCmyk,
      signatures,
    };
  }

  /**
   * WBS 3.3: 통합 컬러 모드 감지
   * 1차 구조 감지 → 조건부 2차 GS inkcov 분석
   */
  async detectColorMode(
    pdfBytes: Uint8Array,
    inputPath: string,
    fileType?: string,
  ): Promise<ColorModeResult> {
    const warnings: string[] = [];

    // 1차: 구조적 CMYK 감지
    const cmykStructure = this.detectCmykStructure(pdfBytes);

    // CMYK 시그니처가 없으면 RGB로 판정 (GS 호출 생략)
    if (!cmykStructure.suspectedCmyk) {
      this.logger.debug('No CMYK structure detected, assuming RGB');
      return {
        colorMode: 'RGB',
        confidence: 'medium',
        cmykStructure,
        warnings: ['CMYK 구조가 감지되지 않았습니다.'],
      };
    }

    // 2차: Ghostscript inkcov 분석
    try {
      // GS 사용 가능 여부 확인
      const gsAvailable = await isGhostscriptAvailable();
      if (!gsAvailable) {
        warnings.push('Ghostscript를 사용할 수 없어 구조 기반으로 추정합니다.');
        return {
          colorMode: 'CMYK',
          confidence: 'low',
          cmykStructure,
          warnings,
        };
      }

      // 파일 크기 확인 - 대형 파일은 GS 분석 생략
      const fileSize = pdfBytes.length;
      if (fileSize > VALIDATION_CONFIG.LARGE_FILE_THRESHOLD) {
        warnings.push(
          `파일이 ${Math.round(fileSize / 1024 / 1024)}MB로 대형 파일입니다. 구조 기반으로 추정합니다.`,
        );
        return {
          colorMode: 'CMYK',
          confidence: 'low',
          cmykStructure,
          warnings,
        };
      }

      // inkcov 분석 실행
      const inkCoverage = await detectCmykUsage(inputPath);

      // 후가공 파일 + CMYK 사용 = 오류 (별도 처리 필요시 여기서 throw)
      if (fileType === 'post_process' && inkCoverage.totalCmykUsage) {
        this.logger.warn('Post-process file contains CMYK colors');
        // 에러는 호출자에서 처리하도록 결과에 포함
        warnings.push(
          '후가공 파일에 CMYK 색상이 감지되었습니다. 별색(Spot Color)만 사용해주세요.',
        );
      }

      // 별색 포함 여부 확인
      if (cmykStructure.signatures.includes('Separation_SpotColor')) {
        warnings.push('별색(Spot Color)이 포함되어 있습니다.');
      }

      return {
        colorMode: inkCoverage.colorMode,
        confidence: 'high',
        cmykStructure,
        inkCoverage,
        warnings,
      };
    } catch (error) {
      // GS 실패 시 폴백
      this.logger.warn(`Ghostscript analysis failed: ${error.message}`);
      warnings.push('Ghostscript 분석 실패, 구조 기반 추정');

      return {
        colorMode: cmykStructure.suspectedCmyk ? 'CMYK' : 'RGB',
        confidence: 'low',
        cmykStructure,
        warnings,
      };
    }
  }
}
