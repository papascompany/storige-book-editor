/**
 * 판형 프리셋 순수 헬퍼 — 방향(W↔H) 스왑 · 작업 치수 파생.
 *
 * DOM/antd/react 의존 없음(vitest node 환경 단위테스트 대상 — placedMatching.ts 패턴).
 * 프리셋은 세로형 기준 1행 저장이 원칙이며, 가로형은 여기서 스왑해 파생한다.
 */

export type PresetOrientation = 'portrait' | 'landscape';

export interface SizeMm {
  widthMm: number;
  heightMm: number;
}

/** 정사각(W==H) 여부 — 정사각은 방향 토글이 무의미(가로형 disabled). */
export function isSquare(trimWidthMm: number, trimHeightMm: number): boolean {
  return trimWidthMm === trimHeightMm;
}

/** 세로형 기준 재단 치수에 방향 적용 — 가로형이면 W↔H 스왑(정사각은 스왑해도 동일). */
export function orientTrim(
  trimWidthMm: number,
  trimHeightMm: number,
  orientation: PresetOrientation,
): SizeMm {
  if (orientation === 'landscape') {
    return { widthMm: trimHeightMm, heightMm: trimWidthMm };
  }
  return { widthMm: trimWidthMm, heightMm: trimHeightMm };
}

/** 부동소수 잔재 제거(mm 소수 2자리) — 예: 0.5 도련 반복 합산 오차 방지. */
function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 작업 치수 = 재단 + 2×bleed(사방 도련). */
export function workSize(trimWidthMm: number, trimHeightMm: number, bleedMm: number): SizeMm {
  return {
    widthMm: roundMm(trimWidthMm + 2 * bleedMm),
    heightMm: roundMm(trimHeightMm + 2 * bleedMm),
  };
}

/** 치수 표기 — 예: '210 × 297 mm' */
export function formatSizeLabel(widthMm: number, heightMm: number): string {
  return `${widthMm} × ${heightMm} mm`;
}
