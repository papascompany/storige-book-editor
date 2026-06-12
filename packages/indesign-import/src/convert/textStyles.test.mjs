// A2+A3 per-run 텍스트 스타일 테스트.
// 1) 매핑 순수함수: FontStyle→fontWeight, Leading→lineHeight, Justification→textAlign, 세로 자간.
// 2) buildStoryTypography: 혼합 run styles 구조(객체형 diff-only), 전 run 동일 시 {}, 지배값 선출.
// 3) fabric 5.5 실물 왕복: 객체형 styles → fromObject → toObject(배열형) → 재로드 → 동일/무크래시
//    (9628f1a: styles 직렬화 크래시 재발 방지 — canvas-core 의 fabric 5.5.2 를 직접 로드).
// 4) toSpreadTemplate 통합: 가로/세로짜기/미해석 색상, reader per-run 추출(fixtures IDML),
//    3모드(vector/hybrid/flat-spine) 공통 적용.
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fontStyleToFabric,
  lineHeightFromLeading,
  verticalLineHeightFromTracking,
  mapJustificationToTextAlign,
  buildStoryTypography,
  FABRIC_FONTSIZE_MULT,
} from './textStyles.mjs';
import { toSpreadTemplate } from './toSpreadTemplate.mjs';
import { parseIdml, convertIdmlToTemplate } from '../index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureIdml = resolve(__dirname, '../../fixtures/cover-sample.idml');

// pt→px@150dpi (toSpreadTemplate 과 동일 환산: pt × 150/72)
const ptToPx = (pt) => Math.round(((pt * 150) / 72) * 100) / 100;
const mm2pt = (mm) => (mm * 72) / 25.4;

// ─── 1) 매핑 순수함수 ───

