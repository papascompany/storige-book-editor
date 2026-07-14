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

// ===== 치수 정합 가드 (2026-07-14) =====
// 실사고 근거: 하드커버 세트에 구 성책값(301×214) 내지가 연결돼 있던 잔재를 수동 정리 — 재발 방지.
// 규약: templateSet.width/height=판형(재단, 오리엔트됨). page류 템플릿 캔버스의 정합 치수는
// 세트 판형(재단) 또는 작업(재단+2×bleed) — 방향 포함 정확 일치.
// spread/spine/wing/endpaper/cover류는 표지 계열(제작 사이즈 정본)이라 검사 대상 아님(skip).

export type TemplateDimAlignmentStatus = 'ok-trim' | 'ok-work' | 'mismatch' | 'skip';

export interface TemplateDimAlignmentResult {
  status: TemplateDimAlignmentStatus;
}

/** mm 비교 허용오차 — 부동소수 잔재 흡수용(±0.01mm). */
const DIM_TOLERANCE_MM = 0.01;

function nearlyEqualMm(a: number, b: number): boolean {
  return Math.abs(a - b) <= DIM_TOLERANCE_MM;
}

/**
 * page류 템플릿 캔버스 치수의 세트 판형 정합 판정.
 * - 'ok-trim': 재단(세트 W×H)과 정확 일치(±0.01mm)
 * - 'ok-work': 작업(재단+2×bleed)과 정확 일치(±0.01mm)
 * - 'mismatch': 둘 다 아님(방향 스왑도 불일치 — 오리엔트된 판형과 방향 포함 일치가 규약)
 * - 'skip': page류가 아님(spread/spine/wing/endpaper/cover류 — 검사 대상 아님)
 */
export function checkTemplateDimAlignment(
  tpl: { type: string; width: number; height: number },
  set: { width: number; height: number; bleedMm: number },
): TemplateDimAlignmentResult {
  if (tpl.type !== 'page') {
    return { status: 'skip' };
  }
  if (nearlyEqualMm(tpl.width, set.width) && nearlyEqualMm(tpl.height, set.height)) {
    return { status: 'ok-trim' };
  }
  const work = workSize(set.width, set.height, set.bleedMm);
  if (nearlyEqualMm(tpl.width, work.widthMm) && nearlyEqualMm(tpl.height, work.heightMm)) {
    return { status: 'ok-work' };
  }
  return { status: 'mismatch' };
}

export type Orientation = 'portrait' | 'landscape' | 'square';

/** 방향 판정 — W>H 가로 / W<H 세로 / W==H 정사각. */
export function orientationOf(widthMm: number, heightMm: number): Orientation {
  if (widthMm === heightMm) {
    return 'square';
  }
  return widthMm > heightMm ? 'landscape' : 'portrait';
}
