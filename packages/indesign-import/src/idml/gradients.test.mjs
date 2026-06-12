// 그라디언트 정의 파싱(parseGradients) + 합성 IDML 전구간(FULL 모드) 좌표 검증 (A1).
//
// 실 IDML(MA-348/LA-383)에는 도형 그라디언트 표본이 0건이라(텍스트 run 1건뿐),
// GradientFillStart 의 inner-공간 가정은 합성 IDML(사각형+Linear)로 선검증한다(실측 §3b 단서).
import { test } from 'node:test';
import assert from 'node:assert';
import JSZip from 'jszip';
import { parseGradients, parseIdml } from './reader.mjs';
import { toSpreadTemplate } from '../convert/toSpreadTemplate.mjs';

// LA-383 Resources/Graphic.xml 실측 구조 그대로의 축약 fragment
const GRAPHIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.4">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>
  <Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" Name="Paper"/>
  <Color Self="Color/uc37" Model="Process" Space="CMYK" ColorValue="60 80 0 0" Name="C=60 M=80 Y=0 K=0"/>
  <Color Self="Color/C=50 M=10 Y=10 K=0" Model="Process" Space="CMYK" ColorValue="50 10 10 0" Name="C=50 M=10 Y=10 K=0"/>
  <Color Self="Color/u98b" Model="Process" Space="CMYK" ColorValue="10 80 98 0" Name="u98b"/>
  <Gradient Self="Gradient/새 그레이디언트 색상 견본" Type="Linear" Name="새 그레이디언트 색상 견본">
    <GradientStop Self="u988GradientStop0" StopColor="Color/uc37" Location="0"/>
    <GradientStop Self="u988GradientStop1" StopColor="Color/C=50 M=10 Y=10 K=0" Location="100" Midpoint="50"/>
  </Gradient>
  <Gradient Self="Gradient/새 그레이디언트 색상 견본 사본" Type="Linear" Name="새 그레이디언트 색상 견본 사본">
    <GradientStop Self="ua8aGradientStop0" StopColor="Color/u98b" Location="0"/>
    <GradientStop Self="ua8aGradientStop1" StopColor="Color/Paper" Location="100" Midpoint="50"/>
  </Gradient>
  <Gradient Self="Gradient/u90" Type="Linear" Name="$ID/" Visible="false">
    <GradientStop Self="u90GradientStop0" StopColor="Color/u91" Location="0"/>
    <GradientStop Self="u90GradientStop1" StopColor="Color/Black" Location="100" Midpoint="50"/>
  </Gradient>
