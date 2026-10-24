/**
 * `@storige/types` product-profile 순수 함수 단위 테스트 (P1 캘린더, 2026-10-17).
 * packages/types 에는 테스트 러너가 없어 api jest(소스 매핑)에서 실행한다.
 */
import {
  addMonths,
  CALENDAR_YEAR_MONTH_COUNT,
  DEFAULT_CALENDAR_YEAR_SPAN,
  formatCalendarPageLabel,
  formatPhotoPageLabel,
  isCalendarYearDeltaAllowed,
  isStartMonthAllowed,
  readPhotoItems,
  resolveCalendarCanvasCount,
  resolveCalendarCanvasSlot,
  resolveCalendarYearSpan,
  resolveCalendarYearStart,
  resolvePhotoFitMode,
  resolvePhotoFrameInsetMm,
  resolvePhotoItemCanvasIndex,
  resolvePhotoItemCount,
  resolveProductProfile,
  summarizeProductProfile,
  validateProductProfile,
  type CalendarProfile,
  type PhotoPrintProfile,
  type ProductProfile,
} from '@storige/types';

const deskLarge: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: {
    faces: 2,
    canvasLayout: 'canvas-pair',
    binding: 'top-ring',
    pairing: 'offset-next',
    backRotation: 0,
    duplexFlip: 'short-edge',
  },
  calendar: {
    layout: 'desk',
    monthCount: 12,
    coverCanvases: 1,
    canvasesPerMonth: 2,
    epilogueCanvases: 1,
    allowedRange: { from: '2026-01', to: '2027-12' },
    weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true },
    dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
};

const sheetProfile: ProductProfile = {
  version: 1,
  kind: 'sheet',
  editorType: 'sheet_single',
  pages: { kind: 'range', min: 1, max: 10, labelRule: 'default' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  output: { mode: 'single-pdf' },
};

// ── P2-d 사진인화 프로파일 4종(admin 프리셋과 같은 shape) ─────────────────────────────────────

const photoPrintBlock: PhotoPrintProfile = {
  process: 'chemical',
  composition: 'per-photo-free-back',
  sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
  options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true },
  copies: { min: 1, max: 99 },
  upload: { maxPhotos: 200, maxMb: 25 },
};

/** 인화(chemical) — 단면 미니랩, 단일 PDF */
const photoChem: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: photoPrintBlock,
  output: { mode: 'single-pdf' },
};

