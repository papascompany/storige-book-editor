import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFPage } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
import {
  VALIDATION_CONFIG,
  DEFAULT_BLEED_MM,
  LEGACY_SIZE_TOLERANCE_MM,
} from '../config/validation.config';
import {
  detectCmykUsage,
  isGhostscriptAvailable,
  detectSpotColors,
  detectTransparencyAndOverprint,
  detectImageResolutionFromPdf,
  detectFonts,
} from '../utils/ghostscript';
// 트랙 B-(d) 경량(ON) 검증 경로 전용 유틸 (OFF 경로는 import 만 하고 사용하지 않음).
import { downloadToTempFile } from '../utils/stream-download';
import { assertSafeDownloadUrl } from '../utils/url-safety';
import {
  extractPdfMetadataQpdf,
  QpdfMetadataResult,
} from '../utils/pdf-metadata-qpdf';
import { scanPdfStreaming } from '../utils/streaming-pdf-scan';
import { SpotColorResult, TransparencyResult, ImageResolutionResult, FontDetectionResult } from '../dto/validation-result.dto';

// 기본 설정 (VALIDATION_CONFIG에서 가져오거나 폴백)
const DEFAULT_MAX_FILE_SIZE = VALIDATION_CONFIG.MAX_FILE_SIZE;
const DEFAULT_MAX_PAGES = 1000;
// C-2b: 로컬 상수 `DEFAULT_BLEED = 3` 을 삭제하고 validation.config.ts 의
// DEFAULT_BLEED_MM(=3) import 로 치환(값-동일 리팩터, 행동 무변화).
// 사용처는 `orderOptions.bleed ?? DEFAULT_BLEED_MM`.

/** C-2a: 정규화된 박스 사각형(pt) — x/y 는 좌하단, width/height 는 항상 양수. */
interface BoxRectPt {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * C-2a: 첫 페이지 박스 기하 — validateCropMarks 입력.
 * authoritative=false 면 trim/bleed 존재 판정을 신뢰할 수 없어(추출 실패·pdfinfo 폴백 등)
 * 검증을 skip 한다(TRIMBOX_MISSING 허위 경고 오탐 방지).
 */
interface FirstPageBoxes {
  mediaBox?: BoxRectPt;
  trimBox?: BoxRectPt;
  bleedBox?: BoxRectPt;
  authoritative: boolean;
}

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

