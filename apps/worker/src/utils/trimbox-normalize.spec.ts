/**
 * X1 (2026-09-30): TrimBox 크롭 정규화 spec.
 *
 * - planTrimBoxCrop 순수 단위(A/B/4mm/C·stale·회전·UserUnit·editSize·주문 bleed)
 * - normalizeTrimBoxFile(qpdf) / normalizeTrimBoxPdfDoc(pdf-lib) 결과 박스 수치 동등성, 원본 불변, 멱등
 * - GS 재증류(center·addBleed·merge) 뒤 TrimBox ⊂ MediaBox · 중심 일치(±0.5pt) — 실제 gs 실행
 * - 변환(inner-imposition/fix-bleed editSize) innerfit 미선택·스케일 1.0, fix-pagecount 백지 박스 좌표
 * - 합성(synthesizeToLocal) 내지 입력 정규화
 *
 * qpdf 미설치 환경은 qpdf 의존 블록 skip, gs 미설치 환경(CI)은 gs 의존 블록 skip.
 * 로컬(qpdf 12.3.2 / gs 10.08.0)에서는 전부 실행된다.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, PDFName, PDFNumber, PDFString, rgb } from 'pdf-lib';
import {
  VALIDATION_CONFIG,
  isTrimBoxSizeCheckEnabled,
} from '../config/validation.config';
import * as ghostscript from './ghostscript';
import { extractPageDictsQpdf, extractPdfMetadataQpdf } from './pdf-metadata-qpdf';
import {
  BoxRectPt,
  PageBoxesPt,
  TrimCropPlan,
  normalizeBoxPt,
  normalizeTrimBoxFile,
  normalizeTrimBoxPdfDoc,
  planTrimBoxCrop,
  evaluateTrimSizeBasis,
} from './trimbox-normalize';
import { PdfConverterService } from '../services/pdf-converter.service';
import { PdfSynthesizerService } from '../services/pdf-synthesizer.service';
import { PdfValidatorService } from '../services/pdf-validator.service';
import { ValidationOptions, WarningCode } from '../dto/validation-result.dto';

const K = 1 / 0.352778; // mm → pt

/** mm 사각형 → pt [llx, lly, urx, ury] */
const mmBox = (x: number, y: number, w: number, h: number): number[] => [
  x * K,
  y * K,
  (x + w) * K,
  (y + h) * K,
];
const rectPt = (arr: number[]): BoxRectPt => normalizeBoxPt(arr);

interface PageSpec {
  media: number[];
  trim?: number[];
  bleed?: number[];
  rotate?: number;
  userUnit?: number;
  /** 비정형 ArtBox(원소 3개 배열 또는 문자열) 주입 */
  badArtBox?: 'shortArray' | 'string';
}

/** 파일 A: MediaBox 236x323, TrimBox=BleedBox 210x297 (사방 13mm 재단선 영역) */
const A_PAGE: PageSpec = {
  media: mmBox(0, 0, 236, 323),
  trim: mmBox(13, 13, 210, 297),
  bleed: mmBox(13, 13, 210, 297),
};
/** 파일 B: A 와 같되 BleedBox = trim + 3mm 사방 */
const B_PAGE: PageSpec = {
  media: mmBox(0, 0, 236, 323),
  trim: mmBox(13, 13, 210, 297),
  bleed: mmBox(10, 10, 216, 303),
};
/** 사방 4mm 여백 파일: MediaBox 218x305, TrimBox 210x297, BleedBox=MediaBox */
const M4_PAGE: PageSpec = {
  media: mmBox(0, 0, 218, 305),
  trim: mmBox(4, 4, 210, 297),
  bleed: mmBox(0, 0, 218, 305),
};
/** 사방 4mm 여백 + BleedBox 없음(CTO X1-R2 기대 결과 대상) */
const M4_NO_BLEED_PAGE: PageSpec = { media: M4_PAGE.media, trim: M4_PAGE.trim };
/** 도련만 있는 정상 파일(사방 bleedMm, TrimBox 명시) — BleedBox=MediaBox 또는 부재 */
const bleedOnly = (bleedMm: number, withBleedBox: boolean): PageSpec => ({
  media: mmBox(0, 0, 210 + bleedMm * 2, 297 + bleedMm * 2),
  trim: mmBox(bleedMm, bleedMm, 210, 297),
  bleed: withBleedBox ? mmBox(0, 0, 210 + bleedMm * 2, 297 + bleedMm * 2) : undefined,
});
/** InDesign 하단 slug 패턴: 236x333, 여백 L/R/T 13·B 23mm, BleedBox=trim+3 */
const SLUG_BOTTOM_PAGE: PageSpec = {
  media: mmBox(0, 0, 236, 333),
  trim: mmBox(13, 23, 210, 297),
  bleed: mmBox(10, 20, 216, 303),
};

async function buildPdf(pages: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const m = rectPt(spec.media);
    const page = doc.addPage([m.width, m.height]);
    page.setMediaBox(m.x, m.y, m.width, m.height);
    const t = spec.trim ? rectPt(spec.trim) : m;
    // 재단 영역 표시용 콘텐츠(콘텐츠 스트림 수 불변 검사 대상)
    page.drawRectangle({ x: t.x, y: t.y, width: t.width, height: t.height, color: rgb(0.2, 0.4, 0.8) });
    if (spec.trim) page.setTrimBox(t.x, t.y, t.width, t.height);
    if (spec.bleed) {
      const b = rectPt(spec.bleed);
      page.setBleedBox(b.x, b.y, b.width, b.height);
    }
    if (spec.rotate) page.node.set(PDFName.of('Rotate'), PDFNumber.of(spec.rotate));
    if (spec.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(spec.userUnit));
    if (spec.badArtBox === 'shortArray') {
      page.node.set(PDFName.of('ArtBox'), doc.context.obj([0, 0, 600]));
    } else if (spec.badArtBox === 'string') {
      page.node.set(PDFName.of('ArtBox'), PDFString.of('x'));
    }
  }
  return doc.save();
}

const repeat = (p: PageSpec, n: number): PageSpec[] => Array.from({ length: n }, () => p);

function boxes(spec: PageSpec, over: Partial<PageBoxesPt> = {}): PageBoxesPt {
  return {
    mediaBox: rectPt(spec.media),
    trimBox: spec.trim ? rectPt(spec.trim) : undefined,
    bleedBox: spec.bleed ? rectPt(spec.bleed) : undefined,
    rotate: spec.rotate ?? 0,
    userUnit: spec.userUnit ?? 1,
    authoritative: true,
    ...over,
  };
}

