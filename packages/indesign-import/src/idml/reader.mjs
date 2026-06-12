// IDML 리더 — ZIP 해제 + XML 파싱 → 중간표현(IdmlDoc).
// 의존성: jszip(언집), fast-xml-parser(XML).
//
// IDML 구조: Spreads/Spread_*.xml(페이지·도형 geometry), Stories/Story_*.xml(텍스트),
//            Resources/Graphic.xml(색상), Resources/Fonts.xml(폰트), Resources/Preferences.xml(판형·블리드).
//
// ⚠️ z-순서(쌓임 순서) 보존: 스프레드의 페이지아이템은 문서 순서대로 그려진다(뒤 항목이 위).
//    이 순서를 지키지 않으면 책등 패널 아래 있어야 할 도형이 위로 올라온다.
//    → 스프레드는 preserveOrder 파서로 문서 순서대로 수집한다.

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import {
  fromItemTransform,
  compose,
  applyToPoint,
  IDENTITY,
} from '../geometry/matrix.mjs';

const ITEM_TYPES = ['Rectangle', 'Polygon', 'Oval', 'GraphicLine', 'TextFrame'];

// 비순서 파서 — 스토리/색상/폰트/스타일시트(순서 무관)
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['ParagraphStyleRange', 'CharacterStyleRange', 'Color', 'ParagraphStyle', 'Gradient', 'GradientStop'].includes(name),
});

// 순서보존 파서 — 스프레드 geometry(z-순서) 보존.
// parseTagValue:false → 텍스트(#text)를 숫자로 변환하지 않음(예: "2026" 보존).
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseTagValue: false,
});

// 스토리 전용 순서보존 파서 — trimValues:false 로 Content 의 공백 보존.
// 기본(trim)은 `<Content> </Content>`(단독 공백 run, 실측 u187)와 Content 끝공백을 파서 단계에서
// 삼켜 per-run 오프셋이 어긋난다. 부작용(요소 사이 들여쓰기 '#text' 노드)은 keyOf 기반 순회가
// 태그명으로 거르므로 무해. 폰트명 등 텍스트 값은 사용처에서 trim(실측: '태나다체   ' 끝공백).
// ⚠️ 스프레드 geometry 는 기존 orderedParser 유지(좌표 회귀 금지 — 절대 규칙 #3).
const storyParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false,
});

const num = (s) => Number(s);
const parseNums = (s) => String(s).trim().split(/\s+/).map(num);

// ── preserveOrder 노드 헬퍼 (노드 = { [tag]: childrenArray, ':@': attrs }) ──
const keyOf = (node) => {
  for (const k of Object.keys(node)) if (k !== ':@') return k;
  return null;
};
const attrsOf = (node) => node[':@'] || {};
// '#text' 리프는 값이 문자열 — 배열이 아니면 자식 없음으로 취급(문자열을 순회하면
// 1글자 문자열이 자기 자신을 자식으로 갖는 무한 재귀가 된다. trimValues:false 도입으로 표면화).
const childrenOf = (node) => {
  const v = node[keyOf(node)];
  return Array.isArray(v) ? v : [];
};
const findChildren = (node, tag) => childrenOf(node).filter((c) => keyOf(c) === tag);
const findChild = (node, tag) => childrenOf(node).find((c) => keyOf(c) === tag);
function deepFindOrdered(nodes, tag) {
  for (const n of nodes) {
    if (keyOf(n) === tag) return n;
    const r = deepFindOrdered(childrenOf(n), tag);
    if (r) return r;
  }
  return null;
}

/** PathGeometry(순서노드) → { bbox(로컬), subpaths(anchor+베지어 핸들) } */
function extractGeometryOrdered(itemNode) {
  const props = findChild(itemNode, 'Properties');
  const pg = props ? findChild(props, 'PathGeometry') : null;
  const gpts = pg ? findChildren(pg, 'GeometryPathType') : [];
  const subpaths = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    n = 0;
  for (const gpt of gpts) {
    const closed = attrsOf(gpt)['@_PathOpen'] === 'false';
    const ppa = findChild(gpt, 'PathPointArray');
    const ppts = ppa ? findChildren(ppa, 'PathPointType') : [];
    const points = ppts.map((p) => {
      const a = parseNums(attrsOf(p)['@_Anchor']);
      const l = attrsOf(p)['@_LeftDirection'] ? parseNums(attrsOf(p)['@_LeftDirection']) : a;
      const r = attrsOf(p)['@_RightDirection'] ? parseNums(attrsOf(p)['@_RightDirection']) : a;
      minX = Math.min(minX, a[0]);
      maxX = Math.max(maxX, a[0]);
      minY = Math.min(minY, a[1]);
      maxY = Math.max(maxY, a[1]);
      n++;
      return { a, l, r };
    });
    subpaths.push({ closed, points });
  }
  if (!n) return null;
  const bbox = {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
    pointCount: n,
  };
  return { bbox, subpaths };
}

