// PSD 리더 — @webtoon/psd 로 PSD 파싱 → 레이어 분리.
//
// 하이브리드 변환 전략:
//   - 텍스트 레이어  → 편집가능 textbox 로 분리(내용 + 근사 폰트/크기/색). 관리자가 에디터에서 확정.
//   - 비텍스트 레이어 → "추출 레이어 제외 합성" PNG 의 재료(rasterizePsd 에서 합성).
//   ⚠️ 배경 PNG 는 반드시 '텍스트 레이어를 제외'하고 합성해야 텍스트가 두 번 찍히지 않는다.
//
// 좌표/해상도: PSD 는 px + resolutionInfo(DPI) → 물리 mm 변환. CMYK PSD 는 @webtoon/psd 지원 제한.

import Psd from '@webtoon/psd';

/** PSD ColorMode enum: CMYK=4 (인쇄용) */
const COLORMODE_CMYK = 4;

const toArrayBuffer = (buf) => {
  if (buf instanceof ArrayBuffer) return buf;
  // Uint8Array/Buffer → 해당 구간만 ArrayBuffer 로
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

/** EngineData(텍스트 속성)에서 근사 폰트/크기/색 추출 — best effort, 실패 시 부분값/undefined */
function extractTextStyle(engine) {
  const out = {};
  try {
    const sr = engine?.EngineDict?.StyleRun?.RunArray?.[0]?.StyleSheet?.StyleSheetData;
    if (sr) {
      if (typeof sr.FontSize === 'number') out.fontSizePt = sr.FontSize; // 근사(변환 스케일 미반영)
      const v = sr.FillColor?.Values; // [a, r, g, b] 0..1
      if (Array.isArray(v) && v.length >= 4) {
        out.fill = rgbHex(Math.round(v[1] * 255), Math.round(v[2] * 255), Math.round(v[3] * 255));
      }
      const fontIndex = sr.Font;
      const fontName = engine?.ResourceDict?.FontSet?.[fontIndex]?.Name;
      if (fontName) out.fontName = String(fontName);
    }
  } catch {
    // 엔진 데이터 구조가 달라도 무시(관리자 보정 전제)
  }
  return out;
}
const rgbHex = (r, g, b) =>
  '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');

/** 레이어 트리를 z-순서 평탄화(Group 재귀). @webtoon/psd children 순서 보존. */
function flattenLayers(nodes, acc) {
  for (const node of nodes || []) {
    if (node.type === 'Group') {
      flattenLayers(node.children, acc);
    } else if (node.type === 'Layer') {
      acc.push(node);
    }
  }
}

/**
 * PSD(ArrayBuffer/Uint8Array) → { widthPx, heightPx, dpi, colorMode, isCmyk, layers, warnings }.
 * layers: z-순서. 각 항목 { kind:'text'|'raster', name, left, top, width, height, text?, fontSizePt?, fill?, fontName?, rgba? }
 */
export async function parsePsd(buffer) {
  const psd = Psd.parse(toArrayBuffer(buffer));
  const widthPx = psd.width;
  const heightPx = psd.height;

  // 해상도 → DPI (PixelsPerInch=1, PixelsPerCM=2)
  let dpi = 72;
  const ri = psd.resolutionInfo;
  if (ri && ri.horizontal) {
    dpi = ri.horizontalUnit === 2 ? ri.horizontal * 2.54 : ri.horizontal;
  }
  const isCmyk = psd.colorMode === COLORMODE_CMYK;

  const warnings = [];
  if (!ri || !ri.horizontal) warnings.push('PSD 해상도 정보 없음 — 72dpi 로 가정(인쇄 치수 확인 필요)');
  if (Math.round(dpi) < 300) warnings.push(`소스 해상도 ${Math.round(dpi)}dpi (<300) — 인쇄 화질 부족 가능(원본 고해상 권장)`);
  if (isCmyk) warnings.push('CMYK PSD — @webtoon/psd 지원 제한적. 색/래스터가 부정확할 수 있어 검수 필요');

  const flat = [];
  flattenLayers(psd.children, flat);
  // @webtoon/psd children 는 '위→아래'(children[0]=최상단) 순서. 합성/렌더는 '아래부터'라야
  // 하므로 뒤집어 bottom→top 으로 만든다(배경이 맨 아래, 텍스트가 위).
  flat.reverse();

  const layers = [];
  for (const layer of flat) {
    if (layer.isHidden) continue;
    const isText = typeof layer.text === 'string' && layer.text.length > 0;

    if (isText) {
      // ⚠️ 텍스트 레이어는 픽셀 bbox 가 0 일 수 있음(특히 합성 PSD) → 0-size 라도 스킵하지 않는다.
      const style = extractTextStyle(layer.textProperties);
      const text = layer.text.replace(/\r\n?/g, '\n'); // Photoshop 줄바꿈(\r) 정규화
      let { left, top, width: w, height: h } = layer;
      if (!w || !h) {
        // 픽셀 bbox 부재 → 폰트/내용으로 근사 박스(관리자 보정 전제)
        const fsPx = (style.fontSizePt || 24) * (dpi / 72);
        const lines = text.split('\n');
        const maxChars = Math.max(1, ...lines.map((s) => s.length));
        w = Math.min(widthPx - left, Math.round(maxChars * fsPx * 0.55)) || Math.round(fsPx * 4);
        h = Math.round(lines.length * fsPx * 1.25);
      }
      layers.push({ kind: 'text', name: layer.name, left, top, width: w, height: h, text, ...style });
    } else {
      const w = layer.width;
      const h = layer.height;
      if (!w || !h) continue; // 빈 비텍스트 레이어 스킵
      let rgba = null;
      try {
        rgba = await layer.composite(true, false); // effect 적용, 단일 레이어(미합성)
      } catch {
        warnings.push(`레이어 "${layer.name}" 픽셀 추출 실패 — 배경에서 누락됨`);
      }
      if (rgba) layers.push({ kind: 'raster', name: layer.name, left: layer.left, top: layer.top, width: w, height: h, rgba });
    }
  }

  if (layers.filter((l) => l.kind === 'text').length === 0) {
    warnings.push('편집 가능한 텍스트 레이어 없음 — 디자인이 전부 래스터일 수 있음(텍스트는 관리자가 추가)');
  }

  return { widthPx, heightPx, dpi, colorMode: psd.colorMode, isCmyk, layers, warnings };
}