    // 트랙 B-(d): 경량(스트리밍) 검증 ON 경로. env WORKER_LIGHTWEIGHT_VALIDATION=true 일 때만
    // 진입한다. OFF(기본) 동작은 아래 본문 그대로 유지(파리티 보장).
    if (VALIDATION_CONFIG.LIGHTWEIGHT_VALIDATION) {
      return this.validateLightweight(fileUrl, options);
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const metadata: PdfMetadata = {
      pageCount: 0,
      pageSize: { width: 0, height: 0 },
      hasBleed: false,
      colorMode: 'RGB',
      resolution: 300,
    };

    // s3 백엔드(api://) 검증 시 inkcov 입력용으로 떨군 임시파일 경로. finally 에서 정리.
    let tmpToCleanup: string | null = null;

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
      // 0페이지 가드(P0-4): pages[0] 접근 전 차단. 없으면 firstPage.getSize() 가
      // TypeError 를 던져 상위 catch 가 FILE_CORRUPTED 로 오진한다.
      if (pages.length === 0) {
        errors.push({
          code: ErrorCode.PAGE_COUNT_INVALID,
          message: 'PDF에 페이지가 없습니다. (0페이지) 최소 1페이지 이상의 PDF를 업로드해주세요.',
          details: { expected: '>=1', actual: 0 },
          autoFixable: false,
        });
        return { isValid: false, errors, warnings, metadata };
      }
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

      // 6-b. C-2a: crop mark(재단 기하) 검증 — 이중 게이트(orderOptions.cropMarkEnabled
      // opt-in + env WORKER_CROP_MARK_VALIDATION 킬스위치 기본 OFF), 전부 warning(비차단).
      // 게이트 통과 전에는 박스 추출조차 하지 않아 기본 경로 행동 변화 0.
      // ⚠️ pdf-lib page.getTrimBox() 는 부재 시 CropBox/MediaBox 로 폴백하므로
      //    '명시 존재' 판별을 위해 page.node 직독(extractFirstPageBoxesPdfLib)을 쓴다.
      if (this.isCropMarkValidationEnabled(options)) {
        this.validateCropMarks(
          this.extractFirstPageBoxesPdfLib(firstPage),
          options,
          warnings,
          metadata,
        );
      }

      // 7. 재단 여백 검증
      this.validateBleed(widthMm, heightMm, options, warnings, metadata);

      // 8. 책등 크기 검증 (표지인 경우)
      if (options.fileType === 'cover') {
        this.validateSpine(widthMm, options, errors, metadata);
      }

      // 9. 페이지 방향 검증 (WBS 2.1, R3 집계형 재구현)
      this.validatePageOrientation(
        pages,
        warnings,
        options.orderOptions.expectedOrientation,
      );

      // 10. 사철 제본 검증 (WBS 2.2). 데이터 주도 페이지규칙 활성 시 페이지수 검사는 validatePageCount 소유.
      if (options.orderOptions.binding === 'saddle') {
        const dd =
          options.orderOptions.pageMultiple != null ||
          options.orderOptions.pageCountMax != null ||
          options.orderOptions.pageCountMin != null;
        this.validateSaddleStitch(pages.length, errors, warnings, dd);
      }

      // 11. 스프레드(펼침면) 감지 (WBS 2.3)
      const spreadResult = this.detectSpreadFormat(
        pages,
        options.orderOptions.size.width,
        options.orderOptions.size.height,
        options.orderOptions.bleed ?? DEFAULT_BLEED_MM,
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

      // 12~16. 색상모드(CMYK/GS)·별색·투명도/오버프린트·이미지해상도·폰트임베딩 검출.
      // 다섯 검출은 서로 독립(동일 pdfBytes 만 읽음)이므로 병렬 실행한다.
      // detectColorMode 의 Ghostscript inkcov 자식프로세스 대기 시간이 나머지 JS 파싱과
      // 겹쳐 wall-time 이 '가장 느린 1개'로 수렴 → 검증 체감 속도 개선.
      // 파일 경로 계산 (Ghostscript inkcov용) — `/storage/`, `storage/` 양쪽 모두 정규화.
      // s3 백엔드(api://)는 로컬 경로가 없으므로 이미 받은 pdfBytes 를 임시파일로 떨궈
      // 그 경로를 inkcov 입력으로 사용한다(검증 종료 시 정리).
      let inputPath: string;
      if (fileUrl.startsWith('api://')) {
        tmpToCleanup = path.join(
          os.tmpdir(),
          `validate_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
        );
        await fs.writeFile(tmpToCleanup, Buffer.from(pdfBytes));
        inputPath = tmpToCleanup;
      } else {
        inputPath = this.resolveLocalPath(fileUrl);
      }

      const [
        colorModeResult,
        spotColorResult,
        transparencyResult,
        resolutionResult,
        fontResult,
      ] = await Promise.all([
        this.detectColorMode(pdfBytes, inputPath, options.fileType),
        detectSpotColors('', pdfBytes),
        detectTransparencyAndOverprint('', pdfBytes),
        detectImageResolutionFromPdf(pdfBytes, VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI),
        // detectFonts 는 자체 try/catch 로 실패 시 안전기본값(hasUnembeddedFonts:false)을
        // 반환하므로 추가 가드 없이 결과를 그대로 사용한다.
        detectFonts(pdfBytes),
      ]);

      // 12~16. 색상/별색/투명도/해상도/폰트 검출 결과 → errors/warnings/metadata 매핑.
      // OFF·ON 양쪽이 동일 로직을 쓰도록 단일 메서드로 추출(중복 제거·드리프트 방지).
      this.applyDetectionWarnings(
        colorModeResult,
        spotColorResult,
        transparencyResult,
        resolutionResult,
        fontResult,
        options,
        errors,
        warnings,
        metadata,
      );

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
    } finally {
      // s3 백엔드 검증용 임시파일 정리(존재할 때만). 실패해도 검증 결과에 영향 없음.
      if (tmpToCleanup) {
        await fs.unlink(tmpToCleanup).catch(() => {});
      }
    }
  }

  /**
   * 검출 결과(색상모드/별색/투명도/해상도/폰트)를 errors/warnings/metadata 에 매핑.
   *
   * validate()(OFF)·validateLightweight()(ON) 두 경로가 동일 로직을 호출하도록 추출했다.
   * ⚠️ 이 메서드의 동작은 '추출 이전 validate() 의 12~16단계 블록'과 100% 동일해야 한다
   *    (메시지/details/푸시 순서/메타데이터 키 전부). 인쇄 품질 직결 → 임의 변경 금지.
   */
  private applyDetectionWarnings(
    colorModeResult: ColorModeResult,
    spotColorResult: SpotColorResult,
    transparencyResult: TransparencyResult,
    resolutionResult: ImageResolutionResult,
    fontResult: FontDetectionResult,
    options: ValidationOptions,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    metadata: PdfMetadata,
  ): void {
    // 12. 색상 모드 결과 처리
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

    // 13. 별색(Spot Color) 결과 처리 (WBS 4.1)
    metadata.hasSpotColors = spotColorResult.hasSpotColors;
    metadata.spotColors = spotColorResult.spotColorNames;

    if (spotColorResult.hasSpotColors) {
      this.logger.debug(
        `Spot colors detected: ${spotColorResult.spotColorNames.join(', ')}`,
      );
      // 별색은 후가공 파일에서는 정상(별색 인쇄가 정상 입력) → 경고 없음, CMYK 에러경로 불변.
      // 일반 인쇄 파일에서는 별색 인쇄가 별도 확인이 필요할 수 있으므로 비차단 노티.
      if (options.fileType !== 'post_process') {
        const spotColorNames = spotColorResult.spotColorNames;
        warnings.push({
          code: WarningCode.SPOT_COLOR_DETECTED,
          message: `별색(${spotColorNames.join(', ')})이 사용되었습니다. 별색 인쇄는 별도 확인이 필요할 수 있으니 주문 전 확인해 주세요.`,
          details: {
            spotColorNames,
            count: spotColorNames.length,
          },
          autoFixable: false,
        });
      }
    }

    // 14. 투명도/오버프린트 결과 처리 (WBS 4.2)
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

    // 15. 이미지 해상도 결과 처리
    metadata.imageCount = resolutionResult.imageCount;
    if (resolutionResult.imageCount > 0) {
      metadata.resolution = resolutionResult.minResolution;

      if (resolutionResult.hasLowResolution) {
        const lowResCount = resolutionResult.lowResImages.length;
        // 게이트는 MIN_ACCEPTABLE_DPI(150) 미만에서 발동한다. 메시지는 실제 게이트값과
        // 권장값(300)을 함께 명시해 "권장 미만"으로 인한 혼동을 없앤다. (게이트 임계값은 불변)
        warnings.push({
          code: WarningCode.RESOLUTION_LOW,
          message: `${lowResCount}개의 이미지가 최소 허용 해상도(${VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI}DPI) 미만입니다. 인쇄 품질 저하가 우려됩니다(권장 ${VALIDATION_CONFIG.RECOMMENDED_DPI}DPI).`,
          details: {
            minResolution: resolutionResult.minResolution,
            avgResolution: resolutionResult.avgResolution,
            minAcceptableDpi: VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
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

    // 16. 폰트 임베딩 결과 처리 (요구사항6)
    // detectFonts 는 정규식 기반(현행 방식)으로 폰트 객체를 스캔하며, 실패 시 안전기본값을
    // 반환하므로 별도 가드가 없다. 임베딩되지 않은 폰트는 인쇄소에서 글꼴 누락/치환을
    // 유발하므로 비차단 경고로 노출한다(기존 통과/에러 동작은 변경하지 않음).
    metadata.fontCount = fontResult.fontCount;
    metadata.hasUnembeddedFonts = fontResult.hasUnembeddedFonts;
    metadata.unembeddedFonts = fontResult.unembeddedFonts;

    if (fontResult.hasUnembeddedFonts) {
      const unembeddedFonts = fontResult.unembeddedFonts;
      this.logger.debug(
        `Unembedded fonts detected: ${unembeddedFonts.join(', ')}`,
      );
      warnings.push({
        code: WarningCode.FONT_NOT_EMBEDDED,
        message: `임베딩되지 않은 폰트가 ${unembeddedFonts.length}개 있습니다(${unembeddedFonts.join(', ')}). 폰트를 아웃라인 처리하거나 임베딩(서브셋 포함)해 다시 업로드해 주세요.`,
        details: {
          unembeddedFonts,
          fontCount: fontResult.fontCount,
        },
        autoFixable: false,
      });
    }
  }

  /**
   * 트랙 B-(d): 경량(스트리밍) 검증 ON 경로.
   *
   * 기존 validate()(OFF) 는 파일 전체를 메모리(Uint8Array)에 올리고 pdf-lib 로 load 하므로
   * 2GB 파일에서 OOM 이 난다. 이 경로는 같은 검증 규칙을 유지하되:
   *   - 다운로드: 스트림으로 임시파일에 흘려 상수 메모리(downloadToTempFile).
   *   - 메타/페이지치수: qpdf(extractPdfMetadataQpdf) — pdf-lib load 우회.
   *   - 검출 5종: 8MB 청크 스트리밍 스캔(scanPdfStreaming) — 전체버퍼 우회.
   * 결과(errors/warnings/metadata)는 OFF 경로와 **동일**해야 한다(파리티 하니스로 검증).
   */
  private async validateLightweight(
    fileUrl: string,
    options: ValidationOptions,
  ): Promise<ValidationResultDto> {
    // 초기화는 validate() 와 동일.
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const metadata: PdfMetadata = {
      pageCount: 0,
      pageSize: { width: 0, height: 0 },
      hasBleed: false,
      colorMode: 'RGB',
      resolution: 300,
    };

    // 스트림 다운로드(임시파일). 로컬 원본이면 복사 없이 경로만 잡고 cleanup 은 no-op.
    const dl = await downloadToTempFile(fileUrl);
    try {
      // 2. 파일 크기 검증 (OFF 와 동일 메시지/details/조기반환)
      const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
      if (dl.size > maxFileSize) {
        errors.push({
          code: ErrorCode.FILE_TOO_LARGE,
          message: `파일 크기가 ${Math.round(maxFileSize / 1024 / 1024)}MB를 초과합니다.`,
          details: {
            expected: maxFileSize,
            actual: dl.size,
          },
          autoFixable: false,
        });
        return { isValid: false, errors, warnings, metadata };
      }

      // 3. 메타데이터 추출(qpdf) + 손상 판정 (OFF 의 pdf-lib load 실패와 동일 의미)
      const meta = await extractPdfMetadataQpdf(dl.path);
      if (meta.corrupted) {
        errors.push({
          code: ErrorCode.FILE_CORRUPTED,
          message: '파일이 손상되었습니다. 다시 업로드해주세요.',
          details: {
            actual: 'qpdf: page extraction failed (corrupted or unreadable PDF)',
          },
          autoFixable: false,
        });
        return { isValid: false, errors, warnings, metadata };
      }

      // 페이지 객체 확보: qpdf 치수가 있으면 그대로(PDFPage 듀얼로 getSize 만 노출),
      // 드문 폴백(ok:false·corrupted:false = 로드 가능하나 치수 미해석)에서는 pdf-lib 로 치수만 보강.
      let pages: PDFPage[];
      if (meta.ok && meta.pages.length > 0) {
        pages = meta.pages.map(
          (d) => ({ getSize: () => ({ width: d.widthPt, height: d.heightPt }) }),
        ) as unknown as PDFPage[];
      } else {
        // 드문 폴백: qpdf+pdfinfo 둘 다 치수 미해석(파일은 로드 가능). pdf-lib 로 치수만 보강.
        // ⚠️ 전체버퍼 적재 경로 → 대형 파일은 거부(2GB OOM 차단, 상수메모리 불변식 보존).
        //    메타 추출이 전부 실패하는 극히 드문 경우이며, 큰 파일에서만 거부된다.
        if (dl.size > VALIDATION_CONFIG.LARGE_FILE_THRESHOLD) {
          throw new Error(
            `metadata unresolved for large file (${dl.size} bytes); refusing full-buffer fallback`,
          );
        }
        const buf = await fs.readFile(dl.path);
        pages = (await PDFDocument.load(buf)).getPages();
      }
      // pageCount: 정상(meta.ok)=qpdf npages, 폴백=pdf-lib pages.length(OFF 와 동일 단일소스).
      const pageCount =
        meta.ok && meta.pageCount > 0 ? meta.pageCount : pages.length;

      // 0페이지 가드(P0-4): OFF 와 파리티 유지 + pdf-lib 폴백분기 안전(qpdf 상위 가드가
      // 막아 도달은 드물지만, 폴백([])·파리티를 위해 양 경로 동일 적용).
      if (pages.length === 0) {
        errors.push({
          code: ErrorCode.PAGE_COUNT_INVALID,
          message: 'PDF에 페이지가 없습니다. (0페이지) 최소 1페이지 이상의 PDF를 업로드해주세요.',
          details: { expected: '>=1', actual: 0 },
          autoFixable: false,
        });
        return { isValid: false, errors, warnings, metadata };
      }
      // 4. 메타데이터(치수) — OFF 와 동일 (firstPage.getSize → mm 변환)
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();
      const widthMm = width * 0.352778;
      const heightMm = height * 0.352778;

      metadata.pageCount = pageCount;
      metadata.pageSize = {
        width: Math.round(widthMm * 10) / 10,
        height: Math.round(heightMm * 10) / 10,
      };

      // 5~11. 페이지/사이즈/블리드/책등/방향/사철/스프레드 검증 — OFF 와 동일 헬퍼.
      this.validatePageCount(pageCount, options, errors, warnings);
      this.validatePageSize(widthMm, heightMm, options, errors, metadata);
      // C-2a: crop mark(재단 기하) 검증(경량 경로) — OFF 와 동일 게이트/위치(validatePageSize 직후).
      // 1차: qpdf 추출 박스. 비신뢰(pdfinfo 폴백·간접참조 미해석)면 pdf-lib 실페이지
      // (위 폴백 분기에서 로드된 경우에만 node 존재)로 재시도, 그것도 없으면 skip(오탐 방지).
      if (this.isCropMarkValidationEnabled(options)) {
        let cropBoxes = this.extractFirstPageBoxesQpdf(meta);
        if (!cropBoxes.authoritative && firstPage.node) {
          cropBoxes = this.extractFirstPageBoxesPdfLib(firstPage);
        }
        this.validateCropMarks(cropBoxes, options, warnings, metadata);
      }
      this.validateBleed(widthMm, heightMm, options, warnings, metadata);
      if (options.fileType === 'cover') {
        this.validateSpine(widthMm, options, errors, metadata);
      }
      this.validatePageOrientation(
        pages,
        warnings,
        options.orderOptions.expectedOrientation,
      );
      if (options.orderOptions.binding === 'saddle') {
        const dd =
          options.orderOptions.pageMultiple != null ||
          options.orderOptions.pageCountMax != null ||
          options.orderOptions.pageCountMin != null;
        this.validateSaddleStitch(pageCount, errors, warnings, dd);
      }
      const spreadResult = this.detectSpreadFormat(
        pages,
        options.orderOptions.size.width,
        options.orderOptions.size.height,
        options.orderOptions.bleed ?? DEFAULT_BLEED_MM,
      );
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

      // 12~16. 검출 5종(스트리밍 스캔). 색상모드는 GS inkcov 경로를 OFF 와 동일하게 타되,
      // 1차 CMYK 구조·파일크기만 스캔 결과로 주입(전체버퍼 의존 제거).
      // 이미지 DPI 의 페이지 치수는 스캐너가 OFF 와 동일하게 '평문 첫 MediaBox/A4' 로 자체 결정한다
      // (qpdf widthMm/heightMm 주입 금지 — OFF detectImageResolutionFromPdf 와 파리티 위해).
      const scan = await scanPdfStreaming(dl.path, {
        minDpi: VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
      });
      const colorModeResult = await this.detectColorMode(
        new Uint8Array(0),
        dl.path,
        options.fileType,
        { cmykStructure: scan.cmyk as CmykStructureResult, fileSize: dl.size },
      );
      const spotColorResult = scan.spot;
      const transparencyResult = scan.transparency;
      const resolutionResult = scan.resolution;
      const fontResult = scan.fonts;

      // OFF·ON 공통 매핑(추출 메서드).
      this.applyDetectionWarnings(
        colorModeResult,
        spotColorResult,
        transparencyResult,
        resolutionResult,
        fontResult,
        options,
        errors,
        warnings,
        metadata,
      );

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
      // OFF catch 와 동일 메시지/형식.
      this.logger.error(`Validation failed: ${error.message}`, error.stack);
      errors.push({
        code: ErrorCode.FILE_CORRUPTED,
        message: `파일 처리 중 오류가 발생했습니다: ${error.message}`,
        details: { actual: error.message },
        autoFixable: false,
      });
      return { isValid: false, errors, warnings, metadata };
    } finally {
      await dl.cleanup();
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

      // ── 페이지수 단위 검증: 데이터 주도(2026-06-25) vs 레거시 폴백 ──
      // 파트너가 orderOptions.pageMultiple/pageCountMax/pageCountMin 중 하나라도 전달하면 그 값으로
      // 검증한다(worker 무수정으로 제본 taxonomy 확장 — 무선=2/양장=4/중철=4/스프링=8 등).
      // 셋 다 미전송이면 기존 binding 하드코딩(perfect/saddle=4·중철≤64·스프링 홀수경고)으로 폴백
      // — 현행 동작 byte-identical(임베드/기존 외부호출 무영향).
      const { pageMultiple, pageCountMax, pageCountMin } = options.orderOptions;
      const usesDataDriven =
        pageMultiple != null || pageCountMax != null || pageCountMin != null;

      if (usesDataDriven) {
        // (d1) 배수 위반 → 에러 + 자동수정(addBlankPages). bookmoa 모달이 고객 동의 받아 fix 트리거.
        if (pageMultiple && pageMultiple > 0 && actualPages % pageMultiple !== 0) {
          errors.push({
            code: ErrorCode.PAGE_COUNT_INVALID,
            message: `페이지 수가 ${pageMultiple}의 배수여야 합니다. (현재: ${actualPages}페이지)`,
            details: {
              expected: Math.ceil(actualPages / pageMultiple) * pageMultiple,
              actual: actualPages,
              pageMultiple,
            },
            autoFixable: true,
            fixMethod: 'addBlankPages',
          });
        }
        // 제본별 상한 초과 → 에러
        if (pageCountMax && pageCountMax > 0 && actualPages > pageCountMax) {
          errors.push({
            code: ErrorCode.PAGE_COUNT_EXCEEDED,
            message: `페이지 수가 최대 허용치(${pageCountMax}페이지)를 초과합니다. (현재: ${actualPages}페이지)`,
            details: {
              expected: pageCountMax,
              actual: actualPages,
            },
            autoFixable: false,
          });
        }
        // (d2) 제본별 하한 미만 → 경고(비차단, 고객 선택). 콘텐츠 추가는 고객 몫 = 자동수정 불가.
        if (pageCountMin && pageCountMin > 0 && actualPages < pageCountMin) {
          warnings.push({
            code: WarningCode.PAGE_COUNT_BELOW_MIN,
            message: `주문 상품의 최소 페이지(${pageCountMin}페이지)보다 적습니다. (현재: ${actualPages}페이지)`,
            details: {
              min: pageCountMin,
              actual: actualPages,
            },
            autoFixable: false,
          });
        }
      } else {
        // ── 레거시 폴백 (현행 byte-identical) ──
        // R5: 짝수책 경고 (비차단).
        // perfect/saddle 은 아래에서 4의 배수(=자동 짝수)를 PAGE_COUNT_INVALID 에러로 강제하므로
        // 홀수면 이미 에러로 커버됨 → 중복 push 금지. 반면 spring(스프링 제본)은 페이지수
        // 무검사라 홀수가 통과되므로, 여기서만 ODD_PAGE_COUNT 경고로 확인을 유도한다.
        // ⚠️ parity('오른쪽=홀수/왼쪽=짝수' 좌/우 면 배치)는 '검증'이 아니라 임포지션
        //    미리보기(모달②)의 책임 — 여기에 parity 검증을 넣지 말 것(시각 확인으로 분리).
        if (binding === 'spring' && actualPages % 2 !== 0) {
          warnings.push({
            code: WarningCode.ODD_PAGE_COUNT,
            message: `총 페이지가 홀수(${actualPages}면)입니다. 책자는 보통 짝수면으로 제작됩니다. 확인해 주세요.`,
            details: {
              actualPages,
              suggestion: actualPages + 1,
            },
            autoFixable: false,
          });
        }

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
      }

      // 주문 페이지 수와 다른 경우 경고 (데이터주도/레거시 공통)
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
    const bleed = options.orderOptions.bleed ?? DEFAULT_BLEED_MM;

    // 허용 오차 — P1/P4 가변화. 기본 LEGACY_SIZE_TOLERANCE_MM(=1mm, 현행) 유지.
    // ⚠️ DEFAULT_SIZE_TOLERANCE_MM(0.2) 로 좁히지 말 것 — 2026-06-10 실회귀 재발.
    const tolerance =
      options.orderOptions.sizeToleranceMm ?? LEGACY_SIZE_TOLERANCE_MM;

    // 재단 여백 포함 크기(기존 케이스 보존)
    const expectedWidthWithBleed = expectedWidth + bleed * 2;
    const expectedHeightWithBleed = expectedHeight + bleed * 2;

    // 작업 사이즈(P1) — workSize 제공 시 직접, 미제공 시 trim + bleedMm*2 로 파생.
    // 매칭(작업사이즈±허용오차 동일) 업로드를 검증에서도 정상으로 인정(업로드 passthrough 와 정합).
    const bleedMm = options.orderOptions.bleedMm;
    const trim = options.orderOptions.trimSize;
    const workSize =
      options.orderOptions.workSize ??
      (trim && typeof bleedMm === 'number'
        ? { width: trim.width + bleedMm * 2, height: trim.height + bleedMm * 2 }
        : undefined);

    // 크기 비교
    const widthDiff = Math.abs(widthMm - expectedWidth);
    const heightDiff = Math.abs(heightMm - expectedHeight);
    const widthDiffWithBleed = Math.abs(widthMm - expectedWidthWithBleed);
    const heightDiffWithBleed = Math.abs(heightMm - expectedHeightWithBleed);

    const matchesWithoutBleed = widthDiff <= tolerance && heightDiff <= tolerance;
    const matchesWithBleed =
      widthDiffWithBleed <= tolerance && heightDiffWithBleed <= tolerance;
    const matchesWorkSize =
      !!workSize &&
      Math.abs(widthMm - workSize.width) <= tolerance &&
      Math.abs(heightMm - workSize.height) <= tolerance;

    if (!matchesWithoutBleed && !matchesWithBleed && !matchesWorkSize) {
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
    } else if (matchesWorkSize && workSize) {
      // 작업사이즈(재단+블리드*2)와 동일 → 블리드 포함으로 판정.
      // bleedMm 가 있으면 그 값을, 없으면 파생식의 (work-trim)/2 를 bleedSize 로 기록.
      metadata.hasBleed = true;
      metadata.bleedSize =
        typeof bleedMm === 'number'
          ? bleedMm
          : trim
            ? Math.round(((workSize.width - trim.width) / 2) * 10) / 10
            : bleed;
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
    const expectedBleed = options.orderOptions.bleed ?? DEFAULT_BLEED_MM;

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

  // ============================================================
  // C-2a: crop mark(재단 기하) 검증 — warning-only, 이중 게이트
  // ============================================================

  /**
   * 이중 게이트: (1) 잡 opt-in — API TemplateSet.cropMarkEnabled===true 세션 또는
   * 외부 파트너가 orderOptions.cropMarkEnabled 를 명시 전송한 잡에서만,
   * (2) env WORKER_CROP_MARK_VALIDATION 킬스위치(**기본 OFF**, 카나리용).
   * 기본 상태(둘 중 하나라도 미충족)에서는 박스 추출조차 하지 않는다 — 행동 변화 0.
   */
  private isCropMarkValidationEnabled(options: ValidationOptions): boolean {
    return (
      options.orderOptions.cropMarkEnabled === true &&
      VALIDATION_CONFIG.CROP_MARK_VALIDATION
    );
  }

  /** [llx, lly, urx, ury](pt) → 정규화 사각형(음수 폭/역순 좌표 방어). */
  private normalizeBoxPt(nums: number[]): BoxRectPt {
    const [llx, lly, urx, ury] = nums;
    return {
      x: Math.min(llx, urx),
      y: Math.min(lly, ury),
      width: Math.abs(urx - llx),
      height: Math.abs(ury - lly),
    };
  }

  /**
   * OFF(pdf-lib) 경로 첫 페이지 박스 추출.
   * ⚠️ page.getTrimBox()/getBleedBox() 는 부재 시 CropBox→MediaBox 로 **폴백**하므로
   *    명시 존재 판별에 쓰면 안 된다(함정). page.node.TrimBox()/BleedBox() 는
   *    페이지 딕셔너리 lookupMaybe 직독 — 명시 부재 시 undefined 를 돌려준다.
   * 추출 중 예외(비정형 박스 배열 등)는 authoritative=false 로 강등해 검증을 skip 한다.
   */
  private extractFirstPageBoxesPdfLib(firstPage: PDFPage): FirstPageBoxes {
    try {
      const node = firstPage.node;
      const rectOf = (
        arr?: { asRectangle(): { x: number; y: number; width: number; height: number } },
      ): BoxRectPt | undefined => {
        if (!arr) return undefined;
        const r = arr.asRectangle();
        return this.normalizeBoxPt([r.x, r.y, r.x + r.width, r.y + r.height]);
      };
      return {
        mediaBox: rectOf(node.MediaBox()),
        trimBox: rectOf(node.TrimBox()),
        bleedBox: rectOf(node.BleedBox()),
        authoritative: true,
      };
    } catch (error) {
      this.logger.warn(
        `extractFirstPageBoxesPdfLib 실패 — crop mark 검증 skip: ${error.message}`,
      );
      return { authoritative: false };
    }
  }

  /** 경량(qpdf) 경로 첫 페이지 박스 추출 — extractPdfMetadataQpdf 산출을 정규화. */
  private extractFirstPageBoxesQpdf(meta: QpdfMetadataResult): FirstPageBoxes {
    const p0 = meta.ok ? meta.pages[0] : undefined;
    if (!p0 || !p0.boxesAuthoritative) {
      // pdfinfo 폴백(명시 여부 판별 불가) 또는 간접참조 미해석 → 비신뢰.
      return { authoritative: false };
    }
    return {
      mediaBox: p0.mediaBoxPt ? this.normalizeBoxPt(p0.mediaBoxPt) : undefined,
      trimBox: p0.trimBoxPt ? this.normalizeBoxPt(p0.trimBoxPt) : undefined,
      bleedBox: p0.bleedBoxPt ? this.normalizeBoxPt(p0.bleedBoxPt) : undefined,
      authoritative: true,
    };
  }

  /**
   * crop mark 검증 — "재단선이 그려져 있는가"가 아니라 "인쇄소가 재단 위치를 기계적으로
   * 확정할 수 있는 기하 정보(TrimBox)가 PDF에 선언돼 있는가"를 본다(1계층·결정적 검증만).
   * 렌더링/이미지 분석(그려진 마크의 위치·길이·색상 검사)은 범위 제외.
   *
   * 검증 3종(전부 **warning** — error 절대 금지, isValid/상태 판정 불변):
   *   (0) TrimBox 명시 존재            → 부재 시 TRIMBOX_MISSING(정보성)
   *   (1) TrimBox 크기 vs 주문 재단     → ±sizeToleranceMm 초과 시 TRIMBOX_SIZE_MISMATCH
   *   (2) TrimBox⊂MediaBox 포함관계 + BleedBox 존재 시 trim+bleed*2 크기 정합
   *       → 위반 시 TRIMBOX_BLEED_INCONSISTENT (두 위반을 1건으로 집계)
   *
   * error 승격은 파트너 명시 opt-in(데이터 주도 옵션) 없이는 금지 — 파트너 4종 라이브
   * 주문 흐름 차단 방지가 최우선. 편집기(jspdf) 산출 PDF 는 TrimBox 가 없어 opt-in 셋에서
   * TRIMBOX_MISSING 이 상시 발생할 수 있으므로 메시지는 '확인 불가(정보)' 톤을 유지한다.
   */
  private validateCropMarks(
    boxes: FirstPageBoxes,
    options: ValidationOptions,
    warnings: ValidationWarning[],
    metadata: PdfMetadata,
  ): void {
    if (!boxes.authoritative) return; // 판정 불가 — 오탐 방지 위해 조용히 skip

    const { PT_TO_MM } = VALIDATION_CONFIG;
    const round1 = (v: number): number => Math.round(v * 10) / 10;
    // 허용오차: cropMark opt-in 잡은 API 가 sizeToleranceMm(templateSet, 기본 0.2)을
    // 주입한다. 미탑재(외부 파트너 직전송 등)면 validatePageSize 와 동일한 레거시 1mm.
    const tolerance =
      options.orderOptions.sizeToleranceMm ?? LEGACY_SIZE_TOLERANCE_MM;

    // (0) TrimBox 명시 존재
    if (!boxes.trimBox) {
      metadata.hasCropMarkGeometry = false;
      warnings.push({
        code: WarningCode.TRIMBOX_MISSING,
        message:
          '재단선 확인 불가: PDF에 재단 기하(TrimBox)가 선언되어 있지 않습니다. 재단 위치는 주문 재단 사이즈 기준으로 처리됩니다.',
        details: { expected: 'TrimBox', actual: null },
        autoFixable: false,
      });
      return;
    }

    const trimWmm = boxes.trimBox.width * PT_TO_MM;
    const trimHmm = boxes.trimBox.height * PT_TO_MM;
    metadata.hasCropMarkGeometry = true;
    metadata.trimBox = { width: round1(trimWmm), height: round1(trimHmm) };

    // (1) TrimBox 크기 vs 주문 재단 사이즈 (trimSize 미제공 시 size=판형을 재단으로 간주)
    const expectedTrim = options.orderOptions.trimSize ?? options.orderOptions.size;
    if (
      expectedTrim &&
      (Math.abs(trimWmm - expectedTrim.width) > tolerance ||
        Math.abs(trimHmm - expectedTrim.height) > tolerance)
    ) {
      warnings.push({
        code: WarningCode.TRIMBOX_SIZE_MISMATCH,
        message: `선언된 재단 크기(TrimBox ${round1(trimWmm)}x${round1(trimHmm)}mm)가 주문 재단 사이즈(${expectedTrim.width}x${expectedTrim.height}mm)와 다릅니다. 재단 결과를 확인해 주세요.`,
        details: {
          expected: { width: expectedTrim.width, height: expectedTrim.height },
          actual: { width: round1(trimWmm), height: round1(trimHmm) },
          toleranceMm: tolerance,
        },
        autoFixable: false,
      });
    }

    // (2) 블리드 기하 정합 — 위반 2종을 1건(TRIMBOX_BLEED_INCONSISTENT)으로 집계.
    const issues: string[] = [];
    const details: Record<string, any> = {};
    const tolerancePt = tolerance / PT_TO_MM;

    // (2-a) TrimBox ⊂ MediaBox 포함관계 (±tolerance 여유)
    if (boxes.mediaBox) {
      const t = boxes.trimBox;
      const m = boxes.mediaBox;
      const inside =
        t.x >= m.x - tolerancePt &&
        t.y >= m.y - tolerancePt &&
        t.x + t.width <= m.x + m.width + tolerancePt &&
        t.y + t.height <= m.y + m.height + tolerancePt;
      if (!inside) {
        issues.push('TrimBox가 MediaBox(작업 영역)를 벗어납니다');
        details.trimBoxMm = { width: round1(trimWmm), height: round1(trimHmm) };
        details.mediaBoxMm = {
          width: round1(m.width * PT_TO_MM),
          height: round1(m.height * PT_TO_MM),
        };
      }
    }

    // (2-b) BleedBox 존재 시 크기 = trim + bleed*2 정합
    if (boxes.bleedBox) {
      const bleedMm =
        options.orderOptions.bleedMm ??
        options.orderOptions.bleed ??
        DEFAULT_BLEED_MM;
      const bleedWmm = boxes.bleedBox.width * PT_TO_MM;
      const bleedHmm = boxes.bleedBox.height * PT_TO_MM;
      const expectedW = trimWmm + bleedMm * 2;
      const expectedH = trimHmm + bleedMm * 2;
      if (
        Math.abs(bleedWmm - expectedW) > tolerance ||
        Math.abs(bleedHmm - expectedH) > tolerance
      ) {
        issues.push(`BleedBox 크기가 재단+블리드(${bleedMm}mm×2)와 다릅니다`);
        details.bleedBoxMm = { width: round1(bleedWmm), height: round1(bleedHmm) };
        details.expectedBleedBoxMm = {
          width: round1(expectedW),
          height: round1(expectedH),
        };
        details.bleedMm = bleedMm;
      }
    }

    if (issues.length > 0) {
      warnings.push({
        code: WarningCode.TRIMBOX_BLEED_INCONSISTENT,
        message: `재단 기하 부정합: ${issues.join(' / ')}. 재단·블리드 구성을 확인해 주세요.`,
        details,
        autoFixable: false,
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
    const bleed = options.orderOptions.bleed ?? DEFAULT_BLEED_MM;
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
    // s3 백엔드 마커(api://<fileId>) — API 다운로드 엔드포인트 경유.
    // 워커에 s3 SDK 를 추가하지 않고, 기존 API_BASE_URL + WORKER_API_KEY 자산을 재사용.
    if (url.startsWith('api://')) {
      const fileId = url.slice('api://'.length);
      const apiBase = process.env.API_BASE_URL || 'http://localhost:4000/api';
      this.logger.log(`Downloading s3-backed file via API: ${fileId}`);
      const res = await axios.get(`${apiBase}/files/${fileId}/download/external`, {
        responseType: 'arraybuffer',
        timeout: 120000, // 대용량 고려 2분
        headers: { 'X-API-Key': process.env.WORKER_API_KEY },
      });
      return new Uint8Array(res.data);
    }

    // 로컬 파일 경로인 경우 (절대 경로, 상대 경로, storage/ 또는 /storage/ 경로)
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('storage/')) {
      const filePath = this.resolveLocalPath(url);
      this.logger.log(`Reading local file: ${filePath}`);
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    }

    // URL에서 다운로드 — SSRF 가드(P0-1 M1): 내부망 페치 + 리다이렉트 우회 차단.
    await assertSafeDownloadUrl(url);
    this.logger.log(`Downloading from URL: ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60초 타임아웃
      maxRedirects: 0,
    });

    return new Uint8Array(response.data);
  }

  // ============================================================
  // WBS 2.0: pdf-lib 기반 기능
  // @see docs/PDF_VALIDATION_WBS.md
  // ============================================================

  /**
   * WBS 2.1 / R3: 페이지 방향 검증 (집계형·비차단)
   *
   * 종전: 각 landscape 페이지마다 LANDSCAPE_PAGE 경고를 개별 emit
   *   → (1) 가로형 책자가 정상이어도 전 페이지 오탐, (2) 주문 의도 방향 비교 불가,
   *      (3) 경고 N개 스팸. 모달 친화적이지 않음.
   *
   * 재설계(카테고리당 최대 1건):
   *   - expectedOrientation 'portrait'|'landscape' 명시 → 어긋난 페이지를 모아
   *     ORIENTATION_MISMATCH 1건(어긋난 페이지 0개면 경고 없음).
   *   - 미제공/'auto' → 두 방향이 혼재할 때만 MIXED_PAGE_ORIENTATION 1건.
   *     모든 페이지가 같은 방향이면 경고 없음(가로책 오탐 해소).
   *
   * 정사각(거의 정사각) 페이지의 jitter 오판을 막기 위해 landscape 판정에
   * +0.5mm 마진을 둔다(widthMm > heightMm + 0.5 일 때만 가로).
   * 모든 신규 동작은 비차단(warning) — isValid 에 영향 없음.
   */
  private validatePageOrientation(
    pages: PDFPage[],
    warnings: ValidationWarning[],
    expectedOrientation?: 'portrait' | 'landscape' | 'auto',
  ): void {
    const { PT_TO_MM } = VALIDATION_CONFIG;

    // 각 페이지 방향 산정 (1-based 인덱스 수집)
    const portraitPages: number[] = [];
    const landscapePages: number[] = [];

    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      const widthMm = width * PT_TO_MM;
      const heightMm = height * PT_TO_MM;

      // 정사각 jitter 방지: 너비가 높이보다 0.5mm 초과로 클 때만 가로
      const isLandscape = widthMm > heightMm + 0.5;
      if (isLandscape) {
        landscapePages.push(index + 1);
      } else {
        portraitPages.push(index + 1);
      }
    });

