// 하이브리드 변환 모드용 래스터라이저.
//
// 목적: IDML에서 추출한 비텍스트 객체(도형/폴리곤/배경/이미지)를 300dpi PNG 한 장으로
//       "굽는다". 텍스트(textbox)는 제외하여, 상위 레이어(편집 가능한 텍스트)와
//       투명 PNG로 합성할 수 있게 한다.
//
// 환경: 브라우저(admin)와 Node(CLI/worker) 양쪽에서 동작.
//   - 브라우저: <img> + <canvas> 로 SVG를 래스터화 (외부 의존 없음).
//   - Node:    sharp 로 SVG → PNG 래스터화.
//
// 좌표 규약(입력 draftTemplateDto):
//   - 객체 left/top = 중심(center origin), width/height/strokeWidth 는 px.
//   - canvasData.width/height 는 px@150dpi (SVG viewBox 단위).
//   - obj.path 는 절대 캔버스 px 좌표의 SVG path `d` 문자열 → transform 불필요.
//   - 미리보기(preview/svg.mjs)와 달리 래스터는: opacity 1, 영역 가이드/라벨 없음,
//     textbox 제외, 흰 배경 미적용(투명 PNG).

const esc = (t) =>
  String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * 비텍스트 객체만 그린 아트워크 SVG 문자열을 만든다.
 * viewBox/width/height = 0 0 W H (W=canvasData.width, H=canvasData.height, px@150dpi).
 * 배경 없음 → 투명. opacity 1. 영역 가이드/라벨 없음. textbox 제외.
 *
 * @param {object} dto  toSpreadTemplate().draftTemplateDto ({canvasData, spreadConfig})
 * @returns {string} SVG markup
 */
export function buildArtworkSvg(dto) {
  const W = dto.canvasData.width;
  const H = dto.canvasData.height;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

  for (const o of dto.canvasData.objects) {
    if (o.type === 'textbox') continue;

    const left = o.left;
    const top = o.top;
    const w = o.width || 12;
    const h = o.height || 12;
    const fill = o.fill && o.fill !== '' ? o.fill : 'none';
    const strokeAttr = o.stroke
      ? ` stroke="${o.stroke}" stroke-width="${o.strokeWidth || 1}"`
      : '';

    // angle 이 있으면 객체 중심(left,top)을 축으로 회전 그룹으로 감싼다.
    const angle = o.angle || 0;
    if (angle) parts.push(`<g transform="rotate(${angle} ${left} ${top})">`);

    if (o.type === 'image' && o.src) {
      // 이미지: center → 좌상단 변환. href 로 data URL/URL 그대로 포함.
      const x = left - w / 2;
      const y = top - h / 2;
      parts.push(`<image href="${esc(o.src)}" xlink:href="${esc(o.src)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
    } else if (o.path) {
      // path 의 d 는 절대 캔버스 px 좌표 → transform 불필요.
      parts.push(`<path d="${o.path}" fill="${fill}"${strokeAttr}/>`);
    } else if (o.type === 'ellipse') {
      parts.push(`<ellipse cx="${left}" cy="${top}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${strokeAttr}/>`);
    } else {
      // rect (기본): center → 좌상단 변환.
      const x = left - w / 2;
      const y = top - h / 2;
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${strokeAttr}/>`);
    }

    if (angle) parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * 아트워크 SVG 를 목표 dpi(기본 300) PNG dataUrl 로 래스터화한다.
 * 목표 픽셀은 물리 치수(spreadConfig.totalWidthMm/HeightMm) 기준으로 계산하므로,
 * canvasData 의 px@150dpi 해상도와 무관하게 항상 인쇄 해상도로 굽는다.
 *
 * @param {object} dto  draftTemplateDto ({canvasData, spreadConfig})
 * @param {{dpi?:number}} [opts]
 * @returns {Promise<{dataUrl:string, widthPx:number, heightPx:number}>}
 */
export async function rasterizeArtwork(dto, opts = {}) {
  const dpi = opts.dpi || 300;

  // 물리 치수(mm) → 목표 픽셀. mm/25.4 = inch, * dpi = px.
  const widthPx = Math.round((dto.spreadConfig.totalWidthMm / 25.4) * dpi);
  const heightPx = Math.round((dto.spreadConfig.totalHeightMm / 25.4) * dpi);

  const svg = buildArtworkSvg(dto);

  if (typeof document !== 'undefined') {
    // 브라우저: SVG → <img> → <canvas> → toDataURL.
    const img = new Image();
    img.decoding = 'sync';
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error('artwork SVG image load failed'));
      img.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    // viewBox(W×H) 를 목표 픽셀(widthPx×heightPx)로 스케일 — 인쇄 해상도로 강제.
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, widthPx, heightPx };
  }

  // Node: sharp 로 래스터화.
  // sharp 의 SVG density 기본값은 72dpi 라 그대로 두면 작게 날 수 있으므로,
  // resize(fit:'fill') 로 목표 픽셀에 강제로 맞춘다(viewBox 비율 유지 불필요 — fill).
  // sharp 는 Node 전용 native 모듈. 브라우저(admin)에서는 이 분기가 실행되지 않는다.
  // 모듈명을 변수로 둬 번들러(Vite) 정적 분석이 'sharp' 를 해석/번들하지 못하게 한다.
  const sharpName = 'sharp';
  const sharp = (await import(/* @vite-ignore */ sharpName)).default;
  const buf = await sharp(Buffer.from(svg))
    .resize(widthPx, heightPx, { fit: 'fill' })
    .png()
    .toBuffer();
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  return { dataUrl, widthPx, heightPx };
}
