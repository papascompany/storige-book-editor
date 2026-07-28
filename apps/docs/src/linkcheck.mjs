/**
 * linkcheck.mjs — 내부 링크 무결성 (shard ① 소유, 계약 §3-H R4)
 *
 * 산출물의 **모든 내부 상대 링크·앵커**가 실제 emitted 페이지/앵커/자산에 존재하는지 확인한다.
 * 하나라도 깨지면 빌드가 죽는다 — 폐기 문서 배너(③)가 가리키는 목적지, GUIDE 절 앵커
 * (`/guide/common/#1-2`), llms.txt 라우팅이 전부 이 게이트에 걸린다.
 *
 * 외부(http/https/mailto) 링크는 여기서 다루지 않는다 — 호스트 정책은 guard R1 소관.
 * 단 siteUrl 로 시작하는 절대 URL 은 내부 링크로 되돌려 검사한다(llms.txt 가 절대 URL 을 쓸 때).
 */

const HREF_RE = /\bhref="([^"]*)"/g;
const ID_RE = /\bid="([^"]+)"/g;
/** .txt(llms) 안의 마크다운 링크. 맨 경로는 API 경로(`/api/v1/ping`)와 구분이 안 돼 검사하지 않는다. */
const MD_LINK_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * @param {object} input
 * @param {Array<{route:string, file:string, html:string}>} input.pages
 * @param {Array<{file:string, text:string}>} [input.textFiles]  llms.txt 등
 * @param {string[]} [input.assets]  emitted 정적 자산의 루트-상대 경로 (예: '/theme.css')
 * @param {string} [input.siteUrl]
 * @returns {Array<{file:string, target:string, reason:string}>}
 */
export function checkLinks({ pages, textFiles = [], assets = [], siteUrl = '' }) {
  const index = new Map();
  for (const page of pages) index.set(normalizeRoute(page.route), collectIds(page.html));
  const assetSet = new Set(assets);

  const problems = [];
  const verify = (fileLabel, fromRoute, rawTarget) => {
    const reason = resolveTarget(rawTarget, fromRoute, index, assetSet, siteUrl);
    if (reason) problems.push({ file: fileLabel, target: rawTarget, reason });
  };

  for (const page of pages) {
    for (const match of page.html.matchAll(HREF_RE)) verify(page.file, page.route, match[1]);
  }
  for (const file of textFiles) {
    for (const match of file.text.matchAll(MD_LINK_RE)) verify(file.file, '/', match[1]);
  }
  return problems;
}

function resolveTarget(rawTarget, fromRoute, index, assetSet, siteUrl) {
  let target = rawTarget;
  if (!target) return '빈 href';

  if (siteUrl && target.startsWith(siteUrl)) {
    target = target.slice(siteUrl.length) || '/';
  }
  if (/^(?:https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith('//')) return null;

  let route;
  let anchor = '';
  if (target.startsWith('#')) {
    route = normalizeRoute(fromRoute);
    anchor = target.slice(1);
  } else {
    const hashIndex = target.indexOf('#');
    const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
    anchor = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
    const base = pathPart.startsWith('/') ? pathPart : joinRelative(fromRoute, pathPart);
    route = normalizeRoute(base);
  }

  // 확장자가 붙은 경로는 정적 자산으로 본다
  if (/\.[a-z0-9]{2,5}$/i.test(route)) {
    return assetSet.has(route) ? null : `존재하지 않는 자산: ${route}`;
  }

  const ids = index.get(route);
  if (!ids) return `존재하지 않는 라우트: ${route}`;
  if (anchor && !ids.has(anchor)) return `${route} 에 앵커 #${anchor} 없음`;
  return null;
}

function collectIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(ID_RE)) ids.add(match[1]);
  return ids;
}

function joinRelative(fromRoute, relative) {
  const base = fromRoute.endsWith('/') ? fromRoute : `${fromRoute}/`;
  const out = [];
  for (const segment of `${base}${relative}`.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return `/${out.join('/')}`;
}

export function normalizeRoute(route) {
  if (!route) return '/';
  let value = route.split('?')[0];
  if (!value.startsWith('/')) value = `/${value}`;
  if (/\.[a-z0-9]{2,5}$/i.test(value)) return value;
  if (!value.endsWith('/')) value += '/';
  return value;
}
