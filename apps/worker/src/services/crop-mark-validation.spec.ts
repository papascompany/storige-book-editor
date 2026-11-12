/**
 * crop mark(재단 기하) 검증 spec.
 *
 * 검증 대상:
 *   - 이중 게이트: orderOptions.cropMarkEnabled === true + env 킬스위치(기본 OFF).
 *     기본 상태에서 crop 경고/메타데이터가 절대 나오지 않아야 한다(프로덕션 행동 변화 0).
 *   - TrimBox 없음/있음(일치)/크기 불일치/BleedBox 부정합/MediaBox 이탈/간접참조.
 *   - 전부 warning(비차단) — isValid/errors 불변.
 *   - OFF(pdf-lib) ↔ 경량(qpdf) 경로 파리티 (qpdf 미설치 CI 는 skip).
 *
 * 목 없이 실제 파일/실제 qpdf 로 검증한다(lightweight-parity.spec.ts 패턴).
 * gs 미설치 환경에서는 색상모드가 구조기반 추정으로 폴백하지만 crop mark 검증과 무관.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PdfValidatorService } from './pdf-validator.service';
import {
  ValidationOptions,
  ValidationResultDto,
  WarningCode,
} from '../dto/validation-result.dto';
import { VALIDATION_CONFIG } from '../config/validation.config';

const MM_TO_PT = 1 / 0.352778;

interface BoxMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 작업사이즈(216x303 = 재단 210x297 + 블리드 3mm 사방) 페이지의 테스트 PDF 생성. */
async function buildPdf(spec: {
  pageWmm?: number;
  pageHmm?: number;
  pages?: number;
  trimBoxMm?: BoxMm;
  bleedBoxMm?: BoxMm;
  /** true 면 TrimBox 배열을 간접참조로 저장(qpdf --json 이 "N 0 R" 문자열로 노출). */
  trimBoxIndirect?: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const n = spec.pages ?? 4;
  const w = (spec.pageWmm ?? 216) * MM_TO_PT;
  const h = (spec.pageHmm ?? 303) * MM_TO_PT;
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([w, h]);
    if (spec.trimBoxMm) {
      const b = spec.trimBoxMm;
      if (spec.trimBoxIndirect) {
        const arr = doc.context.obj([
          b.x * MM_TO_PT,
          b.y * MM_TO_PT,
          (b.x + b.width) * MM_TO_PT,
          (b.y + b.height) * MM_TO_PT,
        ]);
        page.node.set(PDFName.of('TrimBox'), doc.context.register(arr));
      } else {
        page.setTrimBox(
          b.x * MM_TO_PT,
          b.y * MM_TO_PT,
          b.width * MM_TO_PT,
          b.height * MM_TO_PT,
        );
      }
    }
    if (spec.bleedBoxMm) {
      const b = spec.bleedBoxMm;
      page.setBleedBox(
        b.x * MM_TO_PT,
        b.y * MM_TO_PT,
        b.width * MM_TO_PT,
        b.height * MM_TO_PT,
      );
    }
  }
  return doc.save();
}

/** cropMark opt-in 세션이 받는 orderOptions 형태(API edit-sessions 주입 계약과 동일 필드). */
function cropOpts(cropMarkEnabled = true): ValidationOptions {
  return {
    fileType: 'content',
    orderOptions: {
      size: { width: 210, height: 297 },
      pages: 4,
      binding: 'perfect',
      bleed: 3,
      bleedMm: 3,
      cropMarkEnabled,
      sizeToleranceMm: 0.2,
      trimSize: { width: 210, height: 297 },
      workSize: { width: 216, height: 303 },
    },
  };
}

/**
 * 편집기 양장 싸바리 전개 표지의 완료 검증 잡이 받는 orderOptions(API 주입 형태 — 판형 210x210, 책등 8,
 * 도련 0, 재단선 세트 opt-in). 기대 전개 = (210+8)*2+8+40 = 484 x (210+8)+40 = 258.
 */
function hardcoverWrapCoverOpts(
  extra: Partial<ValidationOptions['orderOptions']> = {},
): ValidationOptions {
  return {
    fileType: 'cover',
    orderOptions: {
      size: { width: 210, height: 210 },
      pages: 16,
      binding: 'hardcover',
      spineWidthMm: 8,
      bleed: 0,
      cropMarkEnabled: true,
      sizeToleranceMm: 0.2,
      trimSize: { width: 210, height: 210 },
      ...extra,
    },
  };
}

