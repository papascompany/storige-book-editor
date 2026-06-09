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