test('FontStyle→fontWeight: 페이퍼로지 numbered weight + ExtraBold/Italic 이름 매칭', () => {
  assert.deepStrictEqual(fontStyleToFabric('Regular'), { fontWeight: 400, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('4 Regular'), { fontWeight: 400, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('5 Medium'), { fontWeight: 500, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('6 SemiBold'), { fontWeight: 600, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('7 Bold'), { fontWeight: 700, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('8 ExtraBold'), { fontWeight: 800, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('ExtraBold'), { fontWeight: 800, fontStyle: 'normal' });
  assert.deepStrictEqual(fontStyleToFabric('Bold Italic'), { fontWeight: 700, fontStyle: 'italic' });
  assert.deepStrictEqual(fontStyleToFabric('Italic'), { fontWeight: 400, fontStyle: 'italic' });
  assert.deepStrictEqual(fontStyleToFabric(null), { fontWeight: 400, fontStyle: 'normal' });
});

test('Leading→lineHeight: 명시 unit 은 LeadingPt/(1.13×size), auto 는 1.2/1.13 (실측 기반)', () => {
  // 실측 사례: 14pt 행간 @ 9pt 글자 → 1.3766 (u627/u74b 판권)
  assert.strictEqual(lineHeightFromLeading(14, 9), 1.3766);
  // absent/Auto = AutoLeading 120%([No paragraph style] 실측, 양 문서 동일) → 1.0619
  assert.strictEqual(lineHeightFromLeading('auto', 10), 1.0619);
  assert.strictEqual(lineHeightFromLeading(null, 10), 1.0619);
  // AutoLeading 커스텀 % 반영
  assert.strictEqual(lineHeightFromLeading('auto', 10, 150), Math.round((1.5 / 1.13) * 10000) / 10000);
  // fontSize 없으면 산출 불가
  assert.strictEqual(lineHeightFromLeading(14, null), null);
  assert.strictEqual(FABRIC_FONTSIZE_MULT, 1.13);
});

test('세로짜기 자간→lineHeight: (1+trk/1000)/1.13 — trk 0=0.885, -80=0.8142 (실측 §4)', () => {
  assert.strictEqual(verticalLineHeightFromTracking(0), 0.885);
  assert.strictEqual(verticalLineHeightFromTracking(-80), 0.8142);
  assert.strictEqual(verticalLineHeightFromTracking(), 0.885);
});

test('Justification→textAlign 전 매핑(fabric 5.5 dist 존재 값) + 미지/absent 는 left', () => {
  assert.strictEqual(mapJustificationToTextAlign('LeftAlign'), 'left');
  assert.strictEqual(mapJustificationToTextAlign('CenterAlign'), 'center');
  assert.strictEqual(mapJustificationToTextAlign('RightAlign'), 'right');
  assert.strictEqual(mapJustificationToTextAlign('LeftJustified'), 'justify-left');
  assert.strictEqual(mapJustificationToTextAlign('CenterJustified'), 'justify-center');
  assert.strictEqual(mapJustificationToTextAlign('RightJustified'), 'justify-right');
  assert.strictEqual(mapJustificationToTextAlign('FullyJustified'), 'justify');
  assert.strictEqual(mapJustificationToTextAlign('ToBindingSide'), 'left');
  assert.strictEqual(mapJustificationToTextAlign('AwayFromBindingSide'), 'right');
  assert.strictEqual(mapJustificationToTextAlign(null), 'left');
  assert.strictEqual(mapJustificationToTextAlign('SomethingNew'), 'left');
});

// ─── 2) buildStoryTypography ───

// MA u187 실측 패턴: '저자 북모아' = 10pt(2자)+9pt(1자)+11pt(3자), trk 100 공통
function u187Story() {
  return {
    self: 'u187',
    text: '저자 북모아',
    vertical: false,
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 2, text: '저자', font: 'THE명품고딕M', fontStyle: 'Regular', sizePt: 10, fillColor: null, tracking: 100, leadingPt: 'auto', underline: false, horizontalScale: 95 },
      { start: 2, end: 3, text: ' ', font: 'THE명품고딕M', fontStyle: 'Regular', sizePt: 9, fillColor: null, tracking: 100, leadingPt: 'auto', underline: false, horizontalScale: 95 },
      { start: 3, end: 6, text: '북모아', font: 'THE명품고딕M', fontStyle: 'Regular', sizePt: 11, fillColor: null, tracking: 100, leadingPt: 'auto', underline: false, horizontalScale: 95 },
    ],
    paragraphs: [{ start: 0, end: 6, justification: 'LeftAlign' }],
  };
}

test('혼합 run: 지배값(문자수 가중) base + 객체형 styles 는 base 와 다른 속성만', () => {
  const typo = buildStoryTypography(u187Story(), { ptToPx });
  // 지배 크기 = 11pt('북모아' 3자 > 10pt 2자) — 종전 '첫 non-null'(10pt) 의 -9% 오차 해소
  assert.strictEqual(typo.base.sizePt, 11);
  assert.strictEqual(typo.base.font, 'THE명품고딕M');
  assert.strictEqual(typo.textAlign, 'left');
  assert.strictEqual(typo.charSpacing, 100); // Tracking 1:1(1/1000em 동단위)
  assert.strictEqual(typo.lineHeight, 1.0619); // auto = 120%/1.13
  assert.strictEqual(typo.multiStyle, true);
  // styles: line0 의 0,1('저자'→10pt) 2(' '→9pt)만 diff, '북모아'(base)는 엔트리 없음
  assert.deepStrictEqual(typo.styles, {
    0: {
      0: { fontSize: ptToPx(10) },
      1: { fontSize: ptToPx(10) },
      2: { fontSize: ptToPx(9) },
    },
  });
  // 자간 동일(100) → 혼합 경고 없음, 가로비율 95% → 경고 1건
  assert.strictEqual(typo.warnings.filter((w) => w.includes('자간')).length, 0);
  assert.strictEqual(typo.warnings.filter((w) => w.includes('가로비율')).length, 1);
});

test('전 run 동일 속성이면 styles:{} 유지(불필요 비대 방지) + multiStyle=false', () => {
  const story = {
    text: 'AB\nCD',
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 3, text: 'AB\n', font: 'F', fontStyle: 'Bold', sizePt: 12, fillColor: 'Color/Black', tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
      { start: 3, end: 5, text: 'CD', font: 'F', fontStyle: 'Bold', sizePt: 12, fillColor: 'Color/Black', tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 5, justification: 'CenterAlign' }],
  };
  const typo = buildStoryTypography(story, { ptToPx });
  assert.deepStrictEqual(typo.styles, {});
  assert.strictEqual(typo.multiStyle, false);
  assert.strictEqual(typo.base.fontWeight, 700); // FontStyle 'Bold' → 객체 기본 굵기
  assert.strictEqual(typo.textAlign, 'center');
  assert.strictEqual(typo.warnings.length, 0);
});

test('혼합 자간(trk 0/-25)은 객체 charSpacing 지배값 + 근사 경고 / 줄바꿈 다음 라인 인덱스', () => {
  // u627 축약 패턴: 9pt trk0 다수 + '·' 1자만 trk -25, 명시 Leading 14pt
  const story = {
    text: '디자인·인쇄\n북모아',
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 3, text: '디자인', font: 'F', fontStyle: 'Regular', sizePt: 9, fillColor: null, tracking: 0, leadingPt: 14, underline: false, horizontalScale: 100 },
      { start: 3, end: 4, text: '·', font: 'F', fontStyle: 'Regular', sizePt: 9, fillColor: null, tracking: -25, leadingPt: 14, underline: false, horizontalScale: 100 },
      { start: 4, end: 10, text: '인쇄\n북모아', font: 'F', fontStyle: 'Regular', sizePt: 9, fillColor: null, tracking: 0, leadingPt: 14, underline: false, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 10, justification: 'LeftAlign' }],
  };
  const typo = buildStoryTypography(story, { ptToPx });
  assert.strictEqual(typo.charSpacing, 0); // 지배값(9자 vs 1자)
  assert.strictEqual(typo.lineHeight, 1.3766); // 14pt @ 9pt 실측식
  assert.ok(typo.warnings.some((w) => w.includes('자간') && w.includes('-25')), '자간 혼합 경고');
  // 크기/폰트 전부 동일 → per-char diff 없음(자간은 per-char 불가 속성)
  assert.deepStrictEqual(typo.styles, {});
});

test('혼합 fill/fontWeight: per-char diff 에 fill(hex)/fontWeight 만 들어간다', () => {
  const story = {
    text: 'AB',
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 1, text: 'A', font: 'F', fontStyle: 'Regular', sizePt: 12, fillColor: null, tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
      { start: 1, end: 2, text: 'B', font: 'F', fontStyle: '7 Bold', sizePt: 12, fillColor: 'Color/Red', tracking: 0, leadingPt: 'auto', underline: true, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 2, justification: 'LeftAlign' }],
  };
  const typo = buildStoryTypography(story, {
    ptToPx,
    resolveFillHex: (id) => ({ hex: id === 'Color/Red' ? '#ff0000' : '#000000' }),
  });
  // 동률(1자 vs 1자)은 선행 run 승 → base 는 Regular/null fill
  assert.strictEqual(typo.base.fontWeight, 400);
  assert.deepStrictEqual(typo.styles, {
    0: { 1: { fontWeight: 700, underline: true, fill: '#ff0000' } },
  });
});

