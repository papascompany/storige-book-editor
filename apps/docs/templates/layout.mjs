/**
 * layout.mjs — 페이지 셸 (shard ① 소유)
 *
 * 규칙: **JS 0줄 · CDN 0건 · 인라인 스타일 0건**. 모든 스타일은 /theme.css 한 장.
 * 모바일에서는 사이트 네비가 가로 스크롤 칩 줄로, 페이지 목차는 접힌 <details> 로 바뀐다
 * (둘 다 순수 CSS + 네이티브 엘리먼트라 스크립트가 필요 없다).
 */
import { escapeHtml } from '../src/render-md.mjs';

/**
 * @param {object} p
 * @param {string} p.title           페이지 제목
 * @param {string} p.description     meta description
 * @param {string} p.lang
 * @param {string} p.siteTitle
 * @param {string} p.route           현재 라우트 (활성 표시)
 * @param {Array}  p.navGroups       [{label, items:[{route,title}]}]
 * @param {Array}  p.headings        [{depth,id,text}]
 * @param {string} p.body            본문 HTML
 * @param {string} [p.provenance]    출처 한 줄 (예: GUIDE §1 발췌)
 * @param {boolean} [p.noindex]
 * @param {string} [p.assetPrefix]   기본 '' (루트 절대경로)
 */
export function renderLayout(p) {
  const toc = buildToc(p.headings);
  const noindex = p.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : '';

  return `<!doctype html>
<html lang="${escapeHtml(p.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)} · ${escapeHtml(p.siteTitle)}</title>
<meta name="description" content="${escapeHtml(p.description)}">${noindex}
<link rel="stylesheet" href="${p.assetPrefix ?? ''}/theme.css">
</head>
<body>
<a class="skip-link" href="#content">본문 바로가기</a>

<header class="topbar">
  <a class="brand" href="/">${escapeHtml(p.siteTitle)}</a>
  <span class="brand-note">파트너 연동 문서</span>
</header>

<nav class="sitenav" aria-label="사이트 네비게이션">
${p.navGroups
  .map(
    (group) => `  <div class="navgroup">
    <p class="navgroup-label">${escapeHtml(group.label)}</p>
    <ul>
${group.items
  .map(
    (item) =>
      `      <li><a href="${item.route}"${item.route === p.route ? ' aria-current="page"' : ''}>${escapeHtml(
        item.title,
      )}</a></li>`,
  )
  .join('\n')}
    </ul>
  </div>`,
  )
  .join('\n')}
</nav>

<div class="shell">
  <main id="content" class="content">
${toc ? `    <details class="toc-mobile">\n      <summary>이 페이지 목차</summary>\n${indent(toc, 6)}\n    </details>\n` : ''}${
    p.provenance ? `    <p class="provenance">${p.provenance}</p>\n` : ''
  }${p.body}
  </main>

${toc ? `  <aside class="toc-desktop" aria-label="이 페이지 목차">\n    <p class="toc-label">이 페이지 목차</p>\n${indent(toc, 4)}\n  </aside>\n` : ''}</div>

<footer class="sitefoot">
  <p>Storige 파트너 문서 포털. 본문 정본은 <code>docs/PLATFORM_INTEGRATION_GUIDE.md</code> 이며 이 사이트는 그 발행 채널이다.</p>
</footer>
</body>
</html>
`;
}

function buildToc(headings) {
  const items = (headings ?? []).filter((h) => h.depth >= 2 && h.depth <= 4);
  if (items.length === 0) return '';
  return `<ul class="toc">
${items
  .map((h) => `  <li class="toc-d${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
  .join('\n')}
</ul>`;
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
