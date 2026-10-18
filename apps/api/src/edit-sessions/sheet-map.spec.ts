/**
 * buildSheetMap 골든 테스트 (P2-a, 2026-10-18) — 설계 §6.3 규칙을 시트 배열로 고정한다.
 * 프로파일은 매핑에 쓰는 필드만 의미가 있고(validateProductProfile 은 호출부 책임), 결과 배열 전체를 비교한다.
 */
import type { ProductProfile, SheetSpec } from '@storige/types';
import { assertSheetMapCoversPages, buildSheetMap, SheetMapError } from './sheet-map';

const sheetMapOutput = { mode: 'sheet-map' as const };

/** 단면 낱장 N장(엽서·포스터) */
const perSheet: ProductProfile = {
  version: 1,
  kind: 'sheet',
  editorType: 'sheet_single_face',
  pages: { kind: 'range', min: 1, max: 50, labelRule: 'default' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  output: sheetMapOutput,
};

/** 인쇄 ①~③ / 낱장 N장 양면: 2i 앞 / 2i+1 뒤 */
const pairSame: ProductProfile = {
  version: 1,
  kind: 'sheet',
  editorType: 'photo_digital_items',
  pages: { kind: 'range', min: 2, max: 60, step: 2, labelRule: 'default' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
};

/** 벽걸이 (나) §3: [표지, 상1, 하1, …, 상12, 하12] = 25캔버스, offset-next */
const wallB25: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_wall_b',
  pages: { kind: 'fixed', count: 25, protectedIndices: [0], labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'wall-2',
    monthCount: 12,
    coverCanvases: 1,
    canvasesPerMonth: 2,
    epilogueCanvases: 0,
    allowedRange: { from: '2026-01', to: '2027-12' },
    weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true },
    dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
};

/** 캘린더 P1 프리셋 shape(admin calendarProfilePresets 와 동일, single-pdf) */
const deskLargeP1: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
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

function patch(base: ProductProfile, fn: (p: ProductProfile) => void): ProductProfile {
  const clone = JSON.parse(JSON.stringify(base)) as ProductProfile;
  fn(clone);
  return clone;
}

function expectError(fn: () => unknown, code: SheetMapError['code']): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SheetMapError);
    expect((e as SheetMapError).code).toBe(code);
    return;
  }
  throw new Error(`SheetMapError(${code}) 이어야 합니다`);
}

const single = (index: number, page: number): SheetSpec => ({ index, front: { page }, back: null });
const duplex = (index: number, front: number, back: number, rotate: 0 | 180 = 0): SheetSpec => ({
  index,
  front: { page: front },
  back: { page: back, rotate },
});

