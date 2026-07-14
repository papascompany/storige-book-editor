// formatPresetHelpers 순수 함수 단위테스트 — vitest (node 환경, DOM 불필요)
import { describe, it, expect } from 'vitest';
import { formatSizeLabel, isSquare, orientTrim, workSize } from './formatPresetHelpers';

describe('isSquare', () => {
  it('W==H 면 정사각', () => {
    expect(isSquare(210, 210)).toBe(true);
  });

  it('W!=H 면 정사각 아님', () => {
    expect(isSquare(210, 297)).toBe(false);
    expect(isSquare(297, 210)).toBe(false);
  });
});

describe('orientTrim', () => {
  it('세로형은 저장값 그대로', () => {
    expect(orientTrim(210, 297, 'portrait')).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('가로형은 W↔H 스왑 — A4 → 297×210 (가로내지 실측 정본 관행)', () => {
    expect(orientTrim(210, 297, 'landscape')).toEqual({ widthMm: 297, heightMm: 210 });
  });

  it('시드 7종 가로형 스왑 대칭성 — 두 번 스왑하면 원복', () => {
    const seeds: Array<[number, number]> = [
      [210, 297], // a4
      [148, 210], // a5
      [182, 257], // b5
      [188, 257], // baepan46
      [190, 260], // jeol16
      [128, 182], // b6
      [210, 210], // square210
    ];
    for (const [w, h] of seeds) {
      const landscape = orientTrim(w, h, 'landscape');
      const restored = orientTrim(landscape.widthMm, landscape.heightMm, 'landscape');
      expect(restored).toEqual({ widthMm: w, heightMm: h });
    }
  });

  it('정사각은 가로형이어도 동일 값', () => {
    expect(orientTrim(210, 210, 'landscape')).toEqual({ widthMm: 210, heightMm: 210 });
  });
});

describe('workSize', () => {
  it('작업 = 재단 + 2×bleed — A4 210×297 bleed 3 → 216×303 (기본내지 실측 정본)', () => {
    expect(workSize(210, 297, 3)).toEqual({ widthMm: 216, heightMm: 303 });
  });

  it('bleed 0 이면 재단 그대로', () => {
    expect(workSize(148, 210, 0)).toEqual({ widthMm: 148, heightMm: 210 });
  });

  it('소수 bleed 도 지원(0.5 step) — 부동소수 잔재 없이 2자리 반올림', () => {
    expect(workSize(190, 260, 2.5)).toEqual({ widthMm: 195, heightMm: 265 });
    expect(workSize(210, 297, 0.1)).toEqual({ widthMm: 210.2, heightMm: 297.2 });
  });
});

describe('formatSizeLabel', () => {
  it("'W × H mm' 표기", () => {
    expect(formatSizeLabel(210, 297)).toBe('210 × 297 mm');
  });
});
