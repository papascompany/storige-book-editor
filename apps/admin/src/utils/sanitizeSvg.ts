/**
 * sanitizeSvgMarkup — 의존성 없는 화이트리스트 기반 SVG 새니타이저.
 *
 * 배경(감사 DEP-7 / CVE-2026-27013): fabric <7.2.0 의 SVG export 가 Stored XSS 를
 * 유발할 수 있다. 본 코드베이스에서 export/변환 SVG 가 **라이브 DOM 에 그대로
 * 주입되는** 유일한 경로는 admin TemplateImport 의 미리보기
 * (`dangerouslySetInnerHTML={{ __html: previewSvg }}`)이며, 이 previewSvg 는
 * **신뢰할 수 없는 업로드 IDML/PSD** 를 변환한 결과(`buildPreviewSvg`)다.
 *
 * 그 외 export 경로(canvas.toSVG -> svg2pdf -> PDF, `<img src=blob:svg>` 폴백)는
 * 스크립트가 실행되지 않아 XSS 실효가 없다. 따라서 새니타이즈는 이 렌더 경계에만
 * 적용한다.
 *
 * 입력은 우리가 생성한 SVG(알려진 요소/속성 집합)이므로 DOMPurify(~45KB) 대신
 * 좁고 명시적인 화이트리스트로 충분하다. 정상 도형/이미지/텍스트 출력은 보존하고
 * (a) script/foreignObject 등 활성 콘텐츠 요소,
 * (b) on* 이벤트 핸들러 속성,
 * (c) javascript: 등 위험 스킴의 href/xlink:href,
 * 만 제거한다.
 */
/* global DOMParser, XMLSerializer, Element */

/** 허용 SVG 요소(소문자). 이 집합 밖의 요소는 통째로 제거된다. */
const ALLOWED_ELEMENTS = new Set<string>([
  'svg',
  'g',
  'defs',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'image',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'use',
  'title',
  'desc',
  'pattern',
])

/** href/xlink:href 에 허용되는 스킴(이미지 데이터 URL + 내부 fragment + http(s)/루트경로). */
const SAFE_URL_RE = /^(?:data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);|#|https?:\/\/|\/)/i

const HREF_ATTRS = new Set(['href', 'xlink:href'])

// URL 정규화: 제어문자(U+0000..U+0020) + 제로폭/방향마커(U+200B..U+200F) + BOM(U+FEFF)
// 제거용. "java<TAB>script:" / 제로폭 삽입 류 스킴 우회를 차단한다. 리터럴 제어/제로폭
// 문자를 소스에 두면 no-irregular-whitespace/no-control-regex 에 걸리므로 코드포인트
// 기반으로 RegExp 를 동적 생성한다.
// eslint-disable-next-line no-control-regex -- 보안 목적의 의도적 제어문자 매칭
const URL_STRIP_RE = new RegExp('[\\u0000-\\u0020\\u200B-\\u200F\\uFEFF]', 'g')

/** 공백/제어문자를 정규화한 뒤 위험 스킴 여부를 판정(우회 방지). */
function isSafeUrl(raw: string | null): boolean {
  if (!raw) return false
  const v = raw.replace(URL_STRIP_RE, '').toLowerCase()
  if (v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:text/html')) {
    return false
  }
  return SAFE_URL_RE.test(v)
}

/** 한 요소의 위험 속성을 제거(on*, style, 위험 href/xlink:href). */
function scrubAttributes(el: Element): void {
  // 라이브 NamedNodeMap 변형 중 인덱스가 흔들리므로 스냅샷 후 제거.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    // 1) 모든 이벤트 핸들러
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name)
      continue
    }
    // 2) style — url(javascript:...) / expression 등 우회 벡터 제거(미리보기에 불필요)
    if (name === 'style') {
      el.removeAttribute(attr.name)
      continue
    }
    // 3) href / xlink:href — 안전 스킴만 허용
    if (HREF_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }
}

/** DOM 트리를 깊이우선으로 순회하며 비허용 요소 제거 + 속성 스크럽. */
function scrubTree(node: Element): void {
  // 자식 먼저 스냅샷(제거로 인한 라이브 컬렉션 변형 회피).
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase()
    if (!ALLOWED_ELEMENTS.has(tag)) {
      child.remove()
      continue
    }
    scrubAttributes(child)
    scrubTree(child)
  }
}

/** DOM 파서 부재/실패 시 활성 콘텐츠만 정규식으로 제거하는 폴백. */
function regexFallback(markup: string): string {
  return markup
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
}

/**
 * 신뢰할 수 없는 SVG 마크업을 새니타이즈한다.
 * @param markup buildPreviewSvg 등이 생성한 SVG 문자열
 * @returns 라이브 DOM 주입에 안전한 SVG 문자열. 파싱 실패 시 빈 문자열.
 */
export function sanitizeSvgMarkup(markup: string): string {
  if (!markup || typeof markup !== 'string') return ''
  // 비-DOM 환경(테스트/SSR) 방어.
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return regexFallback(markup)
  }

  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  // 파서 에러(잘못된 XML) → 주입 금지.
  if (doc.querySelector('parsererror')) return ''

  const root = doc.documentElement
  // image/svg+xml 미지원 환경(예: happy-dom)은 documentElement 가 null →
  // 정규식 폴백으로 활성 콘텐츠 제거(미리보기 유지 + XSS 차단). svg 루트가 아닌
  // 입력(html 등)은 우리 생성물이 아니므로 차단.
  if (!root) return regexFallback(markup)
  if (root.tagName.toLowerCase() !== 'svg') return ''

  // 루트 자체의 속성도 스크럽(루트에 onload 등이 붙을 수 있음).
  scrubAttributes(root)
  scrubTree(root)

  return new XMLSerializer().serializeToString(root)
}