// ── 코너 반경(A6) ──
// 실측(MA-348/LA-383, 2026-06-12): 라운드 코너 보유 요소는 Rectangle 4건(MA u5c3/u6f8/u5df,
// LA u79c)뿐이며 전부 균일 — per-corner 4값(TopLeft~BottomRight ×Option/Radius)과 legacy
// CornerOption/CornerRadius 가 동시 기록·값 동일. 코너 미적용 요소는 corner attr 자체가 없다
// (실측: 미적용 70건 attr 0). 방어적으로 option(None 제외) ∧ radius>0 을 함께 요구한다.
const CORNER_KEYS = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];
function extractCorner(a) {
  const legacyOption = a['@_CornerOption'] != null ? String(a['@_CornerOption']) : null;
  const legacyRadius = a['@_CornerRadius'] != null ? num(a['@_CornerRadius']) : null;
  const per = CORNER_KEYS.map((c) => ({
    option: a[`@_${c}CornerOption`] != null ? String(a[`@_${c}CornerOption`]) : legacyOption,
    radius: a[`@_${c}CornerRadius`] != null ? num(a[`@_${c}CornerRadius`]) : legacyRadius,
  }));
  const active = (p) => p.option != null && p.option !== 'None' && p.radius != null && p.radius > 0;
  if (!per.some(active)) return null;
  const radii = per.map((p) => (active(p) ? p.radius : 0));
  const options = [...new Set(per.filter(active).map((p) => p.option))];
  const uniform = per.every(active) && options.length === 1 && radii.every((r) => r === radii[0]);
  return {
    options, // 적용된 코너 유형(실측: ['RoundedCorner'] 만)
    radiusPt: Math.max(...radii), // 대표 반경 — 비균일 시 최대값 폴백(실측 0건, 변환기 경고)
    radiiPt: radii, // [tl, tr, bl, br] (pt)
    uniform,
  };
}

