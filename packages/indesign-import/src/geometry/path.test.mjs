import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPathD, transformedBBox, ptEq } from './path.mjs';

const idMap = (p) => ({ x: p[0], y: p[1] });
// 핸들=anchor → 직선 점
const straightPt = (x, y) => ({ a: [x, y], l: [x, y], r: [x, y] });

test('ptEq: 근사 동일 판정', () => {
  assert.ok(ptEq([1, 2], [1.00001, 2]));
  assert.ok(!ptEq([1, 2], [1.1, 2]));
});

test('buildPathD: 닫힌 사각형 → M/L/Z (직선)', () => {
  const sub = [
    {
      closed: true,
      points: [straightPt(0, 0), straightPt(10, 0), straightPt(10, 10), straightPt(0, 10)],
    },
  ];
  assert.equal(buildPathD(sub, idMap), 'M 0 0 L 10 0 L 10 10 L 0 10 Z');
});

test('buildPathD: 열린 경로 → Z 없음, 마지막 세그먼트 생략', () => {
  const sub = [
    { closed: false, points: [straightPt(0, 0), straightPt(10, 0), straightPt(10, 10)] },
  ];
  assert.equal(buildPathD(sub, idMap), 'M 0 0 L 10 0 L 10 10');
});

test('buildPathD: 베지어 핸들이 anchor 와 다르면 C', () => {
  const sub = [
    {
      closed: false,
      points: [
        { a: [0, 0], l: [0, 0], r: [5, -5] }, // right handle ≠ anchor
        { a: [10, 0], l: [5, 5], r: [10, 0] }, // left handle ≠ anchor
      ],
    },
  ];
  assert.equal(buildPathD(sub, idMap), 'M 0 0 C 5 -5 5 5 10 0');
});

test('buildPathD: mapPt 로 좌표 변환 적용 (×2)', () => {
  const scale2 = (p) => ({ x: p[0] * 2, y: p[1] * 2 });
  const sub = [{ closed: true, points: [straightPt(0, 0), straightPt(5, 0), straightPt(5, 5)] }];
  assert.equal(buildPathD(sub, scale2), 'M 0 0 L 10 0 L 10 10 Z');
});

test('transformedBBox: anchor 들의 경계', () => {
  const sub = [{ closed: true, points: [straightPt(2, 3), straightPt(12, 3), straightPt(12, 23)] }];
  const b = transformedBBox(sub, idMap);
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [2, 3, 12, 23]);
  assert.equal(b.cx, 7);
  assert.equal(b.w, 10);
});
