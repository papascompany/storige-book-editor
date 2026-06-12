// SVG 그라디언트 defs 공통 헬퍼 + 두 빌더(raster/preview) 통합 + FLAT 래스터 픽셀 검증 (A1).
import { test } from 'node:test';
import assert from 'node:assert';
import { isGradientFill, svgGradientFor } from './svgGradient.mjs';
import { toSpreadTemplate } from '../convert/toSpreadTemplate.mjs';
import { buildPreviewSvg } from '../preview/svg.mjs';
import { buildArtworkSvg, rasterizeArtwork } from '../raster/rasterize.mjs';

const mm2pt = (mm) => (mm * 72) / 25.4;

test('isGradientFill: colorStops 배열 보유 객체만 참(단색 hex/빈 문자열 거짓)', () => {
  assert.ok(isGradientFill({ type: 'linear', coords: {}, colorStops: [] }));
  assert.ok(!isGradientFill('#ff0000'));
  assert.ok(!isGradientFill(''));
  assert.ok(!isGradientFill(null));
  assert.ok(!isGradientFill({ type: 'linear' }));
});

test('svgGradientFor: objectBoundingBox 정규화 + id sanitize + radial', () => {
  const lin = svgGradientFor(
    { type: 'linear', coords: { x1: 0, y1: 50, x2: 100, y2: 50 }, colorStops: [{ offset: 0, color: '#6633ff' }, { offset: 1, color: '#80e6e6' }] },
    { id: 'idml-u1 한글<id>', width: 100, height: 100 }
  );
  assert.match(lin.def, /^<linearGradient id="grad-idml-u1[_]+id[_]?" gradientUnits="objectBoundingBox" x1="0" y1="0\.5" x2="1" y2="0\.5">/);
  assert.ok(lin.def.includes('<stop offset="0%" stop-color="#6633ff"/>'));
  assert.ok(lin.def.includes('<stop offset="100%" stop-color="#80e6e6"/>'));
  assert.strictEqual(lin.ref, `url(#${lin.id})`);
  assert.ok(!/[^A-Za-z0-9_#()url\-=".<>%/ ]/.test(lin.ref), 'ref 에 비ASCII 없음');

  const rad = svgGradientFor(
    { type: 'radial', coords: { x1: 50, y1: 50, x2: 50, y2: 50, r1: 0, r2: 50 }, colorStops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] },
    { id: 'r', width: 100, height: 100 }
  );
  assert.match(rad.def, /^<radialGradient id="grad-r" gradientUnits="objectBoundingBox" cx="0\.5" cy="0\.5" r="0\.5">/);
});

test('svgGradientFor: flipY — 정규화 y 를 1−y 반전(linear y1/y2, radial cy)', () => {
  const fill = {
    type: 'linear',
    coords: { x1: 50, y1: 0, x2: 50, y2: 100 },
    colorStops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }],
  };
  const plain = svgGradientFor(fill, { id: 'f', width: 100, height: 100 });
  assert.match(plain.def, /x1="0\.5" y1="0" x2="0\.5" y2="1"/, '비플립: 위→아래');
  const flipped = svgGradientFor(fill, { id: 'f', width: 100, height: 100, flipY: true });
  assert.match(flipped.def, /x1="0\.5" y1="1" x2="0\.5" y2="0"/, '플립: 아래→위(fabric flipY 외관 일치)');

  const rad = svgGradientFor(
    { type: 'radial', coords: { x1: 50, y1: 25, x2: 50, y2: 25, r1: 0, r2: 50 }, colorStops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] },
    { id: 'r', width: 100, height: 100, flipY: true }
  );
  assert.match(rad.def, /cx="0\.5" cy="0\.75" r="0\.5"/, 'radial: cy 1−y 반전');
});

test('svgGradientFor: 스톱 opacity != null 이면 stop-opacity 출력(미지정은 생략)', () => {
  const { def } = svgGradientFor(
    {
      type: 'linear',
      coords: { x1: 0, y1: 0, x2: 100, y2: 0 },
      colorStops: [{ offset: 0, color: '#ff0000', opacity: 0.5 }, { offset: 1, color: '#0000ff' }],
    },
    { id: 'o', width: 100, height: 100 }
  );
  assert.ok(def.includes('<stop offset="0%" stop-color="#ff0000" stop-opacity="0.5"/>'), `opacity 스톱: ${def}`);
  assert.ok(def.includes('<stop offset="100%" stop-color="#0000ff"/>'), '미지정 스톱은 stop-opacity 생략');
});

