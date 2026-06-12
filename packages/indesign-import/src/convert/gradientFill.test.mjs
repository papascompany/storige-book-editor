// gradientFill 단위테스트 — colorStops 정규화(Midpoint 합성), fabric 좌표식,
// inner pt 공간 E 합성(회전/플립/스케일 정합), radial, fabric 5.5 dist 왕복(가능 환경에서만 — 없으면 skip).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  isGradientRef,
  mixHex,
  normalizeColorStops,
  buildFabricGradientFill,
} from './gradientFill.mjs';

test('isGradientRef: Gradient/ 접두만 참, Color/·None·undefined 는 거짓', () => {
  assert.ok(isGradientRef('Gradient/새 그레이디언트 색상 견본'));
  assert.ok(!isGradientRef('Color/uc37'));
  assert.ok(!isGradientRef('Swatch/None'));
  assert.ok(!isGradientRef(undefined));
});

test('normalizeColorStops: Midpoint=50 은 no-op(스톱 수 불변)', () => {
  const out = normalizeColorStops([
    { offset: 0, color: '#6633ff', cmyk: [60, 80, 0, 0] },
    { offset: 1, color: '#80e6e6', midpoint: 50 },
  ]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { offset: 0, color: '#6633ff', cmyk: [60, 80, 0, 0] });
  assert.deepStrictEqual(out[1], { offset: 1, color: '#80e6e6' });
});

test('normalizeColorStops: Midpoint≠50 → offset_prev+(mid/100)·Δ 위치에 50% 혼합 스톱 합성', () => {
  const out = normalizeColorStops([
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff', midpoint: 25 },
  ]);
  assert.strictEqual(out.length, 3, '중간 스톱 합성');
  assert.strictEqual(out[1].offset, 0.25, 'midpoint 25% 위치');
  assert.strictEqual(out[1].color, mixHex('#000000', '#ffffff', 0.5), '50% 혼합색');
  assert.strictEqual(out[1].color, '#808080');
});

const I_MAP = ([x, y]) => ({ x, y }); // mapPt 항등(이미 content px 라고 가정)
const ID_PTPX = (v) => v; // ptToPx 항등

test('buildFabricGradientFill: angle 0 — S + L·(1,0), 좌상단 원점 로컬 px', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
  const { fill, warnings } = buildFabricGradientFill(def, {
    mapPt: I_MAP,
    ptToPx: ID_PTPX,
    start: [10, 20],
    lengthPt: 100,
    angleDeg: 0,
    objectAngleDeg: 0,
    centerXpx: 60, // 객체 bbox: left=10, top=−30, w=100, h=100
    centerYpx: 20,
    widthPx: 100,
    heightPx: 100,
  });
  assert.deepStrictEqual(fill.coords, { x1: 0, y1: 50, x2: 100, y2: 50 });
  assert.strictEqual(fill.gradientUnits, 'pixels');
  assert.strictEqual(fill.offsetX, 0);
  assert.strictEqual(fill.offsetY, 0);
  assert.strictEqual(warnings.length, 0);
});

test('buildFabricGradientFill: angle −90 → 하향(0,+1) — CCW·y-up 각의 y-down 환산', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  const { fill } = buildFabricGradientFill(def, {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: [50, -50], lengthPt: 100, angleDeg: -90,
    centerXpx: 50, centerYpx: 0, widthPx: 100, heightPx: 100,
  });
  // S 로컬 (50, 0) → E = S + 100·(cos(−90), −sin(−90)) = (50, 100)
  assert.ok(Math.abs(fill.coords.x2 - 50) < 1e-9 && Math.abs(fill.coords.y2 - 100) < 1e-9, JSON.stringify(fill.coords));
});

test('buildFabricGradientFill: 기하 미지정(길이 0/null) → bbox 가로지름 기본 + 경고 신호', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  const { fill, warnings } = buildFabricGradientFill(def, {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: null, lengthPt: null, angleDeg: 0,
    centerXpx: 50, centerYpx: 50, widthPx: 100, heightPx: 80,
  });
  // 객체 bbox: left=0, top=10(centerY 50 − h/2 40) → 세로 중앙의 로컬 y = 40
  assert.deepStrictEqual(fill.coords, { x1: 0, y1: 40, x2: 100, y2: 40 }, '폭 전체 좌→우(세로 중앙)');
  assert.ok(warnings.includes('gradient-default-geometry'));
});

test('buildFabricGradientFill: 회전 객체 — 중심 역회전 로컬화 + 경고 신호(항등 매퍼 결과 불변)', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  const { fill, warnings } = buildFabricGradientFill(def, {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: [0, 0], lengthPt: 100, angleDeg: 0,
    objectAngleDeg: 90, // fabric 시계방향 90°
    centerXpx: 50, centerYpx: 0, widthPx: 100, heightPx: 100,
  });
  assert.ok(warnings.includes('gradient-rotated-object'));
  // S content (0,0) — 중심(50,0) 기준 −90° 역회전 → (50,50) → 로컬 (50, 100)... 좌상단(0,−50) 기준
  assert.deepStrictEqual({ x: fill.coords.x1, y: fill.coords.y1 }, { x: 50, y: 100 });
});

