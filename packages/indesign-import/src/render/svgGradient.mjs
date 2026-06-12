// 그라디언트 fill 의 SVG defs 공통 출력 — raster(rasterize.buildArtworkSvg)와
// preview(svg.buildPreviewSvg)가 단일 헬퍼를 공유한다(중복 구현 금지 — A1 규약).
//
// fabric coords(gradientUnits:'pixels', 객체 좌상단 원점 px)를 objectBoundingBox 로 정규화해
// 출력한다. 근거(실측 §3c): 두 빌더 모두 rect/ellipse 를 content 좌표로 직접 그리고,
// preview 의 path 는 transform="scale(s)", raster 의 회전은 <g rotate> 래핑 —
// objectBoundingBox 는 스케일·회전·두 빌더 좌표계 차이에 모두 불변이라 단일 헬퍼로 공유 가능
// (userSpaceOnUse 는 빌더별 scale/rotate 보정이 따로 필요해 중복을 낳는다).
// 한계: 비정사각 bbox 의 대각(비축정렬) 그라디언트는 bbox 비율만큼 각도가 왜곡될 수 있다
// (fabric 'pixels' 렌더와의 차이) — 실측 표본(수직/수평)에서는 무왜곡.

const escAttr = (t) =>
  String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** fill 이 fabric Gradient 직렬화 형태(plain object, colorStops 배열 보유)인지 */
export function isGradientFill(fill) {
  return fill != null && typeof fill === 'object' && Array.isArray(fill.colorStops);
}

/**
 * fabric Gradient fill → { id, ref, def }.
 * id 는 객체 self 기반(`grad-<sanitized id>`)으로 충돌을 방지한다(객체 id 는 idml-<Self> 유일).
 *
 * @param {object} fill   fabric Gradient 직렬화 fill({ type, coords, colorStops })
 * @param {{ id?: string|number, width: number, height: number, flipY?: boolean }} opts
 *   객체 식별자·unscaled 치수(px). flipY: 객체가 fabric flipY 로 렌더되는 경우 —
 *   두 빌더(raster/preview)는 도형을 미러 없이 그리므로 정규화 y 를 1−y 로 반전해
 *   fabric 캔버스와 같은 외관을 만든다(공통 헬퍼 단일 지점 — 빌더별 보정 중복 금지).
 * @returns {{ id: string, ref: string, def: string }}  def 는 <linearGradient|radialGradient> 마크업
 */
export function svgGradientFor(fill, { id, width, height, flipY = false }) {
  const gid = `grad-${String(id ?? 'obj').replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const w = width || 1;
  const h = height || 1;
  const fy = (v) => (flipY ? round4(1 - v) : round4(v));
  const stops = (fill.colorStops || [])
    .map(
      (s) =>
        `<stop offset="${round4((s.offset ?? 0) * 100)}%" stop-color="${escAttr(s.color || '#000000')}"${
          s.opacity != null ? ` stop-opacity="${round4(s.opacity)}"` : ''
        }/>`
    )
    .join('');
  const c = fill.coords || {};
  if (fill.type === 'radial') {
    // objectBoundingBox radial 의 r 은 bbox 비율 단위 — 최대 변 기준 근사(비정사각은 타원화).
    const maxSide = Math.max(w, h) || 1;
    const cx = round4((c.x2 ?? w / 2) / w);
    const cy = fy((c.y2 ?? h / 2) / h);
    const r = round4((c.r2 ?? maxSide / 2) / maxSide);
    return {
      id: gid,
      ref: `url(#${gid})`,
      def: `<radialGradient id="${gid}" gradientUnits="objectBoundingBox" cx="${cx}" cy="${cy}" r="${r}">${stops}</radialGradient>`,
    };
  }
  const x1 = round4((c.x1 ?? 0) / w);
  const y1 = fy((c.y1 ?? 0) / h);
  const x2 = round4((c.x2 ?? w) / w);
  const y2 = fy((c.y2 ?? 0) / h);
  return {
    id: gid,
    ref: `url(#${gid})`,
    def: `<linearGradient id="${gid}" gradientUnits="objectBoundingBox" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
  };
}

const round4 = (n) => Math.round(n * 10000) / 10000;
