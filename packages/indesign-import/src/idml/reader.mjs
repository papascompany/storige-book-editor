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

// 비순서 파서 — 스토리/색상/폰트(순서 무관)
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['ParagraphStyleRange', 'CharacterStyleRange', 'Color'].includes(name),
});

// 순서보존 파서 — 스프레드 geometry(z-순서) + 스토리(줄바꿈 Br 순서) 보존.
// parseTagValue:false → 텍스트(#text)를 숫자로 변환하지 않음(예: "2026" 보존).
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseTagValue: false,
});

const num = (s) => Number(s);
const parseNums = (s) => String(s).trim().split(/\s+/).map(num);

// ── preserveOrder 노드 헬퍼 (노드 = { [tag]: childrenArray, ':@': attrs }) ──
const keyOf = (node) => {
  for (const k of Object.keys(node)) if (k !== ':@') return k;
  return null;
};
const attrsOf = (node) => node[':@'] || {};
const childrenOf = (node) => node[keyOf(node)] || [];
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

/**
 * Story_*.xml → { self, text, font, sizePt, fillColor } (순서보존 파서).
 * 단락(ParagraphStyleRange) 사이 + 줄바꿈(Br)을 모두 '\n' 으로 보존 → 다단 텍스트 영역 이탈 방지.
 */
function parseStory(xml) {
  const top = orderedParser.parse(xml);
  const story = deepFindOrdered(top, 'Story');
  if (!story) return null;
  const self = attrsOf(story)['@_Self'];
  let text = '';
  let font;
  let sizePt;
  let fillColor;
  const psrs = findChildren(story, 'ParagraphStyleRange');
  psrs.forEach((psr, pi) => {
    for (const csr of findChildren(psr, 'CharacterStyleRange')) {
      const a = attrsOf(csr);
      if (sizePt == null && a['@_PointSize'] != null) sizePt = num(a['@_PointSize']);
      if (fillColor == null && a['@_FillColor'] != null) fillColor = a['@_FillColor'];
      const props = findChild(csr, 'Properties');
      const af = props ? findChild(props, 'AppliedFont') : null;
      if (!font && af) {
        const f = innerText(af);
        if (f) font = f;
      }
      // CSR 자식을 순서대로: Content=텍스트, Br=줄바꿈
      for (const child of childrenOf(csr)) {
        const k = keyOf(child);
        if (k === 'Content') text += innerText(child);
        else if (k === 'Br') text += '\n';
      }
    }
    if (pi < psrs.length - 1) text += '\n'; // 단락 구분
  });
  return { self, text: text.replace(/[ \t]+$/gm, '').trim(), font, sizePt, fillColor };
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
function parseColors(xml) {
  const o = parser.parse(xml);
  const colors = deepFind(o, 'Color') || [];
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
  const families = [...xml.matchAll(/<FontFamily\b[^>]*\bName="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(families)];
}

function parseBleedPt(xml) {
  const m = xml.match(/DocumentBleedTopOffset="([^"]+)"/);
  return m ? num(m[1]) : null;
}

/**
 * IDML(Buffer/Uint8Array/ArrayBuffer) → IdmlDoc.
 * @returns {Promise<{ pages, items, colors, fonts, bleedPt }>}
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

  // 색상 / 폰트 / 블리드
  const colors = zip.files['Resources/Graphic.xml']
    ? parseColors(await zip.files['Resources/Graphic.xml'].async('string'))
    : new Map();
  const fonts = zip.files['Resources/Fonts.xml']
    ? parseFonts(await zip.files['Resources/Fonts.xml'].async('string'))
    : [];
  const bleedPt = zip.files['Resources/Preferences.xml']
    ? parseBleedPt(await zip.files['Resources/Preferences.xml'].async('string'))
    : null;

  // 스토리(텍스트)
  const stories = new Map();
  for (const name of Object.keys(zip.files)) {
    if (/^Stories\/Story_.*\.xml$/.test(name)) {
      const st = parseStory(await zip.files[name].async('string'));
      if (st && st.self) stories.set(st.self, st);
    }
  }
  for (const it of items) {
    if (it.type === 'TextFrame' && it.parentStory) {
      it.story = stories.get(it.parentStory) || null;
    }
  }

  return { pages, items, colors, fonts, bleedPt };
}