const digitalBase: Omit<ProductProfile, 'editorType' | 'photoPrint'> = {
  version: 1,
  kind: 'photo-print',
  pages: { kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
};

/** 인쇄 ① — 사진별 자유 뒷면 */
const photoDigitalItems: ProductProfile = {
  ...digitalBase,
  editorType: 'photo_digital_items',
  photoPrint: { ...photoPrintBlock, process: 'digital' },
};

/** 인쇄 ② — 사진별 고정 뒷면(backTemplateId) */
const photoDigitalFixedBack: ProductProfile = {
  ...digitalBase,
  editorType: 'photo_digital_fixedback',
  photoPrint: { ...photoPrintBlock, process: 'digital', composition: 'per-photo-fixed-back', backTemplateId: 'tpl-back-1' },
};

/** 인쇄 ③ — 카드형(앞/뒤 한 쌍) */
const photoDigitalSheet: ProductProfile = {
  ...digitalBase,
  editorType: 'photo_digital_sheet',
  photoPrint: {
    ...photoPrintBlock,
    process: 'digital',
    composition: 'sheet-cards',
    sizes: [{ code: 'card-90x54', widthMm: 90, heightMm: 54, minDpi: 300 }],
    options: { ...photoPrintBlock.options, borderInsetMm: 3 },
  },
};

/** 깊은 복제 후 경로 수정 — 테스트 가독성용 */
function withPatch(base: ProductProfile, patch: (p: Record<string, any>) => void): unknown {
  const clone = JSON.parse(JSON.stringify(base)) as Record<string, any>;
  patch(clone);
  return clone;
}

describe('resolveProductProfile — NULL/미정의/무효는 legacy(null)', () => {
  it('null·undefined·{productProfile:null} → null, 경고 없음', () => {
    const warn = jest.fn();
    expect(resolveProductProfile(null, warn)).toBeNull();
    expect(resolveProductProfile(undefined, warn)).toBeNull();
    expect(resolveProductProfile({ productProfile: null }, warn)).toBeNull();
    expect(resolveProductProfile({}, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('version !== 1 → null + warn 1회', () => {
    const warn = jest.fn();
    const raw = withPatch(deskLarge, (p) => { p.version = 2; }) as ProductProfile;
    expect(resolveProductProfile({ productProfile: raw }, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('version');
  });

  it('검증 실패 → null + warn(오류 문구 포함)', () => {
    const warn = jest.fn();
    const raw = withPatch(deskLarge, (p) => { p.pages.count = 25; }) as ProductProfile;
    expect(resolveProductProfile({ productProfile: raw }, warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('pages.count(25)');
  });

  it('유효 → 같은 객체 참조를 돌려준다', () => {
    const warn = jest.fn();
    expect(resolveProductProfile({ productProfile: deskLarge }, warn)).toBe(deskLarge);
    expect(resolveProductProfile({ productProfile: sheetProfile }, warn)).toBe(sheetProfile);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('validateProductProfile', () => {
  it('오너 확정 탁상 라지·낱장 range 프로파일은 오류 0', () => {
    expect(validateProductProfile(deskLarge)).toEqual([]);
    expect(validateProductProfile(sheetProfile)).toEqual([]);
  });

  it('객체 아님 → 단일 오류', () => {
    expect(validateProductProfile(null)).toEqual(['프로파일은 객체여야 합니다']);
    expect(validateProductProfile('x')).toEqual(['프로파일은 객체여야 합니다']);
    expect(validateProductProfile([])).toEqual(['프로파일은 객체여야 합니다']);
  });

  it('kind 오류·editorType 형식', () => {
    const errs = validateProductProfile(withPatch(deskLarge, (p) => { p.kind = 'poster'; p.editorType = 'Bad-Code'; }));
    expect(errs).toContain('kind 는 sheet|calendar|photo-print 중 하나여야 합니다');
    expect(errs.some((e) => e.startsWith('editorType'))).toBe(true);
  });

  it("kind 'photo-print' 는 P2-d 부터 어휘로 통과 — photoPrint 블록이 없으면 그 문구만", () => {
    const errs = validateProductProfile(withPatch(deskLarge, (p) => { p.kind = 'photo-print'; delete p.calendar; p.pages.labelRule = 'default'; }));
    expect(errs.some((e) => e.startsWith('kind 는'))).toBe(false);
    expect(errs).toContain("kind='photo-print' 는 photoPrint 프로파일이 필요합니다");
  });

  it('pages fixed 는 count ≥1, range 는 min<=max', () => {
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.pages = { kind: 'fixed', count: 0, labelRule: 'default' }; })))
      .toContain('pages.count 는 1 이상 정수여야 합니다');
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.pages = { kind: 'range', min: 5, max: 2, labelRule: 'default' }; })))
      .toContain('pages.min/max 는 1 이상 정수이고 min<=max 여야 합니다');
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.pages.kind = 'auto'; })))
      .toContain("pages.kind 는 'fixed'|'range' 여야 합니다");
  });

  it('protectedIndices 는 중복 없고 count 미만', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.pages.protectedIndices = [0, 0]; })))
      .toContain('pages.protectedIndices 는 중복 없는 0 이상 정수 배열이어야 합니다');
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.pages.protectedIndices = [0, 26]; })))
      .toContain('pages.protectedIndices 는 pages.count 미만이어야 합니다');
  });

  it('faces ↔ canvasLayout 결합', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.sheet.canvasLayout = 'canvas-per-sheet'; p.sheet.pairing = undefined; })))
      .toContain("sheet.faces=2 이면 canvasLayout 은 'canvas-pair' 여야 합니다");
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.sheet.canvasLayout = 'canvas-pair'; p.sheet.pairing = 'same-sheet'; })))
      .toContain("sheet.faces=1 이면 canvasLayout 은 'canvas-per-sheet' 여야 합니다");
  });

  it('pairing 규칙 — canvas-pair 필수, per-sheet 금지, center-punch 는 same-sheet 만', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { delete p.sheet.pairing; })))
      .toContain('canvas-pair 는 sheet.pairing(same-sheet|offset-next) 이 필요합니다');
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.sheet.pairing = 'same-sheet'; })))
      .toContain('sheet.pairing 은 canvas-pair 에서만 지정합니다');
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.sheet.binding = 'center-punch'; })))
      .toContain("sheet.binding='center-punch' 는 pairing 'same-sheet' 만 허용합니다");
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.sheet.binding = 'center-punch'; p.sheet.pairing = 'same-sheet'; })))
      .toEqual([]);
  });

  it('faces=2 이면 fixed count 는 짝수', () => {
    const errs = validateProductProfile(withPatch(deskLarge, (p) => { p.pages.count = 27; p.calendar.epilogueCanvases = 2; }));
    expect(errs).toContain('sheet.faces=2 이면 pages.count 는 짝수여야 합니다');
    expect(errs.some((e) => e.includes('coverCanvases + 12×canvasesPerMonth'))).toBe(false);
  });

  it("calendar 는 kind='calendar' 에서 필수, 그 외 금지; labelRule 'month' 는 calendar 전용", () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { delete p.calendar; })))
      .toContain("kind='calendar' 는 calendar 프로파일이 필요합니다");
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.calendar = deskLarge.calendar; })))
      .toContain("calendar 프로파일은 kind='calendar' 에서만 지정합니다");
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.pages.labelRule = 'month'; })))
      .toContain("pages.labelRule='month' 는 kind='calendar' 에서만 쓸 수 있습니다");
  });

  it('calendar 는 pages fixed + labelRule month + count 정합(1+12×2+1=26)', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.pages.count = 25; })))
      .toContain('pages.count(25)는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = 26 여야 합니다');
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.pages.labelRule = 'default'; })))
      .toContain("calendar 프로파일은 pages.labelRule='month' 여야 합니다");
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.pages = { kind: 'range', min: 26, max: 26, labelRule: 'month' }; })))
      .toContain("calendar 프로파일은 pages.kind='fixed' 여야 합니다");
    // 월1면(12+2=14) 도 정합이면 통과
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.canvasesPerMonth = 1; p.pages.count = 14; p.pages.protectedIndices = [0, 13]; })))
      .toEqual([]);
  });

  it('allowedRange 형식·순서·데이터 범위(시작연월+11개월)', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.allowedRange = { from: '2026-1', to: '2027-12' }; })))
      .toContain("calendar.allowedRange.from/to 는 'YYYY-MM' 형식이어야 합니다");
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.allowedRange = { from: '2027-12', to: '2026-01' }; })))
      .toContain('calendar.allowedRange.from 은 to 이전이거나 같아야 합니다');
    // to=2035-02 → 마지막 월 2036-01 > 데이터 끝 2035-12
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.allowedRange = { from: '2026-01', to: '2035-02' }; })))
      .toContain('calendar.allowedRange(시작연월+11개월)는 데이터 범위 2025-01~2035-12 안이어야 합니다');
    // to=2035-01 → 마지막 월 2035-12 = 경계 포함 통과
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.allowedRange = { from: '2025-01', to: '2035-01' }; })))
      .toEqual([]);
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.allowedRange = { from: '2024-12', to: '2026-01' }; })))
      .toContain('calendar.allowedRange(시작연월+11개월)는 데이터 범위 2025-01~2035-12 안이어야 합니다');
  });

  it('dataVersion 미등록·show·weekStart·monthCount', () => {
    const errs = validateProductProfile(withPatch(deskLarge, (p) => {
      p.calendar.dataVersion = 'kr-9999';
      p.calendar.show.lunar = 'yes';
      p.calendar.weekStart = 2;
      p.calendar.monthCount = 13;
    }));
    expect(errs).toContain('calendar.dataVersion 은 kr-2025-2035-v1 중 하나여야 합니다');
    expect(errs).toContain('calendar.show.holidays/lunar/solarTerms 는 boolean 이어야 합니다');
    expect(errs).toContain('calendar.weekStart 는 0|1 이어야 합니다');
    expect(errs).toContain('calendar.monthCount 는 12 여야 합니다');
  });

  it('output.mode 는 single-pdf 또는 sheet-map 만 (P2-a 에서 sheet-map 허용)', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.output.mode = 'per-sheet'; })))
      .toContain("output.mode 는 'single-pdf' 또는 'sheet-map' 여야 합니다");
    expect(validateProductProfile(withPatch(deskLarge, (p) => { delete p.output; })))
      .toContain("output.mode 는 'single-pdf' 또는 'sheet-map' 여야 합니다");
  });

  it('postProcess 형식', () => {
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.postProcess = { pages: 1, source: 'upload', colorRule: 'spot-only', allowTransparency: false }; })))
      .toEqual([]);
    const errs = validateProductProfile(withPatch(sheetProfile, (p) => { p.postProcess = { pages: 0, source: 'editor', colorRule: 'cmyk', allowTransparency: 'no' }; }));
    expect(errs).toHaveLength(4);
  });
});

