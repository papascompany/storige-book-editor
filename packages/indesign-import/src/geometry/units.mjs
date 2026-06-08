// 단위 변환 — Storige 좌표 규약과 동일 상수를 사용한다.
// 권위 소스: packages/canvas-core/src/utils/math.ts (DEFAULT_DPI=150),
//            packages/canvas-core/src/ruler/constants.ts
// IDML 좌표는 PostScript point(1pt = 1/72 inch). 변환 사슬: pt → mm → workspace px.

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;
export const DEFAULT_DPI = 150; // Storige 캔버스 기본 DPI (math.ts와 일치)

/** mm → workspace px. Storige: (mm / 25.4) * DPI */
export function mmToPx(mm, dpi = DEFAULT_DPI) {
  return (mm / MM_PER_INCH) * dpi;
}

/** workspace px → mm */
export function pxToMm(px, dpi = DEFAULT_DPI) {
  return (px / dpi) * MM_PER_INCH;
}

/** PostScript point → mm. (pt / 72) * 25.4 */
export function ptToMm(pt) {
  return (pt / POINTS_PER_INCH) * MM_PER_INCH;
}

/** PostScript point → workspace px. Storige ptToPx: (pt * DPI) / 72 */
export function ptToPx(pt, dpi = DEFAULT_DPI) {
  return (pt * dpi) / POINTS_PER_INCH;
}

/** mm → PostScript point (역변환, 검산용) */
export function mmToPt(mm) {
  return (mm / MM_PER_INCH) * POINTS_PER_INCH;
}

/** mm 값을 0.1mm 단위로 반올림 — Storige roundMm01 규약 */
export function roundMm01(mm) {
  return Math.round(mm * 10) / 10;
}
