import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_ORDER,
  computeRegionWidthsMm,
  computeTotalWidthMm,
  layoutRegionsMm,
  layoutRegionsPx,
  resolveRegionAtX,
  computeRegionAnchor,
} from './regions.mjs';
import { mmToPx } from './units.mjs';

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

// 날개 있는 표지: cover=150, spine=10, wing=60
const withWing = {
  coverWidthMm: 150,
  coverHeightMm: 220,
  spineWidthMm: 10,
  wingEnabled: true,
  wingWidthMm: 60,
};
// 날개 없는 표지
const noWing = {
  coverWidthMm: 150,
  coverHeightMm: 220,
  spineWidthMm: 10,
  wingEnabled: false,
};

test('REGION_ORDER 는 SpreadLayoutEngine 과 동일한 5영역', () => {
  assert.deepEqual(REGION_ORDER, [
    'back-wing',
    'back-cover',
    'spine',
    'front-cover',
    'front-wing',
  ]);
});

test('computeTotalWidthMm: wing*2 + cover*2 + spine', () => {
  // 60*2 + 150*2 + 10 = 430
  approx(computeTotalWidthMm(withWing), 430);
  // 날개 없음: 150*2 + 10 = 310
  approx(computeTotalWidthMm(noWing), 310);
});

test('computeRegionWidthsMm: 날개 비활성 시 wing 폭 0', () => {
  const w = computeRegionWidthsMm(noWing);
  assert.equal(w['back-wing'], 0);
  assert.equal(w['front-wing'], 0);
  assert.equal(w['back-cover'], 150);
  assert.equal(w.spine, 10);
});

test('layoutRegionsMm: 좌→우 누적 배치', () => {
  const layout = layoutRegionsMm(withWing);
  // back-wing 0..60, back-cover 60..210, spine 210..220, front-cover 220..370, front-wing 370..430
  assert.deepEqual(
    layout.map((r) => [r.kind, r.xMm, r.widthMm]),
    [
      ['back-wing', 0, 60],
      ['back-cover', 60, 150],
      ['spine', 210, 10],
      ['front-cover', 220, 150],
      ['front-wing', 370, 60],
    ]
  );
});

test('resolveRegionAtX: 경계는 오른쪽 영역에 귀속 (x >= r.x && x < r.x+width)', () => {
  const regions = layoutRegionsPx(withWing);
  const at = (mm) => resolveRegionAtX(regions, mmToPx(mm));
  assert.equal(at(0), 'back-wing');
  assert.equal(at(30), 'back-wing');
  assert.equal(at(60), 'back-cover'); // 경계 60 → 오른쪽(back-cover)
  assert.equal(at(150), 'back-cover');
  assert.equal(at(215), 'spine');
  assert.equal(at(220), 'front-cover'); // 경계 220 → front-cover
  assert.equal(at(300), 'front-cover');
  assert.equal(at(400), 'front-wing');
});

test('resolveRegionAtX: 범위 밖이면 null', () => {
  const regions = layoutRegionsPx(withWing);
  assert.equal(resolveRegionAtX(regions, mmToPx(430)), null); // 끝 경계는 밖
  assert.equal(resolveRegionAtX(regions, mmToPx(500)), null);
  assert.equal(resolveRegionAtX(regions, -1), null);
});

test('resolveRegionAtX: 폭 0 날개는 절대 매칭되지 않음', () => {
  const regions = layoutRegionsPx(noWing);
  // x=0 은 back-wing(폭0)이 아니라 back-cover 에 귀속되어야 한다
  assert.equal(resolveRegionAtX(regions, 0), 'back-cover');
});

test('computeRegionAnchor: 영역 내 정규화 앵커 xNorm', () => {
  const regions = layoutRegionsPx(withWing);
  // front-cover 중앙(220+75=295mm) → xNorm 0.5
  const anchor = computeRegionAnchor(
    regions,
    mmToPx(295),
    mmToPx(110),
    mmToPx(220)
  );
  assert.equal(anchor.regionRef, 'front-cover');
  approx(anchor.xNorm, 0.5, 1e-9);
  approx(anchor.yNorm, 0.5, 1e-9);
});

test('computeRegionAnchor: 어느 영역에도 없으면 null', () => {
  const regions = layoutRegionsPx(withWing);
  assert.equal(
    computeRegionAnchor(regions, mmToPx(999), 0, mmToPx(220)),
    null
  );
});
