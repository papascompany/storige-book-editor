/**
 * X1 (2026-09-30): TrimBox 기준 내지 판형 판정 spec (CTO 결정 X1 §1·§5).
 *
 * - 파일 A(재단선 13mm·BleedBox=TrimBox) / B(BleedBox=trim+3) / 사방 4mm / C(TrimBox 부재·동일)
 * - CTO X1-R2: 통과 조건 = 엄격 기하 조건 + known 목표(Trim+B_order) ⊂ MediaBox.
 *   '합성 산출 박스 = 허용 크기' 조건 제거 → B+bleed1·사방 4mm(BleedBox 유무 무관) 통과.
 *   도련은 명시 BleedBox − TrimBox 최소값(부재 0) ≥ 주문 bleed − tol/2 일 때만 hasBleed.
 * - 불통과: TrimBox 불일치·페이지 혼합·회전·UserUnit → SIZE_MISMATCH 유지(message·details.actual 불변)
 * - 회귀: 표지·후가공·정상 작업사이즈·100p(MediaBox 판형+블리드×2)·stale TrimBox → 플래그 ON≡OFF
 * - 킬스위치 OFF → 종전 결과
 * - 표준(pdf-lib) ↔ 경량(qpdf) 결과 deep-equal(파일 크기·색상 등 비박스 항목 포함)
 *
 * crop-mark-validation.spec 패턴: pdf-lib 픽스처 즉석 생성 → tmp 파일 → validate()/validateLightweight.
 * qpdf 미설치 환경은 경량 비교를 skip 한다.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, PDFName, PDFNumber, rgb } from 'pdf-lib';
import { PdfValidatorService } from './pdf-validator.service';
import {
  ErrorCode,
  ValidationOptions,
  ValidationResultDto,
  WarningCode,
} from '../dto/validation-result.dto';
import { VALIDATION_CONFIG } from '../config/validation.config';
import { normalizeBoxPt, planTrimBoxCrop } from '../utils/trimbox-normalize';

jest.setTimeout(120_000);

const K = 1 / 0.352778; // mm → pt
const mmBox = (x: number, y: number, w: number, h: number): number[] => [
  x * K,
  y * K,
  (x + w) * K,
  (y + h) * K,
];

interface PageSpec {
  media: number[];
  trim?: number[];
  bleed?: number[];
  rotate?: number;
  userUnit?: number;
}

const A_PAGE: PageSpec = {
  media: mmBox(0, 0, 236, 323),
  trim: mmBox(13, 13, 210, 297),
  bleed: mmBox(13, 13, 210, 297),
};
const B_PAGE: PageSpec = { ...A_PAGE, bleed: mmBox(10, 10, 216, 303) };
/** InDesign 하단 slug 패턴: 236x333, 여백 L/R/T 13·B 23mm, BleedBox=trim+3 */
const SLUG_BOTTOM_PAGE: PageSpec = {
  media: mmBox(0, 0, 236, 333),
  trim: mmBox(13, 23, 210, 297),
  bleed: mmBox(10, 20, 216, 303),
};
const M4_PAGE: PageSpec = {
  media: mmBox(0, 0, 218, 305),
  trim: mmBox(4, 4, 210, 297),
  bleed: mmBox(0, 0, 218, 305),
};
/** 사방 4mm 여백 + BleedBox 없음(X1-R2 기대 결과 대상) */
const M4_NO_BLEED_PAGE: PageSpec = { media: M4_PAGE.media, trim: M4_PAGE.trim };
/** 파일 C 박스(pt): 0 7.92 810 817.92 */
const C_BOX = [0, 7.92, 810, 817.92];

