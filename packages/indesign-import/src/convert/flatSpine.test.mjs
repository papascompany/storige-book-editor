// flat-spine 모드 테스트.
// 1) 크롭 지오메트리(순수 함수): 경계 px 합산 = 전폭, spine 3배폭, 중심 정렬, 반올림 일관성.
// 2) convertIdmlToTemplate(mode='flat-spine') 통합: 객체 구성/z-order/anchor/잠금/스탬프.
//    (Node 래스터는 sharp 사용 — devDependency. 픽셀 공식: px = Math.round(mm/25.4*300).)
import { test } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFlatSpineCrops } from './flatSpineGeometry.mjs';
import { ARTWORK_LOCK } from './artworkLock.mjs';
import { convertIdmlToTemplate } from '../index.mjs';
import { mmToPx } from '../geometry/units.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureIdml = resolve(__dirname, '../../fixtures/cover-sample.idml');

// MA-348/LA-383 실측 사양: 210×297mm 표지 + 10mm 책등, 총폭 430mm.
const SPEC_430 = {
  coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 10,
  wingEnabled: false, wingWidthMm: 0, cutSizeMm: 3, safeSizeMm: 3,
};

// ─── 크롭 지오메트리 (순수 함수) ───

test('flat-spine 크롭: 430mm 사양 실측치(전폭 5079×3508, spine 밴드 118px, spine 크롭 354px)', () => {
  const c = computeFlatSpineCrops(SPEC_430, { dpi: 300 });
  assert.strictEqual(c.fullWidthPx, 5079, '전폭 = round(430/25.4*300)');
  assert.strictEqual(c.fullHeightPx, 3508, '전고 = round(297/25.4*300)');
  assert.strictEqual(c.spineLeftPx, 2480, 'spine 좌경계 = round(210mm)');
  assert.strictEqual(c.spineRightPx, 2598, 'spine 우경계 = round(220mm)');
  assert.strictEqual(c.spineRightPx - c.spineLeftPx, 118, 'spine 밴드 = 118px@300dpi');
  assert.strictEqual(c.spine.width, 354, 'spine 크롭 = 3배폭 354px (round(30mm))');
  // 중심 정렬: 크롭 중심 ≈ 책등 중심(215mm = 2539.37px), 반올림 1px 이내
  const cropCenter = c.spine.left + c.spine.width / 2;
  assert.ok(Math.abs(cropCenter - (215 / 25.4) * 300) <= 1, `spine 크롭 중심(${cropCenter}) ≈ 책등 중심`);
});

test('flat-spine 크롭: back+spine밴드+front 폭 합 = 전폭 (경계 반올림 일관성)', () => {
  // 0.1mm 단위의 까다로운 사양들로 반올림 누적 오차가 없는지 검증
  const specs = [
    SPEC_430,
    { ...SPEC_430, spineWidthMm: 7.3, coverWidthMm: 148.5, coverHeightMm: 210 },
    { ...SPEC_430, spineWidthMm: 23.7, coverWidthMm: 188.2 },
    { ...SPEC_430, wingEnabled: true, wingWidthMm: 90.4 },
  ];
  for (const spec of specs) {
    const c = computeFlatSpineCrops(spec, { dpi: 300 });
    const bandWidth = c.spineRightPx - c.spineLeftPx;
    assert.strictEqual(
      c.back.width + bandWidth + c.front.width,
      c.fullWidthPx,
      `폭 합산 = 전폭 (spine=${spec.spineWidthMm}mm, wing=${spec.wingEnabled})`
    );
    assert.strictEqual(c.back.left, 0, 'back 은 좌단(0)부터');
    assert.strictEqual(c.front.left, c.spineRightPx, 'front 는 spine 우경계부터');
    assert.strictEqual(c.front.left + c.front.width, c.fullWidthPx, 'front 는 우단까지');
    // spine 크롭은 캔버스 안에 들어야 sharp.extract 가 가능
    assert.ok(c.spine.left >= 0 && c.spine.left + c.spine.width <= c.fullWidthPx, 'spine 크롭 ⊂ 캔버스');
  }
});