// ── P2-d 사진인화 — 검증 결합 규칙 ───────────────────────────────────────────────────────────
describe('validateProductProfile — photo-print (P2-d, 2026-10-19)', () => {
  it('사진인화 프로파일 4종(인화·인쇄 ①②③)은 오류 0, resolveProductProfile 은 같은 참조', () => {
    const warn = jest.fn();
    for (const profile of [photoChem, photoDigitalItems, photoDigitalFixedBack, photoDigitalSheet]) {
      expect(validateProductProfile(profile)).toEqual([]);
      expect(resolveProductProfile({ productProfile: profile }, warn)).toBe(profile);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('chemical 에 faces 2(canvas-pair) → 결합 오류', () => {
    const errs = validateProductProfile(withPatch(photoChem, (p) => {
      p.sheet = { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' };
    }));
    expect(errs).toEqual(["photoPrint.process='chemical' 은 sheet.faces=1(canvas-per-sheet) 이어야 합니다"]);
  });

  it('chemical 에 composition fixed-back / output sheet-map → 결합 오류', () => {
    expect(validateProductProfile(withPatch(photoChem, (p) => { p.photoPrint.composition = 'per-photo-fixed-back'; p.photoPrint.backTemplateId = 'x'; })))
      .toEqual(["photoPrint.process='chemical' 은 composition 'per-photo-free-back' 만 허용합니다"]);
    expect(validateProductProfile(withPatch(photoChem, (p) => { p.output = { mode: 'sheet-map' }; })))
      .toEqual(["photoPrint.process='chemical' 은 output.mode='single-pdf' 여야 합니다"]);
  });

  it('digital 에 pages.step 1 → 결합 오류', () => {
    expect(validateProductProfile(withPatch(photoDigitalItems, (p) => { p.pages.step = 1; })))
      .toEqual(["photoPrint.process='digital' 은 pages.step=2 여야 합니다"]);
  });

  it('digital 에 faces 1 / pairing offset-next / min 홀수 → 결합 오류', () => {
    expect(validateProductProfile(withPatch(photoDigitalItems, (p) => {
      p.sheet = { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' };
    }))).toEqual(["photoPrint.process='digital' 은 sheet.faces=2(canvas-pair) 이어야 합니다"]);
    expect(validateProductProfile(withPatch(photoDigitalItems, (p) => { p.sheet.pairing = 'offset-next'; })))
      .toEqual(["photoPrint.process='digital' 은 sheet.pairing 'same-sheet' 만 허용합니다"]);
    expect(validateProductProfile(withPatch(photoDigitalItems, (p) => { p.pages.min = 3; })))
      .toEqual(["photoPrint.process='digital' 은 pages.min/max 가 짝수여야 합니다"]);
  });

  it("fixed-back 에 backTemplateId 없음 → 결합 오류; 빈 문자열은 형식 오류", () => {
    expect(validateProductProfile(withPatch(photoDigitalFixedBack, (p) => { delete p.photoPrint.backTemplateId; })))
      .toEqual(["photoPrint.composition='per-photo-fixed-back' 은 backTemplateId 가 필요합니다"]);
    expect(validateProductProfile(withPatch(photoDigitalFixedBack, (p) => { p.photoPrint.backTemplateId = ' '; })))
      .toEqual(['photoPrint.backTemplateId 는 생략하거나 비어 있지 않은 문자열이어야 합니다']);
  });

  it("photo-print 는 pages.kind 'range' 만 — fixed 는 결합 오류", () => {
    expect(validateProductProfile(withPatch(photoChem, (p) => { p.pages = { kind: 'fixed', count: 10, labelRule: 'photo' }; })))
      .toEqual(["photo-print 프로파일은 pages.kind='range' 여야 합니다"]);
  });

  it("labelRule 'photo' 는 photo-print 전용 — calendar/sheet 에 쓰면 오류; photoPrint 블록도 photo-print 전용", () => {
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.pages.labelRule = 'photo'; })))
      .toEqual(["pages.labelRule='photo' 는 kind='photo-print' 에서만 쓸 수 있습니다"]);
    const calErrs = validateProductProfile(withPatch(deskLarge, (p) => { p.pages.labelRule = 'photo'; }));
    expect(calErrs).toContain("calendar 프로파일은 pages.labelRule='month' 여야 합니다");
    expect(validateProductProfile(withPatch(sheetProfile, (p) => { p.photoPrint = photoPrintBlock; })))
      .toEqual(["photoPrint 프로파일은 kind='photo-print' 에서만 지정합니다"]);
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.photoPrint = photoPrintBlock; })))
      .toEqual(["photoPrint 프로파일은 kind='photo-print' 에서만 지정합니다"]);
  });

  it('photoPrint 블록 형식 — sizes 2개·code 형식·어휘 중복·copies 역전·upload', () => {
    const errs = validateProductProfile(withPatch(photoChem, (p) => {
      p.photoPrint.sizes = [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }, { code: '5x7', widthMm: 127, heightMm: 178, minDpi: 200 }];
      p.photoPrint.options.border = ['none', 'none'];
      p.photoPrint.copies = { min: 5, max: 1 };
      p.photoPrint.upload = { maxPhotos: 0, maxMb: 25 };
    }));
    expect(errs).toContain('photoPrint.sizes 는 정확히 1개여야 합니다(P2: 1세션 1사이즈)');
    expect(errs).toContain('photoPrint.options.border 는 none|white 의 중복 없는 비어 있지 않은 배열이어야 합니다');
    expect(errs).toContain('photoPrint.copies.min/max 는 1 이상 정수이고 min<=max 여야 합니다');
    expect(errs).toContain('photoPrint.upload.maxPhotos 는 1 이상 정수, maxMb 는 0보다 큰 숫자여야 합니다');
    expect(validateProductProfile(withPatch(photoChem, (p) => { p.photoPrint.sizes[0].code = '4 x 6'; })))
      .toEqual(["photoPrint.sizes[0].code 는 영숫자·'_'·'-' 1~32자여야 합니다"]);
  });

  it('기존 캘린더·낱장 프로파일 결과는 불변(오류 0)', () => {
    expect(validateProductProfile(deskLarge)).toEqual([]);
    expect(validateProductProfile(sheetProfile)).toEqual([]);
  });
});

