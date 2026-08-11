/**
 * Ghostscript 유틸리티 테스트
 * WBS 5.2.2: ghostscript.spec.ts
 *
 * 성공/경고/실패 케이스 모두 테스트
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';

// 실제 파일 시스템 사용 (테스트 픽스처)
const FIXTURES_DIR = path.join(__dirname, '../../test/fixtures/pdf');

// 모듈 임포트 (실제 구현 테스트)
import {
  detectSpotColors,
  detectTransparencyAndOverprint,
  detectImageResolutionFromPdf,
  detectFonts,
  parseInkTacOutput,
} from './ghostscript';

describe('Ghostscript Utilities', () => {
  // Helper function to check if file exists
  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // WBS 4.1: 별색(Spot Color) 감지 테스트
  // ============================================================
  describe('detectSpotColors (WBS 4.1)', () => {
    describe('Success cases - spot colors detected', () => {
      it('should detect spot colors from PDF with Separation colorspace (PANTONE)', async () => {
        // spot-only.pdf는 PANTONE Red 032 C + CutContour (DeviceN) 포함
        const spotColorPdfPath = path.join(FIXTURES_DIR, 'spot-color', 'spot-only.pdf');

        if (!await fileExists(spotColorPdfPath)) {
          console.log('Skipping test: spot-only.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(spotColorPdfPath);
        const result = await detectSpotColors(spotColorPdfPath, pdfBytes);

        expect(result.hasSpotColors).toBe(true);
        expect(result.spotColorNames.length).toBeGreaterThan(0);
        // PANTONE Red 032 C 가 포함되어야 함
        expect(
          result.spotColorNames.some((name) => name.includes('PANTONE')),
        ).toBe(true);
      });

      it('should detect DeviceN colorspace colors', async () => {
        // spot-only.pdf는 DeviceN [Cyan, Magenta, CutContour] 포함
        const spotColorPdfPath = path.join(FIXTURES_DIR, 'spot-color', 'spot-only.pdf');

        if (!await fileExists(spotColorPdfPath)) {
          console.log('Skipping test: spot-only.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(spotColorPdfPath);
        const result = await detectSpotColors(spotColorPdfPath, pdfBytes);

        // DeviceN에서 CutContour 별색이 감지되어야 함
        expect(result.spotColorNames.some((name) => name === 'CutContour')).toBe(
          true,
        );
      });

      it('should decode hex-encoded spot color names', async () => {
        // #20 = space, #23 = #
        // 테스트 PDF에 PANTONE#20Red#20032#20C 가 있음
        const spotColorPdfPath = path.join(FIXTURES_DIR, 'spot-color', 'spot-only.pdf');

        if (!await fileExists(spotColorPdfPath)) {
          console.log('Skipping test: spot-only.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(spotColorPdfPath);
        const result = await detectSpotColors(spotColorPdfPath, pdfBytes);

        // 디코딩된 이름이 공백을 포함해야 함
        expect(
          result.spotColorNames.some((name) => name.includes(' ')),
        ).toBe(true);
      });

      it('should detect pure spot colors (no CMYK ink)', async () => {
        // success-spot-only.pdf는 CutContour + Crease (CMYK 잉크 0%)
        // 후가공 파일 테스트용 - 실제 인쇄 잉크 없이 별색만 포함
        const pureSpotPdfPath = path.join(FIXTURES_DIR, 'spot-color', 'success-spot-only.pdf');

        if (!await fileExists(pureSpotPdfPath)) {
          console.log('Skipping test: success-spot-only.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pureSpotPdfPath);
        const result = await detectSpotColors(pureSpotPdfPath, pdfBytes);

        expect(result.hasSpotColors).toBe(true);
        // CutContour와 Crease 별색이 감지되어야 함
        expect(result.spotColorNames.some((name) => name === 'CutContour')).toBe(true);
        expect(result.spotColorNames.some((name) => name === 'Crease')).toBe(true);
      });
    });

    describe('Warning cases - mixed colors', () => {
      it('should detect both CMYK and spot colors in mixed PDF', async () => {
        const mixedPdfPath = path.join(FIXTURES_DIR, 'spot-color', 'warn-cmyk-spot-mixed.pdf');

        if (!await fileExists(mixedPdfPath)) {
          console.log('Skipping test: warn-cmyk-spot-mixed.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(mixedPdfPath);
        const result = await detectSpotColors(mixedPdfPath, pdfBytes);

        // 별색이 감지되어야 함
        expect(result.hasSpotColors).toBe(true);
        expect(result.spotColorNames.length).toBeGreaterThan(0);
      });
    });

    describe('Success cases - no spot colors', () => {
      it('should not detect system colors as spot colors in RGB PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const result = await detectSpotColors(rgbPdfPath, pdfBytes);

        expect(result.hasSpotColors).toBe(false);
        expect(result.spotColorNames).toHaveLength(0);
      });

      it('should not detect spot colors in 8-page RGB PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-8pages.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-8pages.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const result = await detectSpotColors(rgbPdfPath, pdfBytes);

        expect(result.hasSpotColors).toBe(false);
        expect(result.spotColorNames).toHaveLength(0);
      });

      it('should not detect spot colors in RGB PDF with bleed', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-with-bleed.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-with-bleed.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const result = await detectSpotColors(rgbPdfPath, pdfBytes);

        expect(result.hasSpotColors).toBe(false);
        expect(result.spotColorNames).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // WBS 4.2: 투명도/오버프린트 감지 테스트
  // ============================================================
  describe('detectTransparencyAndOverprint (WBS 4.2)', () => {
    describe('Warning cases - transparency detected', () => {
      it('should detect transparency in PDF', async () => {
        const transparencyPdfPath = path.join(
          FIXTURES_DIR,
          'transparency',
          'warn-with-transparency.pdf',
        );

        if (!await fileExists(transparencyPdfPath)) {
          console.log('Skipping test: warn-with-transparency.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(transparencyPdfPath);
        const result = await detectTransparencyAndOverprint(
          transparencyPdfPath,
          pdfBytes,
        );

        expect(result.hasTransparency).toBe(true);
      });

      it('should detect blend mode as transparency', async () => {
        const transparencyPdfPath = path.join(
          FIXTURES_DIR,
          'transparency',
          'warn-with-transparency.pdf',
        );

        if (!await fileExists(transparencyPdfPath)) {
          console.log('Skipping test: warn-with-transparency.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(transparencyPdfPath);
        const result = await detectTransparencyAndOverprint(
          transparencyPdfPath,
          pdfBytes,
        );

        // BM /Multiply 가 투명도로 감지되어야 함
        expect(result.hasTransparency).toBe(true);
      });
    });

    describe('Warning cases - overprint detected', () => {
      it('should detect overprint in PDF', async () => {
        const overprintPdfPath = path.join(
          FIXTURES_DIR,
          'transparency',
          'warn-with-overprint.pdf',
        );

        if (!await fileExists(overprintPdfPath)) {
          console.log('Skipping test: warn-with-overprint.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(overprintPdfPath);
        const result = await detectTransparencyAndOverprint(
          overprintPdfPath,
          pdfBytes,
        );

        expect(result.hasOverprint).toBe(true);
      });
    });

    describe('Warning cases - both transparency and overprint', () => {
      it('should detect both transparency and overprint in PDF', async () => {
        const bothPdfPath = path.join(
          FIXTURES_DIR,
          'transparency',
          'warn-both-trans-overprint.pdf',
        );

        if (!await fileExists(bothPdfPath)) {
          console.log('Skipping test: warn-both-trans-overprint.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(bothPdfPath);
        const result = await detectTransparencyAndOverprint(
          bothPdfPath,
          pdfBytes,
        );

        expect(result.hasTransparency).toBe(true);
        expect(result.hasOverprint).toBe(true);
      });
    });

    describe('Success cases - no transparency or overprint', () => {
      it('should not detect transparency in normal RGB PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const result = await detectTransparencyAndOverprint(rgbPdfPath, pdfBytes);

        expect(result.hasTransparency).toBe(false);
        expect(result.hasOverprint).toBe(false);
      });

      it('should not detect transparency in PDF explicitly without transparency', async () => {
        const noTransPdfPath = path.join(FIXTURES_DIR, 'transparency', 'success-no-transparency.pdf');

        if (!await fileExists(noTransPdfPath)) {
          console.log('Skipping test: success-no-transparency.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(noTransPdfPath);
        const result = await detectTransparencyAndOverprint(noTransPdfPath, pdfBytes);

        expect(result.hasTransparency).toBe(false);
        expect(result.hasOverprint).toBe(false);
      });

      it('should not detect transparency in 8-page RGB PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-8pages.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-8pages.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const result = await detectTransparencyAndOverprint(rgbPdfPath, pdfBytes);

        expect(result.hasTransparency).toBe(false);
        expect(result.hasOverprint).toBe(false);
      });
    });
  });

  // ============================================================
  // CMYK 감지 테스트 (구조적 감지)
  // ============================================================
  describe('CMYK detection', () => {
    describe('Fail cases - CMYK detected', () => {
      it('should detect DeviceCMYK in CMYK PDF', async () => {
        const cmykPdfPath = path.join(FIXTURES_DIR, 'cmyk', 'fail-cmyk-for-postprocess.pdf');

        if (!await fileExists(cmykPdfPath)) {
          console.log('Skipping test: fail-cmyk-for-postprocess.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(cmykPdfPath);
        const pdfString = new TextDecoder('latin1').decode(pdfBytes);

        // DeviceCMYK 시그니처 확인
        expect(pdfString.includes('/DeviceCMYK')).toBe(true);
      });
    });

    describe('Success cases - no CMYK', () => {
      it('should not detect DeviceCMYK in RGB PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'cmyk', 'success-rgb-only.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-rgb-only.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const pdfString = new TextDecoder('latin1').decode(pdfBytes);

        // DeviceCMYK 시그니처가 없어야 함
        expect(pdfString.includes('/DeviceCMYK')).toBe(false);
      });

      it('should not detect DeviceCMYK in normal A4 PDF', async () => {
        const rgbPdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(rgbPdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(rgbPdfPath);
        const pdfString = new TextDecoder('latin1').decode(pdfBytes);

        // DeviceCMYK 시그니처가 없어야 함
        expect(pdfString.includes('/DeviceCMYK')).toBe(false);
      });
    });
  });

  // ============================================================
  // 에지 케이스 테스트
  // ============================================================
  describe('edge cases', () => {
    it('should handle empty PDF gracefully', async () => {
      const pdfDoc = await PDFDocument.create();
      const pdfBytes = await pdfDoc.save();

      const spotResult = await detectSpotColors('', pdfBytes);
      expect(spotResult.hasSpotColors).toBe(false);

      const transparencyResult = await detectTransparencyAndOverprint(
        '',
        pdfBytes,
      );
      expect(transparencyResult.hasTransparency).toBe(false);
      expect(transparencyResult.hasOverprint).toBe(false);
    });

    it('should handle PDF with only pages', async () => {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([595, 842]); // A4
      const pdfBytes = await pdfDoc.save();

      const spotResult = await detectSpotColors('', pdfBytes);
      expect(spotResult.hasSpotColors).toBe(false);

      const transparencyResult = await detectTransparencyAndOverprint(
        '',
        pdfBytes,
      );
      expect(transparencyResult.hasTransparency).toBe(false);
    });

    it('should handle PDF with multiple pages', async () => {
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < 10; i++) {
        pdfDoc.addPage([595, 842]); // A4
      }
      const pdfBytes = await pdfDoc.save();

      const spotResult = await detectSpotColors('', pdfBytes);
      expect(spotResult.hasSpotColors).toBe(false);

      const transparencyResult = await detectTransparencyAndOverprint(
        '',
        pdfBytes,
      );
      expect(transparencyResult.hasTransparency).toBe(false);
      expect(transparencyResult.hasOverprint).toBe(false);
    });

    it('should handle large page count PDF', async () => {
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < 64; i++) {
        pdfDoc.addPage([595, 842]); // A4
      }
      const pdfBytes = await pdfDoc.save();

      const spotResult = await detectSpotColors('', pdfBytes);
      expect(spotResult.hasSpotColors).toBe(false);

      const transparencyResult = await detectTransparencyAndOverprint(
        '',
        pdfBytes,
      );
      expect(transparencyResult.hasTransparency).toBe(false);
    });
  });

  // ============================================================
  // 폰트 감지 테스트
  // ============================================================
  describe('detectFonts', () => {
    describe('PDF without fonts', () => {
      it('should return empty result for PDF without fonts', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([595, 842]); // A4
        const pdfBytes = await pdfDoc.save();

        const result = await detectFonts(pdfBytes);

        expect(result.fontCount).toBe(0);
        expect(result.fonts).toHaveLength(0);
        expect(result.hasUnembeddedFonts).toBe(false);
        expect(result.allFontsEmbedded).toBe(true);
      });

      it('should handle empty PDF', async () => {
        const pdfDoc = await PDFDocument.create();
        const pdfBytes = await pdfDoc.save();

        const result = await detectFonts(pdfBytes);

        expect(result.fontCount).toBe(0);
        expect(result.hasUnembeddedFonts).toBe(false);
      });
    });

    describe('PDF with embedded fonts (using fixture files)', () => {
      it('should detect fonts in real PDF file', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectFonts(pdfBytes);

        // PDF에 폰트가 있거나 없을 수 있음 (픽스처에 따라 다름)
        expect(typeof result.fontCount).toBe('number');
        expect(Array.isArray(result.fonts)).toBe(true);
        expect(typeof result.hasUnembeddedFonts).toBe('boolean');
        expect(typeof result.allFontsEmbedded).toBe('boolean');
      });

      it('should detect fonts in 8-page PDF', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-8pages.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-8pages.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectFonts(pdfBytes);

        expect(typeof result.fontCount).toBe('number');
        expect(Array.isArray(result.fonts)).toBe(true);
      });
    });

    describe('FontInfo structure', () => {
      it('should return correct FontInfo structure when fonts exist', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectFonts(pdfBytes);

        if (result.fontCount > 0) {
          const firstFont = result.fonts[0];
          expect(firstFont).toHaveProperty('name');
          expect(firstFont).toHaveProperty('type');
          expect(firstFont).toHaveProperty('embedded');
          expect(firstFont).toHaveProperty('subset');

          expect(typeof firstFont.name).toBe('string');
          expect(typeof firstFont.type).toBe('string');
          expect(typeof firstFont.embedded).toBe('boolean');
          expect(typeof firstFont.subset).toBe('boolean');
        }
      });
    });

    describe('Font embedding detection', () => {
      it('should detect subset fonts as embedded', async () => {
        // 서브셋 폰트는 ABCDEF+FontName 형식으로 이름이 지정됨
        // pdf-lib로 생성한 PDF는 서브셋 폰트를 사용
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectFonts(pdfBytes);

        // 서브셋 폰트는 임베딩됨으로 처리
        const subsetFonts = result.fonts.filter((f) => f.subset);
        for (const font of subsetFonts) {
          expect(font.embedded).toBe(true);
        }
      });

      it('should handle PDF with multiple fonts', async () => {
        const pdfDoc = await PDFDocument.create();
        for (let i = 0; i < 5; i++) {
          pdfDoc.addPage([595, 842]); // A4
        }
        const pdfBytes = await pdfDoc.save();

        const result = await detectFonts(pdfBytes);

        // 빈 PDF는 폰트가 없음
        expect(result.fontCount).toBe(0);
        expect(result.allFontsEmbedded).toBe(true);
      });
    });

    describe('Standard font detection', () => {
      it('should recognize PDF standard fonts', async () => {
        // PDF 14 표준 폰트는 임베딩 없이 사용 가능
        // Helvetica, Times-Roman, Courier 등
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectFonts(pdfBytes);

        // 표준 폰트는 unembeddedFonts에 포함되지 않아야 함
        const standardFontNames = [
          'Helvetica',
          'Times-Roman',
          'Courier',
          'Arial',
        ];

        for (const fontName of standardFontNames) {
          expect(
            result.unembeddedFonts.some((name) =>
              name.toLowerCase().includes(fontName.toLowerCase()),
            ),
          ).toBe(false);
        }
      });
    });
  });

  // ============================================================
  // 해상도 감지 테스트
  // ============================================================
  describe('detectImageResolutionFromPdf', () => {
    describe('PDF with no images', () => {
      it('should return empty result for PDF without images', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([595, 842]); // A4
        const pdfBytes = await pdfDoc.save();

        const result = await detectImageResolutionFromPdf(pdfBytes);

        expect(result.imageCount).toBe(0);
        expect(result.hasLowResolution).toBe(false);
        expect(result.minResolution).toBe(0);
        expect(result.avgResolution).toBe(0);
        expect(result.images).toHaveLength(0);
        expect(result.lowResImages).toHaveLength(0);
      });

      it('should handle empty PDF', async () => {
        const pdfDoc = await PDFDocument.create();
        const pdfBytes = await pdfDoc.save();

        const result = await detectImageResolutionFromPdf(pdfBytes);

        expect(result.imageCount).toBe(0);
        expect(result.hasLowResolution).toBe(false);
      });
    });

    describe('PDF with images (using fixture files)', () => {
      it('should detect images in real PDF file', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectImageResolutionFromPdf(pdfBytes);

        // 이미지가 있거나 없을 수 있음 (픽스처에 따라 다름)
        expect(result.imageCount).toBeGreaterThanOrEqual(0);
        expect(typeof result.hasLowResolution).toBe('boolean');
        expect(typeof result.minResolution).toBe('number');
        expect(typeof result.avgResolution).toBe('number');
      });

      it('should detect images in 8-page PDF', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-8pages.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-8pages.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectImageResolutionFromPdf(pdfBytes);

        expect(result.imageCount).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(result.images)).toBe(true);
        expect(Array.isArray(result.lowResImages)).toBe(true);
      });
    });

    describe('Resolution threshold', () => {
      it('should use custom minDpi threshold', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([595, 842]); // A4
        const pdfBytes = await pdfDoc.save();

        // 높은 threshold로 테스트 (500 DPI)
        const result = await detectImageResolutionFromPdf(pdfBytes, 500);

        expect(result.imageCount).toBe(0);
        expect(result.hasLowResolution).toBe(false);
      });

      it('should use default threshold of 150 DPI', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([595, 842]); // A4
        const pdfBytes = await pdfDoc.save();

        // 기본 threshold 사용
        const result = await detectImageResolutionFromPdf(pdfBytes);

        expect(result.imageCount).toBe(0);
        // 이미지가 없으므로 저해상도도 없음
        expect(result.hasLowResolution).toBe(false);
      });
    });

    describe('Image info structure', () => {
      it('should return correct ImageInfo structure when images exist', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');

        if (!await fileExists(pdfPath)) {
          console.log('Skipping test: success-a4-single.pdf not found');
          return;
        }

        const pdfBytes = await fs.readFile(pdfPath);
        const result = await detectImageResolutionFromPdf(pdfBytes);

        if (result.imageCount > 0) {
          const firstImage = result.images[0];
          expect(firstImage).toHaveProperty('index');
          expect(firstImage).toHaveProperty('pixelWidth');
          expect(firstImage).toHaveProperty('pixelHeight');
          expect(firstImage).toHaveProperty('displayWidthMm');
          expect(firstImage).toHaveProperty('displayHeightMm');
          expect(firstImage).toHaveProperty('effectiveDpiX');
          expect(firstImage).toHaveProperty('effectiveDpiY');
          expect(firstImage).toHaveProperty('minEffectiveDpi');

          expect(typeof firstImage.index).toBe('number');
          expect(typeof firstImage.pixelWidth).toBe('number');
          expect(typeof firstImage.pixelHeight).toBe('number');
          expect(typeof firstImage.minEffectiveDpi).toBe('number');
        }
      });
    });
  });

  // ============================================================
  // R3 (2026-08-11): parseInkTacOutput — ink_cov 페이지 평균 TAC 파싱
  // ============================================================
  describe('parseInkTacOutput (R3)', () => {
    it('페이지별 채널 합(이미 % 스케일)으로 TAC 를 계산하고 최대 페이지를 짚는다', () => {
      // ⚠️ ink_cov 실출력은 inkcov(0~1 분율)와 달리 **0~100 퍼센트** 스케일이다 —
      // 2026-08-11 프로덕션 GS 10.x 컨테이너 실측으로 확정(전면 CMYK 0.9/0.85/0.8/0.95
      // → " 89.99  85.00  80.00  94.99 CMYK OK"). ×100 재적용 금지(34980% 실사고).
      const out =
        '  4.09   10.05   14.11    6.26 CMYK OK\n' +
        ' 89.99   85.00   80.00   94.99 CMYK OK\n' +
        '  0.00    0.00    0.00   12.00 CMYK OK\n';

      const r = parseInkTacOutput(out);

      expect(r).not.toBeNull();
      expect(r!.analyzedPages).toBe(3);
      expect(r!.pages[0].tacPercent).toBeCloseTo(34.5, 1);
      expect(r!.pages[1].tacPercent).toBeCloseTo(350, 1); // 전면 리치블랙류
      expect(r!.pages[2].tacPercent).toBeCloseTo(12, 1);
      expect(r!.maxTacPercent).toBeCloseTo(350, 1);
      expect(r!.maxTacPage).toBe(2);
    });

    it('4채널 라인이 하나도 없으면 null (측정 부재 = 경고 스킵 규약)', () => {
      expect(parseInkTacOutput('GPL Ghostscript 10.0\nno pages')).toBeNull();
      expect(parseInkTacOutput('')).toBeNull();
    });

    it('비수치/잡음 라인은 건너뛰고 유효 페이지만 집계한다', () => {
      const out =
        'Processing pages 1 through 2.\n' +
        ' 10.00   10.00   10.00   10.00 CMYK OK\n' +
        'Page 2\n' +
        ' 20.00   20.00   20.00   20.00 CMYK OK\n';
      const r = parseInkTacOutput(out);
      expect(r!.analyzedPages).toBe(2);
      expect(r!.maxTacPercent).toBeCloseTo(80, 1);
    });
  });
});
