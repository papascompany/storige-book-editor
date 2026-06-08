import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY,
  fromItemTransform,
  multiply,
  compose,
  applyToPoint,
  decompose,
} from './matrix.mjs';

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);
const approxPt = (p, x, y, eps = 1e-9) => {
  approx(p.x, x, eps);
  approx(p.y, y, eps);
};

test('fromItemTransform: [a,b,c,d,tx,ty] → {a,b,c,d,e,f}', () => {
  const m = fromItemTransform([1, 0, 0, 1, 10, 20]);
  assert.deepEqual(m, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
});

test('fromItemTransform: 길이 부족이면 throw', () => {
  assert.throws(() => fromItemTransform([1, 0, 0]));
});

test('applyToPoint: 항등행렬은 점을 보존', () => {
  approxPt(applyToPoint(IDENTITY, 3, 4), 3, 4);
});

test('applyToPoint: 평행이동', () => {
  const t = fromItemTransform([1, 0, 0, 1, 10, 20]);
  approxPt(applyToPoint(t, 0, 0), 10, 20);
  approxPt(applyToPoint(t, 5, 7), 15, 27);
});

test('applyToPoint: 90도 회전 (1,0)→(0,1)', () => {
  // a=cos90=0, b=sin90=1, c=-sin90=-1, d=cos90=0
  const r = fromItemTransform([0, 1, -1, 0, 0, 0]);
  approxPt(applyToPoint(r, 1, 0), 0, 1);
  approxPt(applyToPoint(r, 0, 1), -1, 0);
});

test('multiply/compose: scale 후 translate 합성 순서', () => {
  const T = fromItemTransform([1, 0, 0, 1, 10, 0]); // +10 x
  const S = fromItemTransform([2, 0, 0, 2, 0, 0]); // x2 scale
  // compose(T,S): S 를 먼저 적용한 뒤 T → (1,1) → scale (2,2) → translate (12,2)
  const M = compose(T, S);
  approxPt(applyToPoint(M, 1, 1), 12, 2);
  // multiply 도 동일
  approxPt(applyToPoint(multiply(T, S), 1, 1), 12, 2);
});

test('compose: 중첩 변환은 자식이 먼저 적용된다 (Spread∘Group∘Item)', () => {
  const spread = fromItemTransform([1, 0, 0, 1, 100, 0]); // 스프레드 원점 보정 +100
  const group = fromItemTransform([1, 0, 0, 1, 10, 5]); // 그룹 오프셋
  const item = fromItemTransform([1, 0, 0, 1, 1, 1]); // 아이템 로컬
  const world = compose(spread, group, item);
  // 로컬 (0,0) → item(1,1) → group(11,6) → spread(111,6)
  approxPt(applyToPoint(world, 0, 0), 111, 6);
});

test('decompose: scale+translate (회전 0)', () => {
  const m = fromItemTransform([2, 0, 0, 3, 10, 20]);
  const d = decompose(m);
  approx(d.scaleX, 2);
  approx(d.scaleY, 3);
  approx(d.translateX, 10);
  approx(d.translateY, 20);
  approx(d.rotationDeg, 0);
  assert.equal(d.flipped, false);
});

test('decompose: 수직 반전(d<0) 은 scaleY 음수 + flipped', () => {
  // IDML 의 Y-down 보정 등에서 흔한 반전
  const m = fromItemTransform([1, 0, 0, -1, 0, 0]);
  const d = decompose(m);
  approx(d.scaleX, 1);
  assert.ok(d.scaleY < 0, 'scaleY 는 음수여야 한다');
  assert.ok(d.det < 0, 'det 는 음수여야 한다');
  assert.equal(d.flipped, true);
  approx(d.rotationDeg, 0);
});

test('decompose: 45도 회전', () => {
  const rad = Math.PI / 4;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const m = fromItemTransform([cos, sin, -sin, cos, 0, 0]);
  const d = decompose(m);
  approx(d.rotationDeg, 45, 1e-9);
  approx(d.scaleX, 1, 1e-9);
  approx(d.scaleY, 1, 1e-9);
});