/** 스프레드/그룹 자식들을 '문서 순서대로' 재귀 수집(z-순서 보존, 부모 변환 합성) */
function collectItemsOrdered(siblingNodes, parentT, acc) {
  for (const node of siblingNodes) {
    const tag = keyOf(node);
    if (ITEM_TYPES.includes(tag)) {
      const a = attrsOf(node);
      const t = compose(parentT, fromItemTransform(parseNums(a['@_ItemTransform'])));
      const geom = extractGeometryOrdered(node);
      // 프레임 안의 배치(placed) 콘텐츠 감지 — IDML 에는 원본 픽셀이 없고 링크 메타만 있어
      // 복원 불가. 변환기에서 플레이스홀더 + 경고 처리용 플래그.
      const placedContent = ['Image', 'PDF', 'EPS', 'WMF', 'PICT'].find(
        (ct) => findChild(node, ct) != null
      );
      // 그라디언트 기하(GradientFill*) — InDesign 은 모든 프레임에 잔존 기본값
      // (GradientFillStart="0 0" Length="0")을 박아두므로, 이 값의 존재만으로 그라디언트
      // 적용을 판정하면 안 된다(실측). 적용 판정은 변환기에서 FillColor="Gradient/..." 로만.
      const gradientFill =
        a['@_GradientFillStart'] != null || a['@_GradientFillLength'] != null
          ? {
              start: a['@_GradientFillStart'] != null ? parseNums(a['@_GradientFillStart']) : null,
              length: a['@_GradientFillLength'] != null ? num(a['@_GradientFillLength']) : null,
              angle: a['@_GradientFillAngle'] != null ? num(a['@_GradientFillAngle']) : 0,
              hiliteAngle: a['@_GradientFillHiliteAngle'] != null ? num(a['@_GradientFillHiliteAngle']) : 0,
              hiliteLength: a['@_GradientFillHiliteLength'] != null ? num(a['@_GradientFillHiliteLength']) : 0,
            }
          : null;
      // 코너 반경(A6) — 실측 4건 전부 균일 RoundedCorner. 비적용 시 null(키 미출력).
      const corner = extractCorner(a);
      // 특수 스트로크 속성(점선/끝모양/선정렬) — 실측 0건(가시 스트로크 자체가 0)이라
      // 매핑은 보류, 변환기의 감지·경고용으로만 추출한다(파싱+경고만 — 과잉 구현 금지).
      // ⚠️ ColumnRuleStrokeType(칼럼룰 기본값 노이즈)와 attr 이름이 다르므로 오염 없음.
      const strokeDetail = {};
      if (a['@_StrokeType'] != null) strokeDetail.strokeType = String(a['@_StrokeType']);
      if (a['@_EndCap'] != null) strokeDetail.endCap = String(a['@_EndCap']);
      if (a['@_EndJoin'] != null) strokeDetail.endJoin = String(a['@_EndJoin']);
      if (a['@_StrokeAlignment'] != null) strokeDetail.strokeAlignment = String(a['@_StrokeAlignment']);
      acc.push({
        type: tag,
        self: a['@_Self'],
        transform: t,
        bbox: geom?.bbox || null,
        subpaths: geom?.subpaths || [],
        fillColor: a['@_FillColor'],
        strokeColor: a['@_StrokeColor'],
        strokeWeight: a['@_StrokeWeight'] != null ? num(a['@_StrokeWeight']) : undefined,
        parentStory: a['@_ParentStory'],
        ...(placedContent ? { placedContent } : {}),
        ...(gradientFill ? { gradientFill } : {}),
        ...(corner ? { corner } : {}),
        ...strokeDetail,
      });
    } else if (tag === 'Group') {
      const a = attrsOf(node);
      const gt = compose(parentT, fromItemTransform(parseNums(a['@_ItemTransform'])));
      collectItemsOrdered(childrenOf(node), gt, acc);
    }
  }
}

/** Content/AppliedFont 등의 #text 추출 */
const innerText = (node) =>
  childrenOf(node)
    .map((c) => (c['#text'] != null ? String(c['#text']) : ''))
    .join('');

// ── 단락 스타일 시트(Styles.xml) ──
// 실측(MA-348/LA-383): 상속 체인은 NormalParagraphStyle(고유 속성 0, BasedOn 만)
// → [No paragraph style](전 속성 보유) 1단뿐이고, 캐릭터 스타일은 전부 빈
// [No character style] — 따라서 ParagraphStyle 의 Justification/AutoLeading 만 해석한다.
// (양 문서 모두 [No paragraph style]: Justification="LeftJustified", AutoLeading="120")

/** 비순서 파스 트리에서 key 이름의 노드를 재귀로 전부 수집(중첩 StyleGroup 대비) */
function deepCollect(obj, key, acc = []) {
  if (obj == null || typeof obj !== 'object') return acc;
  if (!Array.isArray(obj) && key in obj) {
    const v = obj[key];
    if (Array.isArray(v)) acc.push(...v);
    else acc.push(v);
  }
  for (const k of Object.keys(obj)) {
    if (k !== key) deepCollect(obj[k], key, acc);
  }
  return acc;
}

/** BasedOn 텍스트('#text' 또는 원시 문자열) 추출 */
const basedOnText = (props) => {
  const b = props?.BasedOn;
  if (b == null) return null;
  if (typeof b === 'object') return b['#text'] != null ? String(b['#text']) : null;
  return String(b);
};

/**
 * Resources/Styles.xml → Map(styleSelf → { justification, autoLeadingPct, basedOn }).
 * Self/AppliedParagraphStyle 형식: "ParagraphStyle/$ID/[No paragraph style]".
 * BasedOn 값("$ID/...")은 "ParagraphStyle/" 접두를 붙여 정규화.
 */
export function parseParagraphStyles(xml) {
  const o = parser.parse(xml);
  const map = new Map();
  for (const ps of deepCollect(o, 'ParagraphStyle')) {
    if (!ps || ps['@_Self'] == null) continue;
    let basedOn = basedOnText(ps.Properties);
    if (basedOn && !basedOn.startsWith('ParagraphStyle/')) basedOn = `ParagraphStyle/${basedOn}`;
    map.set(ps['@_Self'], {
      justification: ps['@_Justification'] != null ? String(ps['@_Justification']) : null,
      autoLeadingPct: ps['@_AutoLeading'] != null ? num(ps['@_AutoLeading']) : null,
      basedOn,
    });
  }
  return map;
}

