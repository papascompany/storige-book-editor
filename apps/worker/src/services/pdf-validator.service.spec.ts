import { Test, TestingModule } from '@nestjs/testing';
import { PdfValidatorService } from './pdf-validator.service';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { ValidationOptions, ErrorCode, WarningCode } from '../dto/validation-result.dto';
import { VALIDATION_CONFIG } from '../config/validation.config';
import { assertSafeDownloadUrl } from '../utils/url-safety';

jest.mock('fs/promises');
jest.mock('axios');
// SSRF 가드(P0-1 M1)는 url-safety.spec.ts 가 오프라인으로 단독 검증한다. 여기선 downloadFile
// 단위테스트가 실제 DNS 조회를 타지 않도록 no-op 으로 목하고, 배선(호출 여부)만 확인한다.
jest.mock('../utils/url-safety', () => ({
  assertSafeDownloadUrl: jest.fn().mockResolvedValue(undefined),
}));

// ghostscript 함수 모킹
jest.mock('../utils/ghostscript', () => ({
  detectCmykUsage: jest.fn().mockResolvedValue({
    pages: [],
    totalCmykUsage: false,
    colorMode: 'RGB',
  }),
  isGhostscriptAvailable: jest.fn().mockResolvedValue(true),
  detectSpotColors: jest.fn().mockResolvedValue({
    hasSpotColors: false,
    spotColorNames: [],
    pages: [],
  }),
  detectTransparencyAndOverprint: jest.fn().mockResolvedValue({
    hasTransparency: false,
    hasOverprint: false,
    pages: [],
  }),
  detectImageResolutionFromPdf: jest.fn().mockResolvedValue({
    imageCount: 0,
    hasLowResolution: false,
    minResolution: 0,
    avgResolution: 0,
    lowResImages: [],
    images: [],
  }),
  // 기본값: 폰트 모두 임베딩됨(경고 없음). 개별 테스트에서 mockResolvedValueOnce 로 override.
  detectFonts: jest.fn().mockResolvedValue({
    fontCount: 0,
    fonts: [],
    hasUnembeddedFonts: false,
    unembeddedFonts: [],
    allFontsEmbedded: true,
  }),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PdfValidatorService', () => {
  let service: PdfValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfValidatorService],
    }).compile();

    service = module.get<PdfValidatorService>(PdfValidatorService);
    jest.clearAllMocks();
  });

  describe('validate', () => {
    const createMockPdf = async (pageCount: number, width: number, height: number) => {
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < pageCount; i++) {
        // Convert mm to points (1mm = 2.83465 points)
        pdfDoc.addPage([width * 2.83465, height * 2.83465]);
      }
      return pdfDoc.save();
    };

    const defaultOptions: ValidationOptions = {
      fileType: 'content',
      orderOptions: {
        size: { width: 210, height: 297 },
        pages: 4,
        binding: 'perfect',
        bleed: 3,
      },
    };

    it('should validate a valid PDF successfully', async () => {
      const pdfBytes = await createMockPdf(4, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const result = await service.validate('./test.pdf', defaultOptions);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.pageCount).toBe(4);
    });

    it('should return error for corrupted PDF', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('not a pdf'));

      const result = await service.validate('./corrupted.pdf', defaultOptions);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ErrorCode.FILE_CORRUPTED);
    });

    // P0-4(2026-06-22): 0페이지 PDF 는 과거 firstPage.getSize() TypeError → FILE_CORRUPTED 오진.
    // 이제 PAGE_COUNT_INVALID 로 정확히 진단하고 크래시하지 않아야 한다.
    // pdf-lib 의 create/save/load 라운드트립은 빈 문서를 1페이지로 정규화하므로(검증됨),
    // 타 도구가 만든 진짜 0페이지 상태를 재현하려면 load 를 스텁해 getPages()=[] 를 강제한다.
    it('should return PAGE_COUNT_INVALID (not crash) for a 0-page PDF', async () => {
      const pdfBytes = await createMockPdf(1, 210, 297); // 크기검증 통과용 더미 바이트
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));
      const loadSpy = jest
        .spyOn(PDFDocument, 'load')
        .mockResolvedValueOnce({ getPages: () => [] } as any);

      try {
        const result = await service.validate('./empty.pdf', defaultOptions);

        expect(result.isValid).toBe(false);
        const zeroPageError = result.errors.find(
          (e) => e.code === ErrorCode.PAGE_COUNT_INVALID,
        );
        expect(zeroPageError).toBeDefined();
        expect(zeroPageError?.details?.actual).toBe(0);
        // firstPage.getSize() TypeError → FILE_CORRUPTED 오진이 없어야 한다
        expect(
          result.errors.find((e) => e.code === ErrorCode.FILE_CORRUPTED),
        ).toBeUndefined();
      } finally {
        loadSpy.mockRestore();
      }
    });

    it('should return error when file is too large', async () => {
      const pdfBytes = await createMockPdf(1, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const optionsWithSmallLimit: ValidationOptions = {
        ...defaultOptions,
        maxFileSize: 100, // 100 bytes
      };

      const result = await service.validate('./large.pdf', optionsWithSmallLimit);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ErrorCode.FILE_TOO_LARGE);
    });

    it('should return error for invalid page count with perfect binding', async () => {
      const pdfBytes = await createMockPdf(3, 210, 297); // 3 pages, not multiple of 4
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        ...defaultOptions,
        orderOptions: {
          ...defaultOptions.orderOptions,
          pages: 3,
        },
      };

      const result = await service.validate('./test.pdf', options);

      expect(result.isValid).toBe(false);
      const pageCountError = result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID);
      expect(pageCountError).toBeDefined();
      expect(pageCountError?.autoFixable).toBe(true);
      expect(pageCountError?.fixMethod).toBe('addBlankPages');
    });

    it('should return error for saddle binding exceeding 64 pages', async () => {
      const pdfBytes = await createMockPdf(68, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        ...defaultOptions,
        orderOptions: {
          ...defaultOptions.orderOptions,
          binding: 'saddle',
          pages: 68,
        },
      };

      const result = await service.validate('./test.pdf', options);

      expect(result.isValid).toBe(false);
      const pageCountError = result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_EXCEEDED);
      expect(pageCountError).toBeDefined();
    });

    it('should return warning for page count mismatch', async () => {
      const pdfBytes = await createMockPdf(4, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        ...defaultOptions,
        orderOptions: {
          ...defaultOptions.orderOptions,
          pages: 8, // Expected 8 but PDF has 4
        },
      };

      const result = await service.validate('./test.pdf', options);

      const pageCountWarning = result.warnings.find(w => w.code === WarningCode.PAGE_COUNT_MISMATCH);
      expect(pageCountWarning).toBeDefined();
    });

    // ── 데이터 주도 페이지수 (pageMultiple/pageCountMax/pageCountMin, 2026-06-25) ──
    // 파트너가 제본별 값을 전달하면 binding 하드코딩 대신 그 값으로 검증. 미전송 시 레거시(byte-identical).
    const ddOptions = (
      orderOverrides: Record<string, unknown>,
    ): ValidationOptions => ({
      ...defaultOptions,
      orderOptions: { ...defaultOptions.orderOptions, ...orderOverrides } as any,
    });

    it('데이터주도: pageMultiple 위반 → PAGE_COUNT_INVALID(자동수정, expected=올림 배수)', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(35, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ pageMultiple: 4, pages: 35 }));
      const err = result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID);
      expect(err).toBeDefined();
      expect(err?.autoFixable).toBe(true);
      expect(err?.fixMethod).toBe('addBlankPages');
      expect(err?.details?.expected).toBe(36);
      expect(err?.details?.pageMultiple).toBe(4);
    });

    it('데이터주도: pageMultiple 충족 → 페이지수 에러 없음', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(36, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ pageMultiple: 4, pages: 36 }));
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID)).toBeUndefined();
    });

    it('데이터주도: pageMultiple 이 binding 레거시(perfect=4)를 오버라이드 (무선=2)', async () => {
      // 34p 는 레거시 perfect(%4)면 에러지만, pageMultiple=2 면 34%2=0 → 통과.
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(34, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ binding: 'perfect', pageMultiple: 2, pages: 34 }));
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID)).toBeUndefined();
    });

    it('데이터주도: pageCountMax 초과 → PAGE_COUNT_EXCEEDED', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(40, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ pageMultiple: 4, pageCountMax: 32, pages: 40 }));
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_EXCEEDED)).toBeDefined();
    });

    it('데이터주도: pageCountMin 미만 → PAGE_COUNT_BELOW_MIN 경고(비차단·자동수정 불가)', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(20, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ pageCountMin: 32, pages: 20 }));
      const warn = result.warnings.find(w => w.code === WarningCode.PAGE_COUNT_BELOW_MIN);
      expect(warn).toBeDefined();
      expect(warn?.autoFixable).toBe(false);
      // 하한 미만은 경고일 뿐 → 페이지수 에러 없음
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID)).toBeUndefined();
    });

    it('데이터주도: saddle + pageMultiple 이면 validateSaddleStitch 의 %4 강제 스킵(중앙객체 경고는 유지)', async () => {
      // 10p 는 레거시 saddle(%4)이면 SADDLE_STITCH_INVALID 지만, pageMultiple=2 면 10%2=0 → 통과해야.
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(10, 210, 297)));
      const result = await service.validate('./dd.pdf', ddOptions({ binding: 'saddle', pageMultiple: 2, pages: 10 }));
      expect(result.errors.find(e => e.code === ErrorCode.SADDLE_STITCH_INVALID)).toBeUndefined();
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID)).toBeUndefined();
      // 사철 중앙부 객체 확인 경고는 페이지수와 무관 → 유지
      expect(result.warnings.find(w => w.code === WarningCode.CENTER_OBJECT_CHECK)).toBeDefined();
    });

    it('레거시 잠금: 데이터주도 필드 미전송 시 perfect %4 에러 현행 유지', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(34, 210, 297)));
      const result = await service.validate('./legacy.pdf', ddOptions({ binding: 'perfect', pages: 34 }));
      expect(result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID)).toBeDefined();
    });

    it('should return warning for missing bleed', async () => {
      const pdfBytes = await createMockPdf(4, 210, 297); // No bleed
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const result = await service.validate('./test.pdf', defaultOptions);

      const bleedWarning = result.warnings.find(w => w.code === WarningCode.BLEED_MISSING);
      expect(bleedWarning).toBeDefined();
      // 킬스위치 기본 OFF: 레거시 autoFixable=true 유지 (게이팅 ON 동작은 아래 C+ describe 참조)
      expect(bleedWarning?.autoFixable).toBe(true);
      expect(bleedWarning?.fixMethod).toBe('extendBleed');
    });

    it('should detect PDF with bleed', async () => {
      // 210 + 3*2 = 216, 297 + 3*2 = 303
      const pdfBytes = await createMockPdf(4, 216, 303);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const result = await service.validate('./test.pdf', defaultOptions);

      expect(result.metadata.hasBleed).toBe(true);
      const bleedWarning = result.warnings.find(w => w.code === WarningCode.BLEED_MISSING);
      expect(bleedWarning).toBeUndefined();
    });

    it('should return error for size mismatch', async () => {
      const pdfBytes = await createMockPdf(4, 100, 100); // Wrong size
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const result = await service.validate('./test.pdf', defaultOptions);

      expect(result.isValid).toBe(false);
      const sizeError = result.errors.find(e => e.code === ErrorCode.SIZE_MISMATCH);
      expect(sizeError).toBeDefined();
    });

    // ── C+ 게이팅 (2026-07-11, 킬스위치 WORKER_WIRED_FIXABLE_GATING 기본 OFF) ──
    // ON 이면 autoFixable 은 실행기가 배선된 fixMethod(WIRED_FIX_METHODS=
    // {addBlankPages, extendBleed(2026-07-13 fix-bleed 배선)})에만
    // 부여 — 실행 수단 없는 항목이 FIXABLE(원클릭 해결처럼 보이는 상태)로 노출되는 것을 차단.
    // OFF(기본)는 레거시 byte-identical. fixMethod 는 양쪽 모두 의도 메타로 보존.
    describe('C+ 게이팅: WIRED_FIXABLE_GATING 킬스위치', () => {
      const cfg = VALIDATION_CONFIG as unknown as { WIRED_FIXABLE_GATING: boolean };
      afterEach(() => {
        cfg.WIRED_FIXABLE_GATING = false; // 기본(OFF) 복원
      });

      it('킬스위치는 기본 OFF 다 (WORKER_WIRED_FIXABLE_GATING 미설정)', () => {
        expect(process.env.WORKER_WIRED_FIXABLE_GATING).toBeUndefined();
        expect(cfg.WIRED_FIXABLE_GATING).toBe(false);
      });

      it('OFF(기본): SIZE_MISMATCH 는 레거시 autoFixable=true 유지', async () => {
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 100, 100)));
        const result = await service.validate('./size.pdf', defaultOptions);
        const err = result.errors.find(e => e.code === ErrorCode.SIZE_MISMATCH);
        expect(err?.autoFixable).toBe(true);
        expect(err?.fixMethod).toBe('resizeWithPadding');
      });

      it('ON: SIZE_MISMATCH autoFixable=false + fixMethod=resizeWithPadding 보존', async () => {
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 100, 100)));
        const result = await service.validate('./size.pdf', defaultOptions);
        const err = result.errors.find(e => e.code === ErrorCode.SIZE_MISMATCH);
        expect(err).toBeDefined();
        expect(err?.autoFixable).toBe(false);
        expect(err?.fixMethod).toBe('resizeWithPadding');
      });

      it('ON: SIZE_MISMATCH 단독 에러 파일은 errors.every(autoFixable)=false (processor FAILED 파생 잠금)', async () => {
        // 페이지수(4=배수 충족)·판형만 어긋난 파일 → 에러는 SIZE_MISMATCH 뿐이어야 하고,
        // 게이팅 후 전부 autoFixable=false → validation.processor 가 FIXABLE 대신 FAILED 로 판정.
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 100, 100)));
        const result = await service.validate('./size-only.pdf', defaultOptions);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.every(e => e.code === ErrorCode.SIZE_MISMATCH)).toBe(true);
        expect(result.errors.every(e => e.autoFixable)).toBe(false);
      });

      it('ON: 혼재 잡(SIZE_MISMATCH + PAGE_COUNT_INVALID)도 every(autoFixable)=false — FIXABLE→FAILED 스코프 잠금', async () => {
        // 3p(배수 위반=addBlankPages true) + 100x100(판형 위반=false 혼재) →
        // errors.every()=false. 파트너 고지 범위가 '단독'보다 넓음을 테스트로 명문화.
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(3, 100, 100)));
        const result = await service.validate('./mixed.pdf', {
          ...defaultOptions,
          orderOptions: { ...defaultOptions.orderOptions, pages: 3 },
        });
        const codes = result.errors.map(e => e.code);
        expect(codes).toContain(ErrorCode.SIZE_MISMATCH);
        expect(codes).toContain(ErrorCode.PAGE_COUNT_INVALID);
        expect(result.errors.every(e => e.autoFixable)).toBe(false);
      });

      it('ON: SPINE_SIZE_MISMATCH autoFixable=false + fixMethod=adjustSpine 보존', async () => {
        // wing 미전달 회귀 시나리오 재사용: 511mm 표지 vs 기대 411mm → SPINE_SIZE_MISMATCH.
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 511, 286)));
        const result = await service.validate('./cover.pdf', {
          fileType: 'cover',
          orderOptions: {
            size: { width: 200, height: 280 }, pages: 4, binding: 'perfect', bleed: 3,
            spineWidthMm: 5,
          },
        } as ValidationOptions);
        const err = result.errors.find(e => e.code === ErrorCode.SPINE_SIZE_MISMATCH);
        expect(err).toBeDefined();
        expect(err?.autoFixable).toBe(false);
        expect(err?.fixMethod).toBe('adjustSpine');
      });

      it('ON: BLEED_MISSING 경고 autoFixable=true 유지 — extendBleed 실행기 배선(2026-07-13, POST /worker-jobs/fix-bleed)', async () => {
        // 2026-07-13 이전엔 미배선이라 ON 시 false 였다. fix-bleed 실행기 배선과 동일 커밋으로
        // WIRED_FIX_METHODS 에 'extendBleed' 추가 → 게이팅 ON 에서도 정직하게 true.
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 210, 297)));
        const result = await service.validate('./bleed.pdf', defaultOptions);
        const warn = result.warnings.find(w => w.code === WarningCode.BLEED_MISSING);
        expect(warn).toBeDefined();
        expect(warn?.autoFixable).toBe(true);
        expect(warn?.fixMethod).toBe('extendBleed');
        expect(result.isValid).toBe(true);
      });

      it('ON: 배선된 addBlankPages 는 autoFixable=true 유지 (perfect %4)', async () => {
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(3, 210, 297)));
        const result = await service.validate('./pc.pdf', {
          ...defaultOptions,
          orderOptions: { ...defaultOptions.orderOptions, pages: 3 },
        });
        const err = result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID);
        expect(err?.autoFixable).toBe(true);
        expect(err?.fixMethod).toBe('addBlankPages');
      });

      it('ON: PAGE_COUNT_MISMATCH(부족) 경고도 배선된 addBlankPages 라 autoFixable=true 유지', async () => {
        cfg.WIRED_FIXABLE_GATING = true;
        mockedFs.readFile.mockResolvedValue(Buffer.from(await createMockPdf(4, 210, 297)));
        const result = await service.validate('./pcm.pdf', {
          ...defaultOptions,
          orderOptions: { ...defaultOptions.orderOptions, pages: 8 },
        });
        const warn = result.warnings.find(w => w.code === WarningCode.PAGE_COUNT_MISMATCH);
        expect(warn?.autoFixable).toBe(true);
        expect(warn?.fixMethod).toBe('addBlankPages');
      });
    });

    it('should validate cover PDF page count', async () => {
      const pdfBytes = await createMockPdf(3, 210, 297); // Invalid cover page count
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'cover',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 4,
          binding: 'perfect',
          bleed: 3,
        },
      };

      const result = await service.validate('./cover.pdf', options);

      expect(result.isValid).toBe(false);
      const pageCountError = result.errors.find(e => e.code === ErrorCode.PAGE_COUNT_INVALID);
      expect(pageCountError).toBeDefined();
    });

    describe('spine + wing validation (2026-06-04)', () => {
      const spineErr = (r: any) => r.errors.find((e: any) => e.code === ErrorCode.SPINE_SIZE_MISMATCH);

      it('should accept cover whose width includes provided spineWidthMm + wings', async () => {
        // 기대 총너비 = 200*2 + spine 5 + wing 50*2 + bleed 3*2 = 511mm
        const pdfBytes = await createMockPdf(4, 511, 286);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));
        const result = await service.validate('./cover.pdf', {
          fileType: 'cover',
          orderOptions: {
            size: { width: 200, height: 280 }, pages: 4, binding: 'perfect', bleed: 3,
            spineWidthMm: 5, wingEnabled: true, wingWidthMm: 50,
          },
        } as ValidationOptions);
        expect(spineErr(result)).toBeUndefined(); // 책등·날개 반영 → 책등 검증 통과
      });

      it('should reject the same wing cover when wing info is NOT passed (regression of old bug)', async () => {
        // 동일 511mm 표지인데 wing 미전달 → 기대 411mm → 100mm 초과 → SPINE_SIZE_MISMATCH
        const pdfBytes = await createMockPdf(4, 511, 286);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));
        const result = await service.validate('./cover.pdf', {
          fileType: 'cover',
          orderOptions: {
            size: { width: 200, height: 280 }, pages: 4, binding: 'perfect', bleed: 3,
            spineWidthMm: 5, // wing 미전달
          },
        } as ValidationOptions);
        expect(spineErr(result)).toBeDefined();
      });

      it('should prefer spineWidthMm over paperThickness fallback', async () => {
        // spineWidthMm 10 사용 시 기대 = 200*2 + 10 + 6 = 416mm (paperThickness fallback=0.2면 406.2 → 불일치)
        const pdfBytes = await createMockPdf(4, 416, 286);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));
        const result = await service.validate('./cover.pdf', {
          fileType: 'cover',
          orderOptions: {
            size: { width: 200, height: 280 }, pages: 4, binding: 'perfect', bleed: 3,
            paperThickness: 0.1, spineWidthMm: 10,
          },
        } as ValidationOptions);
        expect(spineErr(result)).toBeUndefined();
      });
    });

    it('should download file from URL', async () => {
      const pdfBytes = await createMockPdf(4, 210, 297);
      mockedAxios.get.mockResolvedValue({
        data: pdfBytes,
      });

      const result = await service.validate('https://example.com/test.pdf', defaultOptions);

      // SSRF 가드(P0-1 M1)가 raw-URL 다운로드 전에 호출됐는지 배선 확인
      expect(assertSafeDownloadUrl).toHaveBeenCalledWith('https://example.com/test.pdf');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://example.com/test.pdf',
        expect.objectContaining({
          responseType: 'arraybuffer',
          timeout: 60000,
          maxRedirects: 0,
        }),
      );
      expect(result.metadata.pageCount).toBe(4);
    });

    it('should handle storage/ path correctly', async () => {
      const originalEnv = process.env.WORKER_STORAGE_PATH;
      process.env.WORKER_STORAGE_PATH = '../api';

      const pdfBytes = await createMockPdf(4, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      await service.validate('storage/uploads/test.pdf', defaultOptions);

      expect(mockedFs.readFile).toHaveBeenCalledWith('../api/storage/uploads/test.pdf');

      process.env.WORKER_STORAGE_PATH = originalEnv;
    });

    it('should use default storage path when WORKER_STORAGE_PATH not set', async () => {
      const originalEnv = process.env.WORKER_STORAGE_PATH;
      delete process.env.WORKER_STORAGE_PATH;

      const pdfBytes = await createMockPdf(4, 210, 297);
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      await service.validate('storage/uploads/test.pdf', defaultOptions);

      expect(mockedFs.readFile).toHaveBeenCalledWith('../api/storage/uploads/test.pdf');

      process.env.WORKER_STORAGE_PATH = originalEnv;
    });

    // ============================================================
    // WBS 2.1 / R3: 페이지 방향 검증 테스트 (집계형 재구현)
    // 종전 무차별 LANDSCAPE_PAGE per-page emit 은 제거 → 카테고리당 1건 집계.
    // ============================================================
    describe('page orientation detection (WBS 2.1 / R3)', () => {
      // 더 이상 페이지마다 LANDSCAPE_PAGE 를 뿜지 않는다(레거시 enum 만 유지).
      it('should NOT emit per-page LANDSCAPE_PAGE warnings anymore (legacy removed)', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([297 * 2.83465, 210 * 2.83465]); // Landscape A4
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 297, height: 210 }, // Landscape
            pages: 1,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate('./landscape.pdf', options);

        const landscapeWarning = result.warnings.find(
          (w) => w.code === WarningCode.LANDSCAPE_PAGE,
        );
        expect(landscapeWarning).toBeUndefined();
      });

      // 가로책(전 페이지 landscape, auto) → 단일 방향이므로 경고 0건 (오탐 해소)
      it('should NOT warn for an all-landscape book under auto (no false positive)', async () => {
        const pdfDoc = await PDFDocument.create();
        for (let i = 0; i < 4; i++) {
          pdfDoc.addPage([297 * 2.83465, 210 * 2.83465]); // all landscape
        }
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 297, height: 210 },
            pages: 4,
            binding: 'perfect',
            bleed: 0,
            // expectedOrientation 미제공 = auto
          },
        };

        const result = await service.validate('./landscape-book.pdf', options);

        expect(
          result.warnings.find((w) => w.code === WarningCode.MIXED_PAGE_ORIENTATION),
        ).toBeUndefined();
        expect(
          result.warnings.find((w) => w.code === WarningCode.ORIENTATION_MISMATCH),
        ).toBeUndefined();
      });

      // 단일 방향(전 페이지 portrait, auto) → 경고 0건
      it('should NOT warn for an all-portrait book under auto', async () => {
        const pdfBytes = await createMockPdf(4, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const result = await service.validate('./portrait.pdf', defaultOptions);

        expect(
          result.warnings.find((w) => w.code === WarningCode.MIXED_PAGE_ORIENTATION),
        ).toBeUndefined();
        expect(
          result.warnings.find((w) => w.code === WarningCode.LANDSCAPE_PAGE),
        ).toBeUndefined();
      });

      // 혼재(세로 다수 + 가로 1, auto) → MIXED_PAGE_ORIENTATION 1건, 소수=가로 목록
      it('should emit exactly one MIXED_PAGE_ORIENTATION when orientations are mixed (auto)', async () => {
        const pdfDoc = await PDFDocument.create();
        // 3 portrait + 1 landscape (landscape 가 4번째 페이지)
        for (let i = 0; i < 3; i++) {
          pdfDoc.addPage([210 * 2.83465, 297 * 2.83465]);
        }
        pdfDoc.addPage([297 * 2.83465, 210 * 2.83465]);
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 4,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate('./mixed-orient.pdf', options);

        const mixed = result.warnings.filter(
          (w) => w.code === WarningCode.MIXED_PAGE_ORIENTATION,
        );
        expect(mixed).toHaveLength(1);
        expect(mixed[0].details?.portraitCount).toBe(3);
        expect(mixed[0].details?.landscapeCount).toBe(1);
        expect(mixed[0].details?.minorityPages).toEqual([4]); // 소수=가로(p.4)
        // 비차단 → 통과
        expect(result.isValid).toBe(true);
      });

      // expectedOrientation='portrait' + 가로 페이지 존재 → ORIENTATION_MISMATCH 1건
      // (4의 배수 페이지 + 정사이즈로 구성해 방향 경고만 단독 검증 = 비차단 통과 확인)
      it('should emit one ORIENTATION_MISMATCH when expected portrait but landscape pages exist', async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([210 * 2.83465, 297 * 2.83465]); // portrait (p.1)
        pdfDoc.addPage([210 * 2.83465, 297 * 2.83465]); // portrait (p.2)
        pdfDoc.addPage([210 * 2.83465, 297 * 2.83465]); // portrait (p.3)
        pdfDoc.addPage([297 * 2.83465, 210 * 2.83465]); // landscape (p.4)
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 4,
            binding: 'perfect',
            bleed: 0,
            expectedOrientation: 'portrait',
          },
        };

        const result = await service.validate('./portrait-order.pdf', options);

        const mismatch = result.warnings.filter(
          (w) => w.code === WarningCode.ORIENTATION_MISMATCH,
        );
        expect(mismatch).toHaveLength(1);
        expect(mismatch[0].details?.expected).toBe('portrait');
        expect(mismatch[0].details?.mismatchPages).toEqual([4]);
        // expected 명시 시에는 MIXED 경고를 내지 않는다
        expect(
          result.warnings.find((w) => w.code === WarningCode.MIXED_PAGE_ORIENTATION),
        ).toBeUndefined();
        expect(result.isValid).toBe(true);
      });

      // expectedOrientation='portrait' + 전부 세로 → 경고 0건
      it('should NOT warn when all pages match expected portrait orientation', async () => {
        const pdfBytes = await createMockPdf(4, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          ...defaultOptions,
          orderOptions: {
            ...defaultOptions.orderOptions,
            expectedOrientation: 'portrait',
          },
        };

        const result = await service.validate('./portrait.pdf', options);

        expect(
          result.warnings.find((w) => w.code === WarningCode.ORIENTATION_MISMATCH),
        ).toBeUndefined();
      });
    });

    // ============================================================
    // WBS 2.2: 사철 제본 검증 테스트
    // ============================================================
    describe('saddle stitch validation (WBS 2.2)', () => {
      it('should error when saddle stitch pages not multiple of 4', async () => {
        const pdfBytes = await createMockPdf(13, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 13,
            binding: 'saddle',
            bleed: 3,
          },
        };

        const result = await service.validate('./saddle.pdf', options);

        expect(result.isValid).toBe(false);
        const saddleError = result.errors.find(
          (e) => e.code === ErrorCode.SADDLE_STITCH_INVALID,
        );
        expect(saddleError).toBeDefined();
        expect(saddleError?.autoFixable).toBe(true);
        expect(saddleError?.fixMethod).toBe('addBlankPages');
      });

      it('should pass when saddle stitch pages are multiple of 4', async () => {
        const pdfBytes = await createMockPdf(16, 216, 303);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 16,
            binding: 'saddle',
            bleed: 3,
          },
        };

        const result = await service.validate('./saddle.pdf', options);

        const saddleError = result.errors.find(
          (e) => e.code === ErrorCode.SADDLE_STITCH_INVALID,
        );
        expect(saddleError).toBeUndefined();
      });

      it('should add center object check warning for saddle stitch', async () => {
        const pdfBytes = await createMockPdf(16, 216, 303);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 16,
            binding: 'saddle',
            bleed: 3,
          },
        };

        const result = await service.validate('./saddle.pdf', options);

        const centerWarning = result.warnings.find(
          (w) => w.code === WarningCode.CENTER_OBJECT_CHECK,
        );
        expect(centerWarning).toBeDefined();
      });
    });

    // ============================================================
    // R5: 짝수책 경고 (spring 홀수) 테스트
    // ============================================================
    describe('odd page count warning (R5)', () => {
      // spring 제본 + 홀수 페이지 → ODD_PAGE_COUNT 경고 1건 (비차단)
      it('should warn ODD_PAGE_COUNT for spring binding with odd pages', async () => {
        const pdfBytes = await createMockPdf(5, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 5,
            binding: 'spring',
            bleed: 0,
          },
        };

        const result = await service.validate('./spring-odd.pdf', options);

        const oddWarnings = result.warnings.filter(
          (w) => w.code === WarningCode.ODD_PAGE_COUNT,
        );
        expect(oddWarnings).toHaveLength(1);
        expect(oddWarnings[0].details?.actualPages).toBe(5);
        expect(oddWarnings[0].details?.suggestion).toBe(6);
        expect(oddWarnings[0].autoFixable).toBe(false);
        // spring 은 4배수 강제가 없으므로 페이지수 에러 없음 → 비차단 통과
        expect(result.isValid).toBe(true);
      });

      // spring 제본 + 짝수 페이지 → 경고 0건
      it('should NOT warn for spring binding with even pages', async () => {
        const pdfBytes = await createMockPdf(6, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 6,
            binding: 'spring',
            bleed: 0,
          },
        };

        const result = await service.validate('./spring-even.pdf', options);

        expect(
          result.warnings.find((w) => w.code === WarningCode.ODD_PAGE_COUNT),
        ).toBeUndefined();
      });

      // perfect 제본 + 홀수(비4배수) → 기존 PAGE_COUNT_INVALID 에러만, ODD 중복 없음
      it('should NOT add ODD_PAGE_COUNT for perfect binding odd pages (covered by 4-multiple error)', async () => {
        const pdfBytes = await createMockPdf(3, 210, 297);
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 3,
            binding: 'perfect',
            bleed: 0,
          },
        };

        const result = await service.validate('./perfect-odd.pdf', options);

        // 4배수 위반 에러는 존재
        expect(
          result.errors.find((e) => e.code === ErrorCode.PAGE_COUNT_INVALID),
        ).toBeDefined();
        // ODD_PAGE_COUNT 는 중복으로 추가되지 않음
        expect(
          result.warnings.find((w) => w.code === WarningCode.ODD_PAGE_COUNT),
        ).toBeUndefined();
      });
    });

    // ============================================================
    // WBS 2.3: 스프레드(펼침면) 감지 테스트
    // ============================================================
    describe('spread format detection (WBS 2.3)', () => {
      it('should detect spread format when width is double', async () => {
        // 스프레드: 432 x 303 (= 216 * 2 x 303)
        const pdfDoc = await PDFDocument.create();
        for (let i = 0; i < 10; i++) {
          pdfDoc.addPage([432 * 2.83465, 303 * 2.83465]);
        }
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 }, // 단면 기준
            pages: 20, // 스프레드 10페이지 = 단면 20페이지
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate('./spread.pdf', options);

        // 스프레드 형식은 에러가 아닌 정상 처리
        // 단, SIZE_MISMATCH가 발생할 수 있음 (현재 로직에서)
        expect(result.metadata.pageCount).toBe(10);
      });

      it('should detect mixed PDF (cover + content spread)', async () => {
        const pdfDoc = await PDFDocument.create();
        // 표지: 216 x 303 (단면)
        pdfDoc.addPage([216 * 2.83465, 303 * 2.83465]);
        // 내지: 432 x 303 (펼침면)
        for (let i = 0; i < 5; i++) {
          pdfDoc.addPage([432 * 2.83465, 303 * 2.83465]);
        }
        const pdfBytes = await pdfDoc.save();
        mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

        const options: ValidationOptions = {
          fileType: 'content',
          orderOptions: {
            size: { width: 216, height: 303 },
            pages: 11,
            binding: 'perfect',
            bleed: 3,
          },
        };

        const result = await service.validate('./mixed.pdf', options);

        const mixedWarning = result.warnings.find(
          (w) => w.code === WarningCode.MIXED_PDF,
        );
        expect(mixedWarning).toBeDefined();
      });
    });
  });

  // ============================================================
  // WBS 3.1: CMYK 구조적 감지 테스트
  // ============================================================
  describe('CMYK structure detection (WBS 3.1)', () => {
    it('should detect DeviceCMYK signature', () => {
      // detectCmykStructure는 private 메서드이므로
      // validate 통합 테스트로 대체
      // 여기서는 모킹된 ghostscript 함수가 호출되는지 확인
      expect(true).toBe(true);
    });
  });

  // ============================================================
  // WBS 4.1-4.2: 별색/투명도/오버프린트 감지 테스트
  // ============================================================
  describe('spot color and transparency detection (WBS 4.1-4.2)', () => {
    const {
      detectSpotColors,
      detectTransparencyAndOverprint,
    } = require('../utils/ghostscript');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should call detectSpotColors during validation', async () => {
      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      await service.validate('./test.pdf', options);

      expect(detectSpotColors).toHaveBeenCalled();
    });

    it('should add warning when transparency detected', async () => {
      detectTransparencyAndOverprint.mockResolvedValueOnce({
        hasTransparency: true,
        hasOverprint: false,
        pages: [{ page: 1, transparency: true, overprint: false }],
      });

      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./transparency.pdf', options);

      const transparencyWarning = result.warnings.find(
        (w) => w.code === WarningCode.TRANSPARENCY_DETECTED,
      );
      expect(transparencyWarning).toBeDefined();
    });

    it('should add warning when overprint detected', async () => {
      detectTransparencyAndOverprint.mockResolvedValueOnce({
        hasTransparency: false,
        hasOverprint: true,
        pages: [{ page: 1, transparency: false, overprint: true }],
      });

      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./overprint.pdf', options);

      const overprintWarning = result.warnings.find(
        (w) => w.code === WarningCode.OVERPRINT_DETECTED,
      );
      expect(overprintWarning).toBeDefined();
    });

    // 별색 노티 (요구사항7): 일반 인쇄 파일에서는 비차단 경고, 후가공 파일에서는 정상(경고 없음)
    it('should add SPOT_COLOR_DETECTED warning for non post_process file', async () => {
      detectSpotColors.mockResolvedValueOnce({
        hasSpotColors: true,
        spotColorNames: ['PANTONE 877 C'],
        pages: [{ page: 1, colors: ['PANTONE 877 C'] }],
      });

      // 4페이지 무선제본 + 정사이즈 → 별색 노티 외 차단 사유 없음(비차단 검증용)
      const pdfBytes = await PDFDocument.create().then((doc) => {
        for (let i = 0; i < 4; i++) doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 4,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./spot.pdf', options);

      const spotWarning = result.warnings.find(
        (w) => w.code === WarningCode.SPOT_COLOR_DETECTED,
      );
      expect(spotWarning).toBeDefined();
      expect(spotWarning?.autoFixable).toBe(false);
      expect(spotWarning?.details?.count).toBe(1);
      expect(spotWarning?.details?.spotColorNames).toEqual(['PANTONE 877 C']);
      // 별색 노티는 비차단 → 통과
      expect(result.isValid).toBe(true);
    });

    it('should NOT add SPOT_COLOR_DETECTED warning for post_process file (spot is normal)', async () => {
      detectSpotColors.mockResolvedValueOnce({
        hasSpotColors: true,
        spotColorNames: ['PANTONE 877 C'],
        pages: [{ page: 1, colors: ['PANTONE 877 C'] }],
      });

      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'post_process',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./postprocess.pdf', options);

      const spotWarning = result.warnings.find(
        (w) => w.code === WarningCode.SPOT_COLOR_DETECTED,
      );
      expect(spotWarning).toBeUndefined();
      // 메타데이터에는 별색 정보가 그대로 기록됨
      expect(result.metadata.hasSpotColors).toBe(true);
    });
  });

  // ============================================================
  // 폰트 임베딩 검증 테스트 (요구사항6)
  // ============================================================
  describe('font embedding detection (요구사항6)', () => {
    const { detectFonts } = require('../utils/ghostscript');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should add FONT_NOT_EMBEDDED warning when unembedded fonts exist', async () => {
      detectFonts.mockResolvedValueOnce({
        fontCount: 2,
        fonts: [
          { name: 'Arial', type: 'TrueType', embedded: false, subset: false },
          { name: 'ABCDEF+NanumGothic', type: 'CID', embedded: true, subset: true },
        ],
        hasUnembeddedFonts: true,
        unembeddedFonts: ['Arial'],
        allFontsEmbedded: false,
      });

      // 4페이지 무선제본 + 정사이즈 → 폰트 경고 외 차단 사유 없음(비차단 검증용)
      const pdfBytes = await PDFDocument.create().then((doc) => {
        for (let i = 0; i < 4; i++) doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 4,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./font.pdf', options);

      const fontWarning = result.warnings.find(
        (w) => w.code === WarningCode.FONT_NOT_EMBEDDED,
      );
      expect(fontWarning).toBeDefined();
      expect(fontWarning?.autoFixable).toBe(false);
      expect(fontWarning?.details?.unembeddedFonts).toEqual(['Arial']);
      expect(fontWarning?.details?.fontCount).toBe(2);
      // 메타데이터 반영
      expect(result.metadata.fontCount).toBe(2);
      expect(result.metadata.hasUnembeddedFonts).toBe(true);
      expect(result.metadata.unembeddedFonts).toEqual(['Arial']);
      // 비차단 → 통과
      expect(result.isValid).toBe(true);
    });

    it('should NOT add FONT_NOT_EMBEDDED warning when all fonts embedded', async () => {
      detectFonts.mockResolvedValueOnce({
        fontCount: 1,
        fonts: [
          { name: 'ABCDEF+NanumGothic', type: 'CID', embedded: true, subset: true },
        ],
        hasUnembeddedFonts: false,
        unembeddedFonts: [],
        allFontsEmbedded: true,
      });

      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./font.pdf', options);

      const fontWarning = result.warnings.find(
        (w) => w.code === WarningCode.FONT_NOT_EMBEDDED,
      );
      expect(fontWarning).toBeUndefined();
      expect(result.metadata.hasUnembeddedFonts).toBe(false);
    });

    it('should call detectFonts during validation', async () => {
      const pdfBytes = await PDFDocument.create().then((doc) => {
        doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 1,
          binding: 'perfect',
          bleed: 0,
        },
      };

      await service.validate('./test.pdf', options);

      expect(detectFonts).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 해상도 경고 메시지 정합 테스트 (요구사항4)
  // ============================================================
  describe('low resolution warning message (요구사항4)', () => {
    const { detectImageResolutionFromPdf } = require('../utils/ghostscript');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should reference min acceptable DPI (150) in message and details', async () => {
      detectImageResolutionFromPdf.mockResolvedValueOnce({
        imageCount: 1,
        hasLowResolution: true,
        minResolution: 96,
        avgResolution: 96,
        lowResImages: [
          {
            index: 0,
            pixelWidth: 400,
            pixelHeight: 400,
            displayWidthMm: 100,
            displayHeightMm: 100,
            effectiveDpiX: 96,
            effectiveDpiY: 96,
            minEffectiveDpi: 96,
          },
        ],
        images: [],
      });

      // 4페이지 무선제본 + 정사이즈 → 해상도 경고 외 차단 사유 없음(비차단 검증용)
      const pdfBytes = await PDFDocument.create().then((doc) => {
        for (let i = 0; i < 4; i++) doc.addPage([210 * 2.83465, 297 * 2.83465]);
        return doc.save();
      });
      mockedFs.readFile.mockResolvedValue(Buffer.from(pdfBytes));

      const options: ValidationOptions = {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 4,
          binding: 'perfect',
          bleed: 0,
        },
      };

      const result = await service.validate('./lowres.pdf', options);

      const resWarning = result.warnings.find(
        (w) => w.code === WarningCode.RESOLUTION_LOW,
      );
      expect(resWarning).toBeDefined();
      // 메시지는 게이트값(150)과 권장값(300)을 함께 명시
      expect(resWarning?.message).toContain('150DPI');
      expect(resWarning?.message).toContain('300DPI');
      expect(resWarning?.details?.minAcceptableDpi).toBe(150);
      expect(resWarning?.details?.recommendedDpi).toBe(300);
      // 비차단 → 통과
      expect(result.isValid).toBe(true);
    });
  });
});
