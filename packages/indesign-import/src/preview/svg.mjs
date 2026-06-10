// 변환 결과(draft DTO) → 미리보기 SVG 문자열 (순수 함수, fs 미사용 — 브라우저/노드 공용).
// 폴리곤은 복원된 path(절대 캔버스 px)를 그룹 스케일로 렌더.

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
  // 객체 left/top 은 '중앙원점' 좌표(toSpreadTemplate: centerXpx - halfW)인데 viewBox/region/path
  // 는 콘텐츠 좌상단원점(0..W). 비-path 객체(image/rect/ellipse/textbox)는 +halfW/+halfH 평행이동
  // 으로 콘텐츠 좌표로 환산해야 region 가이드·path 와 정합한다. (path 의 d 는 이미 콘텐츠 절대 px.)
  const halfW = cw / 2;
  const halfH = ch / 2;

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
  for (const o of dto.canvasData.objects) {
    if (o.type === 'textbox') continue;
    // 하이브리드 모드: 디자인 아트워크 이미지(최하단). scale 반영해 캔버스 전체 커버.
    if (o.type === 'image' && o.src) {
      const dw = (o.width || 0) * (o.scaleX || 1);
      const dh = (o.height || 0) * (o.scaleY || 1);
      parts.push(`<image href="${o.src}" x="${s(o.left + halfW - dw / 2)}" y="${s(o.top + halfH - dh / 2)}" width="${s(dw)}" height="${s(dh)}" preserveAspectRatio="none"/>`);
      continue;
    }
    const w = o.width || 12;
    const h = o.height || 12;
    const x = s(o.left + halfW - w / 2);
    const y = s(o.top + halfH - h / 2);
    const fill = o.fill && o.fill !== '' ? o.fill : 'none';
    if (o.path) {
      const strokeAttr = o.stroke ? ` stroke="${o.stroke}" stroke-width="${(o.strokeWidth || 1) * scale}"` : '';
      parts.push(`<path d="${o.path}" transform="scale(${scale})" fill="${fill}"${strokeAttr} opacity="0.92"/>`);
    } else if (o.type === 'ellipse') {
      parts.push(`<ellipse cx="${s(o.left + halfW)}" cy="${s(o.top + halfH)}" rx="${s(w / 2)}" ry="${s(h / 2)}" fill="${fill}" opacity="0.9"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${s(w)}" height="${s(h)}" fill="${fill}" opacity="0.92"/>`);
    }
  }

  // 텍스트 (위로). angle(예: 책등 세로쓰기 90°)을 중심 기준으로 회전 렌더.
  for (const o of dto.canvasData.objects) {
    if (o.type !== 'textbox' || !o.text) continue;
    const fs = Math.max(7, s(o.fontSize || 24));
    const cx = s(o.left + halfW);
    const cy = s(o.top + halfH);
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