/** 스타일 체인(BasedOn) 따라 attr 해석 — 순환 가드 10단 */
function resolveParaStyleAttr(styles, styleSelf, key) {
  if (!styles) return null;
  let ref = styleSelf;
  for (let hop = 0; hop < 10 && ref; hop++) {
    const st = styles.get(ref);
    if (!st) return null;
    if (st[key] != null) return st[key];
    ref = st.basedOn;
  }
  return null;
}

/**
 * 텍스트 정규화(문자 단위) — 기존 문자열 정규화 `replace(/[ \t]+$/gm,'').trim()` 와
 * 결과가 정확히 일치하도록 동일 규칙을 {ch,run,para} 배열에 적용한다(코드유닛 단위).
 * per-run 오프셋은 반드시 이 '정규화 후' 텍스트 기준이어야 한다(실측 §5: u187 끝공백 탈락,
 * u627/u74b 말미 Br-only run 통째 소멸).
 */
function normalizeStoryChars(chars) {
  const out = [];
  for (const c of chars) {
    if (c.ch === '\n') {
      // /[ \t]+$/gm — 각 줄 끝(개행 직전)의 스페이스/탭 제거
      while (out.length && (out[out.length - 1].ch === ' ' || out[out.length - 1].ch === '\t')) out.pop();
    }
    out.push(c);
  }
  while (out.length && (out[out.length - 1].ch === ' ' || out[out.length - 1].ch === '\t')) out.pop();
  // .trim() — 양 끝의 JS 공백문자(개행 포함) 제거. 단일 문자 trim 결과가 '' 인지가 동일 술어.
  while (out.length && out[0].ch.trim() === '') out.shift();
  while (out.length && out[out.length - 1].ch.trim() === '') out.pop();
  return out;
}

/** 정규화된 {ch,idx} 배열에서 idx(>=0) 연속 구간 → [{idx,start,end}] */
function rangesByIndex(normChars, key) {
  const ranges = [];
  normChars.forEach((c, i) => {
    const v = c[key];
    if (v == null || v < 0) return;
    const last = ranges[ranges.length - 1];
    if (last && last.idx === v && last.end === i) last.end = i + 1;
    else ranges.push({ idx: v, start: i, end: i + 1 });
  });
  return ranges;
}

/**
 * Story_*.xml → { self, text, font, sizePt, fillColor, vertical, runs, paragraphs, autoLeadingPct }.
 * 단락(ParagraphStyleRange) 사이 + 줄바꿈(Br)을 모두 '\n' 으로 보존 → 다단 텍스트 영역 이탈 방지.
 * vertical: StoryPreference@StoryOrientation="Vertical"(세로짜기). 회전(angle)이 아니라
 * 글자가 똑바로 선 채 위→아래로 쌓이는 CJK 세로조판 — 변환기에서 글자 단위 세로 배치로 근사.
 *
 * per-run 보존(A2):
 *  - runs: [{ start, end, text, font, fontStyle, sizePt, fillColor, tracking, leadingPt, underline,
 *    horizontalScale }] — start/end 는 '정규화 후' text 의 [start,end) 코드유닛 구간('\n' 포함 인덱싱).
 *  - paragraphs: [{ start, end, justification }] — PSR 단위. Justification absent 시
 *    AppliedParagraphStyle 의 BasedOn 체인으로 해석(실측: 기본 LeftJustified).
 *  - leadingPt: CSR Properties/Leading type="unit" 의 pt 값, 그 외('auto' 포함 absent)는 'auto'
 *    (실측: absent = AutoLeading 120%).
 *  - font/sizePt/fillColor(스토리 단일값)는 기존 '첫 non-null 승자' 의미 그대로 유지(하위 호환).
 */