test('runs 없음/빈 텍스트 → null (폴백 경로 신호)', () => {
  assert.strictEqual(buildStoryTypography({ text: 'X', runs: [] }, { ptToPx }), null);
  assert.strictEqual(buildStoryTypography({ text: '', runs: [{ start: 0, end: 0 }] }, { ptToPx }), null);
  assert.strictEqual(buildStoryTypography(null, { ptToPx }), null);
});

// ─── 3) fabric 5.5 실물 왕복 (9628f1a 재발 방지) ───

function loadFabric() {
  // indesign-import 는 fabric 비의존 — canvas-core(워크스페이스, fabric 5.5.2 고정)에서 로드
  const req = createRequire(resolve(__dirname, '../../../canvas-core/package.json'));
  return req('fabric').fabric;
}

const fromObjectAsync = (fabric, o) =>
  new Promise((res, rej) => {
    try {
      fabric.Textbox.fromObject(o, (t) => res(t));
    } catch (e) {
      rej(e);
    }
  });

test('fabric 5.5 왕복: 객체형 styles → fromObject → toObject(배열형) → 재로드 동일/무크래시', async (t) => {
  let fabric;
  try {
    fabric = loadFabric();
  } catch {
    t.skip('fabric 로드 불가 환경 — 구조 검증 테스트로 갈음');
    return;
  }
  const typo = buildStoryTypography(u187Story(), { ptToPx });
  const objectForm = {
    type: 'textbox',
    text: '저자 북모아',
    width: 200,
    fontSize: ptToPx(11),
    fontFamily: 'THE명품고딕M',
    charSpacing: typo.charSpacing,
    lineHeight: typo.lineHeight,
    textAlign: typo.textAlign,
    styles: typo.styles, // 객체형 — stylesFromArray 는 비배열 패스스루
  };
  const tb1 = await fromObjectAsync(fabric, objectForm);
  const out1 = tb1.toObject(); // stylesToArray → 배열형 [{start,end,style}]
  assert.ok(Array.isArray(out1.styles), '저장 시 배열형 직렬화');
  // '\n' 미포함 인덱스: 0..1=10pt, 2=9pt — 연속이지만 style 값이 달라 2개 엔트리
  assert.deepStrictEqual(
    out1.styles.map((s) => [s.start, s.end, s.style.fontSize]),
    [
      [0, 2, ptToPx(10)],
      [2, 3, ptToPx(9)],
    ]
  );
  // 2차 왕복: 배열형 → fromObject(stylesFromArray) → toObject — 동일 + 무크래시
  const tb2 = await fromObjectAsync(fabric, out1);
  const out2 = tb2.toObject();
  assert.deepStrictEqual(out2.styles, out1.styles, '2차 왕복 styles 동일');
  assert.strictEqual(out2.charSpacing, typo.charSpacing);
  assert.strictEqual(out2.lineHeight, typo.lineHeight);
  assert.strictEqual(out2.textAlign, typo.textAlign);
  // styles:{} 케이스도 왕복 무크래시(빈 배열 직렬화)
  const tbEmpty = await fromObjectAsync(fabric, { ...objectForm, styles: {} });
  assert.deepStrictEqual(tbEmpty.toObject().styles, []);
});

