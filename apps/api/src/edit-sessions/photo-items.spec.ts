/**
 * photo-items 순수 함수 — P2-d 사진인화(2026-10-19) 시트 매핑 copies/label 주입.
 */
import type { PhotoItem, ProductProfile, SheetSpec } from '@storige/types';
import { applyPhotoItemsToSheets, formatPhotoSheetLabel, readSessionPhotoItems, resolvePhotoItemLimit } from './photo-items';
import { buildSheetMap } from './sheet-map';

const item = (index: number, canvasIndex: number, copies: number, o: Partial<PhotoItem> = {}): PhotoItem => ({
  index,
  canvasIndex,
  sizeCode: '4x6',
  copies,
  border: 'none',
  fit: 'paper-full',
  finish: 'matte',
  brightnessFix: false,
  dateOverlay: false,
  grayscale: false,
  lowRes: false,
  ...o,
});

/** 인쇄 ①(digital, same-sheet, sheet-map) — 4캔버스 = 사진 2장(앞/뒤) */
const photoDigitalProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_items',
  pages: { kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 400, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
};

/** 낱장 양면 sheet-map(사진인화 아님) */
const sheetMapProfile: ProductProfile = {
  version: 1,
  kind: 'sheet',
  editorType: 'card',
  pages: { kind: 'fixed', count: 4, labelRule: 'default' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 180, duplexFlip: 'long-edge' },
  output: { mode: 'sheet-map' },
};

describe('applyPhotoItemsToSheets', () => {
  const fourPages = (): SheetSpec[] => buildSheetMap(photoDigitalProfile, 4);

  it('front.page === canvasIndex 인 시트에 copies·label(사진 N) 주입 — 입력 시트 객체는 불변', () => {
    const sheets = fourPages();
    const out = applyPhotoItemsToSheets(sheets, [item(0, 0, 5), item(1, 2, 2)]);
    expect(out).toEqual([
      { index: 0, front: { page: 0 }, back: { page: 1, rotate: 0 }, copies: 5, label: '사진 1' },
      { index: 1, front: { page: 2 }, back: { page: 3, rotate: 0 }, copies: 2, label: '사진 2' },
    ]);
    expect(out).not.toBe(sheets);
    expect(sheets[0]).not.toHaveProperty('copies');
    expect(sheets[1]).not.toHaveProperty('label');
  });

  it('시트에 맞지 않는 항목(canvasIndex 가 뒷면·범위 밖)은 무시, 항목 없는 시트는 그대로', () => {
    const out = applyPhotoItemsToSheets(fourPages(), [item(0, 1, 7), item(1, 2, 3), item(2, 4, 9)]);
    expect(out[0]).toEqual({ index: 0, front: { page: 0 }, back: { page: 1, rotate: 0 } });
    expect(out[0]).not.toHaveProperty('copies');
    expect(out[1]).toEqual({ index: 1, front: { page: 2 }, back: { page: 3, rotate: 0 }, copies: 3, label: '사진 2' });
  });

  it('items 비면 입력 배열 그대로(같은 참조)', () => {
    const sheets = fourPages();
    expect(applyPhotoItemsToSheets(sheets, [])).toBe(sheets);
  });

  it('같은 canvasIndex 가 중복이면 첫 항목; label 은 항목 index+1(시트 순번 아님)', () => {
    const out = applyPhotoItemsToSheets(fourPages(), [item(3, 2, 4), item(4, 2, 8)]);
    expect(out[1]).toMatchObject({ copies: 4, label: '사진 4' });
    expect(out[0]).not.toHaveProperty('copies');
  });

  it('chemical(canvas-per-sheet) 매핑 — 시트 i 에 사진 i+1', () => {
    const chem: ProductProfile = {
      ...photoDigitalProfile,
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
    };
    const out = applyPhotoItemsToSheets(buildSheetMap(chem, 3), [item(0, 0, 1), item(1, 1, 2), item(2, 2, 3)]);
    expect(out.map((s) => [s.front.page, s.copies, s.label])).toEqual([
      [0, 1, '사진 1'],
      [1, 2, '사진 2'],
      [2, 3, '사진 3'],
    ]);
  });

  it("role 'post-process' 시트는 canvasIndex 가 겹쳐도 건드리지 않는다", () => {
    const sheets = buildSheetMap(sheetMapProfile, 5, { postProcessPages: 1 });
    expect(sheets[2]).toMatchObject({ role: 'post-process', front: { page: 4 } });
    const out = applyPhotoItemsToSheets(sheets, [item(0, 4, 9)]);
    expect(out[2]).toEqual(sheets[2]);
    expect(out[2]).not.toHaveProperty('copies');
  });

  it('formatPhotoSheetLabel: index 0 → 사진 1', () => {
    expect(formatPhotoSheetLabel({ index: 0 })).toBe('사진 1');
    expect(formatPhotoSheetLabel({ index: 11 })).toBe('사진 12');
  });
});

