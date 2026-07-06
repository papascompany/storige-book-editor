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
  centerOnPage,
  getPdfInfo,
} from '../utils/ghostscript';
import { isApiMarker, downloadViaApi } from './api-file-download';
import {
  VALIDATION_CONFIG,
  DEFAULT_SIZE_TOLERANCE_MM,
} from '../config/validation.config';
import { downloadToTempFile } from '../utils/stream-download';
import { assertSafeDownloadUrl } from '../utils/url-safety';
import {
  extractPdfMetadataQpdf,
  getPdfInfoQpdf,
} from '../utils/pdf-metadata-qpdf';

export interface ConversionOptions {
  addPages: boolean;
  applyBleed: boolean;
  targetPages: number;
  bleed: number;
  /** 출력 크기 (mm) */
  targetSize?: { width: number; height: number };
  /**
   * P4 — 고객 업로드 내지 PDF 임포지션 모드.
   *   - undefined : 현행 동작 100% 유지(블리드/리사이즈/페이지추가 기존 흐름). ⚠️ 변경 금지.
   *   - passthrough: 원본 무가공 패스스루(작업사이즈와 동일±허용오차).
   *   - innerfit  : editSize 에 맞춰 비율유지 다운스케일 + 중앙(블리드 없음 & 큼).
   *   - center    : editSize 페이지 중앙에 무스케일 배치(블리드 없음 & 작음).
   * 편집기 생성 PDF 경로는 mode 를 주입하지 않으므로 영향 없음.
   */
  mode?: 'passthrough' | 'innerfit' | 'center';
  /** P4 — innerfit/center 의 목표 페이지(=작업/편집) 크기(mm). mode 지정 시 필수. */
  editSize?: { width: number; height: number };
  /** P4 — 실측 vs editSize 비교 허용오차(mm). 미지정 시 기본 0.2mm. */
  sizeToleranceMm?: number;
  /**
   * 페이지수 배수 보정(2026-06-25, fix-pagecount) — 제공 시 현재 페이지수를 다음 배수
   * (= ceil(현재/padToMultiple)*padToMultiple)까지 첫 페이지 크기 백지로 맨 뒤에 채운다.
   * addPages(절대 targetPages) 위에 얹는 편의 모드. 이미 배수면 no-op. 데이터 주도 d1 빈페이지 보정.
   */
  padToMultiple?: number;
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
    rawOptions: ConversionOptions,
    outputPath: string,
  ): Promise<ConversionResult> {
    this.logger.log(`Converting PDF: ${fileUrl}`);

    // PDF-006(2026-06-22): 예외 시 임시파일 누수 방지. 경로를 try 밖에 선언해 finally 에서
    // 정리한다. 정상 경로는 기존대로 단계별 safeDelete 로 정리되므로 succeeded 후 추가 삭제 없음.
    let tempInputPath: string | undefined;
    let currentPath: string | undefined;
    let succeeded = false;

    try {
      // Ghostscript 사용 가능 여부 확인
      if (this.gsAvailable === null) {
        this.gsAvailable = await isGhostscriptAvailable();
        this.logger.log(`Ghostscript available: ${this.gsAvailable}`);
      }

      // ──────────────────────────────────────────────────────────────
      // 트랙 B-(f) — 2GB 상수메모리 ON 경로(LIGHTWEIGHT_SYNTHESIS).
      //   ON  : 입력을 스트림으로 임시파일에 흘려(메모리 비경유) 확보.
      //   OFF : 기존 전체버퍼 다운로드(downloadFile) → writeFile (불변).
      // 임포지션 코어(addBleed/resize/center=GS 파일기반)는 양쪽 동일하게 'tempInputPath'
      // 파일을 입력으로 받으므로, 여기서 입력 확보 방식만 분기한다. ⚠️ 산출 동일.
      // ──────────────────────────────────────────────────────────────
      const lightweight = VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS;
      tempInputPath = path.join(this.storagePath, `input_${uuidv4()}.pdf`);

      if (lightweight) {
        // 스트림 다운로드 → 디스크. 로컬 원본이면 그 경로를 그대로 복사(파리티: OFF 도
        // 결국 tempInputPath 파일을 만들어 그 경로로 처리하므로 동일 입력 파일을 만든다).
        // tempInputPath 정리는 OFF 와 동일하게 하단 safeDelete(tempInputPath) 가 담당.
        const dl = await downloadToTempFile(fileUrl);
        try {
          await fs.copyFile(dl.path, tempInputPath);
        } finally {
          await dl.cleanup();
        }
      } else {
        const pdfBytes = await this.downloadFile(fileUrl);
        await fs.writeFile(tempInputPath, pdfBytes);
      }

      // ──────────────────────────────────────────────────────────────
      // P4 — mode 자체결정 (2026-06-10).
      // mode 가 명시되지 않았지만 editSize 가 주어진 업로드 경로에서는,
      // 실측(getPdfInfo) vs editSize±허용오차 비교로 mode 를 결정한다.
      //   - 동일(±tol)           → passthrough (무가공, 현행 효과와 동일)
      //   - 실측 > editSize + tol → innerfit   (큼: 비율유지 다운스케일+중앙)
      //   - 실측 < editSize - tol → center     (작음: 무스케일 중앙)
      // mode 가 명시되면 그 값을 그대로 사용(아래 분기 자체결정 skip).
      // editSize 가 없으면 결정하지 않음 → options.mode 가 계속 undefined →
      //   현행(레거시) 경로 100% 유지(편집기 PDF/admin 자동수정 무영향). ⚠️ 게이트.
      const options = await this.resolveMode(rawOptions, tempInputPath, lightweight);

      currentPath = tempInputPath;
      let pagesAdded = 0;
      let bleedApplied = false;

      if (!options.mode) {
        // ──────────────────────────────────────────────────────────────
        // 현행(레거시) 경로 — mode 미지정 시 100% 동작 보존. ⚠️ 변경 금지.
        // 편집기 생성 PDF(표지/내지) 및 기존 admin 자동수정 변환이 여기로 들어온다.
        // ──────────────────────────────────────────────────────────────

        // 1. 페이지 추가 (pdf-lib 사용). padToMultiple(2026-06-25 fix-pagecount): 현재 페이지수를
        //    다음 배수까지 백지로 보정. addPages(절대 targetPages)와 공존(둘 다 시 더 큰 목표 채택).
        const _padTo = options.padToMultiple && options.padToMultiple > 0 ? options.padToMultiple : 0;
        if ((options.addPages && options.targetPages > 0) || _padTo > 0) {
          const pdfDoc = await PDFDocument.load(await fs.readFile(currentPath));
          let _targetPages =
            options.addPages && options.targetPages > 0 ? options.targetPages : 0;
          if (_padTo > 0) {
            const _cur = pdfDoc.getPageCount();
            _targetPages = Math.max(_targetPages, Math.ceil(_cur / _padTo) * _padTo);
          }
          pagesAdded = await this.addPages(pdfDoc, _targetPages);

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
            // WK-2 sanity 게이트용 원본 실측 (블리드 적용 전)
            const beforeInfo = await getPdfInfo(currentPath);

            // Ghostscript로 블리드 적용 (더 정확함)
            await addBleedToPdf(currentPath, tempBleedPath, options.bleed);

            // WK-2 (2026-06-13) — sanity 게이트: 변환 결과 첫 페이지 크기 ≥ 원본.
            //   종전 addBleedToPdf 는 페이지 크기를 bleedPt*2 로 잘못 지정해
            //   콘텐츠가 블리드 2배 크기로 잘려나간 손상 PDF 를 조용히 산출했다.
            //   동일 계열 회귀가 재발하면 손상 산출물이 인쇄로 흘러가지 않도록
            //   여기서 잡을 FAILED 로 떨어뜨린다(throw → 프로세서가 FAILED 처리).
            //   (0.5mm 허용오차: getPdfInfo 반올림/측정 오차 흡수)
            const afterInfo = await getPdfInfo(tempBleedPath);
            const SANITY_TOL_MM = 0.5;
            if (
              afterInfo.width + SANITY_TOL_MM < beforeInfo.width ||
              afterInfo.height + SANITY_TOL_MM < beforeInfo.height
            ) {
              throw new Error(
                `BLEED_OUTPUT_SMALLER_THAN_INPUT: 블리드 적용 결과(${afterInfo.width}x${afterInfo.height}mm)가 ` +
                  `원본(${beforeInfo.width}x${beforeInfo.height}mm)보다 작습니다 — Ghostscript 블리드 변환 손상 의심, 잡 FAILED 처리`,
              );
            }
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
      } else {
        // ──────────────────────────────────────────────────────────────
        // P4 — 고객 업로드 내지 PDF 임포지션(안전 게이팅).
        // mode 가 명시된 업로드 경로에서만 실행. 블리드/리사이즈/페이지추가 스킵.
        // 가짜 블리드 자동생성 안 함.
        // ──────────────────────────────────────────────────────────────
        currentPath = await this.applyImpositionMode(tempInputPath, options, lightweight);
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
      //    ON  : extractPdfMetadataQpdf(파일기반·상수메모리)로 pageCount + 첫 페이지 치수(pt).
      //          pdf-lib getSize()=(urx-llx, ury-lly) 와 동일 보장(스왑 없음) → 산출 동일.
      //    OFF : 기존 pdf-lib load(전체바이트) (불변).
      let finalPageCount: number;
      let width: number;
      let height: number;
      if (lightweight) {
        const meta = await extractPdfMetadataQpdf(outputPath);
        finalPageCount = meta.pageCount;
        // 첫 페이지 치수(pt). 메타 미해석 시 pdf-lib 로 1회 폴백(파리티 안전망).
        if (meta.pages.length > 0) {
          width = meta.pages[0].widthPt;
          height = meta.pages[0].heightPt;
        } else {
          const finalPdf = await PDFDocument.load(await fs.readFile(outputPath));
          finalPageCount = finalPdf.getPageCount();
          const fp = finalPdf.getPage(0).getSize();
          width = fp.width;
          height = fp.height;
        }
      } else {
        const finalPdf = await PDFDocument.load(await fs.readFile(outputPath));
        finalPageCount = finalPdf.getPageCount();
        const firstPage = finalPdf.getPage(0);
        ({ width, height } = firstPage.getSize());
      }

      // 임시 입력 파일 삭제
      await this.safeDelete(tempInputPath);

      this.logger.log(`Conversion complete: ${outputPath}`);

      succeeded = true;
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
    } finally {
      // PDF-006: 예외 경로에서만 임시파일 정리. 정상 경로는 단계별 safeDelete + 270행
      // safeDelete(tempInputPath)로 이미 정리됨(succeeded=true → 스킵). safeDelete 는
      // ENOENT 를 삼키므로 이미 삭제된 경로 재삭제도 무해(멱등).
      if (!succeeded) {
        if (currentPath) await this.safeDelete(currentPath);
        if (tempInputPath) await this.safeDelete(tempInputPath);
      }
    }
  }

  /**
   * P4 — mode 자체결정 (2026-06-10).
   *
   * convert() 진입부에서 호출. mode 미지정 + editSize 주어진 업로드 경로에서만
   * 실측(getPdfInfo) vs editSize±허용오차 비교로 mode 를 결정해 주입한다.
   * applyImpositionMode 로직은 그대로 두고 진입부에서 mode 만 채운다.
   *
   * 결정 규칙(오너 스펙):
   *   - 가로/세로 모두 동일(±tol)        → passthrough (무가공)
   *   - 가로 또는 세로가 editSize+tol 초과 → innerfit   (큼: 비율유지 다운스케일+중앙)
   *   - 그 외(작거나 같음)               → center     (작음: 무스케일 중앙)
   *
   * 보존:
   *   - rawOptions.mode 가 이미 명시 → 그 값 우선(자체결정 skip).
   *   - editSize 없음               → mode 미결정(undefined 유지) → 현행 레거시 경로.
   *   - GS 미가용/실측 실패          → mode 미결정 유지(안전: 현행 경로로 폴백).
   *
   * 입력 객체를 변형하지 않고 얕은 복사본을 반환한다.
   */
  private async resolveMode(
    rawOptions: ConversionOptions,
    inputPath: string,
    lightweight = false,
  ): Promise<ConversionOptions> {
    // 이미 mode 명시 또는 editSize 부재 → 자체결정 안 함(게이트).
    if (rawOptions.mode) return rawOptions;
    const editSize = rawOptions.editSize;
    if (!editSize || !(editSize.width > 0) || !(editSize.height > 0)) {
      return rawOptions;
    }

    // GS 미가용이면 imposition 자체가 폴백되므로 현행 경로 유지(결정 보류).
    if (!this.gsAvailable) {
      this.logger.warn(
        'resolveMode: editSize 주어졌으나 Ghostscript 미가용 → mode 결정 보류(현행 경로 유지)',
      );
      return rawOptions;
    }

    let measuredW: number;
    let measuredH: number;
    try {
      // ON: qpdf 파일기반 실측(상수메모리). OFF: pdf-lib getPdfInfo. 둘 다 mm·A4폴백 동일.
      const info = lightweight
        ? await getPdfInfoQpdf(inputPath)
        : await getPdfInfo(inputPath);
      measuredW = info.width;
      measuredH = info.height;
    } catch (e) {
      this.logger.warn(
        `resolveMode: getPdfInfo 실패 → mode 결정 보류(현행 경로 유지): ${(e as Error).message}`,
      );
      return rawOptions;
    }

    // C-2b: 매직넘버 0.2 → DEFAULT_SIZE_TOLERANCE_MM(=0.2) 치환(값-동일, 행동 무변화).
    const tol = rawOptions.sizeToleranceMm ?? DEFAULT_SIZE_TOLERANCE_MM;
    const sameSize =
      Math.abs(measuredW - editSize.width) <= tol &&
      Math.abs(measuredH - editSize.height) <= tol;
    const larger =
      measuredW > editSize.width + tol || measuredH > editSize.height + tol;

    let decided: 'passthrough' | 'innerfit' | 'center';
    if (sameSize) {
      decided = 'passthrough';
    } else if (larger) {
      decided = 'innerfit';
    } else {
      decided = 'center';
    }

    this.logger.log(
      `resolveMode: measured ${measuredW}x${measuredH}mm vs edit ${editSize.width}x${editSize.height}mm (±${tol}) → mode='${decided}'`,
    );

    return { ...rawOptions, mode: decided };
  }

  /**
   * P4 — 고객 업로드 내지 PDF 임포지션 모드 적용.
   *
   * 오너 확정 스펙:
   *   - passthrough : 작업사이즈와 동일(±허용오차) → 원본 무가공 패스스루.
   *   - innerfit    : 블리드 없음 & 큼 → editSize 에 맞춰 비율유지 다운스케일(GS -dPDFFitPage) + 중앙.
   *                   가드: 실측 ≤ editSize 면 확대 금지(스킵 = 원본 유지).
   *   - center      : 블리드 없음 & 작음 → editSize 페이지 중앙에 무스케일 배치.
   *
   * 반환: 결과 PDF 경로(원본 패스스루면 입력 경로 그대로, 변환이면 신규 temp 경로).
   *       호출부(convert)의 step4 가 이 경로를 outputPath 로 copy 후 정리한다.
   *
   * ⚠️ 이 메서드는 mode 가 명시된 업로드 경로에서만 호출된다(편집기 PDF 무영향).
   */
  private async applyImpositionMode(
    inputPath: string,
    options: ConversionOptions,
    lightweight = false,
  ): Promise<string> {
    const mode = options.mode;
    // C-2b: 매직넘버 0.2 → DEFAULT_SIZE_TOLERANCE_MM(=0.2) 치환(값-동일, 행동 무변화).
    const tol = options.sizeToleranceMm ?? DEFAULT_SIZE_TOLERANCE_MM;
    const editSize = options.editSize;

    // passthrough: 무가공. 입력 경로 그대로 반환(step4 가 outputPath 로 copy).
    if (mode === 'passthrough') {
      this.logger.log('Imposition mode=passthrough — 원본 무가공');
      return inputPath;
    }

    // innerfit/center 는 editSize 가 필수. 누락 시 안전하게 passthrough 폴백.
    if (!editSize || !(editSize.width > 0) || !(editSize.height > 0)) {
      this.logger.warn(
        `Imposition mode=${mode} 인데 editSize 누락/무효 → passthrough 폴백`,
      );
      return inputPath;
    }

    // GS 미가용 시 가공 불가 → 안전 패스스루(원본 보존).
    if (!this.gsAvailable) {
      this.logger.warn(
        `Imposition mode=${mode} 인데 Ghostscript 미가용 → passthrough 폴백`,
      );
      return inputPath;
    }

    // 실측(첫 페이지 mm). ON: qpdf 파일기반(상수메모리), OFF: pdf-lib getPdfInfo. 산출 동일.
    const info = lightweight
      ? await getPdfInfoQpdf(inputPath)
      : await getPdfInfo(inputPath);
    const measuredW = info.width;
    const measuredH = info.height;

    if (mode === 'innerfit') {
      // 가드: 실측이 editSize 이하(±tol)면 확대 금지 → 무가공.
      const fitsWithin =
        measuredW <= editSize.width + tol && measuredH <= editSize.height + tol;
      if (fitsWithin) {
        this.logger.log(
          `Imposition innerfit 스킵(확대 금지): measured ${measuredW}x${measuredH} ≤ edit ${editSize.width}x${editSize.height}(+${tol}mm) → passthrough`,
        );
        return inputPath;
      }
      // 비율유지 다운스케일 + 중앙(GS -dPDFFitPage 가 비율유지·중앙 정렬 수행).
      const out = path.join(this.storagePath, `innerfit_${uuidv4()}.pdf`);
      await resizePdf(inputPath, out, editSize.width, editSize.height);
      this.logger.log(
        `Imposition innerfit: ${measuredW}x${measuredH} → fit ${editSize.width}x${editSize.height}mm`,
      );
      return out;
    }

    if (mode === 'center') {
      // 무스케일 중앙 배치.
      const out = path.join(this.storagePath, `center_${uuidv4()}.pdf`);
      await centerOnPage(inputPath, out, editSize.width, editSize.height);
      this.logger.log(
        `Imposition center: ${measuredW}x${measuredH} → center on ${editSize.width}x${editSize.height}mm`,
      );
      return out;
    }

    // 알 수 없는 mode → 안전 패스스루.
    this.logger.warn(`Imposition unknown mode='${mode}' → passthrough 폴백`);
    return inputPath;
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
    // API가 s3(R2) backend 파일에 넘기는 마커 → API 다운로드 라우트로 위임 (local/s3 라우팅)
    if (isApiMarker(url)) {
      return await downloadViaApi(url);
    }

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

    // Download from URL — SSRF 가드(P0-1 M1): 내부망 페치 + 리다이렉트 우회 차단.
    await assertSafeDownloadUrl(url);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxRedirects: 0,
    });

    return new Uint8Array(response.data);
  }
}
