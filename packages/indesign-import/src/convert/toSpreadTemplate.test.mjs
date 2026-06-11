// toSpreadTemplate 좌표 규약 테스트.
// 시스템 규약 = 콘텐츠 '중앙원점'(WorkspacePlugin 워크스페이스 중심 = fabric (0,0)).
// 변환기 출력이 originX/originY='center' + 중앙원점(캔버스 중심 기준) 인지 검증.
import { test } from 'node:test';
import assert from 'node:assert';
import { toSpreadTemplate } from './toSpreadTemplate.mjs';

const mm2pt = (mm) => (mm * 72) / 25.4;

// 3페이지(날개없음) 표지: 표지210 + 책등10 + 표지210 = 430mm × 297mm. 스프레드 중심 원점.
function makeDoc(items) {
  const h = mm2pt(297);
  return {
    bleedPt: mm2pt(3),
    fonts: [],
    colors: new Map([['Color/Blue', { hex: '#0000ff', space: 'RGB' }]]),
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items,
  };
}

test('모든 객체가 originX/originY=center + 캔버스 중심 기준(중앙원점) 범위에 든다', () => {
  const h = mm2pt(297);
  const doc = makeDoc([
    // 스프레드 정중앙에 둔 배경 rect
    { self: 'bg', type: 'Rectangle', fillColor: 'Color/Blue', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, bbox: { cx: 0, cy: 0, w: mm2pt(430), h, pointCount: 4 } },
    // 앞표지(우측) 한가운데에 둔 작은 rect(스프레드 x = +105mm)
    { self: 'fc', type: 'Rectangle', fillColor: 'Color/Blue', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, bbox: { cx: mm2pt(105), cy: 0, w: mm2pt(20), h: mm2pt(20), pointCount: 4 } },
    // 뒤표지(좌측) 한가운데(스프레드 x = -105mm)
    { self: 'bc', type: 'Rectangle', fillColor: 'Color/Blue', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, bbox: { cx: -mm2pt(105), cy: 0, w: mm2pt(20), h: mm2pt(20), pointCount: 4 } },
  ]);
  const { draftTemplateDto } = toSpreadTemplate(doc);
  const objs = draftTemplateDto.canvasData.objects;
  const halfW = draftTemplateDto.canvasData.width / 2;
  const halfH = draftTemplateDto.canvasData.height / 2;

  assert.ok(objs.length === 3, '3 객체');
  for (const o of objs) {
    assert.strictEqual(o.originX, 'center', `${o.id} originX=center`);
    assert.strictEqual(o.originY, 'center', `${o.id} originY=center`);
    assert.ok(o.left >= -halfW - 1 && o.left <= halfW + 1, `${o.id} left(${o.left}) ∈ [-halfW,+halfW]`);
    assert.ok(o.top >= -halfH - 1 && o.top <= halfH + 1, `${o.id} top(${o.top}) ∈ [-halfH,+halfH]`);
  }

  // 정중앙 배경 → (0,0) 근처
  const bg = objs.find((o) => o.id === 'idml-bg');
  assert.ok(Math.abs(bg.left) < 2 && Math.abs(bg.top) < 2, `중앙 rect ≈ (0,0): (${bg.left},${bg.top})`);
  // 앞표지(우측)는 +left, 뒤표지(좌측)는 -left (좌우 대칭)
  const fc = objs.find((o) => o.id === 'idml-fc');
  const bc = objs.find((o) => o.id === 'idml-bc');
  assert.ok(fc.left > 0, `앞표지 객체 left>0 (${fc.left})`);
  assert.ok(bc.left < 0, `뒤표지 객체 left<0 (${bc.left})`);
  assert.ok(Math.abs(fc.left + bc.left) < 2, `좌우 대칭(${fc.left}, ${bc.left})`);
});

