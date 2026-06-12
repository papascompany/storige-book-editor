// A6 — 코너 반경(rect rx/ry) + 스트로크 위생/패리티 테스트.
//
// 실측(MA-348/LA-383, 2026-06-12) 근거:
//  - 라운드 코너 = Rectangle 4건, 전부 균일(per-corner 4값 == legacy CornerOption/CornerRadius).
//  - LA u79c 는 반경(31.18pt) > 높이/2 인 pill — SVG/fabric 양쪽 렌더 클램프로 외형 보존(비클램프 직렬화).
//  - 가시 스트로크 0건: weight>0 ∧ color=None 89건은 비가시가 정답 → strokeWidth 고아 직렬화 금지.
//  - dash/cap/join/alignment 실표본 0건 → 매핑 보류(파싱+경고만).
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { parseIdml } from '../idml/reader.mjs';
import { toSpreadTemplate } from './toSpreadTemplate.mjs';
import { buildArtworkSvg } from '../raster/rasterize.mjs';
import { buildPreviewSvg } from '../preview/svg.mjs';

const mm2pt = (mm) => (mm * 72) / 25.4;
const K = 150 / 72; // pt → px@150dpi
const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// ── 합성 IDML(zip): 3페이지(210/10/210 × 297mm) + 앞표지 중앙 100×50pt 사각형 ──
async function makeIdml(rectAttrs = '', { tag = 'Rectangle' } = {}) {
  const h = mm2pt(297);
  const rectTx = mm2pt(110 + 215) - 50; // 앞표지 중앙(+110mm) − 로컬 cx(50)
  const spreadXml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.4">
  <Spread Self="us1">
    <Page Self="p1" Name="1" GeometricBounds="0 0 ${h} ${mm2pt(210)}" ItemTransform="1 0 0 1 ${-mm2pt(215)} ${-h / 2}"/>
    <Page Self="p2" Name="2" GeometricBounds="0 0 ${h} ${mm2pt(10)}" ItemTransform="1 0 0 1 ${-mm2pt(5)} ${-h / 2}"/>
    <Page Self="p3" Name="3" GeometricBounds="0 0 ${h} ${mm2pt(210)}" ItemTransform="1 0 0 1 ${mm2pt(5)} ${-h / 2}"/>
    <${tag} Self="r1" FillColor="Color/Blue" ItemTransform="1 0 0 1 ${rectTx - mm2pt(215)} 0" ${rectAttrs}>
      <Properties>
        <PathGeometry>
          <GeometryPathType PathOpen="false">
            <PathPointArray>
              <PathPointType Anchor="0 -25"/>
              <PathPointType Anchor="100 -25"/>
              <PathPointType Anchor="100 25"/>
              <PathPointType Anchor="0 25"/>
            </PathPointArray>
          </GeometryPathType>
        </PathGeometry>
      </Properties>
    </${tag}>
  </Spread>
</idPkg:Spread>`;
  const graphicXml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.4">
  <Color Self="Color/Blue" Model="Process" Space="RGB" ColorValue="0 0 255" Name="Blue"/>
  <Color Self="Color/Red" Model="Process" Space="RGB" ColorValue="255 0 0" Name="Red"/>
</idPkg:Graphic>`;
  const zip = new JSZip();
  zip.file('Spreads/Spread_us1.xml', spreadXml);
  zip.file('Resources/Graphic.xml', graphicXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// MA u5c3 실측 형태: per-corner 4값 + legacy 동시 기록, 값 동일(균일)
const UNIFORM_12 =
  'TopLeftCornerOption="RoundedCorner" TopRightCornerOption="RoundedCorner" ' +
  'BottomLeftCornerOption="RoundedCorner" BottomRightCornerOption="RoundedCorner" ' +
  'TopLeftCornerRadius="12.047" TopRightCornerRadius="12.047" ' +
  'BottomLeftCornerRadius="12.047" BottomRightCornerRadius="12.047" ' +
  'CornerOption="RoundedCorner" CornerRadius="12.047"';

test('파싱: per-corner + legacy 동시 기록(실측 형태) → corner{uniform, radiusPt} 추출', async () => {
  const doc = await parseIdml(await makeIdml(UNIFORM_12));
  const it = doc.items.find((i) => i.self === 'r1');
  assert.ok(it.corner, 'corner 추출');
  assert.strictEqual(it.corner.uniform, true);
  assert.strictEqual(it.corner.radiusPt, 12.047);
  assert.deepStrictEqual(it.corner.radiiPt, [12.047, 12.047, 12.047, 12.047]);
  assert.deepStrictEqual(it.corner.options, ['RoundedCorner']);
});

test('파싱: legacy CornerOption/CornerRadius 단독도 동일 추출(구버전 IDML 대비)', async () => {
  const doc = await parseIdml(await makeIdml('CornerOption="RoundedCorner" CornerRadius="6.126"'));
  const it = doc.items.find((i) => i.self === 'r1');
  assert.strictEqual(it.corner.uniform, true);
  assert.strictEqual(it.corner.radiusPt, 6.126);
});

test('파싱: 코너 attr 없음 / CornerOption="None" → corner 키 자체 없음(잔존 기본값 오염 금지)', async () => {
  const d1 = await parseIdml(await makeIdml(''));
  assert.strictEqual(d1.items.find((i) => i.self === 'r1').corner, undefined);
  // None + 기본 반경(12.7pt) 잔존 케이스 — 적용으로 오판하면 안 됨
  const d2 = await parseIdml(await makeIdml('CornerOption="None" CornerRadius="12.7"'));
  assert.strictEqual(d2.items.find((i) => i.self === 'r1').corner, undefined);
});

test('매핑: 균일 RoundedCorner → rect rx/ry = radiusPt×K, 경고 없음', async () => {
  const doc = await parseIdml(await makeIdml(UNIFORM_12));
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.type, 'rect');
  assert.ok(Math.abs(o.rx - 12.047 * K) < 0.01, `rx≈${(12.047 * K).toFixed(2)} (${o.rx})`);
  assert.strictEqual(o.rx, o.ry, '균일 → rx=ry');
  assert.ok(!warnings.some((w) => w.includes('코너')), `코너 경고 없음: ${warnings}`);
});

test('매핑(pill, LA u79c 실측): 반경>변/2 비클램프 직렬화 — 렌더 클램프로 외형 보존', async () => {
  // 100×50pt 사각형 + 반경 31.181pt (> 높이/2=25pt) — LA u79c 의 pill 형상 축소판
  const doc = await parseIdml(
    await makeIdml('CornerOption="RoundedCorner" CornerRadius="31.181102362204726"')
  );
  const { objects } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.ok(Math.abs(o.rx - 31.181102362204726 * K) < 0.01, `rx 비클램프 (${o.rx})`);
  assert.ok(o.rx > o.height / 2, 'pill: rx > height/2 유지(클램프는 렌더 단계)');
});

test('매핑: 스케일 베이크(2x) → rx 가 |scaleX| 따라감, ry 는 |scaleY|', async () => {
  // 변환행렬에 스케일을 직접 박을 수 없는 makeIdml 구조라 doc 을 직접 구성
  const h = mm2pt(297);
  const doc = {
    bleedPt: mm2pt(3), fonts: [], colors: new Map([['Color/Blue', { hex: '#0000ff', space: 'RGB' }]]),
    gradients: new Map(),
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items: [{
      self: 'sc', type: 'Rectangle', fillColor: 'Color/Blue',
      transform: { a: 2, b: 0, c: 0, d: 1, e: mm2pt(105), f: 0 },
      bbox: { cx: 0, cy: 0, w: 100, h: 50, pointCount: 4 },
      corner: { options: ['RoundedCorner'], radiusPt: 10, radiiPt: [10, 10, 10, 10], uniform: true },
    }],
  };
  const { objects } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-sc');
  assert.ok(Math.abs(o.rx - 20 * K) < 0.01, `rx = 10pt×2×K (${o.rx})`);
  assert.ok(Math.abs(o.ry - 10 * K) < 0.01, `ry = 10pt×1×K (${o.ry})`);
});

test('매핑: 비균일 반경(실측 0건) → 경고 + 최대값 균일 폴백', async () => {
  const attrs =
    'TopLeftCornerOption="RoundedCorner" TopRightCornerOption="RoundedCorner" ' +
    'BottomLeftCornerOption="RoundedCorner" BottomRightCornerOption="RoundedCorner" ' +
    'TopLeftCornerRadius="4" TopRightCornerRadius="8" BottomLeftCornerRadius="4" BottomRightCornerRadius="8"';
  const doc = await parseIdml(await makeIdml(attrs));
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.ok(Math.abs(o.rx - 8 * K) < 0.01, `최대값(8pt) 폴백 (${o.rx})`);
  assert.ok(warnings.some((w) => w.includes('코너 반경(r1)') && w.includes('비대칭')), `비균일 경고: ${warnings}`);
});

test('매핑: RoundedCorner 외 유형(실측 0건) → rx 미적용 + 경고(직각 근사)', async () => {
  const doc = await parseIdml(await makeIdml('CornerOption="BevelCorner" CornerRadius="10"'));
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.rx, undefined, 'Bevel 은 rx 미적용');
  assert.ok(warnings.some((w) => w.includes('코너 유형(r1)') && w.includes('BevelCorner')), `유형 경고: ${warnings}`);
});