function parseStory(xml, styleCtx = {}) {
  const { paragraphStyles = null, autoLeadingPct = 120 } = styleCtx;
  const top = storyParser.parse(xml);
  const story = deepFindOrdered(top, 'Story');
  if (!story) return null;
  const self = attrsOf(story)['@_Self'];
  const storyPref = findChild(story, 'StoryPreference');
  const vertical = storyPref
    ? attrsOf(storyPref)['@_StoryOrientation'] === 'Vertical'
    : false;
  let rawText = '';
  let font;
  let sizePt;
  let fillColor;
  const runDefs = []; // CSR 단위 스타일
  const paraDefs = []; // PSR 단위 단락 속성
  const chars = []; // { ch, run, para } — run/para 는 위 배열 인덱스, 단락 구분 '\n' 은 run=-1
  const pushChars = (s, run, para) => {
    // 코드유닛 단위(서러게이트 분리 포함) — 문자열 정규식 정규화와 결과 동치 보장
    for (let i = 0; i < s.length; i++) chars.push({ ch: s[i], run, para });
  };
  const psrs = findChildren(story, 'ParagraphStyleRange');
  psrs.forEach((psr, pi) => {
    const pa = attrsOf(psr);
    const justification =
      pa['@_Justification'] != null
        ? String(pa['@_Justification'])
        : resolveParaStyleAttr(paragraphStyles, pa['@_AppliedParagraphStyle'], 'justification');
    paraDefs.push({ justification: justification || null });
    for (const csr of findChildren(psr, 'CharacterStyleRange')) {
      const a = attrsOf(csr);
      if (sizePt == null && a['@_PointSize'] != null) sizePt = num(a['@_PointSize']);
      if (fillColor == null && a['@_FillColor'] != null) fillColor = a['@_FillColor'];
      const props = findChild(csr, 'Properties');
      const af = props ? findChild(props, 'AppliedFont') : null;
      const runFont = af ? innerText(af).trim() : ''; // trimValues:false — 폰트명 끝공백 제거(실측 '태나다체   ')
      if (!font && runFont) font = runFont;
      // Leading: <Properties><Leading type="unit">14</Leading> 만 명시 pt — 그 외는 'auto'
      let leadingPt = 'auto';
      const leadNode = props ? findChild(props, 'Leading') : null;
      if (leadNode && attrsOf(leadNode)['@_type'] === 'unit') {
        const lv = innerText(leadNode);
        if (lv !== '' && !Number.isNaN(num(lv))) leadingPt = num(lv);
      }
      const runIdx =
        runDefs.push({
          font: runFont || null,
          fontStyle: a['@_FontStyle'] != null ? String(a['@_FontStyle']) : null,
          sizePt: a['@_PointSize'] != null ? num(a['@_PointSize']) : null,
          fillColor: a['@_FillColor'] != null ? String(a['@_FillColor']) : null,
          tracking: a['@_Tracking'] != null ? num(a['@_Tracking']) : 0,
          leadingPt,
          underline: a['@_Underline'] === 'true',
          horizontalScale: a['@_HorizontalScale'] != null ? num(a['@_HorizontalScale']) : 100,
        }) - 1;
      // CSR 자식을 순서대로: Content=텍스트, Br=줄바꿈
      for (const child of childrenOf(csr)) {
        const k = keyOf(child);
        if (k === 'Content') {
          const t = innerText(child);
          rawText += t;
          pushChars(t, runIdx, pi);
        } else if (k === 'Br') {
          rawText += '\n';
          chars.push({ ch: '\n', run: runIdx, para: pi });
        }
      }
    }
    if (pi < psrs.length - 1) {
      rawText += '\n'; // 단락 구분
      chars.push({ ch: '\n', run: -1, para: pi });
    }
  });

  const legacyText = rawText.replace(/[ \t]+$/gm, '').trim();
  const normChars = normalizeStoryChars(chars);
  const normText = normChars.map((c) => c.ch).join('');

  let runs = [];
  let paragraphs = [];
  let runFallback = false;
  if (normText === legacyText) {
    runs = rangesByIndex(normChars, 'run').map((r) => ({
      start: r.start,
      end: r.end,
      text: normText.slice(r.start, r.end),
      ...runDefs[r.idx],
    }));
    paragraphs = rangesByIndex(normChars, 'para').map((r) => ({
      start: r.start,
      end: r.end,
      justification: paraDefs[r.idx]?.justification || null,
    }));
  }
  else {
    // (방어) 문자배열 정규화 ≠ 문자열 정규화 — 절대 일어나면 안 되지만, 어긋나면 per-run 을
    // 포기하고 단일 스타일 폴백(runs:[])로 안전 강하. 크래시/오프셋 오염 금지.
    // runFallback 신호로 호출측(toSpreadTemplate)이 경고를 노출해 운영 중 감지 가능하게 한다.
    runFallback = true;
  }

  return {
    self,
    text: legacyText,
    font,
    sizePt,
    fillColor,
    vertical,
    runs,
    paragraphs,
    runFallback,
    autoLeadingPct,
  };
}