describe('buildSheetMap (설계 §6.3 골든)', () => {
  it('(a) canvas-per-sheet 13쪽 → 13시트, 전부 back null', () => {
    const sheets = buildSheetMap(perSheet, 13);
    expect(sheets).toEqual(Array.from({ length: 13 }, (_, i) => single(i, i)));
  });

  it('(b) canvas-pair same-sheet 6쪽(표지 없음) → (0|1)(2|3)(4|5)', () => {
    expect(buildSheetMap(pairSame, 6)).toEqual([duplex(0, 0, 1), duplex(1, 2, 3), duplex(2, 4, 5)]);
  });

  it('(b′) same-sheet 25쪽 protected [0] → 표지 단면 1시트 선행 + (1|2)…(23|24) 12시트', () => {
    const profile = patch(wallB25, (p) => { p.sheet.pairing = 'same-sheet'; });
    const sheets = buildSheetMap(profile, 25);
    expect(sheets).toHaveLength(13);
    expect(sheets[0]).toEqual(single(0, 0));
    expect(sheets.slice(1)).toEqual(Array.from({ length: 12 }, (_, m) => duplex(m + 1, 2 * m + 1, 2 * m + 2)));
  });

  it('(b″) same-sheet 26쪽 protected [0,25](P1 shape) → 표지 단면 + 12시트 + 에필로그 단면 = 14시트', () => {
    const profile = patch(deskLargeP1, (p) => { p.sheet.pairing = 'same-sheet'; p.output = { mode: 'sheet-map' }; });
    const sheets = buildSheetMap(profile, 26);
    expect(sheets).toHaveLength(14);
    expect(sheets[0]).toEqual(single(0, 0));
    expect(sheets[1]).toEqual(duplex(1, 1, 2));
    expect(sheets[12]).toEqual(duplex(12, 23, 24));
    expect(sheets[13]).toEqual(single(13, 25));
  });

  it('(c) offset-next 25쪽 벽걸이 (나) → [표지|상1], [하k|상k+1] ×11, [하12|null] = 13시트', () => {
    const sheets = buildSheetMap(wallB25, 25);
    expect(sheets).toHaveLength(13);
    expect(sheets[0]).toEqual(duplex(0, 0, 1));
    // 상k = 2k-1, 하k = 2k (k=1..12)
    for (let k = 1; k <= 11; k += 1) {
      expect(sheets[k]).toEqual(duplex(k, 2 * k, 2 * k + 1));
    }
    expect(sheets[12]).toEqual(single(12, 24));
  });

  it('(c′) offset-next 26쪽 protected [0,25](P1 shape + sheet-map) → 13시트, 마지막 back = 에필로그', () => {
    const profile = patch(deskLargeP1, (p) => { p.output = { mode: 'sheet-map' }; });
    const sheets = buildSheetMap(profile, 26);
    expect(sheets).toHaveLength(13);
    expect(sheets[0]).toEqual(duplex(0, 0, 1));
    expect(sheets[12]).toEqual(duplex(12, 24, 25));
  });

  it('(d) backRotation 180 → back.rotate 180 (same-sheet·offset-next 모두), front 는 회전 없음', () => {
    const same = buildSheetMap(patch(pairSame, (p) => { p.sheet.backRotation = 180; }), 4);
    expect(same).toEqual([duplex(0, 0, 1, 180), duplex(1, 2, 3, 180)]);
    const offset = buildSheetMap(patch(wallB25, (p) => { p.sheet.backRotation = 180; }), 25);
    expect(offset[0]).toEqual(duplex(0, 0, 1, 180));
    expect(offset[1]).toEqual(duplex(1, 2, 3, 180));
    expect(offset[12]).toEqual(single(12, 24));
    expect(offset.every((s) => s.front.rotate === undefined)).toBe(true);
  });

  it('(e) center-punch + offset-next → PAIRING_NOT_ALLOWED; center-punch + same-sheet 는 허용', () => {
    expectError(() => buildSheetMap(patch(wallB25, (p) => { p.sheet.binding = 'center-punch'; }), 25), 'PAIRING_NOT_ALLOWED');
    const ok = buildSheetMap(patch(pairSame, (p) => { p.sheet.binding = 'center-punch'; }), 4);
    expect(ok).toEqual([duplex(0, 0, 1), duplex(1, 2, 3)]);
  });

  it('(f) 홀수 pageCount 로 same-sheet 짝 불가 → PAGE_COUNT_MISMATCH', () => {
    expectError(() => buildSheetMap(pairSame, 5), 'PAGE_COUNT_MISMATCH');
    // 표지 단면 1 + 짝 대상 25 (홀수)
    expectError(() => buildSheetMap(patch(wallB25, (p) => { p.sheet.pairing = 'same-sheet'; p.pages.count = 26; }), 26), 'PAGE_COUNT_MISMATCH');
  });

  it('(f′) pages.fixed count ≠ pageCount / range 밖 → PAGE_COUNT_MISMATCH', () => {
    expectError(() => buildSheetMap(wallB25, 26), 'PAGE_COUNT_MISMATCH');
    expectError(() => buildSheetMap(perSheet, 51), 'PAGE_COUNT_MISMATCH');
    expectError(() => buildSheetMap(pairSame, 0), 'INVALID_PAGE_COUNT');
    expectError(() => buildSheetMap(pairSame, 2.5), 'INVALID_PAGE_COUNT');
  });

  it('(g) postProcessPages 1 → 마지막 1쪽은 짝에서 제외되어 role post-process 단면 시트로 뒤에 분리', () => {
    const profile = patch(pairSame, (p) => { p.postProcess = { pages: 1, source: 'upload', colorRule: 'any', allowTransparency: true }; });
    const sheets = buildSheetMap(profile, 3, { postProcessPages: 1 });
    expect(sheets).toEqual([duplex(0, 0, 1), { index: 1, front: { page: 2 }, back: null, role: 'post-process' }]);
    // 인쇄 시트에는 role 없음
    expect(sheets[0].role).toBeUndefined();
    // 후가공면을 빼면 짝이 안 맞음
    expectError(() => buildSheetMap(profile, 3), 'PAGE_COUNT_MISMATCH');
    // postProcessPages 가 전체를 덮으면 거부
    expectError(() => buildSheetMap(profile, 1, { postProcessPages: 1 }), 'INVALID_POST_PROCESS');
    expectError(() => buildSheetMap(profile, 3, { postProcessPages: -1 }), 'INVALID_POST_PROCESS');
  });

  it('(h) 불변식: 모든 page 가 0..pageCount-1 정확히 1회 (매핑 조합별)', () => {
    const cases: Array<[ProductProfile, number, number?]> = [
      [perSheet, 1],
      [perSheet, 7],
      [pairSame, 2],
      [pairSame, 40],
      [wallB25, 25],
      [patch(wallB25, (p) => { p.sheet.pairing = 'same-sheet'; }), 25],
      [patch(deskLargeP1, (p) => { p.output = { mode: 'sheet-map' }; }), 26],
      [patch(pairSame, (p) => { p.postProcess = { pages: 2, source: 'upload', colorRule: 'any', allowTransparency: false }; }), 8, 2],
    ];
    for (const [profile, pageCount, pp] of cases) {
      const sheets = buildSheetMap(profile, pageCount, pp !== undefined ? { postProcessPages: pp } : undefined);
      const pages = sheets.flatMap((s) => [s.front.page, ...(s.back ? [s.back.page] : [])]).sort((a, b) => a - b);
      expect(pages).toEqual(Array.from({ length: pageCount }, (_, i) => i));
      expect(sheets.map((s) => s.index)).toEqual(sheets.map((_, i) => i));
    }
  });

  it('assertSheetMapCoversPages — 범위 밖·중복·누락·index 불일치 거부', () => {
    expectError(() => assertSheetMapCoversPages([single(0, 1)], 1), 'PAGE_COUNT_MISMATCH');
    expectError(() => assertSheetMapCoversPages([duplex(0, 0, 0)], 1), 'PAGE_COUNT_MISMATCH');
    expectError(() => assertSheetMapCoversPages([single(0, 0)], 2), 'PAGE_COUNT_MISMATCH');
    expectError(() => assertSheetMapCoversPages([single(1, 0)], 1), 'PAGE_COUNT_MISMATCH');
    expect(() => assertSheetMapCoversPages([duplex(0, 0, 1), single(1, 2)], 3)).not.toThrow();
  });

  it('캘린더 P1 프로파일(single-pdf) → INVALID_PROFILE (sheet-map 대상 아님)', () => {
    expectError(() => buildSheetMap(deskLargeP1, 26), 'INVALID_PROFILE');
  });

  it('INVALID_PROFILE — pairing 누락, offset-next 에 표지 없음, 중간 protected, faces/layout 불일치', () => {
    expectError(() => buildSheetMap(patch(pairSame, (p) => { delete p.sheet.pairing; }), 4), 'INVALID_PROFILE');
    expectError(() => buildSheetMap(patch(wallB25, (p) => { p.pages.protectedIndices = []; }), 25), 'INVALID_PROFILE');
    expectError(() => buildSheetMap(patch(pairSame, (p) => { p.pages.protectedIndices = [2]; }), 6), 'INVALID_PROFILE');
    expectError(() => buildSheetMap(patch(pairSame, (p) => { p.sheet.faces = 1; }), 4), 'INVALID_PROFILE');
  });

  it('protectedIndices 중 인쇄 범위 밖 값은 무시(에필로그가 없는 pageCount 로 호출해도 매핑 유지)', () => {
    // P1 shape 의 protected [0,25] 를 25쪽 same-sheet 로 호출 → 25 는 범위 밖, 표지만 단면
    const profile = patch(deskLargeP1, (p) => { p.sheet.pairing = 'same-sheet'; p.output = { mode: 'sheet-map' }; p.pages.count = 25; });
    expect(buildSheetMap(profile, 25)).toHaveLength(13);
  });
});
