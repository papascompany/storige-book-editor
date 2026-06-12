// 변환 결과(draft DTO) → 미리보기 SVG 문자열 (순수 함수, fs 미사용 — 브라우저/노드 공용).
// 폴리곤은 복원된 path(절대 캔버스 px)를 그룹 스케일로 렌더.
// 좌표: 객체 left/top 은 scene(중앙원점), viewBox/region/path 는 content(좌상단원점). 비-path
// 객체는 sceneToContent(centerOrigin.mjs SSOT)로 환산. (docs/COORDINATE_SYSTEM.md)

import { halvesOf, sceneToContentX, sceneToContentY } from '../geometry/centerOrigin.mjs';
import { isGradientFill, svgGradientFor } from '../render/svgGradient.mjs';

const esc = (t) =>
  String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * @param {object} dto  toSpreadTemplate().draftTemplateDto
 * @param {{width?:number}} [opts]  출력 SVG 가로폭(px). 기본 1100.
 * @returns {string} SVG markup
 */
export function buildPreviewSvg(dto, opts = {}) {
  const cw = dto.canvasData.width;
  const ch = dto.canvasData.height;
  const targetW = opts.width || 1100;
  const scale = targetW / cw;
  const W = Math.round(cw * scale);
  const H = Math.round(ch * scale);
  const s = (v) => v * scale;
  // 객체 left/top 은 scene(중앙원점)인데 viewBox/region/path 는 content(좌상단원점, 0..W).
  // 비-path 객체(image/rect/ellipse/textbox)는 sceneToContent 로 환산해야 region 가이드·path 와
  // 정합한다. (path 의 d 는 이미 콘텐츠 절대 px → 변환 제외.)
  const { halfW, halfH } = halvesOf(cw, ch);
  const cX = (left) => sceneToContentX(left, halfW); // scene.left → content.x
  const cY = (top) => sceneToContentY(top, halfH);   // scene.top  → content.y

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#f4f4f5"/>`);

  // 영역 경계 + 라벨 (단일 페이지 = spreadConfig 없음 → 스킵)
  for (const r of dto.spreadConfig?.regions || []) {
    if (r.width <= 0) continue;
    parts.push(`<rect x="${s(r.x)}" y="0" width="${s(r.width)}" height="${H}" fill="none" stroke="#c026d3" stroke-dasharray="6 4" stroke-width="1"/>`);
    parts.push(`<text x="${s(r.x + r.width / 2)}" y="14" fill="#c026d3" font-size="11" text-anchor="middle" font-family="sans-serif">${esc(r.kind)}</text>`);
  }

  // 도형/이미지 (center origin)
  let gi = 0; // 그라디언트 id 폴백 카운터(객체 id 부재 시)
  for (const o of dto.canvasData.objects) {
    if (o.type === 'textbox') continue;
    // 하이브리드 모드: 디자인 아트워크 이미지(최하단). scale 반영해 캔버스 전체 커버.
    if (o.type === 'image' && o.src) {
      const dw = (o.width || 0) * (o.scaleX || 1);
      const dh = (o.height || 0) * (o.scaleY || 1);
      parts.push(`<image href="${o.src}" x="${s(cX(o.left) - dw / 2)}" y="${s(cY(o.top) - dh / 2)}" width="${s(dw)}" height="${s(dh)}" preserveAspectRatio="none"/>`);
      continue;
    }
    const w = o.width || 12;
    const h = o.height || 12;
    const x = s(cX(o.left) - w / 2);
    const y = s(cY(o.top) - h / 2);
    // 그라디언트 fill — raster(buildArtworkSvg)와 동일한 공통 헬퍼로 defs 출력(중복 구현 금지).
    // objectBoundingBox 정규화라 path 의 transform="scale(s)" 에도 불변.
    // flipY 객체는 도형을 미러 없이 그리므로 그라디언트 y 를 1−y 반전(공통 헬퍼 옵션).
    let fill;
    if (isGradientFill(o.fill)) {
      const g = svgGradientFor(o.fill, { id: o.id ?? `i${gi}`, width: w, height: h, flipY: !!o.flipY });
      parts.push(`<defs>${g.def}</defs>`);
      fill = g.ref;
    } else {
      fill = o.fill && o.fill !== '' ? o.fill : 'none';
    }
    gi++;
    // 스트로크는 path/ellipse/rect 3종 모두 동일 적용 — raster(buildArtworkSvg)와 패리티
    // (renderInvariants 정신: FULL/FLAT 한쪽만 반영 금지. 종전엔 path 만 적용돼 잠복 갭).
    // path 는 transform="scale()" 이 스트로크까지 스케일하므로 비스케일 굵기를 쓴다
    // (스케일 곱하면 scale² 이중 축소 — 적대 리뷰 2026-06-12). rect/ellipse 는 사전
    // 스케일 geometry(transform 없음)라 ×scale 1회가 정확.
    const strokeAttr = o.stroke ? ` stroke="${o.stroke}" stroke-width="${(o.strokeWidth || 1) * scale}"` : '';
    const strokeAttrUnscaled = o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.strokeWidth || 1}"` : '';
    // 도형 회전 — rasterize.mjs 의 rotate 그룹과 동일 패턴(미리보기↔래스터 패리티).
    // 회전 중심 = 객체 중심(중앙원점 객체의 left/top 은 center).
    const rot = o.angle && !o.path ? ` transform="rotate(${o.angle} ${s(cX(o.left))} ${s(cY(o.top))})"` : '';
    if (o.path) {
      parts.push(`<path d="${o.path}" transform="scale(${scale})" fill="${fill}"${strokeAttrUnscaled} opacity="0.92"/>`);
    } else if (o.type === 'ellipse') {
      parts.push(`<ellipse cx="${s(cX(o.left))}" cy="${s(cY(o.top))}" rx="${s(w / 2)}" ry="${s(h / 2)}" fill="${fill}"${strokeAttr}${rot} opacity="0.9"/>`);
    } else {
      // rect rx/ry = 라운드 코너(A6) — raster 와 동일 충실도, 출력 스케일(s) 반영.
      const rxAttr = o.rx ? ` rx="${s(o.rx)}" ry="${s(o.ry != null ? o.ry : o.rx)}"` : '';
      parts.push(`<rect x="${x}" y="${y}" width="${s(w)}" height="${s(h)}"${rxAttr} fill="${fill}"${strokeAttr}${rot} opacity="0.92"/>`);
    }
  }

  // 텍스트 (위로). angle(예: 책등 세로쓰기 90°)을 중심 기준으로 회전 렌더.
  for (const o of dto.canvasData.objects) {
    if (o.type !== 'textbox' || !o.text) continue;
    const fs = Math.max(7, s(o.fontSize || 24));
    const cx = s(cX(o.left));
    const cy = s(cY(o.top));
    const angle = o.angle || 0;
    const lines = String(o.text).split('\n');
    const blockH = lines.length * fs;
    const g = angle ? `<g transform="rotate(${angle} ${cx} ${cy})">` : '<g>';
    parts.push(g);
    lines.forEach((ln, i) => {
      // 블록을 중심에 맞춰 세로 정렬
      const y = cy - blockH / 2 + (i + 0.8) * fs;
      parts.push(`<text x="${cx}" y="${y}" fill="${o.fill || '#000'}" font-size="${fs}" text-anchor="middle" font-family="sans-serif">${esc(ln)}</text>`);
    });
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}