    const portraitCount = portraitPages.length;
    const landscapeCount = landscapePages.length;

    // (A) 주문 의도 방향이 명시된 경우 → 어긋난 페이지를 1건으로 집계
    if (expectedOrientation === 'portrait' || expectedOrientation === 'landscape') {
      const mismatchPages =
        expectedOrientation === 'portrait' ? landscapePages : portraitPages;

      if (mismatchPages.length > 0) {
        const expectedLabel = expectedOrientation === 'portrait' ? '세로형' : '가로형';
        const actualLabel = expectedOrientation === 'portrait' ? '가로형' : '세로형';
        warnings.push({
          code: WarningCode.ORIENTATION_MISMATCH,
          message: `${expectedLabel} 주문인데 ${actualLabel} 페이지가 ${mismatchPages.length}개 있습니다(p.${mismatchPages.join(', ')}).`,
          details: {
            expected: expectedOrientation,
            mismatchPages,
            total: pages.length,
          },
          autoFixable: false,
        });
      }
      return;
    }

    // (B) 미제공/'auto' → 두 방향 혼재 시에만 1건 집계. 단일 방향이면 경고 없음.
    if (portraitCount > 0 && landscapeCount > 0) {
      // 소수(minority) 방향 페이지 목록을 노출(모달에서 "어느 쪽이 섞였는지" 안내용)
      const minorityPages =
        landscapeCount <= portraitCount ? landscapePages : portraitPages;
      warnings.push({
        code: WarningCode.MIXED_PAGE_ORIENTATION,
        message: `세로형과 가로형 페이지가 섞여 있습니다(세로 ${portraitCount}개, 가로 ${landscapeCount}개). 의도한 구성인지 확인해 주세요.`,
        details: {
          portraitCount,
          landscapeCount,
          minorityPages,
        },
        autoFixable: false,
      });
    }
  }

  /**
   * WBS 2.2: 사철 제본 검증
   * 사철 제본은 4의 배수, 최대 64페이지
   */
  private validateSaddleStitch(
    pageCount: number,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    dataDrivenPageRules = false,
  ): void {
    const { SADDLE_STITCH_MAX_PAGES } = VALIDATION_CONFIG;

    // 페이지수 규칙(4의 배수·최대 64)은 데이터 주도(orderOptions.pageMultiple/pageCountMax) 활성 시
    // validatePageCount 가 소유 → 여기선 스킵(이중 보고/충돌 방지). 미활성(레거시)이면 현행 byte-identical.
    if (!dataDrivenPageRules) {
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
    }

    // 중앙부 객체 확인 경고 (페이지수와 무관 — 항상 유지)
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
    // 경량(ON) 경로 전용 선택 인자. 스트리밍 스캔이 이미 구한 CMYK 구조와 파일크기를
    // 주입해 pdfBytes 전체버퍼 의존(detectCmykStructure·pdfBytes.length)을 우회한다.
    // 미전달(OFF 경로) 시 동작은 기존과 완전히 동일하다.
    precomputed?: { cmykStructure: CmykStructureResult; fileSize: number },
  ): Promise<ColorModeResult> {
    const warnings: string[] = [];

    // 1차: 구조적 CMYK 감지 (ON 경로는 스트리밍 스캔 결과를 재사용)
    const cmykStructure = precomputed?.cmykStructure ?? this.detectCmykStructure(pdfBytes);

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

      // 파일 크기 확인 - 대형 파일은 GS 분석 생략 (ON 경로는 dl.size 를 주입)
      const fileSize = precomputed?.fileSize ?? pdfBytes.length;
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