test('buildFabricGradientFill: flipY rect — 수직 그라디언트 로컬 y 미러(렌더 시 fabric flip 이 원복) + 경고', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  // IDML inner: 상중앙(50,0)에서 아래로 100 (angle −90 → inner 방향 (0,+1)).
  // 객체 bbox: center (50,50), 100×100 → left 0, top 0.
  const base = {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: [50, 0], lengthPt: 100, angleDeg: -90,
    centerXpx: 50, centerYpx: 50, widthPx: 100, heightPx: 100,
  };
  const plain = buildFabricGradientFill(def, base);
  assert.deepStrictEqual(plain.fill.coords, { x1: 50, y1: 0, x2: 50, y2: 100 }, '비플립: 위→아래');
  assert.strictEqual(plain.warnings.length, 0);

  const flipped = buildFabricGradientFill(def, { ...base, objectFlipY: true });
  // 중심 기준 y 미러 → 로컬 아래→위. fabric 이 flipY 로 다시 미러 → 캔버스 외관은 plain 과 동일 방향.
  assert.deepStrictEqual(flipped.fill.coords, { x1: 50, y1: 100, x2: 50, y2: 0 }, '플립: 로컬 y 미러');
  assert.ok(flipped.warnings.includes('gradient-flipped-object'), '플립 경고 신호');
});

test('buildFabricGradientFill: 회전 베이크 PATH(objectAngleDeg=0) — inner 공간 합성으로 방향 자동 정합(경고 불필요 근거)', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  // ItemTransform 90° CW 가 좌표에 베이크된 경우를 모사: mapPt 가 (x,y)→(−y,x) 회전.
  // inner rect (0,−50)..(100,50) → 캔버스 bbox center (0,50), 100×100 (left −50, top 0).
  const ROT90 = ([x, y]) => ({ x: -y, y: x });
  const { fill, warnings } = buildFabricGradientFill(def, {
    mapPt: ROT90, ptToPx: ID_PTPX,
    start: [0, 0], lengthPt: 100, angleDeg: 0,
    objectAngleDeg: 0, // PATH: 회전이 좌표에 베이크 → fabric angle 0
    centerXpx: 0, centerYpx: 50, widthPx: 100, heightPx: 100,
  });
  // inner 좌중앙(0,0)→우중앙(100,0) 가 회전을 타고 캔버스 상중앙→하중앙으로 사상 — 로컬 수직.
  assert.deepStrictEqual(fill.coords, { x1: 50, y1: 0, x2: 50, y2: 100 }, '베이크 회전 자동 정합(수직)');
  assert.ok(!warnings.includes('gradient-rotated-object'), '베이크 회전은 근사 아님 — 경고 불필요');
});

test('buildFabricGradientFill: 회전 angle 객체 — inner 합성 + 중심 역회전 = 비회전과 동일 로컬 coords', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  // 같은 90° CW 회전이지만 비-path 객체: mapPt 는 회전을 적용하고 fabric angle=90 로 출력되는 경우.
  const ROT90 = ([x, y]) => ({ x: -y, y: x });
  const { fill, warnings } = buildFabricGradientFill(def, {
    mapPt: ROT90, ptToPx: ID_PTPX,
    start: [0, 0], lengthPt: 100, angleDeg: 0,
    objectAngleDeg: 90, // 비-path: fabric angle 로 회전 표현
    centerXpx: 0, centerYpx: 50, widthPx: 100, heightPx: 100,
  });
  // 역회전 후 로컬 좌중앙→우중앙 — 비회전 케이스와 동일(렌더 시 fabric 이 90° 재적용).
  assert.deepStrictEqual(fill.coords, { x1: 0, y1: 50, x2: 100, y2: 50 }, '역회전 정합(수평 복원)');
  assert.ok(warnings.includes('gradient-rotated-object'), '회전 객체 정보 경고 유지');
});