describe('readSessionPhotoItems', () => {
  it("kind 'photo-print' + metadata.items → readPhotoItems(profile.photoPrint) 정제본(copies 클램프·canvasIndex 재계산)", () => {
    const items = readSessionPhotoItems(photoDigitalProfile, { items: [{ copies: 500, canvasIndex: 9 }, 'junk', { copies: 2 }] });
    expect(items.map((i) => [i.index, i.canvasIndex, i.copies, i.sizeCode])).toEqual([
      [0, 0, 99, '4x6'],
      [1, 2, 2, '4x6'],
    ]);
  });

  it('프로파일 없음·sheet/calendar kind·photoPrint 블록 없음·metadata.items 없음 → []', () => {
    expect(readSessionPhotoItems(null, { items: [{ copies: 2 }] })).toEqual([]);
    expect(readSessionPhotoItems(undefined, { items: [{ copies: 2 }] })).toEqual([]);
    expect(readSessionPhotoItems(sheetMapProfile, { items: [{ copies: 2 }] })).toEqual([]);
    expect(readSessionPhotoItems({ kind: 'photo-print', sheet: photoDigitalProfile.sheet }, { items: [{ copies: 2 }] })).toEqual([]);
    expect(readSessionPhotoItems(photoDigitalProfile, {})).toEqual([]);
    expect(readSessionPhotoItems(photoDigitalProfile, null)).toEqual([]);
    expect(readSessionPhotoItems(photoDigitalProfile, { items: null })).toEqual([]);
    expect(readSessionPhotoItems(photoDigitalProfile, { items: 'nope' })).toEqual([]);
  });

  it('buildSheetMap → applyPhotoItemsToSheets 결합: NULL 세트·낱장 세트는 시트 무변경', () => {
    const sheets = buildSheetMap(sheetMapProfile, 4);
    expect(applyPhotoItemsToSheets(sheets, readSessionPhotoItems(sheetMapProfile, { items: [{ copies: 3 }] }))).toBe(sheets);
  });

  // ── security-1(2026-10-19): 항목 수 상한 — 캔버스 수(사진 수)·upload.maxPhotos ─────────────────────────
  describe('items 상한(security-1)', () => {
    const photoChemProfile: ProductProfile = {
      ...photoDigitalProfile,
      editorType: 'photo_chem',
      pages: { kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' },
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
      photoPrint: { ...photoDigitalProfile.photoPrint!, process: 'chemical', upload: { maxPhotos: 200, maxMb: 25 } },
      output: { mode: 'single-pdf' },
    };
    const huge = Array.from({ length: 100_000 }, () => ({ copies: 99, sourcePhotoId: 'x'.repeat(100) }));

    it('resolvePhotoItemLimit — digital ceil(N/2)·chemical N 과 maxPhotos 의 최솟값, 캔버스 수 모르면 maxPhotos', () => {
      expect(resolvePhotoItemLimit(photoDigitalProfile, 10)).toBe(5);
      expect(resolvePhotoItemLimit(photoDigitalProfile, 3)).toBe(2);
      expect(resolvePhotoItemLimit(photoChemProfile, 10)).toBe(10);
      expect(resolvePhotoItemLimit(photoChemProfile, 1000)).toBe(200);
      expect(resolvePhotoItemLimit(photoDigitalProfile, 1000)).toBe(400);
      expect(resolvePhotoItemLimit(photoDigitalProfile)).toBe(400);
      expect(resolvePhotoItemLimit(photoDigitalProfile, 0)).toBe(400);
      expect(resolvePhotoItemLimit({ sheet: photoDigitalProfile.sheet })).toBe(Infinity);
    });

    it('items 10만 건 + 캔버스 10(digital) → 응답 items 5건(사진 수), canvasIndex 0..8', () => {
      const items = readSessionPhotoItems(photoDigitalProfile, { items: huge }, 10);
      expect(items).toHaveLength(5);
      expect(items.map((i) => i.canvasIndex)).toEqual([0, 2, 4, 6, 8]);
    });

    it('items 10만 건 + 캔버스 3(chemical) → 3건; 캔버스 수 없음 → maxPhotos 200 건', () => {
      expect(readSessionPhotoItems(photoChemProfile, { items: huge }, 3)).toHaveLength(3);
      expect(readSessionPhotoItems(photoChemProfile, { items: huge })).toHaveLength(200);
      expect(readSessionPhotoItems(photoChemProfile, { items: huge }, 0)).toHaveLength(200);
    });

    it('상한 이내면 그대로(자르지 않음) — 정제 순서는 유지', () => {
      const items = readSessionPhotoItems(photoDigitalProfile, { items: [{ copies: 1 }, 'junk', { copies: 2 }] }, 4);
      expect(items.map((i) => [i.index, i.copies])).toEqual([
        [0, 1],
        [1, 2],
      ]);
    });

    it('sheet-map 주입도 잘린 항목만 쓴다 — 4캔버스 digital 에 items 500건 → 시트 2장에만 copies/label', () => {
      const sheets = applyPhotoItemsToSheets(
        buildSheetMap(photoDigitalProfile, 4),
        readSessionPhotoItems(photoDigitalProfile, { items: huge.slice(0, 500) }, 4),
      );
      expect(sheets).toHaveLength(2);
      expect(sheets.map((sh) => [sh.copies, sh.label])).toEqual([
        [99, '사진 1'],
        [99, '사진 2'],
      ]);
    });
  });
});