/** 무선 표지(148x210, 책등 8, 도련 3 → 전개 310 x 216) — 제외 범위가 양장 전개만인지 대조용. */
function perfectCoverOpts(): ValidationOptions {
  return {
    fileType: 'cover',
    orderOptions: {
      size: { width: 148, height: 210 },
      pages: 16,
      binding: 'perfect',
      spineWidthMm: 8,
      bleed: 3,
      bleedMm: 3,
      cropMarkEnabled: true,
      sizeToleranceMm: 0.2,
    },
  };
}

const CROP_CODES = [
  WarningCode.TRIMBOX_MISSING,
  WarningCode.TRIMBOX_SIZE_MISMATCH,
  WarningCode.TRIMBOX_BLEED_INCONSISTENT,
];
const cropWarnings = (r: ValidationResultDto) =>
  r.warnings.filter((w) => CROP_CODES.includes(w.code));

function qpdfAvailable(): boolean {
  try {
    execFileSync(process.env.QPDF_PATH || 'qpdf', ['--version'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('crop mark 검증', () => {
  const service = new PdfValidatorService();
  const cfg = VALIDATION_CONFIG as unknown as { CROP_MARK_VALIDATION: boolean };
  let tmpDir: string;
  let seq = 0;

  const writePdf = async (bytes: Uint8Array): Promise<string> => {
    const p = path.join(tmpDir, `case-${seq++}.pdf`);
    fs.writeFileSync(p, Buffer.from(bytes));
    return p;
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cropmark-spec-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  afterEach(() => {
    cfg.CROP_MARK_VALIDATION = false; // 기본(OFF) 복원
  });

  describe('이중 게이트 (기본 상태 행동 변화 0)', () => {
    it('env 킬스위치는 기본 OFF 다 (WORKER_CROP_MARK_VALIDATION 미설정)', () => {
      expect(process.env.WORKER_CROP_MARK_VALIDATION).toBeUndefined();
      expect(cfg.CROP_MARK_VALIDATION).toBe(false);
    });

    it('킬스위치 OFF: cropMarkEnabled=true + TrimBox 부재여도 crop 경고/메타 0', async () => {
      const p = await writePdf(await buildPdf({}));
      const r = await service.validate(p, cropOpts(true));
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.hasCropMarkGeometry).toBeUndefined();
      expect(r.metadata.trimBox).toBeUndefined();
    });

    it('킬스위치 ON 이어도 cropMarkEnabled 미충족(false/미전송)이면 검증 안함', async () => {
      cfg.CROP_MARK_VALIDATION = true;
      const p = await writePdf(await buildPdf({}));

      const rFalse = await service.validate(p, cropOpts(false));
      expect(cropWarnings(rFalse)).toHaveLength(0);

      const noField = cropOpts(true);
      delete noField.orderOptions.cropMarkEnabled;
      const rAbsent = await service.validate(p, noField);
      expect(cropWarnings(rAbsent)).toHaveLength(0);
      expect(rAbsent.metadata.hasCropMarkGeometry).toBeUndefined();
    });
  });

  describe('검증 케이스 (킬스위치 ON + opt-in)', () => {
    beforeEach(() => {
      cfg.CROP_MARK_VALIDATION = true;
    });

    it('TrimBox 없음 → TRIMBOX_MISSING warning-only (isValid/errors 불변)', async () => {
      const p = await writePdf(await buildPdf({}));
      const r = await service.validate(p, cropOpts());
      const cw = cropWarnings(r);
      expect(cw).toHaveLength(1);
      expect(cw[0].code).toBe(WarningCode.TRIMBOX_MISSING);
      expect(cw[0].autoFixable).toBe(false);
      expect(r.errors).toHaveLength(0);
      expect(r.isValid).toBe(true); // warning 은 상태 판정에 영향 없음
      expect(r.metadata.hasCropMarkGeometry).toBe(false);
    });

    it('TrimBox 일치(+BleedBox 정합) → crop 경고 0 + metadata 기록', async () => {
      const p = await writePdf(
        await buildPdf({
          trimBoxMm: { x: 3, y: 3, width: 210, height: 297 },
          bleedBoxMm: { x: 0, y: 0, width: 216, height: 303 },
        }),
      );
      const r = await service.validate(p, cropOpts());
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.hasCropMarkGeometry).toBe(true);
      expect(r.metadata.trimBox).toEqual({ width: 210, height: 297 });
      expect(r.isValid).toBe(true);
    });

    it('TrimBox 크기 불일치 → TRIMBOX_SIZE_MISMATCH (에러 아님)', async () => {
      const p = await writePdf(
        await buildPdf({ trimBoxMm: { x: 8, y: 8, width: 200, height: 287 } }),
      );
      const r = await service.validate(p, cropOpts());
      const cw = cropWarnings(r);
      expect(cw).toHaveLength(1);
      expect(cw[0].code).toBe(WarningCode.TRIMBOX_SIZE_MISMATCH);
      expect(cw[0].details.expected).toEqual({ width: 210, height: 297 });
      expect(cw[0].details.actual).toEqual({ width: 200, height: 287 });
      expect(r.errors).toHaveLength(0);
      expect(r.isValid).toBe(true);
    });

    it('BleedBox 크기가 재단+블리드*2 와 다름 → TRIMBOX_BLEED_INCONSISTENT', async () => {
      const p = await writePdf(
        await buildPdf({
          trimBoxMm: { x: 3, y: 3, width: 210, height: 297 },
          // 잘못된 BleedBox: 재단과 동일(=블리드 0) — 기대는 216x303.
          bleedBoxMm: { x: 3, y: 3, width: 210, height: 297 },
        }),
      );
      const r = await service.validate(p, cropOpts());
      const cw = cropWarnings(r);
      expect(cw).toHaveLength(1);
      expect(cw[0].code).toBe(WarningCode.TRIMBOX_BLEED_INCONSISTENT);
      expect(cw[0].details.expectedBleedBoxMm).toEqual({ width: 216, height: 303 });
      expect(r.isValid).toBe(true);
    });

    it('TrimBox 가 MediaBox 를 벗어남 → TRIMBOX_BLEED_INCONSISTENT', async () => {
      const p = await writePdf(
        await buildPdf({ trimBoxMm: { x: -5, y: 3, width: 210, height: 297 } }),
      );
      const r = await service.validate(p, cropOpts());
      const cw = cropWarnings(r);
      expect(cw).toHaveLength(1);
      expect(cw[0].code).toBe(WarningCode.TRIMBOX_BLEED_INCONSISTENT);
      expect(r.isValid).toBe(true);
    });

    it('TrimBox 간접참조(배열이 "N 0 R")도 해석해 정상 검증(일치 → 경고 0)', async () => {
      const p = await writePdf(
        await buildPdf({
          trimBoxMm: { x: 3, y: 3, width: 210, height: 297 },
          trimBoxIndirect: true,
        }),
      );
      const r = await service.validate(p, cropOpts());
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.trimBox).toEqual({ width: 210, height: 297 });
    });
  });

  describe('양장 싸바리 전개 표지 — crop mark 검증 비적용 (킬스위치 ON + opt-in)', () => {
    beforeEach(() => {
      cfg.CROP_MARK_VALIDATION = true;
    });

    it('TrimBox 없는 싸바리 전개 표지(484x258) → crop 경고 0 + cropMarkSkipReason, 전개식은 통과', async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 484, pageHmm: 258, pages: 1 }));
      const r = await service.validate(p, hardcoverWrapCoverOpts());
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.cropMarkSkipReason).toBe('HARDCOVER_WRAP');
      expect(r.metadata.hasCropMarkGeometry).toBeUndefined();
      expect(r.metadata.trimBox).toBeUndefined();
      expect(r.errors).toHaveLength(0);
      expect(r.isValid).toBe(true);
      expect(r.metadata.spineSize).toBe(8);
    });

    it('싸바리 전개 표지라도 전개 규격이 틀리면 책등 검증은 종전대로 동작한다(crop 경고만 비적용)', async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 470, pageHmm: 258, pages: 1 }));
      const r = await service.validate(p, hardcoverWrapCoverOpts());
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.cropMarkSkipReason).toBe('HARDCOVER_WRAP');
      expect(r.errors.map((e) => e.code)).toContain('SPINE_SIZE_MISMATCH');
    });

    it("양장이라도 낱장 표지(coverLayout 'separate')는 종전대로 TRIMBOX_MISSING", async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 210, pageHmm: 210, pages: 1 }));
      const r = await service.validate(p, hardcoverWrapCoverOpts({ coverLayout: 'separate' }));
      expect(cropWarnings(r).map((w) => w.code)).toEqual([WarningCode.TRIMBOX_MISSING]);
      expect(r.metadata.cropMarkSkipReason).toBeUndefined();
      expect(r.metadata.hasCropMarkGeometry).toBe(false);
    });

    it("양장이라도 책등 없음(coverSpine 'none')은 종전대로 TRIMBOX_MISSING", async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 210, pageHmm: 210, pages: 1 }));
      const r = await service.validate(p, hardcoverWrapCoverOpts({ coverSpine: 'none' }));
      expect(cropWarnings(r).map((w) => w.code)).toEqual([WarningCode.TRIMBOX_MISSING]);
      expect(r.metadata.cropMarkSkipReason).toBeUndefined();
    });

    it('무선 표지는 종전대로 TRIMBOX_MISSING (제외는 양장 전개만)', async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 310, pageHmm: 216, pages: 1 }));
      const r = await service.validate(p, perfectCoverOpts());
      expect(cropWarnings(r).map((w) => w.code)).toEqual([WarningCode.TRIMBOX_MISSING]);
      expect(r.metadata.cropMarkSkipReason).toBeUndefined();
    });

    it('양장 전개 표지에 TrimBox 가 있어도 crop 검증은 하지 않는다(메타 trimBox 미기록)', async () => {
      const p = await writePdf(
        await buildPdf({
          pageWmm: 484,
          pageHmm: 258,
          pages: 1,
          trimBoxMm: { x: 0, y: 0, width: 484, height: 258 },
        }),
      );
      const r = await service.validate(p, hardcoverWrapCoverOpts());
      expect(cropWarnings(r)).toHaveLength(0);
      expect(r.metadata.cropMarkSkipReason).toBe('HARDCOVER_WRAP');
      expect(r.metadata.trimBox).toBeUndefined();
    });

    it('킬스위치 OFF 또는 opt-in 없음이면 cropMarkSkipReason 도 남기지 않는다(기본 경로 불변)', async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 484, pageHmm: 258, pages: 1 }));
      cfg.CROP_MARK_VALIDATION = false;
      const rOff = await service.validate(p, hardcoverWrapCoverOpts());
      expect(rOff.metadata.cropMarkSkipReason).toBeUndefined();

      cfg.CROP_MARK_VALIDATION = true;
      const rNoOptIn = await service.validate(p, hardcoverWrapCoverOpts({ cropMarkEnabled: false }));
      expect(rNoOptIn.metadata.cropMarkSkipReason).toBeUndefined();
      expect(cropWarnings(rNoOptIn)).toHaveLength(0);
    });
  });

  // OFF(pdf-lib) ↔ 경량(qpdf) 파리티 — qpdf 미설치 CI 는 skip.
  (qpdfAvailable() ? describe : describe.skip)('OFF ↔ 경량 경로 파리티', () => {
    beforeEach(() => {
      cfg.CROP_MARK_VALIDATION = true;
    });

    const parityCases: { label: string; spec: Parameters<typeof buildPdf>[0] }[] = [
      { label: 'TrimBox 없음', spec: {} },
      {
        label: 'TrimBox 일치 + BleedBox 정합',
        spec: {
          trimBoxMm: { x: 3, y: 3, width: 210, height: 297 },
          bleedBoxMm: { x: 0, y: 0, width: 216, height: 303 },
        },
      },
      {
        label: 'TrimBox 크기 불일치',
        spec: { trimBoxMm: { x: 8, y: 8, width: 200, height: 287 } },
      },
      {
        label: 'TrimBox 간접참조(일치)',
        spec: {
          trimBoxMm: { x: 3, y: 3, width: 210, height: 297 },
          trimBoxIndirect: true,
        },
      },
    ];

    it.each(parityCases)(
      '$label — crop 경고·메타데이터 동일',
      async ({ spec }) => {
        const p = await writePdf(await buildPdf(spec));
        const off = await service.validate(p, cropOpts());
        // ON 경로는 플래그와 무관하게 직접 호출(lightweight-parity.spec.ts 패턴).
        const on: ValidationResultDto = await (
          service as unknown as {
            validateLightweight(
              u: string,
              o: ValidationOptions,
            ): Promise<ValidationResultDto>;
          }
        ).validateLightweight(p, cropOpts());

        expect(cropWarnings(on)).toEqual(cropWarnings(off));
        expect(on.metadata.trimBox).toEqual(off.metadata.trimBox);
        expect(on.metadata.hasCropMarkGeometry).toEqual(
          off.metadata.hasCropMarkGeometry,
        );
        expect(on.isValid).toBe(off.isValid);
      },
    );

    it('싸바리 전개 표지(TrimBox 없음) — 양 경로 모두 crop 경고 0·cropMarkSkipReason 동일', async () => {
      const p = await writePdf(await buildPdf({ pageWmm: 484, pageHmm: 258, pages: 1 }));
      const off = await service.validate(p, hardcoverWrapCoverOpts());
      const on: ValidationResultDto = await (
        service as unknown as {
          validateLightweight(u: string, o: ValidationOptions): Promise<ValidationResultDto>;
        }
      ).validateLightweight(p, hardcoverWrapCoverOpts());
      expect(cropWarnings(off)).toHaveLength(0);
      expect(cropWarnings(on)).toHaveLength(0);
      expect(on.metadata.cropMarkSkipReason).toBe('HARDCOVER_WRAP');
      expect(on.metadata.cropMarkSkipReason).toBe(off.metadata.cropMarkSkipReason);
      expect(on.isValid).toBe(off.isValid);
    });
  });
});
