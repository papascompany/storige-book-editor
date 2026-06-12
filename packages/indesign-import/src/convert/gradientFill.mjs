// IDML 그라디언트 → fabric 5.5 Gradient 직렬화 fill(plain object) 변환 (A1).
//
// fabric 5.5.2 dist 실측 근거(2026-06-12 조사·VM 라운드트립 검증):
//  - 역직렬화: 별도 Gradient.fromObject 없음 — Object._initGradient 가 plain object 에
//    colorStops 키만 있으면 자동 부활(new fabric.Gradient(filler)). 즉 변환기가
//    { type, coords, colorStops, gradientUnits:'pixels', offsetX:0, offsetY:0 } 를 obj.fill 에
//    넣으면 로드→toObject→재로드 왕복이 JSON 동일로 안전하다(추가 키 cmyk 도 보존 — slice()).
//  - 좌표 기준: gradientUnits:'pixels' 일 때 coords 는 객체 로컬 px, 원점 = 객체 좌상단
//    (_applyPatternGradientTransform: ctx.translate(−width/2+offsetX, −height/2+offsetY)).
//    객체 회전은 ctx 에 선적용 → 그라디언트는 객체와 함께 회전.
//
// IDML 기하 해석(실측 §3b):
//  - GradientFillAngle: InDesign UI 기준 CCW·y-up(도) → inner(y-down) 방향벡터 (cosθ, −sinθ).
//  - GradientFillStart: 객체 inner 좌표(PathPointType 앵커와 동일 공간) → mapLocalToCanvas 재사용.
//  - 끝점 E 는 **inner pt 공간**에서 합성한다: E_inner = [Sx + L·cosθ, Sy − L·sinθ],
//    그리고 S 와 동일하게 SSOT 매퍼(mapPt)로 캔버스에 사상한다. 이렇게 하면 ItemTransform 의
//    회전/플립/스케일(베이크된 PATH 회전 포함)이 S·E 에 똑같이 적용되어 방향이 자동 정합한다.
//    (이전 방식 — 캔버스 공간에서 ptToPx(L)·dir 직접 합성 — 은 비항등 변환에서 방향이 어긋났다.)
//    radial 반경은 r2 = |E − S| (캔버스 px). 비균등 스케일에선 평균 반경 근사.
//  ⚠️ 실 IDML 표본에 도형 그라디언트 0건 — inner 공간 가정은 합성 IDML 로 검증(단위테스트).
//    회전 객체 표본도 0건 → 합성 테스트(회전 베이크 PATH/angle 객체/flipY)로 검증, 경고는 유지.

/** FillColor 값이 그라디언트 참조("Gradient/...")인지 */
export function isGradientRef(colorId) {
  return typeof colorId === 'string' && colorId.startsWith('Gradient/');
}