// 그라디언트 rect 2개를 가진 spread doc(중앙원점 규약은 toSpreadTemplate 이 보장)
function makeGradientDto() {
  const h = mm2pt(297);
  const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const gradients = new Map([
    ['Gradient/G1', {
      self: 'Gradient/G1', type: 'linear', name: 'G1',
      stops: [
        { offset: 0, color: '#6633ff', cmyk: [60, 80, 0, 0], midpoint: 50 },
        { offset: 1, color: '#80e6e6', cmyk: [50, 10, 10, 0], midpoint: 50 },
      ],
    }],
    ['Gradient/G2', {
      self: 'Gradient/G2', type: 'linear', name: 'G2',
      stops: [{ offset: 0, color: '#e63305', midpoint: 50 }, { offset: 1, color: '#ffffff', midpoint: 50 }],
    }],
  ]);
  const doc = {
    bleedPt: mm2pt(3),
    fonts: [],
    colors: new Map(),
    gradients,
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items: [
      // 앞표지(+110mm) 중앙 — 좌→우 G1 (로컬 좌중앙 시작, 길이 = 폭 100pt)
      { self: 'g1', type: 'Rectangle', fillColor: 'Gradient/G1', transform: { ...I, e: mm2pt(110) - 50, f: 0 }, bbox: { minX: 0, minY: -50, maxX: 100, maxY: 50, cx: 50, cy: 0, w: 100, h: 100, pointCount: 4 }, gradientFill: { start: [0, 0], length: 100, angle: 0 } },
      // 뒤표지(−110mm) 중앙 — G2
      { self: 'g2', type: 'Rectangle', fillColor: 'Gradient/G2', transform: { ...I, e: -mm2pt(110) - 50, f: 0 }, bbox: { minX: 0, minY: -50, maxX: 100, maxY: 50, cx: 50, cy: 0, w: 100, h: 100, pointCount: 4 }, gradientFill: { start: [0, 0], length: 100, angle: 0 } },
    ],
  };
  return toSpreadTemplate(doc).draftTemplateDto;
}

test('두 빌더 공통: defs(linearGradient) + url(#) 참조 + 객체별 id 유일(self 기반)', () => {
  const dto = makeGradientDto();
  const raster = buildArtworkSvg(dto);
  const preview = buildPreviewSvg(dto, { width: dto.canvasData.width });

  for (const [name, svg] of [['raster', raster], ['preview', preview]]) {
    const ids = [...svg.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(ids.sort(), ['grad-idml-g1', 'grad-idml-g2'], `${name}: 객체 self 기반 id 2건`);
    assert.ok(svg.includes('fill="url(#grad-idml-g1)"'), `${name}: G1 url 참조`);
    assert.ok(svg.includes('fill="url(#grad-idml-g2)"'), `${name}: G2 url 참조`);
    assert.ok(svg.includes('stop-color="#6633ff"') && svg.includes('stop-color="#80e6e6"'), `${name}: 스톱 색`);
    assert.ok(!svg.includes('[object Object]'), `${name}: 객체 fill 문자열화 오염 없음`);
  }
});

test('FLAT 래스터: 그라디언트가 실제 픽셀로 렌더(좌→우 색 전이 — sharp 샘플링)', async () => {
  const dto = makeGradientDto();
  const dpi = 30; // 테스트 속도용 저해상도(공식은 dpi 무관)
  const { dataUrl, widthPx, heightPx } = await rasterizeArtwork(dto, { dpi });
  const sharp = (await import('sharp')).default;
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.strictEqual(info.width, widthPx);

  const pxMm = (mm) => Math.round((mm / 25.4) * dpi);
  const sample = (xMm, yMm) => {
    const i = (Math.min(pxMm(yMm), heightPx - 1) * info.width + Math.min(pxMm(xMm), widthPx - 1)) * info.channels;
    return [data[i], data[i + 1], data[i + 2], info.channels > 3 ? data[i + 3] : 255];
  };

  // G1 rect: content x ∈ [325−17.64, 325+17.64]mm, y 중앙 148.5mm.
  const rectHalfMm = (50 / 72) * 25.4; // 50pt
  const left = sample(325 - rectHalfMm * 0.8, 148.5); // 시작(보라 #6633ff) 근방
  const right = sample(325 + rectHalfMm * 0.8, 148.5); // 끝(하늘 #80e6e6) 근방
  assert.ok(left[3] > 200, `좌측 불투명(${left})`);
  assert.ok(right[3] > 200, `우측 불투명(${right})`);
  // green 채널 51→230 단조 증가가 식별 신호(blue 는 양끝 모두 높음)
  assert.ok(left[1] < 120, `좌측 G≈51(보라): ${left}`);
  assert.ok(right[1] > 170, `우측 G≈230(하늘): ${right}`);
  assert.ok(right[1] - left[1] > 60, `좌→우 색 전이 존재: ${left} → ${right}`);
  // 양끝 모두 파랑 계열(B 높음) — 그라디언트 색상군 확인
  assert.ok(left[2] > 180 && right[2] > 180, `B 채널 높음: ${left} / ${right}`);
});