</idPkg:Graphic>`;

test('parseGradients: LA-383 실측 구조 — 정의 3건, 스톱 hex/offset/type/cmyk', () => {
  const grads = parseGradients(GRAPHIC_XML);
  assert.strictEqual(grads.size, 3, '그라디언트 정의 3건');

  const g1 = grads.get('Gradient/새 그레이디언트 색상 견본');
  assert.ok(g1, '주 그라디언트 존재');
  assert.strictEqual(g1.type, 'linear');
  assert.strictEqual(g1.stops.length, 2);
  assert.deepStrictEqual(
    g1.stops.map((s) => [s.offset, s.color]),
    [[0, '#6633ff'], [1, '#80e6e6']],
    '실측 colorToHex 결과(uc37→#6633ff, C=50/10/10/0→#80e6e6)'
  );
  assert.deepStrictEqual(g1.stops[0].cmyk, [60, 80, 0, 0], 'cmyk 원본 보존');
  assert.strictEqual(g1.stops[1].midpoint, 50);

  // Paper 스톱 → #ffffff (resolveColor 와 동일 특수규칙)
  const g2 = grads.get('Gradient/새 그레이디언트 색상 견본 사본');
  assert.strictEqual(g2.stops[1].color, '#ffffff', 'Paper 스톱 → #ffffff');
  assert.ok(g2.stops[1].isPaper);

  // 미정의 색 참조(Color/u91 정의 누락) → unknown 보존 + color null
  const g3 = grads.get('Gradient/u90');
  assert.strictEqual(g3.stops[0].color, null);
  assert.strictEqual(g3.stops[0].unknown, 'Color/u91');
  assert.strictEqual(g3.stops[1].color, '#000000', 'Black → #000000');
});

// ── 합성 IDML(사각형 + Linear 그라디언트) — parseIdml → toSpreadTemplate 전구간 ──
const mm2pt = (mm) => (mm * 72) / 25.4;
const K = 150 / 72; // pt → px@150dpi

/** 3페이지(210/10/210 × 297mm) + 앞표지 중앙 100×100pt 그라디언트 사각형 IDML zip.
 *  itemTransform 으로 회전/플립/스케일 베이크 케이스, tag 로 Rectangle/Polygon 전환. */
async function makeSyntheticIdml({
  angle = 0,
  start = '0 0',
  length = '100',
  fill = 'Gradient/G1',
  itemTransform = null,
  tag = 'Rectangle',
} = {}) {
  const h = mm2pt(297);
  const rectTx = mm2pt(110 + 215) - 50; // 스프레드 x: 앞표지 중앙(=+110mm) 중심 − 로컬 cx(50)
  const tf = itemTransform || `1 0 0 1 ${rectTx - mm2pt(215)} 0`;
  // 페이지 GeometricBounds="y1 x1 y2 x2", ItemTransform 으로 스프레드 좌표 배치(중앙 y 원점)
  const spreadXml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.4">
  <Spread Self="us1">
    <Page Self="p1" Name="1" GeometricBounds="0 0 ${h} ${mm2pt(210)}" ItemTransform="1 0 0 1 ${-mm2pt(215)} ${-h / 2}"/>
    <Page Self="p2" Name="2" GeometricBounds="0 0 ${h} ${mm2pt(10)}" ItemTransform="1 0 0 1 ${-mm2pt(5)} ${-h / 2}"/>
    <Page Self="p3" Name="3" GeometricBounds="0 0 ${h} ${mm2pt(210)}" ItemTransform="1 0 0 1 ${mm2pt(5)} ${-h / 2}"/>
    <${tag} Self="r1" FillColor="${fill}" ItemTransform="${tf}" GradientFillStart="${start}" GradientFillLength="${length}" GradientFillAngle="${angle}">
      <Properties>
        <PathGeometry>
          <GeometryPathType PathOpen="false">
            <PathPointArray>
              <PathPointType Anchor="0 -50"/>
              <PathPointType Anchor="100 -50"/>
              <PathPointType Anchor="100 50"/>
              <PathPointType Anchor="0 50"/>
            </PathPointArray>
          </GeometryPathType>
        </PathGeometry>
      </Properties>
    </${tag}>
  </Spread>
</idPkg:Spread>`;
  // ⚠️ Rectangle 의 ItemTransform e 값: 페이지 좌표가 아니라 '스프레드' 좌표.
  // 위에서 rectTx 는 콘텐츠 좌상단 기준으로 계산했으므로 originXpt(-215mm) 만큼 되돌린다.
  const zip = new JSZip();
  zip.file('Spreads/Spread_us1.xml', spreadXml);
  zip.file('Resources/Graphic.xml', GRAPHIC_XML.replace('Gradient/새 그레이디언트 색상 견본"', 'Gradient/G1"'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('합성 IDML(FULL): 그라디언트 사각형 → fabric Gradient fill — inner 공간 좌표식 검증(angle 0)', async () => {
  const buf = await makeSyntheticIdml({ angle: 0, start: '0 0', length: '100' });
  const doc = await parseIdml(buf);
  assert.strictEqual(doc.gradients.get('Gradient/G1')?.stops.length, 2, 'doc.gradients 수집');
  const rect = doc.items.find((i) => i.self === 'r1');
  assert.deepStrictEqual(rect.gradientFill.start, [0, 0], 'GradientFillStart 수집');
  assert.strictEqual(rect.gradientFill.length, 100);

  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  const f = o.fill;
  assert.strictEqual(typeof f, 'object', 'fill 은 fabric Gradient 직렬화 객체');
  assert.strictEqual(f.type, 'linear');
  assert.strictEqual(f.gradientUnits, 'pixels');
  // 기대값(실측 §3b 변환식): S_local=(0,0)=bbox 좌중앙 → 로컬 px (0, h/2). E = S + 100pt·(1,0).
  assert.ok(Math.abs(f.coords.x1 - 0) < 0.1, `x1≈0 (${f.coords.x1})`);
  assert.ok(Math.abs(f.coords.y1 - 50 * K) < 0.1, `y1≈${(50 * K).toFixed(2)} (${f.coords.y1})`);
  assert.ok(Math.abs(f.coords.x2 - 100 * K) < 0.1, `x2≈${(100 * K).toFixed(2)} (${f.coords.x2})`);
  assert.ok(Math.abs(f.coords.y2 - 50 * K) < 0.1, `y2≈y1 (${f.coords.y2})`);
  assert.deepStrictEqual(
    f.colorStops.map((s) => [s.offset, s.color]),
    [[0, '#6633ff'], [1, '#80e6e6']]
  );
  assert.deepStrictEqual(f.colorStops[0].cmyk, [60, 80, 0, 0], '스톱별 cmyk 보존');
  // 해석 성공 → 미해석 색상 경고 없어야 함
  assert.ok(!warnings.some((w) => w.includes('미해석 색상: Gradient/')), `미해석 경고 없음: ${warnings}`);
});

test('합성 IDML(FULL): GradientFillAngle=90 → y-down 방향벡터 (0,-1) — 상향 진행', async () => {
  // start 를 bbox 하중앙(0 기준 로컬 y=+50 라인 중앙 x=50)으로, 길이 100pt 위로
  const buf = await makeSyntheticIdml({ angle: 90, start: '50 50', length: '100' });
  const doc = await parseIdml(buf);
  const { objects } = toSpreadTemplate(doc);
  const f = objects.find((x) => x.id === 'idml-r1').fill;
  // S_local=(50,50) → 로컬 px (50K, 100K). E = S + 100pt·(0,−1) → (50K, 0)
  assert.ok(Math.abs(f.coords.x1 - 50 * K) < 0.1, `x1≈${(50 * K).toFixed(2)} (${f.coords.x1})`);
  assert.ok(Math.abs(f.coords.y1 - 100 * K) < 0.1, `y1≈${(100 * K).toFixed(2)} (${f.coords.y1})`);
  assert.ok(Math.abs(f.coords.x2 - 50 * K) < 0.1, `x2=x1 (${f.coords.x2})`);
  assert.ok(Math.abs(f.coords.y2 - 0) < 0.1, `y2≈0(위로) (${f.coords.y2})`);
});

test('합성 IDML: 미정의 그라디언트 참조 → 기존 검정 폴백 + 미해석 경고 유지', async () => {
  const buf = await makeSyntheticIdml({ fill: 'Gradient/없는것' });
  const doc = await parseIdml(buf);
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.fill, '#000000', '미해석 그라디언트 → 검정 폴백(기존 동작 유지)');
  assert.ok(
    warnings.some((w) => w.includes('미해석 색상: Gradient/없는것')),
    `미해석 경고 유지: ${warnings}`
  );
});

// ── 비항등 ItemTransform(회전/플립/스케일) — inner pt 공간 합성의 자동 정합 검증 ──
// 캔버스 공간 ptToPx·dir 직접 합성(구식)이라면 아래 기대값들이 전부 어긋난다.

test('합성 IDML(회전 90° CW, Rectangle): inner 합성 + 중심 역회전 → 비회전과 동일 로컬 coords + angle 90', async () => {
  // M=[0 1 -1 0 e f]: inner (x,y) → spread (−y+e, x+f). 중심(50,0) → (e, 50+f) = 앞표지 중앙.
  const e = -mm2pt(105);
  const f = -50;
  const buf = await makeSyntheticIdml({ angle: 0, start: '0 0', length: '100', itemTransform: `0 1 -1 0 ${e} ${f}` });
  const doc = await parseIdml(buf);
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.ok(Math.abs(o.angle - 90) < 0.01, `fabric angle 90 (${o.angle})`);
  const c = o.fill.coords;
  // 역회전 후 로컬 수평 복원 — 렌더 시 fabric 이 angle 90 을 재적용해 캔버스에선 수직.
  assert.ok(Math.abs(c.x1 - 0) < 0.1 && Math.abs(c.y1 - 50 * K) < 0.1, `S 로컬 (0, 50K) (${JSON.stringify(c)})`);
  assert.ok(Math.abs(c.x2 - 100 * K) < 0.1 && Math.abs(c.y2 - 50 * K) < 0.1, `E 로컬 (100K, 50K) (${JSON.stringify(c)})`);
  assert.ok(warnings.some((w) => w.includes('회전 객체 적용')), `회전 정보 경고: ${warnings}`);
});

test('합성 IDML(회전 베이크 PATH, Polygon): objectAngleDeg=0 이어도 inner 합성으로 방향 자동 정합 — 경고 불필요 근거', async () => {
  const e = -mm2pt(105);
  const f = -50;
  const buf = await makeSyntheticIdml({ angle: 0, start: '0 0', length: '100', itemTransform: `0 1 -1 0 ${e} ${f}`, tag: 'Polygon' });
  const doc = await parseIdml(buf);
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.type, 'path');
  assert.strictEqual(o.angle, 0, 'PATH 는 회전이 좌표에 베이크 → angle 0');
  const c = o.fill.coords;
  // inner 좌중앙→우중앙이 회전을 타고 캔버스 상중앙→하중앙(로컬 수직)으로 사상 — S·E 동일 매퍼 사상 덕분.
  assert.ok(Math.abs(c.x1 - 50 * K) < 0.1 && Math.abs(c.y1 - 0) < 0.1, `S 로컬 (50K, 0) (${JSON.stringify(c)})`);
  assert.ok(Math.abs(c.x2 - 50 * K) < 0.1 && Math.abs(c.y2 - 100 * K) < 0.1, `E 로컬 (50K, 100K) (${JSON.stringify(c)})`);
  assert.ok(!warnings.some((w) => w.includes('회전 객체 적용')), `베이크 회전은 정합 — 경고 없음: ${warnings}`);
});