// [강등 가드] 중심 x 단독 판정의 함정: 스프레드 전폭 배경은 중심이 책등 밴드에 들어와
// 'spine' 으로 분류된다 → 편집기 resizeSpine 시 비율 축소+중앙이동으로 표지 붕괴.
// spine 판정 + 폭이 책등 폭의 1.05배 초과 → 자유 객체(regionRef=null, canvas anchor) 강등.
// 단, 책등 폭 내의 진짜 책등 객체(세로 제목 등)와 cover 판정은 절대 불변.
test('spine 강등 가드: 전폭 배경은 canvas anchor 로 강등, 책등 폭 내 텍스트는 spine 유지', () => {
  const h = mm2pt(297);
  const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const doc = makeDoc([
    // 스프레드 전폭(430mm) 배경 — 중심 x = 책등 밴드(210..220mm) → 종전엔 'spine' 오분류
    { self: 'bg', type: 'Rectangle', fillColor: 'Color/Blue', transform: I, bbox: { cx: 0, cy: 0, w: mm2pt(430), h, pointCount: 4 } },
    // 책등 폭(10mm) 안의 진짜 책등 텍스트(8mm) — 'spine' 유지되어야 함
    { self: 'spineText', type: 'TextFrame', transform: I, bbox: { cx: 0, cy: 0, w: mm2pt(8), h: mm2pt(180), pointCount: 4 }, story: { text: '책등 제목' } },
    // 책등 폭을 약간 초과(14mm > 10*1.05)하는 rect — 강등 대상
    { self: 'wide', type: 'Rectangle', fillColor: 'Color/Blue', transform: I, bbox: { cx: 0, cy: 0, w: mm2pt(14), h: mm2pt(50), pointCount: 4 } },
    // 앞표지 풀블리드 배경(216mm > cover 210mm) — cover 판정은 불변(앵커 유지) 검증
    { self: 'fcbg', type: 'Rectangle', fillColor: 'Color/Blue', transform: I, bbox: { cx: mm2pt(110), cy: 0, w: mm2pt(216), h, pointCount: 4 } },
  ]);
  const { objects } = toSpreadTemplate(doc);

  // 전폭 배경: spine → null 강등 + canvas anchor (scene 중앙원점 좌표)
  const bg = objects.find((o) => o.id === 'idml-bg');
  assert.strictEqual(bg.meta.regionRef, null, '전폭 배경 regionRef=null 강등');
  assert.strictEqual(bg.meta.anchor.kind, 'canvas', '전폭 배경 canvas anchor');
  assert.ok(Math.abs(bg.meta.anchor.x) < 2 && Math.abs(bg.meta.anchor.y) < 2, `canvas anchor ≈ (0,0): (${bg.meta.anchor.x},${bg.meta.anchor.y})`);

  // 책등 폭 내 텍스트: 여전히 'spine' + region anchor(xNorm≈0.5)
  const spineText = objects.find((o) => o.id === 'idml-spineText');
  assert.strictEqual(spineText.meta.regionRef, 'spine', '책등 텍스트는 spine 유지');
  assert.strictEqual(spineText.meta.anchor.kind, 'region', '책등 텍스트 region anchor');
  assert.ok(Math.abs(spineText.meta.anchor.xNorm - 0.5) < 0.01, `xNorm≈0.5 (${spineText.meta.anchor.xNorm})`);

  // 책등 폭 약간 초과 rect: 강등
  const wide = objects.find((o) => o.id === 'idml-wide');
  assert.strictEqual(wide.meta.regionRef, null, '책등 폭 초과 rect 강등');
  assert.strictEqual(wide.meta.anchor.kind, 'canvas', '강등 시 canvas anchor');

  // 풀블리드 표지 배경: cover 판정 불변 (책등 가변 시 표지와 함께 이동해야 함)
  const fcbg = objects.find((o) => o.id === 'idml-fcbg');
  assert.strictEqual(fcbg.meta.regionRef, 'front-cover', '풀블리드 표지 배경은 front-cover 유지');
  assert.strictEqual(fcbg.meta.anchor.kind, 'region', '표지 배경 region anchor 유지');
});