// ─── 4) toSpreadTemplate 통합 ───

// 3페이지(날개없음) 표지 doc — toSpreadTemplate.test.mjs 의 makeDoc 과 동일 사양
function makeDoc(items, colors) {
  const h = mm2pt(297);
  return {
    bleedPt: mm2pt(3),
    fonts: [],
    colors: colors || new Map(),
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items,
  };
}
const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const frame = (self, story, bbox) => ({
  self,
  type: 'TextFrame',
  transform: I,
  bbox: bbox || { cx: mm2pt(105), cy: 0, w: mm2pt(80), h: mm2pt(20), pointCount: 4 },
  story,
});

test('toSpreadTemplate: 가로 textbox 에 textAlign/lineHeight/charSpacing/styles 적용', () => {
  const { objects } = toSpreadTemplate(makeDoc([frame('t1', u187Story())]));
  const tb = objects.find((o) => o.id === 'idml-t1');
  assert.strictEqual(tb.type, 'textbox');
  assert.strictEqual(tb.fontSize, ptToPx(11), '지배 크기 11pt');
  assert.strictEqual(tb.textAlign, 'left');
  assert.strictEqual(tb.lineHeight, 1.0619);
  assert.strictEqual(tb.charSpacing, 100);
  assert.deepStrictEqual(tb.styles[0][0], { fontSize: ptToPx(10) });
  assert.deepStrictEqual(tb.styles[0][2], { fontSize: ptToPx(9) });
  assert.strictEqual(tb.styles[0][3], undefined, 'base run 은 엔트리 없음');
});