/** '#rrggbb' 두 색의 선형 혼합(t: 0=a, 1=b) — Midpoint 중간 스톱 합성용 */
export function mixHex(a, b, t = 0.5) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (x, y) => Math.round(x + (y - x) * t);
  return (
    '#' +
    [ch(pa[0], pb[0]), ch(pa[1], pb[1]), ch(pa[2], pb[2])]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('')
  );
}
function parseHex(hex) {
  const h = String(hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

/**
 * reader.parseGradients 의 stops → fabric colorStops.
 * - offset 0..1 클램프·오름차순(파서가 정렬 보장하지만 방어).
 * - Midpoint==50 무시(선형과 동일). ≠50 이면 이전 스톱과 사이의
 *   offset_prev + (mid/100)·Δ 위치에 50% 혼합색 중간 스톱을 합성(실측 파일은 전부 50 = no-op).
 * - cmyk 원본은 스톱별 추가 키로 보존(fabric Gradient 생성자는 slice() 라 키 유지 — dist 검증).
 */
export function normalizeColorStops(stops) {
  const sorted = [...(stops || [])].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const color = s.color || '#000000';
    if (i > 0 && s.midpoint != null && Math.abs(s.midpoint - 50) > 0.5) {
      const prev = sorted[i - 1];
      const prevOff = clamp01(prev.offset ?? 0);
      const off = clamp01(s.offset ?? 0);
      out.push({
        offset: round4(prevOff + (s.midpoint / 100) * (off - prevOff)),
        color: mixHex(prev.color || '#000000', color, 0.5),
      });
    }
    out.push({
      offset: round4(clamp01(s.offset ?? 0)),
      color,
      ...(s.cmyk ? { cmyk: s.cmyk } : {}),
    });
  }
  return out;
}

/**
 * 그라디언트 정의 + 객체 기하 → fabric Gradient 직렬화 fill.
 *
 * @param {object} def  reader.parseGradients 항목({ type, stops })
 * @param {object} geom
 *   - mapPt: ([lx,ly]) => {x,y} — 객체 로컬(inner) pt → 캔버스 content px (toSpreadTemplate
 *     mapLocalToCanvas 재사용 — 좌표식 복붙 금지). S·E 모두 이 매퍼로만 사상한다(SSOT).
 *   - start: [x,y] 로컬 pt | null, lengthPt: number | null, angleDeg: GradientFillAngle(기본 0)
 *   - objectAngleDeg: fabric angle(비-path 회전, y-down CW) — 0 이 아니면 중심 역회전으로 로컬화
 *   - objectFlipY: 비-path 객체의 d.flipped(fabric flipY) — 역회전 후 중심 기준 y 미러
 *   - centerXpx/centerYpx/widthPx/heightPx: 객체 중심·치수(content px)
 * @returns {{ fill: object, warnings: string[] }}
 *   fill = { type, coords, colorStops, gradientUnits:'pixels', offsetX:0, offsetY:0 }
 */
export function buildFabricGradientFill(def, geom) {
  const {
    mapPt,
    start = null,
    lengthPt = null,
    angleDeg = 0,
    objectAngleDeg = 0,
    objectFlipY = false,
    centerXpx,
    centerYpx,
    widthPx,
    heightPx,
  } = geom;
  const warnings = [];
  const colorStops = normalizeColorStops(def.stops);

  const leftPx = centerXpx - widthPx / 2; // 객체 로컬(좌상단) 원점 — fabric 'pixels' 규약
  const topPx = centerYpx - heightPx / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const hasGeom = Array.isArray(start) && start.length >= 2 && lengthPt != null && lengthPt > 0;
  const loc = (p) => toLocal(p, leftPx, topPx, centerXpx, centerYpx, objectAngleDeg, objectFlipY, warnings);

  let S; // 시작점(content px)
  let E; // 끝점(content px)
  if (hasGeom) {
    // inner pt 공간 합성(핵심): E_inner = S_inner + L·(cosθ, −sinθ) 를 S 와 같은 매퍼로 사상.
    // → ItemTransform 의 회전(베이크 PATH 포함)/플립/스케일이 S·E 에 동일 적용돼 자동 정합.
    S = mapPt(start);
    E = mapPt([start[0] + lengthPt * Math.cos(rad), start[1] - lengthPt * Math.sin(rad)]);
  } else {
    // 기하 미지정/퇴화(길이 0) — InDesign 기본처럼 객체 bbox 를 angle 방향으로 가로지르게 근사
    // (inner 기준점이 없어 캔버스 공간에서 합성 — 경고로 표면화)
    warnings.push('gradient-default-geometry');
    const dir = { x: Math.cos(rad), y: -Math.sin(rad) }; // CCW·y-up 각 → y-down 방향벡터
    const lenPx =
      Math.abs(widthPx * dir.x) + Math.abs(heightPx * dir.y) || Math.max(widthPx, heightPx) || 1;
    S = { x: centerXpx - (lenPx / 2) * dir.x, y: centerYpx - (lenPx / 2) * dir.y };
    E = { x: S.x + lenPx * dir.x, y: S.y + lenPx * dir.y };
  }

  if (def.type === 'radial') {
    // Radial: 중심=S(기하 미지정 시 객체 중심), r2=|E−S|(캔버스 px), r1=0.
    // 비균등 스케일에선 |E−S| 가 방향별 반경의 근사(타원→원). Hilite 보정은 표본 0건 — 미적용.
    const C = hasGeom ? S : { x: centerXpx, y: centerYpx };
    const r2 = hasGeom ? Math.hypot(E.x - S.x, E.y - S.y) : Math.max(widthPx, heightPx) / 2 || 1;
    const cl = loc(C);
    return {
      fill: {
        type: 'radial',
        coords: { x1: cl.x, y1: cl.y, x2: cl.x, y2: cl.y, r1: 0, r2: round2(r2) },
        colorStops,
        gradientUnits: 'pixels',
        offsetX: 0,
        offsetY: 0,
      },
      warnings,
    };
  }

  const Sl = loc(S);
  const El = loc(E);
  return {
    fill: {
      type: 'linear',
      coords: { x1: Sl.x, y1: Sl.y, x2: El.x, y2: El.y },
      colorStops,
      gradientUnits: 'pixels',
      offsetX: 0,
      offsetY: 0,
    },
    warnings,
  };
}

/**
 * content px 점 → 객체 로컬(좌상단 원점) px.
 * fabric 렌더 변환(translate(center) → rotate(angle) → scale(flipY?−1))의 역순:
 * ① 중심 기준 −angle 역회전 → ② flipY 면 중심 기준 y 미러(q.y = 2·cy − q.y) → ③ 좌상단 원점 환산.
 * (inner 공간 합성으로 S·E 방향은 이미 정합 — 이 함수는 캔버스→fabric 로컬 좌표 변환만 담당.)
 */
function toLocal(p, leftPx, topPx, cx, cy, objectAngleDeg, objectFlipY, warnings) {
  let q = p;
  if (objectAngleDeg) {
    if (!warnings.includes('gradient-rotated-object')) warnings.push('gradient-rotated-object');
    const a = (-objectAngleDeg * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    q = { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  if (objectFlipY) {
    if (!warnings.includes('gradient-flipped-object')) warnings.push('gradient-flipped-object');
    q = { x: q.x, y: 2 * cy - q.y };
  }
  return { x: round2(q.x - leftPx), y: round2(q.y - topPx) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
