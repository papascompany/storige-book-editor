// 렌더 정합 불변식 — 미리보기(preview/svg)·래스터(raster/rasterize) 가 scene(중앙원점) 객체를
// content(좌상단 viewBox) 로 올바르게 환산하는지 '실제 SVG 출력 좌표'로 검증한다.
//
// 이 테스트의 목적: 2026-06-11 ③④ 회귀(svg.mjs/rasterize.mjs 가 중앙원점 보정을 빠뜨려 back-cover
// 객체가 viewBox 밖으로 클립되고 front 가 좌측으로 밀린 사고)를 구조적으로 재발 차단한다.
// 누군가 sceneToContent 환산을 제거하면 front 객체가 back region(또는 음수 x)으로 떨어져 즉시 실패.
import { test } from 'node:test';
import assert from 'node:assert';
import { toSpreadTemplate } from '../convert/toSpreadTemplate.mjs';
import { buildPreviewSvg } from './svg.mjs';
import { buildArtworkSvg } from '../raster/rasterize.mjs';

const mm2pt = (mm) => (mm * 72) / 25.4;

// 3페이지(날개없음) 430×297 표지. 앞표지(우측)=빨강, 뒤표지(좌측)=초록 식별용 rect.
function makeSpreadDto() {
  const h = mm2pt(297);
  const doc = {
    bleedPt: mm2pt(3),
    fonts: [],
    colors: new Map([
      ['Color/Red', { hex: '#ff0000', space: 'RGB' }],
      ['Color/Green', { hex: '#00ff00', space: 'RGB' }],
    ]),
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items: [
      // 앞표지(우측, 스프레드 x=+105mm) 한가운데 빨강 rect
      { self: 'fc', type: 'Rectangle', fillColor: 'Color/Red', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, bbox: { cx: mm2pt(105), cy: 0, w: mm2pt(40), h: mm2pt(40), pointCount: 4 } },
      // 뒤표지(좌측, 스프레드 x=−105mm) 한가운데 초록 rect
      { self: 'bc', type: 'Rectangle', fillColor: 'Color/Green', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, bbox: { cx: -mm2pt(105), cy: 0, w: mm2pt(40), h: mm2pt(40), pointCount: 4 } },
    ],
  };
  return toSpreadTemplate(doc).draftTemplateDto;
}

// SVG 문자열에서 특정 fill 의 <rect> 중심 x 추출(x + width/2).
function rectCenterX(svg, fill) {
  const re = new RegExp(`<rect[^>]*x="([\\-0-9.]+)"[^>]*width="([0-9.]+)"[^>]*fill="${fill}"`, 'i');
  const m = svg.match(re);
  if (!m) {
    // 속성 순서가 다를 수 있으니 fill 먼저인 패턴도 시도
    const re2 = new RegExp(`<rect[^>]*fill="${fill}"[^>]*`, 'i');
    const tag = svg.match(re2)?.[0] || '';
    const x = parseFloat(tag.match(/x="([\-0-9.]+)"/)?.[1]);
    const w = parseFloat(tag.match(/width="([0-9.]+)"/)?.[1]);
    return Number.isFinite(x) && Number.isFinite(w) ? x + w / 2 : NaN;
  }
  return parseFloat(m[1]) + parseFloat(m[2]) / 2;
}

test('미리보기: 앞표지 객체는 front region, 뒤표지 객체는 back region 픽셀 범위 안에 렌더', () => {
  const dto = makeSpreadDto();
  const cw = dto.canvasData.width;
  // scale=1 로 두어 SVG 좌표 = content px 직접 비교
  const svg = buildPreviewSvg(dto, { width: cw });
  const front = dto.spreadConfig.regions.find((r) => r.kind === 'front-cover');
  const back = dto.spreadConfig.regions.find((r) => r.kind === 'back-cover');

  const fcx = rectCenterX(svg, '#ff0000');
  const bcx = rectCenterX(svg, '#00ff00');

  assert.ok(Number.isFinite(fcx) && Number.isFinite(bcx), `rect 추출 실패: fcx=${fcx} bcx=${bcx}`);
  assert.ok(fcx >= front.x && fcx <= front.x + front.width, `앞표지 rect 가 front region[${front.x.toFixed(0)}..${(front.x + front.width).toFixed(0)}] 밖: ${fcx.toFixed(1)}`);
  assert.ok(bcx >= back.x && bcx <= back.x + back.width, `뒤표지 rect 가 back region[${back.x.toFixed(0)}..${(back.x + back.width).toFixed(0)}] 밖: ${bcx.toFixed(1)}`);
  // 음수 x(=화면 밖 클립) 가 절대 없어야 한다
  assert.ok(!/x="-/.test(svg.replace(/stroke-dasharray="[^"]*"/g, '')), '음수 x 렌더 객체 존재(viewBox 밖 클립 위험)');
});

test('래스터: 앞표지 객체는 content viewBox 의 우측 절반, 뒤표지는 좌측 절반', () => {
  const dto = makeSpreadDto();
  const W = dto.canvasData.width;
  const svg = buildArtworkSvg(dto); // viewBox = content px 직접
  const fcx = rectCenterX(svg, '#ff0000');
  const bcx = rectCenterX(svg, '#00ff00');
  assert.ok(Number.isFinite(fcx) && Number.isFinite(bcx), `rect 추출 실패: fcx=${fcx} bcx=${bcx}`);
  assert.ok(fcx > W / 2, `앞표지 rect 가 우측 절반(>${(W / 2).toFixed(0)})에 없음: ${fcx.toFixed(1)}`);
  assert.ok(bcx < W / 2, `뒤표지 rect 가 좌측 절반(<${(W / 2).toFixed(0)})에 없음: ${bcx.toFixed(1)}`);
  assert.ok(!/x="-/.test(svg), '음수 x 렌더 객체 존재(viewBox 밖 클립)');
});