async function buildPdf(pages: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const m = normalizeBoxPt(spec.media);
    const page = doc.addPage([m.width, m.height]);
    page.setMediaBox(m.x, m.y, m.width, m.height);
    const t = spec.trim ? normalizeBoxPt(spec.trim) : m;
    page.drawRectangle({ x: t.x, y: t.y, width: t.width, height: t.height, color: rgb(0.9, 0.9, 0.9) });
    if (spec.trim) page.setTrimBox(t.x, t.y, t.width, t.height);
    if (spec.bleed) {
      const b = normalizeBoxPt(spec.bleed);
      page.setBleedBox(b.x, b.y, b.width, b.height);
    }
    if (spec.rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(spec.rotate));
    if (spec.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(spec.userUnit));
  }
  return doc.save();
}
const repeat = (p: PageSpec, n: number): PageSpec[] => Array.from({ length: n }, () => p);

function opts(
  over: Partial<ValidationOptions['orderOptions']> = {},
  fileType: ValidationOptions['fileType'] = 'content',
): ValidationOptions {
  return {
    fileType,
    orderOptions: {
      size: { width: 210, height: 297 },
      pages: 32,
      binding: 'perfect',
      bleed: 1,
      ...over,
    },
  };
}

function qpdfAvailable(): boolean {
  try {
    execFileSync(process.env.QPDF_PATH || 'qpdf', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_QPDF = qpdfAvailable();

const codes = (arr: Array<{ code: string }>): string[] => arr.map((x) => x.code);

describe('X1 TrimBox 기준 내지 판형 판정', () => {
  const service = new PdfValidatorService();
  const lightweight = (u: string, o: ValidationOptions): Promise<ValidationResultDto> =>
    (
      service as unknown as {
        validateLightweight(u: string, o: ValidationOptions): Promise<ValidationResultDto>;
      }
    ).validateLightweight(u, o);
  const cfg = VALIDATION_CONFIG as unknown as { TRIMBOX_SIZE_CHECK: boolean };
  let tmpDir: string;
  let seq = 0;

  const writePdf = async (pages: PageSpec[]): Promise<string> => {
    const p = path.join(tmpDir, `case-${seq++}.pdf`);
    fs.writeFileSync(p, Buffer.from(await buildPdf(pages)));
    return p;
  };

  /** 플래그 ON 표준 결과 + (qpdf 있으면) 경량 결과가 표준과 deep-equal 임을 확인하고 표준 결과 반환 */
  const validateOn = async (p: string, o: ValidationOptions): Promise<ValidationResultDto> => {
    cfg.TRIMBOX_SIZE_CHECK = true;
    const std = await service.validate(p, o);
    if (HAS_QPDF) {
      const lw = await lightweight(p, o);
      expect(lw).toEqual(std);
    }
    return std;
  };
  /** 플래그 OFF(종전 동작) 표준 결과 (+경량 파리티) */
  const validateOff = async (p: string, o: ValidationOptions): Promise<ValidationResultDto> => {
    cfg.TRIMBOX_SIZE_CHECK = false;
    try {
      const std = await service.validate(p, o);
      if (HAS_QPDF) expect(await lightweight(p, o)).toEqual(std);
      return std;
    } finally {
      cfg.TRIMBOX_SIZE_CHECK = true;
    }
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trimbox-size-basis-spec-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  afterEach(() => {
    cfg.TRIMBOX_SIZE_CHECK = true; // 코드 기본(ON) 복원
  });

  it('기본 상태(env 미설정)에서 킬스위치는 ON', () => {
    expect(VALIDATION_CONFIG.TRIMBOX_SIZE_CHECK).toBe(true);
  });

  describe('통과 — 전 페이지 명시 TrimBox ≈ 주문 재단', () => {
    it('파일 A(32p, 236x323, TrimBox=BleedBox 210x297) → TRIMBOX_SIZE_BASIS + BLEED_MISSING 유지', async () => {
      const p = await writePdf(repeat(A_PAGE, 32));
      const r = await validateOn(p, opts());
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(r.isValid).toBe(true);
      const basis = r.warnings.filter((w) => w.code === WarningCode.TRIMBOX_SIZE_BASIS);
      expect(basis).toHaveLength(1);
      expect(basis[0]).toEqual({
        code: WarningCode.TRIMBOX_SIZE_BASIS,
        message:
          '재단 크기(TrimBox) 기준으로 판형을 확인했습니다. 원본 파일에는 재단선·여백 영역이 포함되어 있습니다.',
        details: {
          sizeBasis: 'trimBox',
          trimBox: { width: 210, height: 297 },
          mediaBox: { width: 236, height: 323 },
        },
        autoFixable: false,
      });
      expect(codes(r.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.trimBox).toEqual({ width: 210, height: 297 });
      expect(r.metadata.pageSize).toEqual({ width: 236, height: 323 });
      expect(r.metadata.hasBleed).toBe(false);
      expect(r.metadata.bleedSize).toBe(0);
      // 경고 순서: TRIMBOX_SIZE_BASIS(판형 단계) → BLEED_MISSING(도련 단계)
      expect(codes(r.warnings).indexOf(WarningCode.TRIMBOX_SIZE_BASIS)).toBeLessThan(
        codes(r.warnings).indexOf(WarningCode.BLEED_MISSING),
      );
    });

    it('파일 B(BleedBox=trim+3) + 주문 bleed 3 → 통과(합성 산출 216x303 = 주문 작업사이즈), hasBleed=true, bleedSize=3', async () => {
      const p = await writePdf(repeat(B_PAGE, 4));
      const r = await validateOn(p, opts({ pages: 4, bleed: 3 }));
      expect(r.isValid).toBe(true);
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).not.toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.hasBleed).toBe(true);
      expect(r.metadata.bleedSize).toBe(3);
    });

    it('X1-R2 파일 B(운영 실측: 236x323, Trim 사방 13, Bleed 사방 3) + 주문 210x297 bleed 1 → 통과, BLEED_MISSING 없음', async () => {
      const p = await writePdf(repeat(B_PAGE, 4));
      const r = await validateOn(p, opts({ pages: 4 }));
      expect(r.isValid).toBe(true);
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).not.toContain(WarningCode.BLEED_MISSING); // 3 ≥ 1 − 0.5
      expect(r.metadata.trimBox).toEqual({ width: 210, height: 297 });
      expect(r.metadata.hasBleed).toBe(true);
      expect(r.metadata.bleedSize).toBe(3);
    });

    it('X1-R2 사방 4mm·BleedBox 없음(218x305) + bleed 1 → 통과 + BLEED_MISSING(도련 0)', async () => {
      const p = await writePdf(repeat(M4_NO_BLEED_PAGE, 4));
      const r = await validateOn(p, opts({ pages: 4 }));
      expect(r.isValid).toBe(true);
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.hasBleed).toBe(false);
      expect(r.metadata.bleedSize).toBe(0);
    });

    it('사방 4mm·BleedBox=MediaBox(218x305) + bleed 1 → 통과, 도련 4 → BLEED_MISSING 없음', async () => {
      const r = await validateOn(await writePdf(repeat(M4_PAGE, 4)), opts({ pages: 4 }));
      expect(r.isValid).toBe(true);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).not.toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.bleedSize).toBe(4);
    });

    it('BleedBox 없는 13mm 재단선 여백 + bleed 1 → 통과 + BLEED_MISSING(도련 0)', async () => {
      const r = await validateOn(await writePdf(repeat({ ...A_PAGE, bleed: undefined }, 4)), opts({ pages: 4 }));
      expect(r.isValid).toBe(true);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.bleedSize).toBe(0);
    });

    it('페이지 혼합(1쪽 B + 2쪽 A, 주문 bleed 1) → 통과하되 도련은 전 페이지 최소(0) → BLEED_MISSING', async () => {
      const r = await validateOn(await writePdf([B_PAGE, A_PAGE]), opts({ pages: 2 }));
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.bleedSize).toBe(0);
    });

    it.each([
      ['하단 slug 비대칭(InDesign 패턴 236x333, Bleed 사방 3)', SLUG_BOTTOM_PAGE, 3],
      [
        '여백 L1/R3·B2/T2(214x301, BleedBox=MediaBox)',
        { media: mmBox(0, 0, 214, 301), trim: mmBox(1, 2, 210, 297), bleed: mmBox(0, 0, 214, 301) },
        1,
      ],
    ])('%s + bleed 1 → 통과(합성 산출 크기는 판정 조건 아님 — 한계), 도련 %p', async (_l, spec, bleed) => {
      const r = await validateOn(await writePdf(repeat(spec as PageSpec, 4)), opts({ pages: 4 }));
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).not.toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.bleedSize).toBe(bleed);
    });

    it('파일 B + 주문 bleed 1 이라도 템플릿 작업사이즈(trimSize+bleedMm 3×2 = 216x303)면 통과', async () => {
      const p = await writePdf(repeat(B_PAGE, 4));
      const r = await validateOn(
        p,
        opts({ pages: 4, trimSize: { width: 210, height: 297 }, bleedMm: 3 }),
      );
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(r.metadata.hasBleed).toBe(true);
    });

    it('trimSize 가 있으면 size 대신 trimSize 를 기대 재단으로 사용', async () => {
      const p = await writePdf(repeat(A_PAGE, 4));
      const r = await validateOn(
        p,
        opts({ pages: 4, size: { width: 182, height: 257 }, trimSize: { width: 210, height: 297 } }),
      );
      expect(codes(r.errors)).not.toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
    });
  });

  describe('불통과 — SIZE_MISMATCH 유지(message·details.actual 불변)', () => {
    /** ON 결과의 SIZE_MISMATCH 가 OFF 와 message·details.actual 이 같고 TRIMBOX_SIZE_BASIS 가 없음 */
    const expectKeptMismatch = async (p: string, o: ValidationOptions) => {
      const on = await validateOn(p, o);
      const off = await validateOff(p, o);
      const eOn = on.errors.find((e) => e.code === ErrorCode.SIZE_MISMATCH);
      const eOff = off.errors.find((e) => e.code === ErrorCode.SIZE_MISMATCH);
      expect(eOn).toBeDefined();
      expect(eOff).toBeDefined();
      expect(eOn?.message).toBe(eOff?.message);
      expect(eOn?.details.actual).toEqual(eOff?.details.actual);
      expect(eOn?.details.expected).toEqual(eOff?.details.expected);
      expect(codes(on.warnings)).not.toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(on.isValid).toBe(false);
      return { on, off, eOn, eOff };
    };

    it('파일 C(24p, 모든 박스 0 7.92 810 817.92, TrimBox 부재) → 결과가 플래그 OFF 와 deep-equal', async () => {
      const p = await writePdf(repeat({ media: C_BOX }, 24));
      const o = opts({ pages: 24, size: { width: 210, height: 210 } });
      const { on, off } = await expectKeptMismatch(p, o);
      expect(on).toEqual(off);
    });

    it('파일 C(TrimBox=BleedBox=MediaBox) → 결과가 플래그 OFF 와 deep-equal', async () => {
      const p = await writePdf(repeat({ media: C_BOX, trim: C_BOX, bleed: C_BOX }, 24));
      const o = opts({ pages: 24, size: { width: 210, height: 210 } });
      const { on, off } = await expectKeptMismatch(p, o);
      expect(on).toEqual(off);
    });

    it('TrimBox 182x257 ≠ 주문 210x297 → details.trimBox(additive)만 추가', async () => {
      const p = await writePdf(repeat({ media: mmBox(0, 0, 236, 323), trim: mmBox(27, 33, 182, 257) }, 4));
      const { eOn, eOff } = await expectKeptMismatch(p, opts({ pages: 4 }));
      expect(eOn?.details.trimBox).toEqual({ width: 182, height: 257 });
      expect(eOff?.details.trimBox).toBeUndefined();
      const { trimBox: _t, ...rest } = eOn?.details ?? {};
      expect(rest).toEqual(eOff?.details);
    });

    it('페이지 혼합(1~31p A, 32p TrimBox 없는 236x323) → SIZE_MISMATCH 유지, 페이지 교체 없음', async () => {
      const p = await writePdf([...repeat(A_PAGE, 31), { media: mmBox(0, 0, 236, 323) }]);
      const { eOn } = await expectKeptMismatch(p, opts());
      expect(eOn?.details.page).toBeUndefined();
      expect(eOn?.details.trimBox).toEqual({ width: 210, height: 297 });
    });

    it('페이지 혼합(1~31p A, 32p TrimBox 없는 210x297 백지) → 엄격 규칙상 SIZE_MISMATCH 유지', async () => {
      await expectKeptMismatch(
        await writePdf([...repeat(A_PAGE, 31), { media: mmBox(0, 0, 210, 297) }]),
        opts(),
      );
    });

    it('페이지 혼합(1쪽 B + 2쪽 A, 주문 bleed 3) → 통과하되 도련은 전 페이지 최소(0) → BLEED_MISSING', async () => {
      const p = await writePdf([B_PAGE, A_PAGE]);
      const r = await validateOn(p, opts({ pages: 2, bleed: 3 }));
      expect(codes(r.warnings)).toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(codes(r.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(r.metadata.bleedSize).toBe(0);
    });

    it('/Rotate 90 페이지(비회전 좌표 TrimBox 210x297) → SIZE_MISMATCH 유지', async () => {
      await expectKeptMismatch(await writePdf(repeat({ ...A_PAGE, rotate: 90 }, 4)), opts({ pages: 4 }));
    });

    it('/Rotate 270 → SIZE_MISMATCH 유지', async () => {
      await expectKeptMismatch(await writePdf(repeat({ ...A_PAGE, rotate: 270 }, 4)), opts({ pages: 4 }));
    });

    it('가로 TrimBox 297x210 + 세로 주문 → SIZE_MISMATCH(스왑 불허)', async () => {
      const land: PageSpec = { media: mmBox(0, 0, 323, 236), trim: mmBox(13, 13, 297, 210) };
      await expectKeptMismatch(await writePdf(repeat(land, 4)), opts({ pages: 4 }));
    });

    it('/UserUnit 2 → SIZE_MISMATCH 유지', async () => {
      await expectKeptMismatch(await writePdf(repeat({ ...A_PAGE, userUnit: 2 }, 4)), opts({ pages: 4 }));
    });

    it('정규화 목표(Trim+주문 bleed)가 MediaBox 밖 → SIZE_MISMATCH 유지(산출물 크기 보장 불가)', async () => {
      // 사방 1.5mm 여백(213x300) + 주문 bleed 3 → 목표 216x303 ⊄ MediaBox
      const tight: PageSpec = { media: mmBox(0, 0, 213, 300), trim: mmBox(1.5, 1.5, 210, 297) };
      await expectKeptMismatch(await writePdf(repeat(tight, 4)), opts({ pages: 4, bleed: 3 }));
    });
  });

  describe('회귀 — 플래그 ON 결과 ≡ OFF 결과', () => {
    const expectOnEqualsOff = async (p: string, o: ValidationOptions) => {
      const on = await validateOn(p, o);
      const off = await validateOff(p, o);
      expect(on).toEqual(off);
      expect(codes(on.warnings)).not.toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      return on;
    };

    it('표지 perfect 스프레드(fileType cover)에 A 패턴 박스 → ON≡OFF', async () => {
      await expectOnEqualsOff(
        await writePdf(repeat(A_PAGE, 1)),
        opts({ pages: 100, spineWidthMm: 8 }, 'cover'),
      );
    });

    it('표지 separate(fileType cover, coverLayout separate)에 A 패턴 박스 → ON≡OFF', async () => {
      await expectOnEqualsOff(
        await writePdf(repeat(A_PAGE, 2)),
        opts({ pages: 100, coverLayout: 'separate' }, 'cover'),
      );
    });

    it('후가공(post_process)에 A 패턴 박스 → ON≡OFF', async () => {
      await expectOnEqualsOff(await writePdf(repeat(A_PAGE, 4)), opts({ pages: 4 }, 'post_process'));
    });

    it('정상 작업사이즈(216x303 + Trim 210x297 + Bleed 216x303, bleed 3) → ON≡OFF, 크롭 none(noSlugMargin)', async () => {
      const normal: PageSpec = {
        media: mmBox(0, 0, 216, 303),
        trim: mmBox(3, 3, 210, 297),
        bleed: mmBox(0, 0, 216, 303),
      };
      const r = await expectOnEqualsOff(await writePdf(repeat(normal, 4)), opts({ pages: 4, bleed: 3 }));
      expect(r.isValid).toBe(true);
      const plan = planTrimBoxCrop({
        mediaBox: normalizeBoxPt(normal.media),
        trimBox: normalizeBoxPt(normal.trim as number[]),
        bleedBox: normalizeBoxPt(normal.bleed as number[]),
        rotate: 0,
        userUnit: 1,
        authoritative: true,
      });
      expect(plan).toEqual({ action: 'none', reason: 'noSlugMargin' });
    });

    it.each([
      ['BleedBox=MediaBox(편집기 P3 패턴)', true],
      ['BleedBox 없음', false],
    ])('도련 5mm 정상 파일(220x307 + Trim 210x297, %s, bleed 5) → ON≡OFF, 크롭 none', async (_l, withBleedBox) => {
      const spec: PageSpec = {
        media: mmBox(0, 0, 220, 307),
        trim: mmBox(5, 5, 210, 297),
        bleed: withBleedBox ? mmBox(0, 0, 220, 307) : undefined,
      };
      const r = await expectOnEqualsOff(await writePdf(repeat(spec, 4)), opts({ pages: 4, bleed: 5 }));
      expect(r.isValid).toBe(true);
      const plan = planTrimBoxCrop({
        mediaBox: normalizeBoxPt(spec.media),
        trimBox: normalizeBoxPt(spec.trim as number[]),
        bleedBox: spec.bleed ? normalizeBoxPt(spec.bleed) : undefined,
        rotate: 0,
        userUnit: 1,
        authoritative: true,
      });
      expect(plan.action).toBe('none');
    });

    it('100p 약속: MediaBox 만 있는 판형+블리드×2(214x301, 내지 bleed 2) → isValid·errors·warnings·metadata 완전 동일', async () => {
      const p = await writePdf(repeat({ media: mmBox(0, 0, 214, 301) }, 8));
      const r = await expectOnEqualsOff(p, opts({ pages: 8, bleed: 2 }));
      expect(r.isValid).toBe(true);
      expect(r.metadata.hasBleed).toBe(true);
      expect(r.metadata.bleedSize).toBe(2);
    });

    it('MediaBox=작업사이즈(212x299) + 작은 stale TrimBox(190x270) → 판정 ON≡OFF', async () => {
      const stale: PageSpec = { media: mmBox(0, 0, 212, 299), trim: mmBox(11, 14.5, 190, 270) };
      const r = await expectOnEqualsOff(await writePdf(repeat(stale, 4)), opts({ pages: 4 }));
      expect(r.isValid).toBe(true);
    });
  });

  describe('킬스위치 OFF → 종전 결과', () => {
    it.each([
      ['A', A_PAGE],
      ['B', B_PAGE],
    ])('%s: SIZE_MISMATCH + BLEED_MISSING, TrimBox 관련 추가 없음', async (_l, spec) => {
      const p = await writePdf(repeat(spec, 4));
      const off = await validateOff(p, opts({ pages: 4 }));
      expect(codes(off.errors)).toContain(ErrorCode.SIZE_MISMATCH);
      expect(codes(off.warnings)).toContain(WarningCode.BLEED_MISSING);
      expect(codes(off.warnings)).not.toContain(WarningCode.TRIMBOX_SIZE_BASIS);
      expect(off.errors.find((e) => e.code === ErrorCode.SIZE_MISMATCH)?.details.trimBox).toBeUndefined();
      expect(off.metadata.trimBox).toBeUndefined();
      expect(off.isValid).toBe(false);
    });
  });
});
