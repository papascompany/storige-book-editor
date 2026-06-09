// 단일 페이지 템플릿 빌더 — 명함/내지 단품 등(펼침면 아님).
// PSD 파싱결과 + 합성 배경 PNG → type='page'|'cover' Template DTO (spreadConfig 없음).
//
// 좌표: PSD px → 물리 mm(소스 dpi) → 캔버스 px(템플릿 dpi 150). 모든 스케일 = 150/sourceDpi.
// 텍스트는 편집가능 textbox(근사 폰트/크기/색) — 관리자가 에디터에서 확정.

import { roundMm01, DEFAULT_DPI } from '../geometry/units.mjs';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * @param {{widthPx,heightPx,dpi,layers,warnings,isCmyk}} parsed  parsePsd() 결과
 * @param {{dataUrl,widthPx,heightPx}|null} background  비텍스트 합성 PNG(없으면 null)
 * @param {{name?:string, pageType?:('page'|'cover'), templateDpi?:number}} [opts]
 */
export function toSinglePageTemplate(parsed, background, opts = {}) {
  const tdpi = opts.templateDpi || DEFAULT_DPI; // 150
  const sourceDpi = parsed.dpi || 72;
  const name = opts.name || 'Imported Page';
  const pageType = opts.pageType === 'cover' ? 'cover' : 'page';

  const widthMm = roundMm01((parsed.widthPx / sourceDpi) * 25.4);
  const heightMm = roundMm01((parsed.heightPx / sourceDpi) * 25.4);
  const pxScale = tdpi / sourceDpi; // PSD px → 캔버스 px
  const canvasW = round2(parsed.widthPx * pxScale);
  const canvasH = round2(parsed.heightPx * pxScale);

  const objects = [];

  // 1) 배경 아트워크(비텍스트 합성, 최하단)
  if (background?.dataUrl) {
    objects.push({
      type: 'image',
      id: 'psd-artwork',
      src: background.dataUrl,
      left: round2(canvasW / 2),
      top: round2(canvasH / 2),
      width: background.widthPx,
      height: background.heightPx,
      scaleX: round4(canvasW / background.widthPx),
      scaleY: round4(canvasH / background.heightPx),
      selectable: true,
      evented: true,
      isUserAdded: false,
      meta: { regionRef: null, anchor: { kind: 'canvas', x: round2(canvasW / 2), y: round2(canvasH / 2) } },
    });
  }

  // 2) 텍스트 레이어 → 편집가능 textbox(근사값)
  let ti = 0;
  for (const l of parsed.layers) {
    if (l.kind !== 'text') continue;
    const cx = (l.left + l.width / 2) * pxScale;
    const cy = (l.top + l.height / 2) * pxScale;
    const w = l.width * pxScale;
    const h = l.height * pxScale;
    // 폰트 크기: EngineData pt 우선(pt→px@tdpi), 없으면 레이어 높이 근사
    const fontSize = l.fontSizePt ? round2((l.fontSizePt * tdpi) / 72) : Math.max(8, round2(h * 0.7));
    const obj = {
      type: 'textbox',
      id: `psd-text-${ti++}`,
      left: round2(cx),
      top: round2(cy),
      width: round2(w),
      height: round2(h),
      fontSize,
      fill: l.fill || '#000000',
      text: l.text,
      selectable: true,
      evented: true,
      isUserAdded: false,
      meta: { regionRef: null, anchor: { kind: 'canvas', x: round2(cx), y: round2(cy) } },
      _psd: { name: l.name, approx: true },
    };
    if (l.fontName) obj.fontFamily = l.fontName;
    objects.push(obj);
  }

  const warnings = [...(parsed.warnings || [])];
  const fonts = [...new Set(parsed.layers.filter((l) => l.kind === 'text' && l.fontName).map((l) => l.fontName))];
  if (fonts.length) warnings.push(`폰트 확정 필요(추출 추정): ${fonts.join(', ')}`);
  warnings.push('텍스트 폰트/크기/효과는 추출 근사값입니다 — 에디터에서 관리자 확정 필요');

  const draftTemplateDto = {
    name,
    type: pageType, // 'page'(내지/단품) | 'cover'(표지). spreadConfig 없음(단일 페이지).
    width: widthMm,
    height: heightMm,
    canvasData: { version: '5.3.0', width: canvasW, height: canvasH, objects },
  };

  return {
    draftTemplateDto,
    widthMm,
    heightMm,
    textCount: objects.filter((o) => o.type === 'textbox').length,
    rasterCount: parsed.layers.filter((l) => l.kind === 'raster').length,
    warnings,
    fonts,
  };
}