test('buildFabricGradientFill: 스케일 베이크 변환 — E 도 같은 매퍼 사상(길이가 스케일을 따라감)', () => {
  const def = { type: 'linear', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  // scaleX 2 베이크: inner 100pt 길이가 캔버스 200px 로. (구식 ptToPx(L)·dir 합성은 100px 로 어긋났다.)
  const SCALE2X = ([x, y]) => ({ x: 2 * x, y });
  const { fill } = buildFabricGradientFill(def, {
    mapPt: SCALE2X, ptToPx: ID_PTPX,
    start: [0, 0], lengthPt: 100, angleDeg: 0,
    centerXpx: 100, centerYpx: 0, widthPx: 200, heightPx: 100,
  });
  assert.deepStrictEqual(fill.coords, { x1: 0, y1: 50, x2: 200, y2: 50 }, '스케일 반영된 끝점');
});

test('buildFabricGradientFill: radial — 중심=S, r2=길이, r1=0', () => {
  const def = { type: 'radial', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] };
  const { fill } = buildFabricGradientFill(def, {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: [50, 0], lengthPt: 60, angleDeg: 0,
    centerXpx: 50, centerYpx: 0, widthPx: 100, heightPx: 100,
  });
  assert.strictEqual(fill.type, 'radial');
  assert.deepStrictEqual(fill.coords, { x1: 50, y1: 50, x2: 50, y2: 50, r1: 0, r2: 60 });
});

// ── fabric 5.5.2 dist 왕복(절대 규칙 #6) — canvas-core 의 dist 를 VM 으로 로드 ──
// (indesign-import 는 fabric 비의존 — 모노레포 형제 경로에서 찾고, 없으면 skip)
function findFabricDist() {
  const candidates = [
    new URL('../../../canvas-core/node_modules/fabric/dist/fabric.js', import.meta.url),
    new URL('../../node_modules/fabric/dist/fabric.js', import.meta.url),
  ];
  for (const u of candidates) {
    const p = fileURLToPath(u);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadFabricInVm(distPath) {
  const src = fs.readFileSync(distPath, 'utf8');
  class Document {}
  class Element {}
  class HTMLElement extends Element {}
  class HTMLCanvasElement extends HTMLElement {}
  class HTMLImageElement extends HTMLElement {}
  const mkEl = () =>
    new Proxy(
      { style: {}, classList: { add() {}, remove() {} } },
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === 'getContext') return () => null;
          if (k === 'setAttribute' || k === 'appendChild' || k === 'addEventListener') return () => {};
          return t[k];
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      }
    );
  const doc = new Document();
  doc.createElement = () => mkEl();
  doc.documentElement = mkEl();
  doc.implementation = { createHTMLDocument: () => doc };
  doc.addEventListener = () => {};
  const win = { document: doc, devicePixelRatio: 1, navigator: { userAgent: 'node' }, addEventListener() {} };
  const sandbox = {
    window: win, document: doc, Document, Element, HTMLElement, HTMLCanvasElement, HTMLImageElement,
    navigator: win.navigator, console, setTimeout, clearTimeout,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx);
  return { ctx, sandbox };
}

test('fabric 5.5 dist 왕복: plain fill → _initGradient 부활 → toObject 2차 왕복 JSON 동일', (t) => {
  const distPath = findFabricDist();
  if (!distPath) {
    t.skip('fabric dist 미발견(canvas-core node_modules) — 구조 검증은 타 테스트가 담당');
    return;
  }
  const def = {
    type: 'linear',
    stops: [
      { offset: 0, color: '#6633ff', cmyk: [60, 80, 0, 0] },
      { offset: 1, color: '#80e6e6', cmyk: [50, 10, 10, 0], midpoint: 50 },
    ],
  };
  const { fill } = buildFabricGradientFill(def, {
    mapPt: I_MAP, ptToPx: ID_PTPX,
    start: [0, 0], lengthPt: 100, angleDeg: 0,
    centerXpx: 50, centerYpx: 0, widthPx: 100, heightPx: 100,
  });

  const { ctx, sandbox } = loadFabricInVm(distPath);
  // ⚠️ cross-realm 배열은 fabric 내부 instanceof Array 판정에 실패 — JSON 으로 VM 안에서 생성
  sandbox.__objJson = JSON.stringify({ left: 0, top: 0, width: 100, height: 100, fill });
  sandbox.__out = {};
  vm.runInContext(
    `fabric.Rect.fromObject(JSON.parse(__objJson), function (rect) {
       __out.revived = rect.fill instanceof fabric.Gradient;
       var ser = rect.toObject();
       __out.ser = JSON.stringify(ser.fill);
       fabric.Rect.fromObject(JSON.parse(JSON.stringify(ser)), function (rect2) {
         __out.stable = JSON.stringify(rect2.toObject().fill) === __out.ser;
       });
     });`,
    ctx
  );
  assert.strictEqual(sandbox.__out.revived, true, 'plain fill → fabric.Gradient 부활');
  assert.strictEqual(sandbox.__out.stable, true, '2차 왕복 JSON 동일');
  const ser = JSON.parse(sandbox.__out.ser);
  assert.deepStrictEqual(ser.coords, fill.coords, 'coords 보존');
  assert.deepStrictEqual(
    ser.colorStops.map((s) => [s.offset, s.color]),
    fill.colorStops.map((s) => [s.offset, s.color]),
    'colorStops 보존'
  );
  assert.deepStrictEqual(ser.colorStops[0].cmyk, [60, 80, 0, 0], '스톱 cmyk 추가 키 보존(slice)');
});