const sizeMm = (b: BoxRectPt) => ({
  width: Math.round((b.width / K) * 10) / 10,
  height: Math.round((b.height / K) * 10) / 10,
});

function binAvailable(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_QPDF = binAvailable(process.env.QPDF_PATH || 'qpdf', ['--version']);
const HAS_GS = binAvailable(process.env.GHOSTSCRIPT_PATH || 'gs', ['--version']);

const sha256 = (p: string): string =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 페이지별 박스(pt 배열, 명시값 — 없으면 undefined). pdf-lib 로 재독. */
async function readBoxesPdfLib(p: string): Promise<
  Array<{ media: number[]; crop?: number[]; trim?: number[]; bleed?: number[] }>
> {
  const doc = await PDFDocument.load(fs.readFileSync(p));
  const arr = (a?: { asRectangle(): { x: number; y: number; width: number; height: number } }) => {
    if (!a) return undefined;
    const r = a.asRectangle();
    return [r.x, r.y, r.x + r.width, r.y + r.height];
  };
  return doc.getPages().map((pg) => ({
    media: arr(pg.node.MediaBox()) as number[],
    crop: arr(pg.node.CropBox()),
    trim: arr(pg.node.TrimBox()),
    bleed: arr(pg.node.BleedBox()),
  }));
}

const expectBoxClose = (got: number[] | undefined, want: number[], tol = 0.01): void => {
  expect(got).toBeDefined();
  (got as number[]).forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(tol));
};