test('매핑: 비-Rectangle(Oval) 코너(실측 0건) → 타원 rx/ry(527b85b) 불변 + 무시 경고', async () => {
  const doc = await parseIdml(
    await makeIdml('CornerOption="RoundedCorner" CornerRadius="10"', { tag: 'Oval' })
  );
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.type, 'ellipse');
  // Oval 의 rx/ry 는 코너가 아니라 타원 반경(width/2, height/2) — 기존 처리 불변
  assert.ok(Math.abs(o.rx - o.width / 2) < 0.01, `타원 rx=width/2 (${o.rx} vs ${o.width / 2})`);
  assert.ok(Math.abs(o.ry - o.height / 2) < 0.01, `타원 ry=height/2 (${o.ry})`);
  assert.ok(warnings.some((w) => w.includes('코너 반경(r1)') && w.includes('Oval')), `무시 경고: ${warnings}`);
});

// ── 스트로크 위생 + 보류 항목 경고 ──

test('strokeWidth 고아 정리: weight>0 ∧ color=None(실측 89건 패턴) → stroke/strokeWidth 모두 미직렬화', async () => {
  const doc = await parseIdml(await makeIdml('StrokeWeight="1" StrokeColor="Swatch/None"'));
  const o = toSpreadTemplate(doc).objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.stroke, undefined, 'stroke 없음');
  assert.strictEqual(o.strokeWidth, undefined, 'strokeWidth 고아 직렬화 금지');
});