test('합성 IDML(flipY): 중심 y 미러 로컬화 + 경고, FLAT SVG 는 1−y 반전으로 외관 일치', async () => {
  // M=[1 0 0 -1 e f]: inner (x,y) → spread (x+e, −y+f). 중심(50,0) → (50+e, f) = 앞표지 중앙.
  const e = -mm2pt(105) - 50;
  const buf = await makeSyntheticIdml({ angle: -90, start: '50 -50', length: '100', itemTransform: `1 0 0 -1 ${e} 0` });
  const doc = await parseIdml(buf);
  const result = toSpreadTemplate(doc);
  const o = result.objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.flipY, true, 'd.flipped → flipY');
  const c = o.fill.coords;
  // inner 상중앙→하중앙(angle −90). 플립 캔버스에선 하→상이지만, 미러 로컬화 후 다시 상→하
  // (fabric 렌더가 flipY 미러를 재적용해 캔버스 외관은 하→상 — IDML 원본과 일치).
  assert.ok(Math.abs(c.x1 - 50 * K) < 0.1 && Math.abs(c.y1 - 0) < 0.1, `S 로컬 (50K, 0) (${JSON.stringify(c)})`);
  assert.ok(Math.abs(c.x2 - 50 * K) < 0.1 && Math.abs(c.y2 - 100 * K) < 0.1, `E 로컬 (50K, 100K) (${JSON.stringify(c)})`);
  assert.ok(result.warnings.some((w) => w.includes('플립(flipY) 객체 적용')), `플립 경고: ${result.warnings}`);
  // FLAT(래스터) SVG: 도형은 미러 없이 그려지므로 그라디언트 y 가 1−y 반전돼야 외관 일치.
  const { buildArtworkSvg } = await import('../raster/rasterize.mjs');
  const svg = buildArtworkSvg(result.draftTemplateDto);
  assert.match(svg, /grad-idml-r1"[^>]*y1="1" x2="[^"]*" y2="0"/, `flipY 반전 defs: ${svg.match(/<linearGradient[^>]*>/)?.[0]}`);
});