test('toSpreadTemplate: runs 없는 story(수제/구버전) 폴백 — 기존 동작 그대로', () => {
  const { objects } = toSpreadTemplate(
    makeDoc([frame('legacy', { text: '책등 제목', sizePt: 9, font: 'F' })])
  );
  const tb = objects.find((o) => o.id === 'idml-legacy');
  assert.strictEqual(tb.fontSize, ptToPx(9));
  assert.strictEqual(tb.fontFamily, 'F');
  assert.deepStrictEqual(tb.styles, {});
  assert.strictEqual(tb.textAlign, undefined, '폴백은 textAlign 미설정(기존과 동일)');
});

test('세로짜기: 글자단위 근사 유지 + 자간→lineHeight 환산 + styles 비충돌({})', () => {
  // LA ub51 패턴: 단일 run, trk -40, 세로
  const story = {
    self: 'v1',
    text: '기초탄탄',
    vertical: true,
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 4, text: '기초탄탄', font: '태나다체', fontStyle: 'ExtraBold', sizePt: 60, fillColor: null, tracking: -40, leadingPt: 'auto', underline: false, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 4, justification: 'LeftAlign' }],
  };
  const { objects, warnings } = toSpreadTemplate(
    makeDoc([frame('v1', story, { cx: 0, cy: 0, w: mm2pt(8), h: mm2pt(180), pointCount: 4 })])
  );
  const tb = objects.find((o) => o.id === 'idml-v1');
  assert.strictEqual(tb.text, '기\n초\n탄\n탄', '글자단위 분해 유지');
  assert.strictEqual(tb.textAlign, 'center', '세로는 center 유지(위치 근사 안전)');
  assert.strictEqual(tb.lineHeight, verticalLineHeightFromTracking(-40), '자간→lineHeight 환산');
  assert.deepStrictEqual(tb.styles, {}, '세로는 단일 스타일(인덱스 오염 방지)');
  assert.strictEqual(tb.fontWeight, 800, 'ExtraBold → 800 (객체 단위는 적용)');
  assert.strictEqual(tb.fontSize, ptToPx(60));
  assert.ok(!warnings.some((w) => w.includes('혼합 스타일')), '단일 run 은 혼합 경고 없음');
});

test('세로짜기 + 혼합 run: styles 미적용(단일화) + 경고', () => {
  const story = {
    self: 'v2',
    text: '가나다',
    vertical: true,
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 1, text: '가', font: 'F', fontStyle: 'Regular', sizePt: 30, fillColor: null, tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
      { start: 1, end: 3, text: '나다', font: 'F', fontStyle: 'Regular', sizePt: 20, fillColor: null, tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 3, justification: 'LeftAlign' }],
  };
  const { objects, warnings } = toSpreadTemplate(
    makeDoc([frame('v2', story, { cx: 0, cy: 0, w: mm2pt(8), h: mm2pt(100), pointCount: 4 })])
  );
  const tb = objects.find((o) => o.id === 'idml-v2');
  assert.deepStrictEqual(tb.styles, {}, '분해 후 인덱스가 깨지므로 per-char 미적용');
  assert.strictEqual(tb.fontSize, ptToPx(20), '지배 크기(2자)');
  assert.ok(warnings.some((w) => w.includes('세로쓰기 혼합 스타일')), '단일화 경고');
});

test('미해석 텍스트 색상(그라디언트 등): 검정 대체 + 경고(종전 무경고 갭 해소)', () => {
  const story = {
    self: 'g1',
    text: '제목',
    vertical: false,
    autoLeadingPct: 120,
    runs: [
      { start: 0, end: 2, text: '제목', font: 'F', fontStyle: 'Regular', sizePt: 20, fillColor: 'Gradient/새 그레이디언트 색상 견본', tracking: 0, leadingPt: 'auto', underline: false, horizontalScale: 100 },
    ],
    paragraphs: [{ start: 0, end: 2, justification: 'LeftAlign' }],
  };
  const { objects, warnings } = toSpreadTemplate(makeDoc([frame('g1', story)]));
  const tb = objects.find((o) => o.id === 'idml-g1');
  assert.strictEqual(tb.fill, '#000000', '검정 fallback');
  assert.ok(
    warnings.some((w) => w.includes('미해석 텍스트 색상') && w.includes('Gradient/')),
    '텍스트 색상 경고 노출'
  );
});