// ── P2-d 사진인화 — 항목 매핑·정제(순수 함수) ─────────────────────────────────────────────
describe('사진인화 항목 매핑(순수 함수)', () => {
  it('resolvePhotoItemCanvasIndex: chemical i→i, digital(①②③) i→2i, 비정수·음수 → -1', () => {
    expect(resolvePhotoItemCanvasIndex(photoChem, 0)).toBe(0);
    expect(resolvePhotoItemCanvasIndex(photoChem, 7)).toBe(7);
    expect(resolvePhotoItemCanvasIndex(photoDigitalItems, 0)).toBe(0);
    expect(resolvePhotoItemCanvasIndex(photoDigitalItems, 3)).toBe(6);
    expect(resolvePhotoItemCanvasIndex(photoDigitalFixedBack, 3)).toBe(6);
    expect(resolvePhotoItemCanvasIndex(photoDigitalSheet, 3)).toBe(6);
    expect(resolvePhotoItemCanvasIndex(photoChem, -1)).toBe(-1);
    expect(resolvePhotoItemCanvasIndex(photoDigitalItems, 1.5)).toBe(-1);
  });

  it('resolvePhotoItemCount: chemical N / digital ceil(N/2), 0 이하 → 0', () => {
    expect(resolvePhotoItemCount(photoChem, 5)).toBe(5);
    expect(resolvePhotoItemCount(photoDigitalItems, 6)).toBe(3);
    expect(resolvePhotoItemCount(photoDigitalItems, 5)).toBe(3);
    expect(resolvePhotoItemCount(photoChem, 0)).toBe(0);
  });

  it("formatPhotoPageLabel: chemical '사진 3', digital '사진 3 앞/뒤', photoPrint 없음·음수 → null", () => {
    expect(formatPhotoPageLabel(photoChem, 2)).toBe('사진 3');
    expect(formatPhotoPageLabel(photoDigitalItems, 4)).toBe('사진 3 앞');
    expect(formatPhotoPageLabel(photoDigitalItems, 5)).toBe('사진 3 뒤');
    expect(formatPhotoPageLabel(sheetProfile, 0)).toBeNull();
    expect(formatPhotoPageLabel(photoChem, -1)).toBeNull();
  });

  it('resolvePhotoFitMode / resolvePhotoFrameInsetMm (§13-3 매핑)', () => {
    expect(resolvePhotoFitMode('paper-full')).toBe('cover');
    expect(resolvePhotoFitMode('image-full')).toBe('contain');
    expect(resolvePhotoFrameInsetMm(photoPrintBlock, 'none')).toBe(0);
    expect(resolvePhotoFrameInsetMm(photoPrintBlock, 'white')).toBe(2);
    expect(resolvePhotoFrameInsetMm(photoDigitalSheet.photoPrint as PhotoPrintProfile, 'white')).toBe(3);
  });

  describe('readPhotoItems', () => {
    it('배열 아님 → []', () => {
      expect(readPhotoItems(undefined, photoPrintBlock)).toEqual([]);
      expect(readPhotoItems(null)).toEqual([]);
      expect(readPhotoItems({ 0: {} })).toEqual([]);
      expect(readPhotoItems('[]')).toEqual([]);
    });

    it('프로파일 정제 — 불량(객체 아님) 생략, index/canvasIndex 재부여, sizeCode 고정, copies 클램프, 어휘·플래그 정책', () => {
      const digital = photoDigitalItems.photoPrint as PhotoPrintProfile;
      const items = readPhotoItems(
        [
          { index: 9, canvasIndex: 9, sizeCode: '5x7', copies: 5, border: 'white', fit: 'image-full', finish: 'glossy', dateOverlay: true, grayscale: true, sourcePhotoId: 'p1' },
          'junk',
          null,
          { copies: 500, border: 'black', fit: 'x', finish: 1, brightnessFix: 'yes', lowRes: true, sourcePhotoId: '' },
          { copies: 0 },
        ],
        digital,
      );
      expect(items).toEqual([
        { index: 0, canvasIndex: 0, sourcePhotoId: 'p1', sizeCode: '4x6', copies: 5, border: 'white', fit: 'image-full', finish: 'glossy', brightnessFix: false, dateOverlay: true, grayscale: true, lowRes: false },
        { index: 1, canvasIndex: 2, sizeCode: '4x6', copies: 99, border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: true },
        { index: 2, canvasIndex: 4, sizeCode: '4x6', copies: 1, border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false },
      ]);
      expect(items[1]).not.toHaveProperty('sourcePhotoId');
      // chemical 은 canvasIndex = 순번
      expect(readPhotoItems([{}, {}, {}], photoPrintBlock).map((i) => i.canvasIndex)).toEqual([0, 1, 2]);
    });

    it('프로파일 정책 — 허용 목록 밖 어휘는 첫 허용값, 정책 false 플래그는 false 고정, copies.min 으로 하한', () => {
      const restricted: PhotoPrintProfile = {
        ...photoPrintBlock,
        options: { border: ['white'], fit: ['image-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false },
        copies: { min: 2, max: 4 },
      };
      expect(readPhotoItems([{ border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: true, dateOverlay: true, grayscale: true, copies: 1 }], restricted))
        .toEqual([{ index: 0, canvasIndex: 0, sizeCode: '4x6', copies: 2, border: 'white', fit: 'image-full', finish: 'glossy', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false }]);
      expect(readPhotoItems([{ copies: 10 }], restricted)[0].copies).toBe(4);
    });

    it("프로파일 없음 — 형식만 정제: canvasIndex 입력값(0 이상 정수) 또는 순번, sizeCode 문자열 아니면 '', copies 1 이상 정수(정수형 문자열 '2' 포함) 아니면 1", () => {
      expect(readPhotoItems([{ canvasIndex: 4, sizeCode: '5x7', copies: 3, fit: 'image-full' }, { canvasIndex: -1, sizeCode: 7, copies: '2' }, { copies: 'abc' }])).toEqual([
        { index: 0, canvasIndex: 4, sizeCode: '5x7', copies: 3, border: 'none', fit: 'image-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false },
        { index: 1, canvasIndex: 1, sizeCode: '', copies: 2, border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false },
        { index: 2, canvasIndex: 2, sizeCode: '', copies: 1, border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false },
      ]);
    });
  });

  it('summarizeProductProfile: photo-print 도 같은 산식(chemical N / digital ceil(N/2))', () => {
    expect(summarizeProductProfile(photoChem, 3)).toEqual({ kind: 'photo-print', editorType: 'photo_chem', canvasCount: 3, sheetCount: 3, faces: 1 });
    expect(summarizeProductProfile(photoDigitalItems, 6)).toEqual({ kind: 'photo-print', editorType: 'photo_digital_items', canvasCount: 6, sheetCount: 3, faces: 2 });
  });
});

describe('캘린더 캔버스 매핑(순수 함수)', () => {
  const cal = deskLarge.calendar as CalendarProfile;
  const start = { year: 2027, month: 1 };

  it('resolveCalendarCanvasCount: 1+12×2+1 = 26', () => {
    expect(resolveCalendarCanvasCount(cal)).toBe(26);
    expect(resolveCalendarCanvasCount({ coverCanvases: 0, canvasesPerMonth: 1, epilogueCanvases: 0 })).toBe(12);
  });

  it('resolveCalendarCanvasSlot: 역할·월 오프셋·면', () => {
    expect(resolveCalendarCanvasSlot(cal, 0)).toEqual({ role: 'cover', ordinal: 0 });
    expect(resolveCalendarCanvasSlot(cal, 1)).toEqual({ role: 'month', monthOffset: 0, face: 0 });
    expect(resolveCalendarCanvasSlot(cal, 2)).toEqual({ role: 'month', monthOffset: 0, face: 1 });
    expect(resolveCalendarCanvasSlot(cal, 24)).toEqual({ role: 'month', monthOffset: 11, face: 1 });
    expect(resolveCalendarCanvasSlot(cal, 25)).toEqual({ role: 'epilogue', ordinal: 0 });
    expect(resolveCalendarCanvasSlot(cal, 26)).toBeNull();
    expect(resolveCalendarCanvasSlot(cal, -1)).toBeNull();
    expect(resolveCalendarCanvasSlot(cal, 1.5)).toBeNull();
    // 월1면은 face 없음
    expect(resolveCalendarCanvasSlot({ coverCanvases: 1, canvasesPerMonth: 1, epilogueCanvases: 1 }, 3)).toEqual({ role: 'month', monthOffset: 2 });
  });

  it('formatCalendarPageLabel: 26장 라벨', () => {
    expect(formatCalendarPageLabel(cal, start, 0)).toBe('표지');
    expect(formatCalendarPageLabel(cal, start, 1)).toBe('2027년 1월 앞면');
    expect(formatCalendarPageLabel(cal, start, 2)).toBe('2027년 1월 뒷면');
    expect(formatCalendarPageLabel(cal, start, 24)).toBe('2027년 12월 뒷면');
    expect(formatCalendarPageLabel(cal, start, 25)).toBe('에필로그');
    expect(formatCalendarPageLabel(cal, start, 26)).toBeNull();
  });

  it('formatCalendarPageLabel: wall-2 는 상단/하단, faceLabels 지정 시 우선', () => {
    const wall2 = { ...cal, layout: 'wall-2' as const };
    expect(formatCalendarPageLabel(wall2, start, 1)).toBe('2027년 1월 상단');
    expect(formatCalendarPageLabel(wall2, start, 2)).toBe('2027년 1월 하단');
    const custom = { ...cal, faceLabels: ['A', 'B'] as [string, string] };
    expect(formatCalendarPageLabel(custom, start, 2)).toBe('2027년 1월 B');
  });

  it('formatCalendarPageLabel: 시작 2026-11 이면 offset 2 → 2027년 1월; 표지 2장이면 순번', () => {
    expect(formatCalendarPageLabel(cal, { year: 2026, month: 11 }, 5)).toBe('2027년 1월 앞면');
    const twoCovers = { ...cal, coverCanvases: 2, epilogueCanvases: 2 };
    expect(formatCalendarPageLabel(twoCovers, start, 1)).toBe('표지 2');
    expect(formatCalendarPageLabel(twoCovers, start, 27)).toBe('에필로그 2');
  });

  it('addMonths 경계: 12월→익년 1월, 음수', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 11 }, 2)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths({ year: 2027, month: 1 }, -13)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2027, month: 6 }, 0)).toEqual({ year: 2027, month: 6 });
  });

  it('isStartMonthAllowed: 경계 포함', () => {
    expect(isStartMonthAllowed(cal, { year: 2026, month: 1 })).toBe(true);
    expect(isStartMonthAllowed(cal, { year: 2027, month: 12 })).toBe(true);
    expect(isStartMonthAllowed(cal, { year: 2025, month: 12 })).toBe(false);
    expect(isStartMonthAllowed(cal, { year: 2028, month: 1 })).toBe(false);
  });

  it('summarizeProductProfile: 26장·faces 2 → sheetCount 13', () => {
    expect(summarizeProductProfile(deskLarge, 26)).toEqual({
      kind: 'calendar',
      editorType: 'calendar_desk_large',
      canvasCount: 26,
      sheetCount: 13,
      faces: 2,
    });
    expect(summarizeProductProfile(sheetProfile, 5)).toEqual({
      kind: 'sheet',
      editorType: 'sheet_single',
      canvasCount: 5,
      sheetCount: 5,
      faces: 1,
    });
  });
});