test('합성 IDML(스케일 2x 베이크): E 도 같은 매퍼 사상 — 그라디언트 길이가 스케일을 따라감', async () => {
  // M=[2 0 0 1 e f]: inner (x,y) → spread (2x+e, y). 중심(50,0) → (100+e, 0) = 앞표지 중앙.
  const e = -mm2pt(105) - 100;
  const buf = await makeSyntheticIdml({ angle: 0, start: '0 0', length: '100', itemTransform: `2 0 0 1 ${e} 0` });
  const doc = await parseIdml(buf);
  const { objects } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.ok(Math.abs(o.width - 200 * K) < 0.1, `폭 200pt 스케일 반영 (${o.width})`);
  const c = o.fill.coords;
  // 구식(캔버스 ptToPx(100)·dir 합성)이면 x2=100K 로 절반에 멈춘다 — inner 합성은 200K.
  assert.ok(Math.abs(c.x1 - 0) < 0.1, `x1≈0 (${c.x1})`);
  assert.ok(Math.abs(c.x2 - 200 * K) < 0.1, `x2≈${(200 * K).toFixed(2)} (${c.x2})`);
});

test('합성 IDML(대각 각도+비정사각): FLAT 각도 근사 경고 1줄', async () => {
  const buf = await makeSyntheticIdml({ angle: 45, start: '0 0', length: '100' });
  const doc = await parseIdml(buf);
  // 100×100pt 정사각 → 경고 없어야 함
  const sq = toSpreadTemplate(doc);
  assert.ok(!sq.warnings.some((w) => w.includes('FLAT 미리보기/래스터')), `정사각은 경고 없음: ${sq.warnings}`);
  // 200×100pt 비정사각(스케일 2x) + 45° → 경고 1줄
  const e = -mm2pt(105) - 100;
  const buf2 = await makeSyntheticIdml({ angle: 45, start: '0 0', length: '100', itemTransform: `2 0 0 1 ${e} 0` });
  const doc2 = await parseIdml(buf2);
  const ns = toSpreadTemplate(doc2);
  const hits = ns.warnings.filter((w) => w.includes('FLAT 미리보기/래스터는 각도 근사'));
  assert.strictEqual(hits.length, 1, `비정사각+대각 경고 1줄: ${ns.warnings}`);
});

test('합성 IDML: 잔존 기하(길이 0) — FillColor 가 단색이면 그라디언트 미적용(잔존 파라미터 무시)', async () => {
  // 실측 함정: 모든 프레임에 GradientFillStart="0 0" Length="0" 잔존 — FillColor 기준만 유효
  const buf = await makeSyntheticIdml({ fill: 'Color/uc37', start: '0 0', length: '0' });
  const doc = await parseIdml(buf);
  const { objects, warnings } = toSpreadTemplate(doc);
  const o = objects.find((x) => x.id === 'idml-r1');
  assert.strictEqual(o.fill, '#6633ff', '단색 유지(그라디언트 오염 금지)');
  assert.ok(!warnings.some((w) => w.includes('그라디언트')), '그라디언트 경고 없음');
});