test('가시 스트로크(weight>0 ∧ color≠None): stroke+strokeWidth 기존 동작 유지', async () => {
  const doc = await parseIdml(await makeIdml('StrokeWeight="2" StrokeColor="Color/Red"'));
  const o = toSpreadTemplate(doc).objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.stroke, '#ff0000');
  assert.ok(Math.abs(o.strokeWidth - 2 * K) < 0.01, `strokeWidth=2pt×K (${o.strokeWidth})`);
});

test('특수 스트로크(dash/cap/join/alignment, 실측 0건): 매핑 보류 — 가시 스트로크에서만 경고', async () => {
  const attrs =
    'StrokeWeight="2" StrokeColor="Color/Red" StrokeType="StrokeStyle/$ID/Dashed" ' +
    'EndCap="RoundEndCap" EndJoin="RoundEndJoin" StrokeAlignment="InsideAlignment"';
  const doc = await parseIdml(await makeIdml(attrs));
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  // 매핑 보류 — fabric 키 미출력(과잉 구현 금지)
  assert.strictEqual(o.strokeDashArray, undefined);
  assert.strictEqual(o.strokeLineCap, undefined);
  assert.strictEqual(o.strokeLineJoin, undefined);
  for (const kw of ['특수 선 유형', '끝모양', '모서리 접합', '선 정렬']) {
    assert.ok(warnings.some((w) => w.includes('스트로크(r1)') && w.includes(kw)), `${kw} 경고: ${warnings}`);
  }
  // Solid + 기본값이면 경고 없음
  const doc2 = await parseIdml(
    await makeIdml('StrokeWeight="2" StrokeColor="Color/Red" StrokeType="StrokeStyle/$ID/Solid"')
  );
  assert.ok(!toSpreadTemplate(doc2).warnings.some((w) => w.includes('스트로크(r1)')), 'Solid 는 경고 없음');
  // 비가시(None) 스트로크의 특수 속성은 무의미 — 경고 노이즈 금지
  const doc3 = await parseIdml(
    await makeIdml('StrokeWeight="1" StrokeColor="Swatch/None" EndCap="RoundEndCap"')
  );
  assert.ok(!toSpreadTemplate(doc3).warnings.some((w) => w.includes('스트로크(r1)')), '비가시는 경고 없음');
});

// ── FLAT 패리티(래스터/미리보기 SVG) — 규칙: FULL/FLAT 동일 충실도 ──

test('FLAT 패리티: rect rx/ry 가 래스터(buildArtworkSvg)와 미리보기(buildPreviewSvg) 양쪽에 출력', async () => {
  const doc = await parseIdml(await makeIdml(UNIFORM_12 + ' StrokeWeight="2" StrokeColor="Color/Red"'));
  const { draftTemplateDto: dto, objects } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');

  // 래스터: viewBox=content px 직접 — rx 원값
  const art = buildArtworkSvg(dto);
  const artRect = art.match(/<rect [^>]*rx="[^"]*"[^>]*\/>/)?.[0];
  assert.ok(artRect, `래스터 rect rx 출력: ${art.split('\n').find((l) => l.includes('<rect'))}`);
  assert.ok(artRect.includes(`rx="${o.rx}"`) && artRect.includes(`ry="${o.ry}"`), `래스터 rx/ry 원값 (${artRect})`);
  assert.ok(artRect.includes('stroke="#ff0000"'), `래스터 rect 스트로크 (${artRect})`);

  // 미리보기: 출력 스케일 s 반영
  const w = dto.canvasData.width;
  const scale = 1100 / w;
  const prev = buildPreviewSvg(dto);
  const prevRect = prev.match(/<rect [^>]*rx="[^"]*"[^>]*\/>/)?.[0];
  assert.ok(prevRect, '미리보기 rect rx 출력');
  const rxOut = parseFloat(prevRect.match(/ rx="([0-9.]+)"/)[1]);
  assert.ok(Math.abs(rxOut - o.rx * scale) < 0.01, `미리보기 rx 스케일 반영 (${rxOut} ≈ ${o.rx * scale})`);
  assert.ok(prevRect.includes('stroke="#ff0000"'), `미리보기 rect 스트로크 패리티 (${prevRect})`);
});

