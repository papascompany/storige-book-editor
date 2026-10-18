/**
 * `@storige/types` product-profile 순수 함수 단위 테스트 (P1 캘린더, 2026-10-17).
 * packages/types 에는 테스트 러너가 없어 api jest(소스 매핑)에서 실행한다.
 */
import {
  addMonths,
  formatCalendarPageLabel,
  isStartMonthAllowed,
  resolveCalendarCanvasCount,
  resolveCalendarCanvasSlot,
  resolveProductProfile,
  summarizeProductProfile,
  validateProductProfile,
  type CalendarProfile,
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
    const errs = validateProductProfile(withPatch(deskLarge, (p) => { p.kind = 'photo-print'; p.editorType = 'Bad-Code'; }));
    expect(errs.some((e) => e.startsWith('kind 는'))).toBe(true);
    expect(errs.some((e) => e.startsWith('editorType'))).toBe(true);
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
