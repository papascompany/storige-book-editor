// formatPresetHelpers 순수 함수 단위테스트 — vitest (node 환경, DOM 불필요)
import { describe, it, expect } from 'vitest';
import {
  canPairOrientation,
  checkTemplateDimAlignment,
  formatSizeLabel,
  isOrientationPairMatch,
  isSquare,
  orientTrim,
  orientationOf,
  workSize,
} from './formatPresetHelpers';

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

describe('checkTemplateDimAlignment', () => {
  // 가로 A4 하드커버 세트(재단 297×210, bleed 3 → 작업 303×216) 기준
  const landscapeA4Set = { width: 297, height: 210, bleedMm: 3 };

  it('재단 정확 일치 → ok-trim', () => {
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 297, height: 210 }, landscapeA4Set),
    ).toEqual({ status: 'ok-trim' });
  });

  it('작업(재단+2×bleed) 일치 → ok-work', () => {
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 303, height: 216 }, landscapeA4Set),
    ).toEqual({ status: 'ok-work' });
  });

  it('하드커버 실사고 — 구 성책값 301×214 는 재단(297×210)·작업(303×216) 어느 쪽도 아님 → mismatch', () => {
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 301, height: 214 }, landscapeA4Set),
    ).toEqual({ status: 'mismatch' });
  });

  it('방향 스왑(세로 210×297 vs 가로 세트)은 정합 아님 → mismatch (방향 포함 정확 일치 규약)', () => {
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 210, height: 297 }, landscapeA4Set),
    ).toEqual({ status: 'mismatch' });
  });

  it('±0.01mm 허용오차 이내는 일치, 초과는 불일치', () => {
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 297.01, height: 210 }, landscapeA4Set),
    ).toEqual({ status: 'ok-trim' });
    expect(
      checkTemplateDimAlignment({ type: 'page', width: 297.02, height: 210 }, landscapeA4Set),
    ).toEqual({ status: 'mismatch' });
  });

  it('bleed 0 세트는 재단=작업 → 재단 일치가 우선(ok-trim)', () => {
    expect(
      checkTemplateDimAlignment(
        { type: 'page', width: 148, height: 210 },
        { width: 148, height: 210, bleedMm: 0 },
      ),
    ).toEqual({ status: 'ok-trim' });
  });

  it('page류가 아니면 치수 무관 skip — spread/spine/wing/endpaper/cover', () => {
    for (const type of ['spread', 'spine', 'wing', 'endpaper', 'cover']) {
      expect(
        checkTemplateDimAlignment({ type, width: 999, height: 999 }, landscapeA4Set),
      ).toEqual({ status: 'skip' });
    }
  });
});

describe('canPairOrientation', () => {
  it('W!=H → 방향 쌍 가능', () => {
    expect(canPairOrientation(210, 297)).toBe(true);
    expect(canPairOrientation(297, 210)).toBe(true);
  });

  it('정사각(±0.01mm 허용오차 포함)은 쌍 불가', () => {
    expect(canPairOrientation(210, 210)).toBe(false);
    expect(canPairOrientation(210, 210.01)).toBe(false);
    expect(canPairOrientation(210, 210.02)).toBe(true);
  });
});

describe('isOrientationPairMatch', () => {
  const a4Portrait = { widthMm: 210, heightMm: 297 };

  it('정확 W↔H 스왑 → 성립 (A4 세로 210×297 ↔ 가로 297×210)', () => {
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 297, heightMm: 210 })).toBe(true);
  });

  it('같은 방향(스왑 아님) → 불성립', () => {
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 210, heightMm: 297 })).toBe(false);
  });

  it('다른 재단 규격 → 불성립', () => {
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 297, heightMm: 211 })).toBe(false);
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 296, heightMm: 210 })).toBe(false);
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 257, heightMm: 182 })).toBe(false); // b5 가로
  });

  it('±0.01mm 이내는 성립, 초과는 불성립', () => {
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 297.01, heightMm: 210 })).toBe(true);
    expect(isOrientationPairMatch(a4Portrait, { widthMm: 297.02, heightMm: 210 })).toBe(false);
  });

  it('정사각은 어느 쪽이든 불성립 (스왑값이 우연히 일치해도 차단)', () => {
    const square = { widthMm: 210, heightMm: 210 };
    expect(isOrientationPairMatch(square, square)).toBe(false);
    expect(isOrientationPairMatch(a4Portrait, square)).toBe(false);
    expect(isOrientationPairMatch(square, a4Portrait)).toBe(false);
  });
});

describe('orientationOf', () => {
  it('W>H → landscape (가로내지 297×210)', () => {
    expect(orientationOf(297, 210)).toBe('landscape');
  });

  it('W<H → portrait (기본내지 210×297)', () => {
    expect(orientationOf(210, 297)).toBe('portrait');
  });

  it('W==H → square (210×210)', () => {
    expect(orientationOf(210, 210)).toBe('square');
  });
});