test('flat-spine 크롭: 날개 사양에서도 spine 크롭은 책등 중심 3배폭', () => {
  const spec = { ...SPEC_430, wingEnabled: true, wingWidthMm: 90 };
  const c = computeFlatSpineCrops(spec, { dpi: 300 });
  // 책등 중심 = 90+210+5 = 305mm
  const expectCenter = (305 / 25.4) * 300;
  assert.strictEqual(c.spine.width, Math.round((30 / 25.4) * 300), '3배폭');
  assert.ok(Math.abs(c.spine.left + c.spine.width / 2 - expectCenter) <= 1, '책등 중심 정렬');
});

test('flat-spine 크롭: 책등 폭 0/누락이면 명시적 에러', () => {
  assert.throws(() => computeFlatSpineCrops({ ...SPEC_430, spineWidthMm: 0 }), /spine/);
});

// ─── convertIdmlToTemplate 통합 (실제 래스터: sharp) ───

async function convertFixture(mode) {
  const buf = await readFile(fixtureIdml);
  return convertIdmlToTemplate(buf, { mode, name: 'flat-spine test' });
}

test('flat-spine: 객체 구성과 z-order = [spine, back, front, ...textbox]', async () => {
  const { dto } = await convertFixture('flat-spine');
  const objs = dto.canvasData.objects;
  assert.strictEqual(objs[0].id, 'spine-artwork', 'z 최하단 = spine-artwork');
  assert.strictEqual(objs[1].id, 'back-artwork');
  assert.strictEqual(objs[2].id, 'front-artwork');
  for (const o of objs.slice(3)) assert.strictEqual(o.type, 'textbox', '아트워크 위는 텍스트 오버레이만');
  assert.ok(objs.slice(3).length > 0, '텍스트 오버레이 존재');
  for (const o of objs.slice(0, 3)) {
    assert.strictEqual(o.type, 'image');
    assert.ok(o.src.startsWith('data:image/png;base64,'), `${o.id} PNG dataUrl`);
    assert.strictEqual(o.clipPath, undefined, 'clipPath 사용 금지(직렬화 유실)');
  }
});

test('flat-spine: spine-artwork 는 크롭 중심 유도 left(≈0) + content 중앙 canvas anchor + 3배폭(150dpi 환산 일치)', async () => {
  const { dto } = await convertFixture('flat-spine');
  const spine = dto.canvasData.objects.find((o) => o.id === 'spine-artwork');
  // left 는 가정값 0 이 아니라 실제 크롭 중심(crops.spine.centerPx)에서 유도 —
  // 대칭 레이아웃에서는 scene x≈0 (크롭 반올림/클램프로 1px@300dpi ≈ 0.5px@150dpi 이내 오프셋 허용)
  assert.ok(Math.abs(spine.left) <= 0.5, `spine left(${spine.left}) ≈ 0 (크롭 중심 유도, 반올림 허용)`);
  assert.strictEqual(spine.top, 0);
  assert.strictEqual(spine.originX, 'center');
  assert.strictEqual(spine.originY, 'center');
  // canvas anchor 는 content 좌표 규약: 콘텐츠 중앙 = (W/2, H/2) (= scene 0,0)
  assert.deepStrictEqual(spine.meta.anchor, {
    kind: 'canvas',
    x: dto.canvasData.width / 2,
    y: dto.canvasData.height / 2,
  });
  assert.strictEqual(spine.meta.regionRef, null);
  assert.strictEqual(spine.meta.flatArtwork, 'spine');
  // 표시폭(width×scaleX) ≈ 3×spineWidth @150dpi (반올림 1px 허용)
  const shown = spine.width * spine.scaleX;
  const expect150 = mmToPx(10 * 3, 150);
  assert.ok(Math.abs(shown - expect150) <= 1, `spine 표시폭(${shown}) ≈ 3배폭@150dpi(${expect150})`);
  assert.strictEqual(spine.width, 354, 'spine PNG 원본폭 = 354px@300dpi');
  assert.ok(Math.abs(spine.scaleX - 0.5) < 0.001, 'scale ≈ 0.5 (300→150dpi)');
});