test('FLAT 패리티: ellipse 스트로크 — 미리보기도 래스터와 동일 적용(종전 path 만 적용 갭 해소)', async () => {
  const doc = await parseIdml(
    await makeIdml('StrokeWeight="2" StrokeColor="Color/Red"', { tag: 'Oval' })
  );
  const { draftTemplateDto: dto } = toSpreadTemplate(doc);
  const art = buildArtworkSvg(dto);
  const prev = buildPreviewSvg(dto);
  assert.match(art, /<ellipse [^>]*stroke="#ff0000"/, '래스터 ellipse 스트로크(기존)');
  assert.match(prev, /<ellipse [^>]*stroke="#ff0000"/, '미리보기 ellipse 스트로크(신규 패리티)');
});

test('FLAT: 코너 없는 rect 는 rx attr 미출력(기존 출력 불변)', async () => {
  const doc = await parseIdml(await makeIdml(''));
  const { draftTemplateDto: dto } = toSpreadTemplate(doc);
  assert.ok(!/<rect [^>]* rx=/.test(buildArtworkSvg(dto)), '래스터 rx 없음');
  // 미리보기 배경/가이드 rect 에도 rx 없어야 함
  assert.ok(!/<rect [^>]* rx=/.test(buildPreviewSvg(dto)), '미리보기 rx 없음');
});

// ── fabric 5.5 직렬화 왕복(dist 검증) — canvas-core 의 실제 fabric dist 로 검증 ──
// rx/ry 는 fabric Rect 의 native 키(toObject 상시 직렬화)라 canvas-core 화이트리스트 불필요.
// fabric 로드는 workspace 설치 상태에 의존하므로 미설치 환경에서는 skip(로컬/CI 는 항상 설치됨).

function loadFabric() {
  try {
    const req = createRequire(import.meta.url);
    return req('../../../canvas-core/node_modules/fabric').fabric;
  } catch {
    return null;
  }
}

test('fabric 왕복: rect rx/ry + pill 비클램프 값이 fromObject→toObject 에서 보존', async (t) => {
  const fabric = loadFabric();
  if (!fabric) return t.skip('fabric(canvas-core node_modules) 미설치 — workspace install 후 실행');
  const doc = await parseIdml(
    await makeIdml('CornerOption="RoundedCorner" CornerRadius="31.181102362204726"')
  );
  const src = toSpreadTemplate(doc).objects.find((x) => x.id === 'idml-r1');
  const rect = await new Promise((res) => fabric.Rect.fromObject(JSON.parse(JSON.stringify(src)), res));
  const out = rect.toObject(['cmykFill', 'meta', '_idml', 'isUserAdded', 'id']);
  assert.strictEqual(out.rx, src.rx, `rx 왕복 보존 (${out.rx})`);
  assert.strictEqual(out.ry, src.ry, `ry 왕복 보존 (${out.ry})`);
  assert.strictEqual(out.width, src.width, 'width 불변');
  assert.strictEqual(out.height, src.height, 'height 불변');
  // 렌더 클램프 확인(_rx 가 아니라 렌더 시 Math.min) — 직렬화 값은 비클램프 유지
  assert.ok(out.rx > out.height / 2, 'pill 비클램프 직렬화 유지');
});

test('fabric 왕복: strokeWidth 고아 제거 후 기본값(1)로 로드 — 직렬화 오염 없음', async (t) => {
  const fabric = loadFabric();
  if (!fabric) return t.skip('fabric 미설치');
  const doc = await parseIdml(await makeIdml('StrokeWeight="1" StrokeColor="Swatch/None"'));
  const src = toSpreadTemplate(doc).objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(src.strokeWidth, undefined);
  const rect = await new Promise((res) => fabric.Rect.fromObject(JSON.parse(JSON.stringify(src)), res));
  assert.strictEqual(rect.stroke, null, 'stroke null(비가시)');
  assert.strictEqual(rect.strokeWidth, 1, 'fabric 기본값 — 종전(2.08px 오염) 대비 위생');
});
