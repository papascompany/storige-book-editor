// 표지 펼침면 5영역 분할 — Storige SpreadLayoutEngine 규약을 그대로 따른다.
//
// 권위 소스: packages/canvas-core/src/spread/SpreadLayoutEngine.ts
//   - REGION_ORDER (좌→우): back-wing, back-cover, spine, front-cover, front-wing
//   - resolveRegionAtX: x >= region.x && x < region.x + region.width
//   - 총폭(types/index.ts computeSpreadDimensions):
//       totalWidthMm = (wing*2 if enabled) + cover*2 + spine, 0.1mm 반올림
//
// IDML 스프레드의 절대좌표(px/mm)로부터 각 디자인 객체의 중심 x 를 이 규칙에
// 통과시켜 regionRef 를 부여하고, region 기준 정규화 앵커(xNorm)를 만든다.

import { mmToPx, roundMm01 } from './units.mjs';

/** @typedef {'back-wing'|'back-cover'|'spine'|'front-cover'|'front-wing'} RegionKind */

/** 좌→우 영역 순서 (SpreadLayoutEngine.REGION_ORDER 와 동일) */
export const REGION_ORDER = [
  'back-wing',
  'back-cover',
  'spine',
  'front-cover',
  'front-wing',
];

/**
 * 펼침면 spec.
 * @typedef {Object} SpreadSpecLike
 * @property {number} coverWidthMm   - 표지 한 면(앞=뒤) 폭
 * @property {number} coverHeightMm  - 표지 높이
 * @property {number} spineWidthMm   - 책등 폭(런타임 가변 대상; 초기 표시값)
 * @property {boolean} [wingEnabled] - 날개 사용 여부
 * @property {number} [wingWidthMm]  - 날개 폭
 */

/** spec → 영역별 폭(mm) 맵. 날개 비활성 시 wing 폭 0. */
export function computeRegionWidthsMm(spec) {
  const wing = spec.wingEnabled ? Number(spec.wingWidthMm || 0) : 0;
  const cover = Number(spec.coverWidthMm);
  const spine = Number(spec.spineWidthMm);
  return {
    'back-wing': wing,
    'back-cover': cover,
    spine,
    'front-cover': cover,
    'front-wing': wing,
  };
}

/** 펼침면 총폭(mm). computeSpreadDimensions 와 동일하게 0.1mm 반올림. */
export function computeTotalWidthMm(spec) {
  const w = computeRegionWidthsMm(spec);
  const raw =
    w['back-wing'] +
    w['back-cover'] +
    w.spine +
    w['front-cover'] +
    w['front-wing'];
  return roundMm01(raw);
}

/**
 * 좌→우 누적으로 영역 배치(mm). 각 영역의 시작 x(mm)와 폭(mm).
 * @returns {{kind: RegionKind, xMm: number, widthMm: number}[]}
 */
export function layoutRegionsMm(spec) {
  const widths = computeRegionWidthsMm(spec);
  let cursor = 0;
  return REGION_ORDER.map((kind) => {
    const widthMm = widths[kind];
    const region = { kind, xMm: roundMm01(cursor), widthMm };
    cursor += widthMm;
    return region;
  });
}

/** layoutRegionsMm 결과를 px 로 변환 (DPI 150). */
export function layoutRegionsPx(spec, dpi) {
  return layoutRegionsMm(spec).map((r) => ({
    kind: r.kind,
    x: mmToPx(r.xMm, dpi),
    width: mmToPx(r.widthMm, dpi),
  }));
}

/**
 * 주어진 x(영역과 동일 단위)에 해당하는 영역 kind 반환.
 * SpreadLayoutEngine.resolveRegionAtX 와 동일: x >= r.x && x < r.x + width.
 * 폭 0 영역(비활성 날개)은 절대 매칭되지 않는다. 범위 밖이면 null.
 * @param {{kind: RegionKind, x: number, width: number}[]} regions
 */
export function resolveRegionAtX(regions, x) {
  for (const r of regions) {
    if (x >= r.x && x < r.x + r.width) return r.kind;
  }
  return null;
}

/**
 * 객체의 영역 기준 정규화 앵커. xNorm = (centerX - region.x) / region.width.
 * (SpreadLayoutEngine 의 region 앵커 계산과 동일 형태)
 * 반환 null = 어느 영역에도 속하지 않음(자유 객체).
 */
export function computeRegionAnchor(regions, centerX, centerY, contentHeight) {
  for (const r of regions) {
    if (centerX >= r.x && centerX < r.x + r.width) {
      return {
        regionRef: r.kind,
        xNorm: (centerX - r.x) / r.width,
        yNorm: contentHeight ? centerY / contentHeight : 0,
      };
    }
  }
  return null;
}