// ─── 5) reader per-run 추출 + 3모드 공통 적용 (fixtures IDML 실물) ───

test('reader: fixture u187 — per-run 보존(10/9/11pt) + 정규화 후 오프셋(끝공백 탈락 반영)', async () => {
  const doc = await parseIdml(await readFile(fixtureIdml));
  const fr = doc.items.find((it) => it.parentStory === 'u187');
  const st = fr.story;
  assert.strictEqual(st.text, '저자 북모아', '정규화 텍스트(끝공백 탈락)');
  assert.deepStrictEqual(
    st.runs.map((r) => [r.start, r.end, r.sizePt, r.tracking]),
    [
      [0, 2, 10, 100],
      [2, 3, 9, 100],
      [3, 6, 11, 100], // 원본 '북모아 '(4자) → 끝공백 탈락으로 3자
    ]
  );
  assert.deepStrictEqual(
    st.paragraphs.map((p) => [p.start, p.end, p.justification]),
    [[0, 6, 'LeftAlign']]
  );
});

test('reader: fixture u627 — 말미 Br-only run(7.13pt) 소멸 + 혼합 trk(-25) 보존 + Leading 14', async () => {
  const doc = await parseIdml(await readFile(fixtureIdml));
  const st = doc.items.find((it) => it.parentStory === 'u627').story;
  assert.ok(!st.runs.some((r) => r.sizePt === 7.12871287129347), 'trim 으로 사라진 run 은 미출력');
  assert.ok(st.runs.some((r) => r.tracking === -25 && r.text === '·'), "'·' run trk -25 보존");
  assert.ok(st.runs.every((r) => r.leadingPt === 14), '명시 Leading 14pt unit');
  // 오프셋 정합: 각 run 의 text === 정규화 텍스트 slice
  for (const r of st.runs) assert.strictEqual(st.text.slice(r.start, r.end), r.text);
});

test('reader: fixture u1cc — Justification absent → 스타일 체인 기본(LeftJustified) 해석', async () => {
  const doc = await parseIdml(await readFile(fixtureIdml));
  const st = doc.items.find((it) => it.parentStory === 'u1cc').story;
  // NormalParagraphStyle(속성 0) → BasedOn [No paragraph style](Justification=LeftJustified)
  assert.strictEqual(st.paragraphs[0].justification, 'LeftJustified');
  assert.strictEqual(st.runs[0].fontStyle, '5 Medium');
  assert.strictEqual(st.runs[0].tracking, 60);
  assert.strictEqual(st.autoLeadingPct, 120);
});

test('3모드 공통: vector/hybrid/flat-spine 의 textbox per-run 산출물 동일(구현 1곳 전파)', async () => {
  const buf = await readFile(fixtureIdml);
  const pick = (dto) =>
    dto.canvasData.objects.find((o) => o.type === 'textbox' && o.text === '저자 북모아');
  const [vec, hyb, flat] = await Promise.all([
    convertIdmlToTemplate(buf, { mode: 'vector' }),
    convertIdmlToTemplate(buf, { mode: 'hybrid' }),
    convertIdmlToTemplate(buf, { mode: 'flat-spine' }),
  ]);
  const [tv, th, tf] = [pick(vec.dto), pick(hyb.dto), pick(flat.dto)];
  assert.ok(tv && th && tf, '3모드 모두 u187 textbox 존재(텍스트는 편집 레이어 유지)');
  for (const t of [th, tf]) {
    assert.deepStrictEqual(t.styles, tv.styles, 'styles 동일');
    assert.strictEqual(t.textAlign, tv.textAlign);
    assert.strictEqual(t.lineHeight, tv.lineHeight);
    assert.strictEqual(t.charSpacing, tv.charSpacing);
    assert.strictEqual(t.fontSize, tv.fontSize);
  }
  // 혼합 run 이 실제 styles 로 들어갔는지(빈 {} 아님)
  assert.ok(Object.keys(tv.styles).length > 0, 'u187 혼합 run styles 채워짐');
  assert.deepStrictEqual(tv.styles[0][2], { fontSize: ptToPx(9) });
});