// ── T3a 연달력(설계 C8, v1.26) — calendar.yearPolicy·show.yearTitle 검증과 기간 결정 순수 함수 ────────────
describe('validateProductProfile — 연달력 yearPolicy (T3a, v1.26)', () => {
  // 7종 (editorType, layout) — apps/admin calendarProfilePresets.ts · scripts/register-calendar-samples.mjs 값을 명시 복제(교차 앱 import 금지)
  const PRESET_PAIRS: Array<[string, 'desk' | 'wall-1' | 'wall-2']> = [
    ['calendar_desk_large', 'desk'],
    ['calendar_desk_basic', 'desk'],
    ['calendar_desk_tiny', 'desk'],
    ['calendar_desk_mini', 'desk'],
    ['calendar_wall1_a3', 'wall-1'],
    ['calendar_wall2_a4', 'wall-2'],
    ['calendar_wall2_a3', 'wall-2'],
  ];
  /** admin calendarProfile(editorType, layout) 와 같은 키 순서 */
  const adminPreset = (editorType: string, layout: 'desk' | 'wall-1' | 'wall-2'): ProductProfile => ({
    version: 1,
    kind: 'calendar',
    editorType,
    pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout,
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2026-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: true, solarTerms: true },
      dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  });
  /** 샘플 스크립트 profileFor(p) = { ...BASE_PROFILE, editorType, calendar: { ...BASE.calendar, layout } } 와 같은 키 순서 */
  const sampleProfile = (editorType: string, layout: 'desk' | 'wall-1' | 'wall-2'): unknown => {
    const BASE = {
      version: 1,
      kind: 'calendar',
      pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
      sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
      calendar: {
        monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
        allowedRange: { from: '2026-01', to: '2027-12' }, weekStart: 0,
        show: { holidays: true, lunar: true, solarTerms: true }, dataVersion: 'kr-2025-2035-v1',
      },
      output: { mode: 'single-pdf' },
    };
    return { ...BASE, editorType, calendar: { ...BASE.calendar, layout } };
  };
  const withYear = (patch: (p: Record<string, any>) => void) => withPatch(deskLarge, patch);

  it('T3a 픽스처 — 프리셋 7종·샘플 프로파일: validate 결과 [] 이고 JSON.stringify 가 입력과 같다(yearPolicy 키 없음)', () => {
    const warn = jest.fn();
    for (const [editorType, layout] of PRESET_PAIRS) {
      for (const profile of [adminPreset(editorType, layout), sampleProfile(editorType, layout)]) {
        const before = JSON.stringify(profile);
        expect(validateProductProfile(profile)).toEqual([]);
        const resolved = resolveProductProfile({ productProfile: profile as ProductProfile }, warn);
        expect(resolved).toBe(profile);
        expect(JSON.stringify(resolved)).toBe(before);
        expect(before).not.toContain('yearPolicy');
        expect(before).not.toContain('yearTitle');
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("span 'calendar-year'|'start-span'|생략 통과, 미등재·null·배열 yearPolicy → 문구", () => {
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = { span: 'calendar-year' }; }))).toEqual([]);
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = { span: 'start-span' }; }))).toEqual([]);
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = {}; }))).toEqual([]);
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = { span: 'fiscal' }; })))
      .toEqual(['calendar.yearPolicy.span 은 생략하거나 calendar-year|start-span 중 하나여야 합니다']);
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = null; })))
      .toEqual(['calendar.yearPolicy 는 객체여야 합니다']);
    expect(validateProductProfile(withYear((p) => { p.calendar.yearPolicy = ['calendar-year']; })))
      .toEqual(['calendar.yearPolicy 는 객체여야 합니다']);
  });

  it('select: -2~2 정수·min ≤ max, 위반 각각 문구', () => {
    const sel = (select: unknown) => validateProductProfile(withYear((p) => { p.calendar.yearPolicy = { span: 'calendar-year', select }; }));
    expect(sel({ minDelta: 0, maxDelta: 1 })).toEqual([]);
    expect(sel({ minDelta: -1, maxDelta: 1 })).toEqual([]);
    const range = 'calendar.yearPolicy.select.minDelta/maxDelta 는 -2~2 정수여야 합니다';
    expect(sel({ minDelta: 0, maxDelta: 3 })).toEqual([range]);
    expect(sel({ minDelta: -3, maxDelta: 0 })).toEqual([range]);
    expect(sel({ minDelta: 0.5, maxDelta: 1 })).toEqual([range]);
    expect(sel({ minDelta: '0', maxDelta: 1 })).toEqual([range]);
    expect(sel({ maxDelta: 1 })).toEqual([range]);
    expect(sel({ minDelta: 1, maxDelta: 0 })).toEqual(['calendar.yearPolicy.select.minDelta 는 maxDelta 이하여야 합니다']);
    expect(sel(null)).toEqual(['calendar.yearPolicy.select 는 객체여야 합니다']);
    expect(sel([0, 1])).toEqual(['calendar.yearPolicy.select 는 객체여야 합니다']);
  });

  it('select 데이터 범위: 2026-01~2027-12 에서 calendar-year {-1,1} 통과, {-2,0} 오류; start-span·기본 규칙 경계', () => {
    const sel = (span: string | undefined, minDelta: number, maxDelta: number, allowedRange = { from: '2026-01', to: '2027-12' }) =>
      validateProductProfile(withYear((p) => {
        p.calendar.allowedRange = allowedRange;
        p.calendar.yearPolicy = span === undefined ? { select: { minDelta, maxDelta } } : { span, select: { minDelta, maxDelta } };
      }));
    // calendar-year: 2025-01 ~ 2028-12
    expect(sel('calendar-year', -1, 1)).toEqual([]);
    expect(sel('calendar-year', -2, 0)).toEqual(['calendar.yearPolicy.select 연달력 범위(2024-01~2027-12)는 데이터 범위 2025-01~2035-12 안이어야 합니다']);
    // start-span: to 2027-12 + 12×2 = 2029-12 → +11 = 2030-11
    expect(sel('start-span', -1, 2)).toEqual([]);
    expect(sel('start-span', -2, 0)).toEqual(['calendar.yearPolicy.select 연달력 범위(2024-01~2028-11)는 데이터 범위 2025-01~2035-12 안이어야 합니다']);
    // 끝 경계: allowedRange to 2033-12(+11 = 2034-11 은 기존 검사 통과) — calendar-year +2 → 2035-12 포함 통과, start-span +2 → 2036-11 오류
    const late = { from: '2033-01', to: '2033-12' };
    expect(sel('calendar-year', 0, 2, late)).toEqual([]);
    expect(sel('start-span', 0, 2, late)).toEqual(['calendar.yearPolicy.select 연달력 범위(2033-01~2036-11)는 데이터 범위 2025-01~2035-12 안이어야 합니다']);
    // 기본 규칙(span 생략)은 1월 시작 = calendar-year, 그 밖 = start-span 이라 양 끝 계산이 start-span 과 같다
    expect(sel(undefined, 0, 2, late)).toEqual(['calendar.yearPolicy.select 연달력 범위(2033-01~2036-11)는 데이터 범위 2025-01~2035-12 안이어야 합니다']);
    expect(sel(undefined, -1, 1)).toEqual([]);
  });

  it('yearPolicy·show.yearTitle 오류는 기존 calendar 메시지 뒤에 붙는다(순서 불변)', () => {
    const errs = validateProductProfile(withYear((p) => {
      p.calendar.weekStart = 2;
      p.pages.count = 25;
      p.calendar.show.yearTitle = 'yes';
      p.calendar.yearPolicy = { span: 'fiscal' };
    }));
    // pages 절 → sheet 절 → calendar 절 순, calendar 절 안에서는 기존 문구 → v1.26 문구 순
    expect(errs).toEqual([
      'pages.protectedIndices 는 pages.count 미만이어야 합니다',
      'sheet.faces=2 이면 pages.count 는 짝수여야 합니다',
      'calendar.weekStart 는 0|1 이어야 합니다',
      'pages.count(25)는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = 26 여야 합니다',
      'calendar.show.yearTitle 은 생략하거나 boolean 이어야 합니다',
      'calendar.yearPolicy.span 은 생략하거나 calendar-year|start-span 중 하나여야 합니다',
    ]);
  });

  it('show.yearTitle: 생략·boolean 통과, 비불리언 문구', () => {
    expect(validateProductProfile(withYear((p) => { p.calendar.show.yearTitle = false; }))).toEqual([]);
    expect(validateProductProfile(withYear((p) => { p.calendar.show.yearTitle = true; }))).toEqual([]);
    expect(validateProductProfile(withYear((p) => { p.calendar.show.yearTitle = 1; })))
      .toEqual(['calendar.show.yearTitle 은 생략하거나 boolean 이어야 합니다']);
  });

  it('resolveCalendarYearStart: calendar-year (2027-03,+1) → 2028-01; start-span (2027-03,0) → 2027-03, (2027-03,+1) → 2028-03; 비정수 delta → 0', () => {
    const mar = { year: 2027, month: 3 };
    expect(resolveCalendarYearStart('calendar-year', mar, 1)).toEqual({ year: 2028, month: 1 });
    expect(resolveCalendarYearStart('calendar-year', mar, 0)).toEqual({ year: 2027, month: 1 });
    expect(resolveCalendarYearStart('calendar-year', mar, -1)).toEqual({ year: 2026, month: 1 });
    expect(resolveCalendarYearStart('start-span', mar, 0)).toEqual({ year: 2027, month: 3 });
    expect(resolveCalendarYearStart('start-span', mar, 1)).toEqual({ year: 2028, month: 3 });
    expect(resolveCalendarYearStart('start-span', mar, -1)).toEqual({ year: 2026, month: 3 });
    expect(resolveCalendarYearStart('start-span', mar, 0.5)).toEqual({ year: 2027, month: 3 });
    expect(resolveCalendarYearStart('calendar-year', mar, Number.NaN)).toEqual({ year: 2027, month: 1 });
    expect(CALENDAR_YEAR_MONTH_COUNT).toBe(12);
  });

  it('기본 규칙(오너 답 Q1): span 생략 시 1월 시작 = 기준 연도 1~12월, 시작연월을 바꾸면 그 달부터; 명시 span 은 그대로', () => {
    expect(DEFAULT_CALENDAR_YEAR_SPAN).toBe('calendar-year');
    expect(resolveCalendarYearSpan(undefined, { year: 2027, month: 1 })).toBe('calendar-year');
    expect(resolveCalendarYearSpan(undefined, { year: 2027, month: 3 })).toBe('start-span');
    expect(resolveCalendarYearSpan('calendar-year', { year: 2027, month: 3 })).toBe('calendar-year');
    expect(resolveCalendarYearSpan('start-span', { year: 2027, month: 1 })).toBe('start-span');
    expect(resolveCalendarYearStart(undefined, { year: 2027, month: 1 }, 0)).toEqual({ year: 2027, month: 1 });
    expect(resolveCalendarYearStart(undefined, { year: 2027, month: 1 }, 1)).toEqual({ year: 2028, month: 1 });
    expect(resolveCalendarYearStart(undefined, { year: 2027, month: 3 }, 0)).toEqual({ year: 2027, month: 3 });
    // Q4 상대값 유지: 시작연월을 2027-03 → 2028-03 으로 바꾸면 같은 +1 이 2029-03 으로 이동
    expect(resolveCalendarYearStart(undefined, { year: 2028, month: 3 }, 1)).toEqual({ year: 2029, month: 3 });
  });

  it('isCalendarYearDeltaAllowed: 정책·select 없음 false, 범위 경계 포함, 비정수 false', () => {
    expect(isCalendarYearDeltaAllowed(undefined, 0)).toBe(false);
    expect(isCalendarYearDeltaAllowed({ span: 'calendar-year' }, 0)).toBe(false);
    const policy = { select: { minDelta: -1, maxDelta: 1 } };
    expect(isCalendarYearDeltaAllowed(policy, -1)).toBe(true);
    expect(isCalendarYearDeltaAllowed(policy, 0)).toBe(true);
    expect(isCalendarYearDeltaAllowed(policy, 1)).toBe(true);
    expect(isCalendarYearDeltaAllowed(policy, 2)).toBe(false);
    expect(isCalendarYearDeltaAllowed(policy, -2)).toBe(false);
    expect(isCalendarYearDeltaAllowed(policy, 0.5)).toBe(false);
    expect(isCalendarYearDeltaAllowed(policy, '1')).toBe(false);
    expect(isCalendarYearDeltaAllowed(policy, null)).toBe(false);
  });
});