function deepFind(obj, key) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (!Array.isArray(obj) && key in obj) return obj[key];
  for (const k of Object.keys(obj)) {
    const r = deepFind(obj[k], key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * Graphic.xml → Map(colorId → { space, value:[..], hex, model, isSpot, spotName }).
 * 별색(Spot)/혼합잉크(Mixed Ink)는 4도 근사 시 손실되므로 @_Model 기준으로 감지·보존한다.
 */
function collectColors(parsed) {
  const colors = deepFind(parsed, 'Color') || [];
  const map = new Map();
  for (const c of colors) {
    const self = c['@_Self'];
    const space = c['@_Space'];
    const value = c['@_ColorValue'] ? parseNums(c['@_ColorValue']) : [];
    const model = c['@_Model'];
    // ⚠️ 별색 판정은 반드시 @_Model 기준(Space 아님) — Spot 도 Space=CMYK 인 경우가 많다.
    const isSpot = model === 'Spot' || model === 'Mixed Ink';
    // @_Name 우선, 없으면 @_Self 에서 'Color/' 접두 제거.
    const spotName = c['@_Name'] != null ? c['@_Name'] : String(self).replace(/^Color\//, '');
    map.set(self, { space, value, hex: colorToHex(space, value), model, isSpot, spotName });
  }
  return map;
}

function parseColors(xml) {
  return collectColors(parser.parse(xml));
}

/** GradientStop 의 StopColor 참조 해석 — resolveColor(toSpreadTemplate)와 동일 특수규칙 */
function resolveStopColor(stopColorId, colors) {
  const out = { stopColorId: stopColorId || null };
  if (!stopColorId || /\/None$/.test(stopColorId)) return { ...out, color: '#ffffff', isNone: true };
  if (/\/Paper$/.test(stopColorId)) return { ...out, color: '#ffffff', isPaper: true };
  const c = colors.get(stopColorId);
  if (!c) return { ...out, color: null, unknown: stopColorId };
  return {
    ...out,
    color: c.hex,
    ...(c.space === 'CMYK' ? { cmyk: c.value } : {}),
    ...(c.isSpot ? { isSpot: true, spotName: c.spotName } : {}),
  };
}

/**
 * Graphic.xml → Map(gradientId → { self, type:'linear'|'radial', name, stops }).
 * stops: [{ offset(0~1), color(hex), midpoint(0~100, 기본 50), cmyk?, isSpot?, spotName?,
 *           isPaper?, isNone?, unknown?, stopColorId }] — offset 오름차순.
 * 스톱 색 참조(StopColor="Color/...")는 같은 Graphic.xml 의 색 정의로 hex 화한다.
 * (Midpoint 는 '이전 스톱과 이 스톱 사이' 50% 혼합점 위치 — 변환기에서 ≠50 시 중간 스톱 합성.)
 */
export function parseGradients(xml) {
  const o = parser.parse(xml);
  const colors = collectColors(o);
  const grads = deepFind(o, 'Gradient') || [];
  const map = new Map();
  for (const g of grads) {
    const self = g['@_Self'];
    if (self == null) continue;
    const stops = (g.GradientStop || [])
      .map((s) => ({
        offset: s['@_Location'] != null ? num(s['@_Location']) / 100 : 0,
        midpoint: s['@_Midpoint'] != null ? num(s['@_Midpoint']) : 50,
        ...resolveStopColor(s['@_StopColor'], colors),
      }))
      .sort((a, b) => a.offset - b.offset);
    map.set(self, {
      self,
      type: g['@_Type'] === 'Radial' ? 'radial' : 'linear',
      name: g['@_Name'] != null ? String(g['@_Name']) : null,
      stops,
    });
  }
  return map;
}

/** CMYK/RGB ColorValue → 근사 sRGB hex */
export function colorToHex(space, value) {
  if (space === 'CMYK' && value.length >= 4) {
    const [c, m, y, k] = value.map((v) => v / 100);
    const r = Math.round(255 * (1 - c) * (1 - k));
    const g = Math.round(255 * (1 - m) * (1 - k));
    const b = Math.round(255 * (1 - y) * (1 - k));
    return rgbHex(r, g, b);
  }
  if (space === 'RGB' && value.length >= 3) {
    return rgbHex(value[0], value[1], value[2]);
  }
  return null;
}
const rgbHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');

function parseFonts(xml) {
  // 폰트명 끝공백 trim — IDML 원본에 '태나다체   ' 같은 패딩이 실존(실측). textbox fontFamily
  // (parseStory, trim 적용)와 시딩 목록이 같은 표기를 쓰도록 정규화.
  const families = [...xml.matchAll(/<FontFamily\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1].trim());
  return [...new Set(families)];
}

function parseBleedPt(xml) {
  const m = xml.match(/DocumentBleedTopOffset="([^"]+)"/);
  return m ? num(m[1]) : null;
}

/**
 * IDML(Buffer/Uint8Array/ArrayBuffer) → IdmlDoc.
 * @returns {Promise<{ pages, items, colors, gradients, fonts, bleedPt }>}
 */
export async function parseIdml(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // Spread — 순서보존 파서로 z-순서 유지
  const spreadName = Object.keys(zip.files).find((n) => /^Spreads\/Spread_.*\.xml$/.test(n));
  const spreadXml = await zip.files[spreadName].async('string');
  const top = orderedParser.parse(spreadXml);
  const spread = deepFindOrdered(top, 'Spread');
  if (!spread) throw new Error('Spread 를 찾을 수 없습니다');

  // 페이지: GeometricBounds "y1 x1 y2 x2"(pt) + ItemTransform 로 스프레드 좌표 계산
  const pages = findChildren(spread, 'Page').map((pg) => {
    const a = attrsOf(pg);
    const [y1, x1, y2, x2] = parseNums(a['@_GeometricBounds']);
    const t = fromItemTransform(parseNums(a['@_ItemTransform']));
    const topLeft = applyToPoint(t, x1, y1);
    return {
      self: a['@_Self'],
      name: a['@_Name'],
      widthPt: x2 - x1,
      heightPt: y2 - y1,
      leftSpreadPt: topLeft.x,
      topSpreadPt: topLeft.y,
    };
  });

  // 페이지아이템 — 문서 순서대로(z-순서 보존)
  const items = [];
  collectItemsOrdered(childrenOf(spread), IDENTITY, items);

  // 색상 / 그라디언트 / 폰트 / 블리드
  const graphicXml = zip.files['Resources/Graphic.xml']
    ? await zip.files['Resources/Graphic.xml'].async('string')
    : null;
  const colors = graphicXml ? parseColors(graphicXml) : new Map();
  const gradients = graphicXml ? parseGradients(graphicXml) : new Map();
  const fonts = zip.files['Resources/Fonts.xml']
    ? parseFonts(await zip.files['Resources/Fonts.xml'].async('string'))
    : [];
  const bleedPt = zip.files['Resources/Preferences.xml']
    ? parseBleedPt(await zip.files['Resources/Preferences.xml'].async('string'))
    : null;

  // 단락 스타일 시트(Justification/AutoLeading 기본값 해석용)
  const paragraphStyles = zip.files['Resources/Styles.xml']
    ? parseParagraphStyles(await zip.files['Resources/Styles.xml'].async('string'))
    : null;
  // 문서 기본 AutoLeading(%) — 루트 [No paragraph style] 보유(실측: 양 문서 120)
  const rootPara = paragraphStyles?.get('ParagraphStyle/$ID/[No paragraph style]');
  const autoLeadingPct = rootPara?.autoLeadingPct != null ? rootPara.autoLeadingPct : 120;
  const styleCtx = { paragraphStyles, autoLeadingPct };

  // 스토리(텍스트)
  const stories = new Map();
  for (const name of Object.keys(zip.files)) {
    if (/^Stories\/Story_.*\.xml$/.test(name)) {
      const st = parseStory(await zip.files[name].async('string'), styleCtx);
      if (st && st.self) stories.set(st.self, st);
    }
  }
  for (const it of items) {
    if (it.type === 'TextFrame' && it.parentStory) {
      it.story = stories.get(it.parentStory) || null;
    }
  }

  return { pages, items, colors, gradients, fonts, bleedPt };
}
