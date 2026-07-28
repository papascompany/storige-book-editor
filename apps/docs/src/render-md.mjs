/**
 * render-md.mjs — 마크다운 → HTML (shard ① 소유)
 *
 * 의존성은 `marked` 1개뿐이다(전이 의존 0). 무의존 자작 렌더러를 쓰지 않는 이유는
 * GUIDE 실물에서 escaped pipe(테이블 셀 + inline code 동시 파손)와 task list `- [ ]`
 * 34건이 실제로 깨졌기 때문이다 — go-live 체크리스트가 핵심 산출물이라 정면 충돌한다.
 *
 * 결정성: 호출마다 새 Marked 인스턴스를 만든다(전역 상태 없음). 같은 입력 → 같은 출력.
 */
import { Marked } from 'marked';

/** 명시 앵커 문법 `### 제목 {#custom-id}` — 생성 콘텐츠(API 레퍼런스)에서 쓴다. */
const EXPLICIT_ID = /\s*\{#([A-Za-z0-9._:-]+)\}\s*$/;

/** `1.2 인증 (X-API-Key)` → `1-2` / 번호가 없으면 슬러그. */
export function headingId(rawText) {
  const text = String(rawText).trim();
  const explicit = EXPLICIT_ID.exec(text);
  if (explicit) return explicit[1];
  const numbered = /^(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(text);
  if (numbered) return numbered[1].replace(/\./g, '-');
  return slugify(text);
}

export function slugify(rawText) {
  return (
    String(rawText)
      // 인라인 마크다운 기호 제거 (`code`, **bold**, [link])
      .replace(/[`*_~[\]()]/g, '')
      .trim()
      .toLowerCase()
      // 유니코드 문자/숫자/공백/하이픈만 남긴다 (한글 유지)
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

/**
 * @param {string} md
 * @returns {{ html: string, headings: Array<{depth:number,id:string,text:string}> }}
 */
export function renderMarkdown(md) {
  const headings = [];
  const used = new Map();

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading(token) {
        const base = headingId(token.text);
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen + 1}`;
        // `{#id}` 는 표시 텍스트에서 제거한다(마지막 인라인 토큰만 손보면 된다).
        const last = token.tokens[token.tokens.length - 1];
        if (last && typeof last.text === 'string' && EXPLICIT_ID.test(last.text)) {
          last.text = last.text.replace(EXPLICIT_ID, '');
          if (typeof last.raw === 'string') last.raw = last.raw.replace(EXPLICIT_ID, '');
        }
        const inner = this.parser.parseInline(token.tokens);
        headings.push({ depth: token.depth, id, text: stripInline(token.text.replace(EXPLICIT_ID, '')) });
        // 앵커 링크는 JS 0줄 — 순수 <a href="#id">
        return `<h${token.depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="이 절 링크">#</a></h${token.depth}>\n`;
      },
    },
  });

  let html = marked.parse(md);

  // 표는 좁은 화면에서 가로 스크롤되도록 래핑한다(코드블록은 theme.css 의 pre 규칙으로 처리).
  // 코드펜스 안의 `<table>` 은 marked 가 `&lt;table&gt;` 로 이스케이프하므로 오탐이 없다.
  html = html.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, '</table></div>');

  return { html, headings };
}

function stripInline(text) {
  return String(text).replace(/[`*_~]/g, '').trim();
}

/** 짧은 인라인 조각(요약문·라벨)만 렌더할 때 사용 */
export function renderInline(md) {
  return new Marked({ gfm: true }).parseInline(String(md));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