test('flat-spine: back/front-artwork 는 region anchor + 표지 영역 참조', async () => {
  const { dto } = await convertFixture('flat-spine');
  const back = dto.canvasData.objects.find((o) => o.id === 'back-artwork');
  const front = dto.canvasData.objects.find((o) => o.id === 'front-artwork');
  assert.strictEqual(back.meta.regionRef, 'back-cover');
  assert.strictEqual(front.meta.regionRef, 'front-cover');
  assert.strictEqual(back.meta.flatArtwork, 'back');
  assert.strictEqual(front.meta.flatArtwork, 'front');
  for (const o of [back, front]) {
    assert.strictEqual(o.meta.anchor.kind, 'region');
    assert.ok(o.meta.anchor.xNorm > 0 && o.meta.anchor.xNorm < 1, `${o.id} xNorm(${o.meta.anchor.xNorm}) ∈ (0,1)`);
    assert.strictEqual(o.meta.anchor.yNorm, 0.5, '세로 전체 크롭 → yNorm=0.5');
  }
  // 날개 없는 대칭 사양: back/front 중심은 좌우 대칭(±), back<0<front
  assert.ok(back.left < 0 && front.left > 0, `back(${back.left}) < 0 < front(${front.left})`);
  assert.ok(Math.abs(back.left + front.left) < 1, '좌우 대칭');
  // 두 크롭 폭 합 + spine 밴드 = 전폭(150dpi 환산, 스케일 적용)
  const cw = dto.canvasData.width;
  const shownSum = back.width * back.scaleX + front.width * front.scaleX + 118 * back.scaleX;
  assert.ok(Math.abs(shownSum - cw) < 1.5, `3분할 표시폭 합(${shownSum}) ≈ 캔버스폭(${cw})`);
});

test('flat-spine: 아트워크 3장 모두 ARTWORK_LOCK 전 속성 적용', async () => {
  const { dto } = await convertFixture('flat-spine');
  for (const id of ['spine-artwork', 'back-artwork', 'front-artwork']) {
    const o = dto.canvasData.objects.find((x) => x.id === id);
    for (const [k, v] of Object.entries(ARTWORK_LOCK)) {
      assert.deepStrictEqual(o[k], v, `${id}.${k}`);
    }
    assert.strictEqual(o.isUserAdded, false, `${id}.isUserAdded`);
  }
});

test('flat-spine: 텍스트 오버레이는 styles:{} 유지(fabric 5.5 저장 크래시 방어)', async () => {
  const { dto } = await convertFixture('flat-spine');
  const texts = dto.canvasData.objects.filter((o) => o.type === 'textbox');
  assert.ok(texts.length > 0);
  for (const t of texts) {
    assert.ok(t.styles && typeof t.styles === 'object', `${t.id} styles 존재`);
  }
});

test('flat-spine: PNG 3장 흰 배경 합성(알파 제거 = 불투명 보장)', async () => {
  const { dto } = await convertFixture('flat-spine');
  const sharp = (await import('sharp')).default;
  for (const id of ['spine-artwork', 'back-artwork', 'front-artwork']) {
    const o = dto.canvasData.objects.find((x) => x.id === id);
    const buf = Buffer.from(o.src.replace(/^data:image\/png;base64,/, ''), 'base64');
    const meta = await sharp(buf).metadata();
    assert.strictEqual(meta.hasAlpha, false, `${id} 알파 없음(흰 배경 flatten)`);
    assert.strictEqual(meta.height, 3508, `${id} 높이 = 전고`);
  }
});

test('conversionMode 스탬프: vector=full / hybrid=flat-spread / flat-spine=flat-spine', async () => {
  const vector = await convertFixture('vector');
  assert.strictEqual(vector.dto.spreadConfig.conversionMode, 'full');
  // vector 객체 구성 불변(아트워크 합성 없음)
  assert.ok(!vector.dto.canvasData.objects.some((o) => /artwork/.test(o.id || '')), 'vector 에 artwork 없음');

  const hybrid = await convertFixture('hybrid');
  assert.strictEqual(hybrid.dto.spreadConfig.conversionMode, 'flat-spread');
  assert.strictEqual(hybrid.dto.canvasData.objects[0].id, 'idml-artwork', 'hybrid 기존 동작 불변');

  const flat = await convertFixture('flat-spine');
  assert.strictEqual(flat.dto.spreadConfig.conversionMode, 'flat-spine');
  // 스탬프 외 spreadConfig 필드 보존
  assert.strictEqual(flat.dto.spreadConfig.totalWidthMm, 430);
  assert.strictEqual(flat.dto.spreadConfig.version, 1);
});