// ── T4 잡절(v1.27) — calendar.show.minorTerms 검증(키 생략 = 현행 바이트·메시지 동일) ────────────────────
describe('validateProductProfile — 잡절 show.minorTerms (T4, v1.27)', () => {
  it('생략: 검증 [] · resolveProductProfile 결과 JSON 이 입력과 같다(minorTerms 키 없음)', () => {
    const warn = jest.fn();
    const profile = withPatch(deskLarge, () => {});
    const before = JSON.stringify(profile);
    expect(before).not.toContain('minorTerms');
    expect(validateProductProfile(profile)).toEqual([]);
    expect(JSON.stringify(resolveProductProfile({ productProfile: profile as ProductProfile }, warn))).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it('boolean 통과, 비불리언 문구 — v1.26 yearTitle 문구 뒤에 붙는다(기존 순서 불변)', () => {
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.show.minorTerms = true; }))).toEqual([]);
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.show.minorTerms = false; }))).toEqual([]);
    expect(validateProductProfile(withPatch(deskLarge, (p) => { p.calendar.show.minorTerms = 'yes'; })))
      .toEqual(['calendar.show.minorTerms 는 생략하거나 boolean 이어야 합니다']);
    expect(validateProductProfile(withPatch(deskLarge, (p) => {
      p.calendar.weekStart = 2;
      p.calendar.show.yearTitle = 1;
      p.calendar.show.minorTerms = null;
    }))).toEqual([
      'calendar.weekStart 는 0|1 이어야 합니다',
      'calendar.show.yearTitle 은 생략하거나 boolean 이어야 합니다',
      'calendar.show.minorTerms 는 생략하거나 boolean 이어야 합니다',
    ]);
  });
});
