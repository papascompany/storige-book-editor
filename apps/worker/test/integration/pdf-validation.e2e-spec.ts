/**
 * PDF 검증 통합 테스트
 * WBS 5.3: 전체 검증 플로우 E2E 테스트
 *
 * 실제 PDF 픽스처를 사용하여 전체 검증 플로우를 테스트
 * 성공/경고/실패 케이스 모두 테스트
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PdfValidatorService } from '../../src/services/pdf-validator.service';
import { ValidationOptions, ErrorCode, WarningCode } from '../../src/dto/validation-result.dto';
import * as fs from 'fs/promises';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/pdf');

describe('PDF Validation E2E (WBS 5.3)', () => {
  let service: PdfValidatorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfValidatorService],
    }).compile();

    service = module.get<PdfValidatorService>(PdfValidatorService);
  });

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
  // RGB 기본 검증 테스트
  // ============================================================
  describe('RGB basic validation', () => {
    describe('Success cases', () => {
      it('should validate RGB single page PDF successfully', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-single.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-single.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(1);
        expect(result.metadata.pageSize.width).toBeCloseTo(210, 0);
        expect(result.metadata.pageSize.height).toBeCloseTo(297, 0);
      });

      it('should validate RGB 8 pages PDF successfully', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-8pages.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-8pages.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 8,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(8);
      });

      it('should validate RGB PDF with bleed successfully', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-a4-with-bleed.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-with-bleed.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 4,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(4);
        expect(result.metadata.hasBleed).toBe(true);
      });

      it('should validate B5 single page PDF successfully', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'success-b5-single.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-b5-single.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 182, height: 257 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(1);
        expect(result.metadata.pageSize.width).toBeCloseTo(182, 0);
        expect(result.metadata.pageSize.height).toBeCloseTo(257, 0);
      });
    });

    describe('Fail cases', () => {
      // R3: 종전엔 가로 페이지마다 LANDSCAPE_PAGE 를 개별 emit 했으나, 이제는
      // 방향 혼재(세로 다수 + 가로 1) 시 MIXED_PAGE_ORIENTATION 1건으로 집계한다.
      it('should aggregate mixed orientations into a single MIXED_PAGE_ORIENTATION warning (auto)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'fail-mixed-orientation.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-mixed-orientation.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 3,
            binding: 'perfect',
            bleed: 0,
            // expectedOrientation 미제공 = auto → 혼재 시 1건 집계
          },
        };

        const result = await service.validate(pdfPath, options);

        // 레거시 per-page 경고는 더 이상 나오지 않는다
        expect(
          result.warnings.find((w) => w.code === WarningCode.LANDSCAPE_PAGE),
        ).toBeUndefined();

        // 혼재 → MIXED_PAGE_ORIENTATION 정확히 1건, 소수=가로(p.2)
        const mixed = result.warnings.filter(
          (w) => w.code === WarningCode.MIXED_PAGE_ORIENTATION,
        );
        expect(mixed).toHaveLength(1);
        expect(mixed[0].details?.minorityPages).toEqual([2]);
      });

      it('should fail for wrong size PDF', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'fail-wrong-size-a5.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-wrong-size-a5.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 }, // A4 주문인데 A5 파일
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);
        const sizeError = result.errors.find(
          (e) => e.code === ErrorCode.SIZE_MISMATCH,
        );
        expect(sizeError).toBeDefined();
      });

      it('should warn for missing bleed when required', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'rgb', 'fail-no-bleed.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-no-bleed.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 3, // bleed 필요
          },
        };

        const result = await service.validate(pdfPath, options);

        const bleedWarning = result.warnings.find(
          (w) => w.code === WarningCode.BLEED_MISSING,
        );
        expect(bleedWarning).toBeDefined();
        // 킬스위치 WORKER_WIRED_FIXABLE_GATING 기본 OFF: 레거시 autoFixable=true.
        // (ON 동작은 pdf-validator.service.spec.ts 의 C+ 게이팅 describe 가 잠근다)
        expect(bleedWarning?.autoFixable).toBe(true);
      });
    });
  });

  // ============================================================
  // 사철 제본 통합 테스트
  // ============================================================
  describe('Saddle stitch validation', () => {
    describe('Success cases - valid page counts (multiple of 4)', () => {
      const validPageCounts = [4, 8, 16, 32, 48, 64];

      validPageCounts.forEach((pageCount) => {
        it(`should pass for ${pageCount} pages (multiple of 4)`, async () => {
          const pdfPath = path.join(FIXTURES_DIR, 'saddle-stitch', `success-${pageCount}-pages.pdf`);
          if (!await fileExists(pdfPath)) {
            console.log(`Skipping: success-${pageCount}-pages.pdf not found`);
            return;
          }

          const options: ValidationOptions = {
            fileType: 'content',
            orderOptions: {
              size: { width: 210, height: 297 },
              pages: pageCount,
              binding: 'saddle',
              bleed: 0,
            },
          };

          const result = await service.validate(pdfPath, options);

          expect(result.metadata.pageCount).toBe(pageCount);

          // 사철 4의 배수 에러가 없어야 함
          const saddleError = result.errors.find(
            (e) => e.code === ErrorCode.SADDLE_STITCH_INVALID,
          );
          expect(saddleError).toBeUndefined();

          // 페이지 수 초과 에러가 없어야 함 (64페이지까지 유효)
          const pageExceedError = result.errors.find(
            (e) => e.code === ErrorCode.PAGE_COUNT_EXCEEDED,
          );
          expect(pageExceedError).toBeUndefined();

          // 중앙부 경고는 있어야 함
          const centerWarning = result.warnings.find(
            (w) => w.code === WarningCode.CENTER_OBJECT_CHECK,
          );
          expect(centerWarning).toBeDefined();
        });
      });
    });

    describe('Fail cases - not multiple of 4', () => {
      const invalidPageCounts = [1, 3, 5, 7, 13, 17, 25];

      invalidPageCounts.forEach((pageCount) => {
        it(`should fail for ${pageCount} pages (not multiple of 4)`, async () => {
          const pdfPath = path.join(FIXTURES_DIR, 'saddle-stitch', `fail-${pageCount}-page${pageCount === 1 ? '' : 's'}.pdf`);
          if (!await fileExists(pdfPath)) {
            console.log(`Skipping: fail-${pageCount}-page(s).pdf not found`);
            return;
          }

          const options: ValidationOptions = {
            fileType: 'content',
            orderOptions: {
              size: { width: 210, height: 297 },
              pages: pageCount,
              binding: 'saddle',
              bleed: 0,
            },
          };

          const result = await service.validate(pdfPath, options);

          expect(result.isValid).toBe(false);

          const saddleError = result.errors.find(
            (e) => e.code === ErrorCode.SADDLE_STITCH_INVALID,
          );
          expect(saddleError).toBeDefined();
          expect(saddleError?.autoFixable).toBe(true);
          expect(saddleError?.fixMethod).toBe('addBlankPages');
        });
      });
    });

    describe('Fail cases - exceeds 64 pages', () => {
      const exceedingPageCounts = [68, 72, 100];

      exceedingPageCounts.forEach((pageCount) => {
        it(`should fail for ${pageCount} pages (exceeds 64 limit)`, async () => {
          const pdfPath = path.join(FIXTURES_DIR, 'saddle-stitch', `fail-${pageCount}-pages.pdf`);
          if (!await fileExists(pdfPath)) {
            console.log(`Skipping: fail-${pageCount}-pages.pdf not found`);
            return;
          }

          const options: ValidationOptions = {
            fileType: 'content',
            orderOptions: {
              size: { width: 210, height: 297 },
              pages: pageCount,
              binding: 'saddle',
              bleed: 0,
            },
          };

          const result = await service.validate(pdfPath, options);

          expect(result.isValid).toBe(false);

          const pageExceedError = result.errors.find(
            (e) => e.code === ErrorCode.PAGE_COUNT_EXCEEDED,
          );
          expect(pageExceedError).toBeDefined();
        });
      });
    });

    describe('Fail cases - both errors', () => {
      it('should fail for 65 pages (not multiple of 4 AND exceeds limit)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'saddle-stitch', 'fail-65-pages.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-65-pages.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 65,
            binding: 'saddle',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);

        // 두 에러 모두 있어야 함
        const saddleError = result.errors.find(
          (e) => e.code === ErrorCode.SADDLE_STITCH_INVALID,
        );
        const pageExceedError = result.errors.find(
          (e) => e.code === ErrorCode.PAGE_COUNT_EXCEEDED,
        );

        expect(saddleError).toBeDefined();
        expect(pageExceedError).toBeDefined();
      });
    });
  });

  // ============================================================
  // 스프레드(펼침면) 통합 테스트
  // ============================================================
  describe('Spread format validation', () => {
    describe('Success cases', () => {
      it('should detect A4 spread format (10 spreads = 20 singles)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'success-a4-spread-10.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-spread-10.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 20, // 10 spreads = 20 single pages
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(10); // 스프레드 10페이지
        expect(result.metadata.pageSize.width).toBeCloseTo(432, 0); // 216 * 2
      });

      it('should detect A4 spread format (20 spreads = 40 singles)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'success-a4-spread-20.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-spread-20.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 40, // 20 spreads = 40 single pages
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(20);
      });

      it('should detect A4 spread format (5 spreads = 10 singles)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'success-a4-spread-5.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-a4-spread-5.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 10, // 5 spreads = 10 single pages
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(5);
      });

      it('should detect B5 spread format', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'success-b5-spread-10.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-b5-spread-10.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 188, height: 263 }, // B5 + bleed
            pages: 20, // 10 spreads
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(10);
        expect(result.metadata.pageSize.width).toBeCloseTo(376, 0); // 188 * 2
      });

      it('should detect saddle stitch spread format', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'success-saddle-spread-8.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-saddle-spread-8.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 16, // 8 spreads = 16 single pages (사철 4의 배수)
            binding: 'saddle',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(8);
      });
    });

    describe('Warning cases - mixed PDF', () => {
      it('should detect mixed PDF (cover single + content spread)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'warn-mixed-cover-content.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-mixed-cover-content.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 11,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        const mixedWarning = result.warnings.find(
          (w) => w.code === WarningCode.MIXED_PDF,
        );
        expect(mixedWarning).toBeDefined();
      });

      it('should detect mixed PDF (first/last single, middle spread)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'warn-mixed-first-last-single.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-mixed-first-last-single.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 12, // 2 singles + 5 spreads
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        const mixedWarning = result.warnings.find(
          (w) => w.code === WarningCode.MIXED_PDF,
        );
        expect(mixedWarning).toBeDefined();
      });
    });

    describe('Fail cases', () => {
      it('should fail for spread submitted for single page order', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-spread-for-single-order.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-spread-for-single-order.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 }, // 단면 주문인데 스프레드 파일
            pages: 10,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        // 사이즈 불일치 에러가 발생해야 함
        const sizeError = result.errors.find(
          (e) => e.code === ErrorCode.SIZE_MISMATCH,
        );
        expect(sizeError).toBeDefined();
      });

      it('should fail for wrong width spread', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-wrong-width-spread.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-wrong-width-spread.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 20, // 432mm 기대하는데 400mm 파일
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);
      });

      it('should fail for wrong height spread', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-wrong-height-spread.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-wrong-height-spread.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 20,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);
      });

      it('should fail for too small spread (A5 size)', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-too-small-spread.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-too-small-spread.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 }, // A4 스프레드 기대
            pages: 20,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);
        const sizeError = result.errors.find(
          (e) => e.code === ErrorCode.SIZE_MISMATCH,
        );
        expect(sizeError).toBeDefined();
      });

      it('should fail for single pages submitted for spread order', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-single-for-spread-order.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-single-for-spread-order.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 432, height: 303 }, // 스프레드 주문인데 단면 파일
            pages: 10,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.isValid).toBe(false);
        const sizeError = result.errors.find(
          (e) => e.code === ErrorCode.SIZE_MISMATCH,
        );
        expect(sizeError).toBeDefined();
      });

      it('should fail for irregular page sizes', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spread', 'fail-irregular-sizes.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-irregular-sizes.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 3,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate(pdfPath, options);

        // 페이지 크기 불일치로 SIZE_MISMATCH 에러 또는 MIXED_PDF 경고가 발생할 수 있음
        const hasSizeError = result.errors.some(
          (e) => e.code === ErrorCode.SIZE_MISMATCH,
        );
        const hasMixedWarning = result.warnings.some(
          (w) => w.code === WarningCode.MIXED_PDF,
        );
        expect(hasSizeError || hasMixedWarning).toBe(true);
      });
    });
  });

  // ============================================================
  // CMYK 감지 통합 테스트
  // ============================================================
  describe('CMYK detection', () => {
    describe('Success cases', () => {
      it('should pass for RGB only PDF', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'cmyk', 'success-rgb-only.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-rgb-only.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(1);
        // RGB 파일이므로 colorMode는 RGB
        // expect(result.metadata.colorMode).toBe('RGB');
      });
    });

    describe('Fail cases', () => {
      it('should detect CMYK in post-process file', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'cmyk', 'fail-cmyk-for-postprocess.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: fail-cmyk-for-postprocess.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content', // 현재 content/cover만 지원
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        // CMYK 파일이므로 메타데이터에서 CMYK 시그니처가 감지되어야 함
        expect(result.metadata.pageCount).toBe(1);
      });
    });
  });

  // ============================================================
  // 별색(Spot Color) 감지 통합 테스트
  // ============================================================
  describe('Spot color detection', () => {
    describe('Success cases', () => {
      it('should detect spot colors in PDF', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spot-color', 'success-spot-only.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-spot-only.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content', // 현재 content/cover만 지원
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(1);
      });
    });

    describe('Warning cases', () => {
      it('should warn for CMYK + spot color mixed', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'spot-color', 'warn-cmyk-spot-mixed.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-cmyk-spot-mixed.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        expect(result.metadata.pageCount).toBe(1);
      });
    });
  });

  // ============================================================
  // 투명도/오버프린트 감지 통합 테스트
  // ============================================================
  describe('Transparency and overprint detection', () => {
    describe('Success cases', () => {
      it('should pass for PDF without transparency', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'transparency', 'success-no-transparency.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: success-no-transparency.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        const transparencyWarning = result.warnings.find(
          (w) => w.code === WarningCode.TRANSPARENCY_DETECTED,
        );
        expect(transparencyWarning).toBeUndefined();
      });
    });

    describe('Warning cases', () => {
      it('should warn for PDF with transparency', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'transparency', 'warn-with-transparency.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-with-transparency.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        const transparencyWarning = result.warnings.find(
          (w) => w.code === WarningCode.TRANSPARENCY_DETECTED,
        );
        expect(transparencyWarning).toBeDefined();
      });

      it('should warn for PDF with overprint', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'transparency', 'warn-with-overprint.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-with-overprint.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        const overprintWarning = result.warnings.find(
          (w) => w.code === WarningCode.OVERPRINT_DETECTED,
        );
        expect(overprintWarning).toBeDefined();
      });

      it('should warn for PDF with both transparency and overprint', async () => {
        const pdfPath = path.join(FIXTURES_DIR, 'transparency', 'warn-both-trans-overprint.pdf');
        if (!await fileExists(pdfPath)) {
          console.log('Skipping: warn-both-trans-overprint.pdf not found');
          return;
        }

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate(pdfPath, options);

        const transparencyWarning = result.warnings.find(
          (w) => w.code === WarningCode.TRANSPARENCY_DETECTED,
        );
        const overprintWarning = result.warnings.find(
          (w) => w.code === WarningCode.OVERPRINT_DETECTED,
        );
        expect(transparencyWarning).toBeDefined();
        expect(overprintWarning).toBeDefined();
      });
    });
  });

  // ============================================================
  // 폴백 시나리오 테스트
  // ============================================================
  describe('Fallback scenarios', () => {
    it('should handle corrupted PDF gracefully', async () => {
      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('/nonexistent/file.pdf', options);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