/** TrimBox ⊂ MediaBox 이고 TrimBox 중심 = MediaBox 중심(±0.5pt) */
function expectTrimCentered(media: number[], trim: number[] | undefined): void {
  expect(trim).toBeDefined();
  const m = rectPt(media);
  const t = rectPt(trim as number[]);
  expect(t.x).toBeGreaterThanOrEqual(m.x - 0.01);
  expect(t.y).toBeGreaterThanOrEqual(m.y - 0.01);
  expect(t.x + t.width).toBeLessThanOrEqual(m.x + m.width + 0.01);
  expect(t.y + t.height).toBeLessThanOrEqual(m.y + m.height + 0.01);
  expect(Math.abs(t.x + t.width / 2 - (m.x + m.width / 2))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(t.y + t.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(0.5);
}

const cfg = VALIDATION_CONFIG as unknown as { TRIMBOX_SIZE_CHECK: boolean };

describe('X1 TrimBox 크롭 정규화', () => {
  let tmpDir: string;
  let seq = 0;
  const writePdf = async (pages: PageSpec[]): Promise<string> => {
    const p = path.join(tmpDir, `in-${seq++}.pdf`);
    fs.writeFileSync(p, Buffer.from(await buildPdf(pages)));
    return p;
  };
  const outPath = (tag: string): string => path.join(tmpDir, `out-${tag}-${seq++}.pdf`);

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trimbox-normalize-spec-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  afterEach(() => {
    cfg.TRIMBOX_SIZE_CHECK = true; // 코드 기본(ON) 복원
    jest.restoreAllMocks();
  });

  // ───────────────────────── 킬스위치 파서 ─────────────────────────
  describe('isTrimBoxSizeCheckEnabled (코드 기본 ON)', () => {
    it.each([undefined, '', 'true', 'TRUE', '1', 'yes', 'on', 'anything'])('%p → ON', (v) => {
      expect(isTrimBoxSizeCheckEnabled({ WORKER_TRIMBOX_SIZE_CHECK: v })).toBe(true);
    });
    it.each(['false', ' False ', '0', 'off', 'OFF', 'no', ' No'])('%p → OFF', (v) => {
      expect(isTrimBoxSizeCheckEnabled({ WORKER_TRIMBOX_SIZE_CHECK: v })).toBe(false);
    });
    it('키 부재(미설정) → ON', () => {
      expect(isTrimBoxSizeCheckEnabled({})).toBe(true);
    });
  });

  // ───────────────────────── planner 순수 단위 ─────────────────────────
  describe('planTrimBoxCrop (모르는 경로 — 합성)', () => {
    const crop = (pl: TrimCropPlan) => {
      expect(pl.action).toBe('crop');
      return pl as Extract<TrimCropPlan, { action: 'crop' }>;
    };

    it('A(BleedBox=TrimBox) → 목표=TrimBox(도련 0), source declaredBleedBox', () => {
      const pl = crop(planTrimBoxCrop(boxes(A_PAGE)));
      expect(pl.source).toBe('declaredBleedBox');
      expect(pl.bleedMm).toEqual({ x: 0, y: 0 });
      expectBoxClose([pl.target.x, pl.target.y, pl.target.x + pl.target.width, pl.target.y + pl.target.height], A_PAGE.trim as number[]);
    });

    it('B(BleedBox=trim+3) → 목표 216x303', () => {
      const pl = crop(planTrimBoxCrop(boxes(B_PAGE)));
      expect(pl.source).toBe('declaredBleedBox');
      expect(sizeMm(pl.target)).toEqual({ width: 216, height: 303 });
    });

    it('BleedBox 없음 + 13mm 여백 → none(noBleedBox) — 도련과 slug 구분 불가', () => {
      expect(planTrimBoxCrop(boxes({ ...A_PAGE, bleed: undefined }))).toEqual({
        action: 'none',
        reason: 'noBleedBox',
      });
    });

    it('BleedBox=MediaBox(13mm) → none(noSlugBeyondBleed) — 선언 도련 바깥 여백 없음', () => {
      expect(planTrimBoxCrop(boxes({ ...A_PAGE, bleed: A_PAGE.media }))).toEqual({
        action: 'none',
        reason: 'noSlugBeyondBleed',
      });
    });

    it.each([
      ['도련 5mm·BleedBox=MediaBox', bleedOnly(5, true), 'noSlugBeyondBleed'],
      ['도련 5mm·BleedBox 없음', bleedOnly(5, false), 'noBleedBox'],
      ['도련 10mm·BleedBox=MediaBox', bleedOnly(10, true), 'noSlugBeyondBleed'],
      ['도련 10mm·BleedBox 없음', bleedOnly(10, false), 'noBleedBox'],
      [
        '도련 5mm·BleedBox=trim+3(바깥 2mm)',
        { ...bleedOnly(5, false), bleed: mmBox(2, 2, 216, 303) },
        'noSlugBeyondBleed',
      ],
    ])('도련만 있는 정상 파일(%s) → 크롭하지 않음(%s)', (_l, spec, reason) => {
      expect(planTrimBoxCrop(boxes(spec))).toEqual({ action: 'none', reason });
    });

    it('편집기 P3 산출물(bleedMm 5: MediaBox=BleedBox=작업사이즈 220x307, TrimBox 재단) → none', () => {
      expect(planTrimBoxCrop(boxes(bleedOnly(5, true))).action).toBe('none');
    });

    it('BleedBox 가 TrimBox 를 감싸지 않음 → none(bleedBoxNotAroundTrim)', () => {
      expect(planTrimBoxCrop(boxes({ ...A_PAGE, bleed: mmBox(20, 20, 150, 200) }))).toEqual({
        action: 'none',
        reason: 'bleedBoxNotAroundTrim',
      });
    });

    it('퇴화(0x0)·극소 TrimBox → none(trimImplausible)', () => {
      const media = [0, 0, 600, 600];
      expect(planTrimBoxCrop(boxes({ media, trim: [300, 300, 300, 300], bleed: [300, 300, 300, 300] }))).toEqual({
        action: 'none',
        reason: 'trimImplausible',
      });
      expect(planTrimBoxCrop(boxes({ media, trim: [295, 295, 305, 305], bleed: [295, 295, 305, 305] }))).toEqual({
        action: 'none',
        reason: 'trimImplausible',
      });
    });

    it('하단 slug 비대칭(InDesign 패턴) → none(slugMarginAsymmetric)', () => {
      expect(planTrimBoxCrop(boxes(SLUG_BOTTOM_PAGE))).toEqual({
        action: 'none',
        reason: 'slugMarginAsymmetric',
      });
    });

    it('여백 3mm·4mm(도련만 있는 정상 파일) → none(noSlugMargin)', () => {
      const m3: PageSpec = { media: mmBox(0, 0, 216, 303), trim: mmBox(3, 3, 210, 297), bleed: mmBox(0, 0, 216, 303) };
      expect(planTrimBoxCrop(boxes(m3))).toEqual({ action: 'none', reason: 'noSlugMargin' });
      expect(planTrimBoxCrop(boxes(M4_PAGE))).toEqual({ action: 'none', reason: 'noSlugMargin' });
      // X1-R2 기대 결과: 사방 4mm·BleedBox 없음 → 합성 크롭 없음(원본 박스 유지)
      expect(planTrimBoxCrop(boxes(M4_NO_BLEED_PAGE))).toEqual({ action: 'none', reason: 'noSlugMargin' });
    });

    it('작업사이즈 MediaBox(212x299) + 비대칭 stale TrimBox → none(slugMarginAsymmetric)', () => {
      const stale: PageSpec = { media: mmBox(0, 0, 212, 299), trim: mmBox(11, 14.5, 190, 270) };
      expect(planTrimBoxCrop(boxes(stale))).toEqual({ action: 'none', reason: 'slugMarginAsymmetric' });
    });

    it('TrimBox ⊄ MediaBox → none(trimOutsideMedia)', () => {
      const out: PageSpec = { media: mmBox(0, 0, 236, 323), trim: mmBox(30, 30, 210, 297) };
      expect(planTrimBoxCrop(boxes(out))).toEqual({ action: 'none', reason: 'trimOutsideMedia' });
    });

    it('비신뢰·TrimBox 없음·Rotate 90/270·UserUnit≠1 → none', () => {
      expect(planTrimBoxCrop(boxes(A_PAGE, { authoritative: false }))).toEqual({ action: 'none', reason: 'notAuthoritative' });
      expect(planTrimBoxCrop(boxes({ media: A_PAGE.media }))).toEqual({ action: 'none', reason: 'noTrimBox' });
      expect(planTrimBoxCrop(boxes(A_PAGE, { rotate: 90 }))).toEqual({ action: 'none', reason: 'rotated' });
      expect(planTrimBoxCrop(boxes(A_PAGE, { rotate: 270 }))).toEqual({ action: 'none', reason: 'rotated' });
      expect(planTrimBoxCrop(boxes(A_PAGE, { userUnit: 2 }))).toEqual({ action: 'none', reason: 'userUnit' });
      // 180 은 폭·높이 불변 → 허용
      expect(planTrimBoxCrop(boxes(A_PAGE, { rotate: 180 })).action).toBe('crop');
    });

    it('주문 bleed 가 있으면 B = 주문 bleed(orderBleed), 목표가 MediaBox 밖이면 skip', () => {
      const pl = crop(planTrimBoxCrop(boxes(A_PAGE), { bleedMm: 1 }));
      expect(pl.source).toBe('orderBleed');
      expect(sizeMm(pl.target)).toEqual({ width: 212, height: 299 });
      const big: PageSpec = { media: mmBox(0, 0, 222, 309), trim: mmBox(6, 6, 210, 297) };
      expect(
        planTrimBoxCrop(boxes(big), { bleedMm: 7, expectedTrimMm: { width: 210, height: 297 } }),
      ).toEqual({ action: 'none', reason: 'targetOutsideMedia' });
      // 주문 bleed 만 있고 기대 재단을 모르면 slug 증거가 여전히 필요
      expect(planTrimBoxCrop(boxes(big), { bleedMm: 1 })).toEqual({ action: 'none', reason: 'noBleedBox' });
    });

    it('기대 재단을 아는 경로: TrimBox ≉ 기대 재단이면 none, 일치하면 여백 5mm 미만도 크롭', () => {
      expect(planTrimBoxCrop(boxes(A_PAGE), { expectedTrimMm: { width: 182, height: 257 } })).toEqual({
        action: 'none',
        reason: 'trimSizeMismatch',
      });
      const pl = crop(planTrimBoxCrop(boxes(M4_PAGE), { expectedTrimMm: { width: 210, height: 297 }, bleedMm: 1 }));
      expect(sizeMm(pl.target)).toEqual({ width: 212, height: 299 });
    });
  });

  describe('planTrimBoxCrop (editSize 경로 — 변환)', () => {
    const edit = { width: 212, height: 299 };
    it.each([
      ['A', A_PAGE],
      ['B', B_PAGE],
      ['사방 4mm', M4_PAGE],
      ['사방 4mm·BleedBox 없음', M4_NO_BLEED_PAGE],
    ])('%s + editSize 212x299 → 목표 212x299(B=1, source editSize)', (_l, spec) => {
      const pl = planTrimBoxCrop(boxes(spec), { editSizeMm: edit, noopTolMm: 0.2 });
      expect(pl.action).toBe('crop');
      const c = pl as Extract<TrimCropPlan, { action: 'crop' }>;
      expect(c.source).toBe('editSize');
      expect(sizeMm(c.target)).toEqual(edit);
    });

    it('MediaBox 가 이미 작업사이즈(212x299) + stale TrimBox → none(범위밖/비대칭/동일 중 하나 — 크롭 없음)', () => {
      const stale: PageSpec = { media: mmBox(0, 0, 212, 299), trim: mmBox(11, 14.5, 190, 270) };
      expect(planTrimBoxCrop(boxes(stale), { editSizeMm: edit, noopTolMm: 0.2 }).action).toBe('none');
      const centered: PageSpec = { media: mmBox(0, 0, 212, 299), trim: mmBox(2, 2, 208, 295) };
      expect(planTrimBoxCrop(boxes(centered), { editSizeMm: edit, noopTolMm: 0.2 })).toEqual({
        action: 'none',
        reason: 'targetEqualsMedia',
      });
    });

    it('작업사이즈 ±1mm(검증 통과 대역) 파일은 no-op(noopTol 1) — 종전 resolveMode 경로 유지', () => {
      const near: PageSpec = {
        media: mmBox(0, 0, 212.8, 299.8),
        trim: mmBox(1.4, 1.4, 210, 297),
        bleed: mmBox(0, 0, 212.8, 299.8),
      };
      expect(planTrimBoxCrop(boxes(near), { editSizeMm: edit, noopTolMm: 1 })).toEqual({
        action: 'none',
        reason: 'targetEqualsMedia',
      });
    });

    it('editSize − Trim 이 두 축 비대칭이면 skip(editSizeAsymmetric), 도련 5mm 초과면 skip', () => {
      expect(planTrimBoxCrop(boxes(A_PAGE), { editSizeMm: { width: 216, height: 299 } })).toEqual({
        action: 'none',
        reason: 'editSizeAsymmetric',
      });
      expect(planTrimBoxCrop(boxes(A_PAGE), { editSizeMm: { width: 230, height: 317 } })).toEqual({
        action: 'none',
        reason: 'editSizeBleedOutOfRange',
      });
    });
  });

  describe('evaluateTrimSizeBasis (판정 공용 함수, CTO X1-R2)', () => {
    /** 주문 210x297 · bleed 1 (B_order = 1) */
    const base = {
      pageCount: 2,
      expectedTrimMm: { width: 210, height: 297 },
      targetBleedMm: 1,
      orderBleedMm: 1,
      tolMm: 1,
    };
    it('박스 판별 불가(null)·페이지 수 불일치 → 불통과', () => {
      expect(evaluateTrimSizeBasis({ ...base, pages: null })).toEqual({ ok: false, reason: 'noBoxes' });
      expect(evaluateTrimSizeBasis({ ...base, pages: [boxes(A_PAGE)] })).toEqual({
        ok: false,
        reason: 'pageCountMismatch',
      });
    });
    it('파일 A(BleedBox=TrimBox) + bleed 1 → 통과, 도련 0 → hasBleed=false(BLEED_MISSING)', () => {
      const r = evaluateTrimSizeBasis({ ...base, pages: [boxes(A_PAGE), boxes(A_PAGE)] });
      expect(r).toEqual({
        ok: true,
        trimMm: { width: 210, height: 297 },
        mediaMm: { width: 236, height: 323 },
        effectiveBleedMm: 0,
        hasBleed: false,
      });
    });
    it('파일 B(BleedBox=trim+3) + bleed 1 → 통과(합성 산출 크기 무관), 도련 3 ≥ 1−0.5 → hasBleed=true', () => {
      const r = evaluateTrimSizeBasis({ ...base, pages: [boxes(B_PAGE), boxes(B_PAGE)] });
      expect(r).toEqual({
        ok: true,
        trimMm: { width: 210, height: 297 },
        mediaMm: { width: 236, height: 323 },
        effectiveBleedMm: 3,
        hasBleed: true,
      });
    });
    it('파일 B + bleed 3 → 통과, 도련 3 → hasBleed=true', () => {
      const r = evaluateTrimSizeBasis({
        ...base,
        targetBleedMm: 3,
        orderBleedMm: 3,
        pages: [boxes(B_PAGE), boxes(B_PAGE)],
      });
      expect(r).toMatchObject({ ok: true, effectiveBleedMm: 3, hasBleed: true });
    });
    it('사방 4mm·BleedBox 없음 + bleed 1 → 통과, 도련 0 → hasBleed=false', () => {
      const r = evaluateTrimSizeBasis({
        ...base,
        pages: [boxes(M4_NO_BLEED_PAGE), boxes(M4_NO_BLEED_PAGE)],
      });
      expect(r).toEqual({
        ok: true,
        trimMm: { width: 210, height: 297 },
        mediaMm: { width: 218, height: 305 },
        effectiveBleedMm: 0,
        hasBleed: false,
      });
    });
    it('도련 = 전 페이지 최소(1쪽 B 3mm + 2쪽 A 0mm) → 0, hasBleed=false', () => {
      const r = evaluateTrimSizeBasis({ ...base, pages: [boxes(B_PAGE), boxes(A_PAGE)] });
      expect(r).toMatchObject({ ok: true, effectiveBleedMm: 0, hasBleed: false });
    });
    it('BleedBox 없는 페이지가 하나라도 있으면 도련 0', () => {
      const r = evaluateTrimSizeBasis({
        ...base,
        pages: [boxes(B_PAGE), boxes({ ...B_PAGE, bleed: undefined })],
      });
      expect(r).toMatchObject({ ok: true, effectiveBleedMm: 0, hasBleed: false });
    });
    it('hasBleed 경계: 도련 ≥ 주문 bleed − tol/2 (bleed 3·tol 1 → 2.5 이상)', () => {
      const withBleed = (b: number): PageSpec => ({ ...A_PAGE, bleed: mmBox(13 - b, 13 - b, 210 + 2 * b, 297 + 2 * b) });
      const at = (b: number) =>
        evaluateTrimSizeBasis({ ...base, pageCount: 1, targetBleedMm: 3, orderBleedMm: 3, pages: [boxes(withBleed(b))] });
      expect(at(2.5)).toMatchObject({ ok: true, effectiveBleedMm: 2.5, hasBleed: true });
      expect(at(2.4)).toMatchObject({ ok: true, effectiveBleedMm: 2.4, hasBleed: false });
      // 판정은 반올림 전 원값: 표시값이 2.5(round1)여도 원값 < 2.5 면 hasBleed=false.
      expect(at(2.46)).toMatchObject({ ok: true, effectiveBleedMm: 2.5, hasBleed: false });
      expect(at(2.45)).toMatchObject({ ok: true, hasBleed: false });
    });
    it('TrimBox ≉ 기대 재단 → 불통과(trimSizeMismatch)', () => {
      const r = evaluateTrimSizeBasis({ ...base, expectedTrimMm: { width: 182, height: 257 }, pages: [boxes(A_PAGE), boxes(A_PAGE)] });
      expect(r).toEqual({ ok: false, reason: 'trimSizeMismatch', page: 1 });
    });
    it('known 목표(Trim+B_order)가 MediaBox 밖이면 불통과(targetOutsideMedia)', () => {
      const r = evaluateTrimSizeBasis({ ...base, pageCount: 1, targetBleedMm: 5, pages: [boxes(M4_PAGE)] });
      expect(r).toEqual({ ok: false, reason: 'targetOutsideMedia', page: 1 });
    });
    it('회전 90/270·UserUnit≠1·비신뢰·극소 TrimBox → 불통과', () => {
      const one = (pg: PageBoxesPt) => evaluateTrimSizeBasis({ ...base, pageCount: 1, pages: [pg] });
      expect(one(boxes(A_PAGE, { rotate: 90 }))).toEqual({ ok: false, reason: 'rotated', page: 1 });
      expect(one(boxes(A_PAGE, { rotate: 270 }))).toEqual({ ok: false, reason: 'rotated', page: 1 });
      expect(one(boxes(A_PAGE, { userUnit: 2 }))).toEqual({ ok: false, reason: 'userUnit', page: 1 });
      expect(one(boxes(A_PAGE, { authoritative: false }))).toEqual({ ok: false, reason: 'notAuthoritative', page: 1 });
      expect(
        one(boxes({ media: [0, 0, 600, 600], trim: [295, 295, 305, 305] })),
      ).toEqual({ ok: false, reason: 'trimImplausible', page: 1 });
    });
  });

  // ───────────────────────── 파일 정규화(qpdf) ─────────────────────────
  (HAS_QPDF ? describe : describe.skip)('normalizeTrimBoxFile (qpdf)', () => {
    it('A 32p → 모든 페이지 MediaBox=CropBox=TrimBox(36.85 36.85 632.13 878.74), 원본 불변', async () => {
      const input = await writePdf(repeat(A_PAGE, 32));
      const before = sha256(input);
      const inDicts = await extractPageDictsQpdf(input);
      const out = outPath('a');
      const r = await normalizeTrimBoxFile(input, out, {}, 'spec');
      expect(r).toEqual({ applied: true, pagesCropped: 32, path: out });
      expect(sha256(input)).toBe(before);

      const want = [36.85, 36.85, 632.13, 878.74];
      const viaLib = await readBoxesPdfLib(out);
      expect(viaLib).toHaveLength(32);
      for (const pg of viaLib) {
        expectBoxClose(pg.media, want, 0.01);
        expectBoxClose(pg.crop, want, 0.01);
        expectBoxClose(pg.trim, A_PAGE.trim as number[], 0.001); // TrimBox 보존
      }
      const meta = await extractPdfMetadataQpdf(out);
      expect(meta.pageCount).toBe(32);
      for (const p of meta.pages) {
        expectBoxClose(p.mediaBoxPt, want, 0.01);
        expectBoxClose(p.trimBoxPt, A_PAGE.trim as number[], 0.001);
      }
      // 콘텐츠 스트림 수 불변
      const outDicts = await extractPageDictsQpdf(out);
      const contentsLen = (d: Record<string, unknown>) =>
        Array.isArray(d['/Contents']) ? (d['/Contents'] as unknown[]).length : 1;
      expect(outDicts?.pages.map((p) => contentsLen(p.dict))).toEqual(
        inDicts?.pages.map((p) => contentsLen(p.dict)),
      );
    });

    it('크롭 대상 없음 → applied=false, path===inputPath, 출력 파일 미생성', async () => {
      const input = await writePdf(repeat({ media: mmBox(0, 0, 216, 303), trim: mmBox(3, 3, 210, 297) }, 2));
      const out = outPath('none');
      const r = await normalizeTrimBoxFile(input, out, {}, 'spec');
      expect(r).toEqual({ applied: false, pagesCropped: 0, path: input });
      expect(fs.existsSync(out)).toBe(false);
    });

    it.each([
      ['도련 5mm·BleedBox=MediaBox', bleedOnly(5, true)],
      ['도련 5mm·BleedBox 없음', bleedOnly(5, false)],
      ['도련 10mm·BleedBox=MediaBox', bleedOnly(10, true)],
      ['도련 10mm·BleedBox 없음', bleedOnly(10, false)],
    ])('도련만 있는 정상 파일(%s) → qpdf·pdf-lib 모두 applied=false, 출력 파일 미생성', async (_l, spec) => {
      const input = await writePdf(repeat(spec, 2));
      const out = outPath('bleedonly');
      expect(await normalizeTrimBoxFile(input, out, {}, 'spec')).toEqual({
        applied: false,
        pagesCropped: 0,
        path: input,
      });
      expect(fs.existsSync(out)).toBe(false);
      const doc = await PDFDocument.load(fs.readFileSync(input));
      expect(await normalizeTrimBoxPdfDoc(doc, {}, 'spec')).toEqual({ applied: false, pagesCropped: 0 });
    });

    it.each([['shortArray' as const], ['string' as const]])(
      '비정형 ArtBox(%s) + A 패턴 → qpdf·pdf-lib 모두 throw 없이 skip(applied=false)',
      async (bad) => {
        const input = await writePdf(repeat({ ...A_PAGE, badArtBox: bad }, 2));
        const out = outPath('badart');
        expect(await normalizeTrimBoxFile(input, out, {}, 'spec')).toEqual({
          applied: false,
          pagesCropped: 0,
          path: input,
        });
        expect(fs.existsSync(out)).toBe(false);
        const doc = await PDFDocument.load(fs.readFileSync(input));
        await expect(normalizeTrimBoxPdfDoc(doc, {}, 'spec')).resolves.toEqual({
          applied: false,
          pagesCropped: 0,
        });
      },
    );

    it('손상/비PDF 입력 → throw 없이 applied=false', async () => {
      const bad = path.join(tmpDir, 'not-a-pdf.pdf');
      fs.writeFileSync(bad, 'dummy');
      const out = outPath('bad');
      await expect(normalizeTrimBoxFile(bad, out, {}, 'spec')).resolves.toEqual({
        applied: false,
        pagesCropped: 0,
        path: bad,
      });
      expect(fs.existsSync(out)).toBe(false);
    });

    it('킬스위치 OFF → 입력 그대로(qpdf 미호출·새 파일 없음)', async () => {
      cfg.TRIMBOX_SIZE_CHECK = false;
      const input = await writePdf(repeat(A_PAGE, 2));
      const out = outPath('off');
      expect(await normalizeTrimBoxFile(input, out, {}, 'spec')).toEqual({
        applied: false,
        pagesCropped: 0,
        path: input,
      });
      expect(fs.existsSync(out)).toBe(false);
      const doc = await PDFDocument.load(fs.readFileSync(input));
      expect(await normalizeTrimBoxPdfDoc(doc, {}, 'spec')).toEqual({ applied: false, pagesCropped: 0 });
    });

    it('입력=출력 경로면 쓰지 않고 skip', async () => {
      const input = await writePdf(repeat(A_PAGE, 1));
      const before = sha256(input);
      expect((await normalizeTrimBoxFile(input, input, {}, 'spec')).applied).toBe(false);
      expect(sha256(input)).toBe(before);
    });

    it('멱등: 정규화 산출물을 다시 정규화하면 applied=false', async () => {
      const input = await writePdf(repeat(A_PAGE, 2));
      const once = await normalizeTrimBoxFile(input, outPath('once'), {}, 'spec');
      expect(once.applied).toBe(true);
      const twice = await normalizeTrimBoxFile(once.path, outPath('twice'), {}, 'spec');
      expect(twice.applied).toBe(false);
    });

    it.each([
      ['A', A_PAGE],
      ['B', B_PAGE],
    ])('%s: qpdf 경로와 pdf-lib 경로의 결과 박스 수치 동일(±0.01pt)', async (_l, spec) => {
      const input = await writePdf(repeat(spec, 3));
      const viaQpdf = await normalizeTrimBoxFile(input, outPath('q'), {}, 'spec');
      expect(viaQpdf.applied).toBe(true);
      const doc = await PDFDocument.load(fs.readFileSync(input));
      const r = await normalizeTrimBoxPdfDoc(doc, {}, 'spec');
      expect(r).toEqual({ applied: true, pagesCropped: 3 });
      const libOut = outPath('lib');
      fs.writeFileSync(libOut, Buffer.from(await doc.save()));
      const a = await readBoxesPdfLib(viaQpdf.path);
      const b = await readBoxesPdfLib(libOut);
      expect(a).toHaveLength(b.length);
      a.forEach((pg, i) => {
        expectBoxClose(pg.media, b[i].media);
        expectBoxClose(pg.crop, b[i].crop as number[]);
        expectBoxClose(pg.trim, b[i].trim as number[]);
        expectBoxClose(pg.bleed, b[i].bleed as number[]);
      });
    });

    it('정규화한 A 는 재검증 시 MediaBox 판정으로 바로 통과(TRIMBOX_SIZE_BASIS 없음)', async () => {
      const input = await writePdf(repeat(A_PAGE, 4));
      const r = await normalizeTrimBoxFile(input, outPath('reval'), {}, 'spec');
      const opts: ValidationOptions = {
        fileType: 'content',
        orderOptions: { size: { width: 210, height: 297 }, pages: 4, binding: 'perfect', bleed: 1 },
      };
      const v = await new PdfValidatorService().validate(r.path, opts);
      expect(v.metadata.pageSize).toEqual({ width: 210, height: 297 });
      expect(v.errors.map((e) => e.code)).not.toContain('SIZE_MISMATCH');
      expect(v.warnings.map((w) => w.code)).not.toContain(WarningCode.TRIMBOX_SIZE_BASIS);
    });

    it('compose OFF 경로 메커니즘: normalizeTrimBoxPdfDoc 후 copyPages 한 문서도 정규화 박스 유지', async () => {
      const src = await PDFDocument.load(await buildPdf(repeat(A_PAGE, 2)));
      await normalizeTrimBoxPdfDoc(src, {}, 'spec');
      const dst = await PDFDocument.create();
      (await dst.copyPages(src, src.getPageIndices())).forEach((p) => dst.addPage(p));
      const p = path.join(tmpDir, 'compose-off.pdf');
      fs.writeFileSync(p, Buffer.from(await dst.save()));
      for (const pg of await readBoxesPdfLib(p)) {
        expect(sizeMm(rectPt(pg.media))).toEqual({ width: 210, height: 297 });
        expectTrimCentered(pg.media, pg.trim);
      }
    });
  });

  // ───────────────────────── GS 재증류 뒤 박스 검증 (실제 gs) ─────────────────────────
  (HAS_QPDF && HAS_GS ? describe : describe.skip)('GS 재증류 뒤 TrimBox 위치 (gs 실제 실행)', () => {
    let normA: string;
    let normB: string;
    beforeAll(async () => {
      normA = (await normalizeTrimBoxFile(await writePdf(repeat(A_PAGE, 2)), outPath('gsA'), {}, 'spec')).path;
      normB = (await normalizeTrimBoxFile(await writePdf(repeat(B_PAGE, 2)), outPath('gsB'), {}, 'spec')).path;
    });

    it('centerOnPage(정규화 A, 212x299) → TrimBox ⊂ MediaBox · 중심 일치', async () => {
      const out = outPath('center');
      await ghostscript.centerOnPage(normA, out, 212, 299);
      const pages = await readBoxesPdfLib(out);
      expect(sizeMm(rectPt(pages[0].media))).toEqual({ width: 212, height: 299 });
      for (const pg of pages) {
        expectTrimCentered(pg.media, pg.trim);
        expect(sizeMm(rectPt(pg.trim as number[]))).toEqual({ width: 210, height: 297 });
      }
    });

    it('addBleedToPdf(정규화 A, 3mm) → 216x303, TrimBox ⊂ MediaBox · 중심 일치', async () => {
      const out = outPath('bleed');
      await ghostscript.addBleedToPdf(normA, out, 3);
      const pages = await readBoxesPdfLib(out);
      expect(sizeMm(rectPt(pages[0].media))).toEqual({ width: 216, height: 303 });
      for (const pg of pages) expectTrimCentered(pg.media, pg.trim);
    });

    it('mergePdfs(정규화 A + 정규화 B) → 페이지별 TrimBox ⊂ MediaBox · 중심 일치', async () => {
      const out = outPath('merge');
      await ghostscript.mergePdfs([normA, normB], out);
      const pages = await readBoxesPdfLib(out);
      expect(pages).toHaveLength(4);
      expect(sizeMm(rectPt(pages[0].media))).toEqual({ width: 210, height: 297 });
      expect(sizeMm(rectPt(pages[2].media))).toEqual({ width: 216, height: 303 });
      for (const pg of pages) expectTrimCentered(pg.media, pg.trim);
    });
  });

  // ───────────────────────── 변환(convert) 통합 ─────────────────────────
  (HAS_QPDF && HAS_GS ? describe : describe.skip)('PdfConverterService 통합 (gs 실제 실행)', () => {
    const savedStorage = process.env.STORAGE_PATH;
    let service: PdfConverterService;
    beforeAll(() => {
      process.env.STORAGE_PATH = tmpDir;
      service = new PdfConverterService();
    });
    afterAll(() => {
      if (savedStorage === undefined) delete process.env.STORAGE_PATH;
      else process.env.STORAGE_PATH = savedStorage;
    });
    const impositionOpts = (edit: { width: number; height: number }) => ({
      addPages: false,
      applyBleed: false,
      targetPages: 0,
      bleed: 0,
      editSize: edit,
      sizeToleranceMm: 0.2,
    });

    it.each([
      ['B 패턴', B_PAGE],
      ['A 패턴', A_PAGE],
      ['사방 4mm', M4_PAGE],
      ['사방 4mm·BleedBox 없음', M4_NO_BLEED_PAGE],
    ])('inner-imposition editSize 212x299 + %s → innerfit 미선택·스케일 1.0·TrimBox 중심 보존', async (_l, spec) => {
      const resizeSpy = jest.spyOn(ghostscript, 'resizePdf');
      const centerSpy = jest.spyOn(ghostscript, 'centerOnPage');
      const input = await writePdf(repeat(spec, 2));
      const before = sha256(input);
      const out = outPath('conv');
      const res = await service.convert(input, impositionOpts({ width: 212, height: 299 }), out);
      expect(res.success).toBe(true);
      expect(resizeSpy).not.toHaveBeenCalled(); // innerfit(-dPDFFitPage 축소) 미선택
      expect(centerSpy).not.toHaveBeenCalled(); // passthrough(무가공)
      expect(res.finalSize).toEqual({ width: 212, height: 299 });
      for (const pg of await readBoxesPdfLib(out)) {
        expect(sizeMm(rectPt(pg.media))).toEqual({ width: 212, height: 299 });
        expect(sizeMm(rectPt(pg.trim as number[]))).toEqual({ width: 210, height: 297 }); // 스케일 1.0
        expectTrimCentered(pg.media, pg.trim);
      }
      expect(sha256(input)).toBe(before); // 원본 불변
    });

    it('킬스위치 OFF → 같은 B 입력이 종전대로 innerfit(축소) 경로', async () => {
      cfg.TRIMBOX_SIZE_CHECK = false;
      const resizeSpy = jest.spyOn(ghostscript, 'resizePdf');
      const input = await writePdf(repeat(B_PAGE, 1));
      await service.convert(input, impositionOpts({ width: 212, height: 299 }), outPath('conv-off'));
      expect(resizeSpy).toHaveBeenCalled();
    });

    it('stale TrimBox + MediaBox=작업사이즈(212x299) → 산출물 바이트 불변(플래그 ON = OFF = 입력)', async () => {
      const stale: PageSpec = { media: mmBox(0, 0, 212, 299), trim: mmBox(11, 14.5, 190, 270) };
      const input = await writePdf(repeat(stale, 2));
      const onOut = outPath('stale-on');
      await service.convert(input, impositionOpts({ width: 212, height: 299 }), onOut);
      cfg.TRIMBOX_SIZE_CHECK = false;
      const offOut = outPath('stale-off');
      await service.convert(input, impositionOpts({ width: 212, height: 299 }), offOut);
      expect(sha256(onOut)).toBe(sha256(offOut));
      expect(sha256(onOut)).toBe(sha256(input)); // passthrough
    });

    it('fix-pagecount: A 3p → 정규화(원점≠0) + 백지도 같은 좌표계 MediaBox·TrimBox·BleedBox', async () => {
      const input = await writePdf(repeat(A_PAGE, 3));
      const out = outPath('pad');
      const res = await service.convert(
        input,
        { addPages: false, applyBleed: false, targetPages: 0, bleed: 0, padToMultiple: 4 },
        out,
      );
      expect(res.pagesAdded).toBe(1);
      const pages = await readBoxesPdfLib(out);
      expect(pages).toHaveLength(4);
      const first = pages[0];
      expect(first.media[0]).toBeGreaterThan(30); // 원점 ≠ 0
      expectBoxClose(pages[3].media, first.media);
      expectBoxClose(pages[3].trim, first.trim as number[]);
      expectBoxClose(pages[3].bleed, first.bleed as number[]);
      expectBoxClose(pages[3].crop, first.crop as number[]);
      expectTrimCentered(pages[3].media, pages[3].trim);
    });

    it('작업사이즈 +0.8mm(212.8x299.8, 검증 통과 대역) + TrimBox → 종전대로 innerfit(ON≡OFF)', async () => {
      const near: PageSpec = {
        media: mmBox(0, 0, 212.8, 299.8),
        trim: mmBox(1.4, 1.4, 210, 297),
        bleed: mmBox(0, 0, 212.8, 299.8),
      };
      const input = await writePdf(repeat(near, 1));
      const onSpy = jest.spyOn(ghostscript, 'resizePdf');
      await service.convert(input, impositionOpts({ width: 212, height: 299 }), outPath('near-on'));
      expect(onSpy).toHaveBeenCalledTimes(1);
      onSpy.mockClear();
      cfg.TRIMBOX_SIZE_CHECK = false;
      await service.convert(input, impositionOpts({ width: 212, height: 299 }), outPath('near-off'));
      expect(onSpy).toHaveBeenCalledTimes(1);
    });

    it('fix-pagecount: TrimBox 보유 + 정규화 없음(작업사이즈 216x303) → 백지 박스 구조 ON≡OFF(복제 없음)', async () => {
      const normal: PageSpec = {
        media: mmBox(0, 0, 216, 303),
        trim: mmBox(3, 3, 210, 297),
        bleed: mmBox(0, 0, 216, 303),
      };
      const input = await writePdf(repeat(normal, 3));
      const padOpts = { addPages: false, applyBleed: false, targetPages: 0, bleed: 0, padToMultiple: 4 };
      const onOut = outPath('pad-norm-on');
      await service.convert(input, padOpts, onOut);
      cfg.TRIMBOX_SIZE_CHECK = false;
      const offOut = outPath('pad-norm-off');
      await service.convert(input, padOpts, offOut);
      const on = await readBoxesPdfLib(onOut);
      const off = await readBoxesPdfLib(offOut);
      expect(on).toEqual(off);
      expect(on[3].trim).toBeUndefined();
      expect(on[3].bleed).toBeUndefined();
    });

    it('fix-pagecount: 첫 페이지 박스 비정형(TrimBox 원소 3개) → throw 없이 종전 백지 경로', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      page.node.set(PDFName.of('TrimBox'), doc.context.obj([10, 10, 590]));
      const input = path.join(tmpDir, `bad-trim-${seq++}.pdf`);
      fs.writeFileSync(input, Buffer.from(await doc.save()));
      const out = outPath('pad-bad');
      const res = await service.convert(
        input,
        { addPages: false, applyBleed: false, targetPages: 0, bleed: 0, padToMultiple: 2 },
        out,
      );
      expect(res.success).toBe(true);
      expect(res.pagesAdded).toBe(1);
      const outDoc = await PDFDocument.load(fs.readFileSync(out));
      expect(outDoc.getPageCount()).toBe(2);
      const blank = outDoc.getPage(1);
      expect(blank.getMediaBox()).toEqual({ x: 0, y: 0, width: 600, height: 800 });
      expect(blank.node.TrimBox()).toBeUndefined();
    });

    it('fix-pagecount: TrimBox 없는 PDF → 백지 종전과 동일(원점 0, 박스 미설정)', async () => {
      const input = await writePdf(repeat({ media: mmBox(0, 0, 210, 297) }, 3));
      const out = outPath('pad-plain');
      await service.convert(
        input,
        { addPages: false, applyBleed: false, targetPages: 0, bleed: 0, padToMultiple: 4 },
        out,
      );
      const pages = await readBoxesPdfLib(out);
      expect(pages).toHaveLength(4);
      expect(pages[3].media[0]).toBe(0);
      expect(pages[3].media[1]).toBe(0);
      expect(pages[3].trim).toBeUndefined();
      expect(pages[3].bleed).toBeUndefined();
    });
  });

  // ───────────────────────── 합성(merge) 통합 ─────────────────────────
  (HAS_QPDF ? describe : describe.skip)('PdfSynthesizerService.synthesizeToLocal 내지 정규화', () => {
    const run = async (
      gs: boolean,
      spec: PageSpec = A_PAGE,
      want: { width: number; height: number } = { width: 210, height: 297 },
    ) => {
      const svc = new PdfSynthesizerService();
      const internals = svc as unknown as { storagePath: string; gsAvailable: boolean | null };
      internals.storagePath = tmpDir;
      internals.gsAvailable = gs;
      const cover = await writePdf([{ media: mmBox(0, 0, 216, 303) }]);
      const content = await writePdf(repeat(spec, 2));
      const before = sha256(content);
      const r = await svc.synthesizeToLocal(cover, content, { outputFormat: 'merged' });
      expect(sha256(content)).toBe(before); // 원본 불변
      const src = await readBoxesPdfLib(r.sourceContentPath);
      for (const pg of src) expect(sizeMm(rectPt(pg.media))).toEqual(want);
      const merged = await readBoxesPdfLib(r.mergedPath);
      expect(merged).toHaveLength(3);
      for (const pg of merged.slice(1)) {
        expect(sizeMm(rectPt(pg.media))).toEqual(want);
        expect(sizeMm(rectPt(pg.trim as number[]))).toEqual({ width: 210, height: 297 });
        expectTrimCentered(pg.media, pg.trim);
      }
      return { before, sourceContentPath: r.sourceContentPath };
    };
    it('pdf-lib 병합 경로 — 파일 A → 210x297(B=0 크롭)', async () => {
      await run(false);
    });
    it('X1-R2 파일 B(BleedBox=trim+3) → 합성 산출 216x303(선언 도련 3 크롭), TrimBox 중앙', async () => {
      await run(false, B_PAGE, { width: 216, height: 303 });
    });
    it('X1-R2 사방 4mm·BleedBox 없음 → 크롭 없음: 원본 218x305·내지 입력 바이트 불변, TrimBox 중앙 보존', async () => {
      const r = await run(false, M4_NO_BLEED_PAGE, { width: 218, height: 305 });
      expect(sha256(r.sourceContentPath)).toBe(r.before);
    });
    it.each([
      ['도련 5mm·BleedBox=MediaBox(편집기 P3 패턴)', bleedOnly(5, true)],
      ['도련 5mm·BleedBox 없음', bleedOnly(5, false)],
      ['도련 10mm·BleedBox=MediaBox', bleedOnly(10, true)],
    ])('도련만 있는 정상 파일(%s) → 내지 입력 바이트 불변(ON≡OFF), 산출 크기 = MediaBox', async (_l, spec) => {
      const svc = new PdfSynthesizerService();
      const internals = svc as unknown as { storagePath: string; gsAvailable: boolean | null };
      internals.storagePath = tmpDir;
      internals.gsAvailable = false;
      const cover = await writePdf([{ media: mmBox(0, 0, 216, 303) }]);
      const content = await writePdf(repeat(spec, 2));
      const before = sha256(content);
      const on = await svc.synthesizeToLocal(cover, content, { outputFormat: 'merged' });
      expect(sha256(on.sourceContentPath)).toBe(before);
      cfg.TRIMBOX_SIZE_CHECK = false;
      const off = await svc.synthesizeToLocal(cover, content, { outputFormat: 'merged' });
      expect(sha256(off.sourceContentPath)).toBe(before);
      const merged = await readBoxesPdfLib(on.mergedPath);
      const want = sizeMm(rectPt(spec.media));
      for (const pg of merged.slice(1)) expect(sizeMm(rectPt(pg.media))).toEqual(want);
    });
    (HAS_GS ? it : it.skip)('GS 병합 경로(gs 실제 실행)', async () => {
      await run(true);
    });
    (HAS_GS ? it : it.skip)('GS 병합 경로 — X1-R2 파일 B → 216x303, TrimBox 중앙(gs 실제 실행)', async () => {
      await run(true, B_PAGE, { width: 216, height: 303 });
    });
  });
});
