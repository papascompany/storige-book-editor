/**
 * emit-llms.mjs — llms.txt / llms-full.txt 생성 (shard ③ 소유, 외부 의존 0)
 *
 * AI 에이전트가 이 플랫폼을 연동할 때 읽는 두 파일을 **빌드에서 생성**한다.
 *   llms.txt       머리말(AGENT INSTRUCTIONS) + 페이지 인덱스(제목·경로·요약)
 *   llms-full.txt  위 + 각 페이지의 마크다운 **원문 전체**
 *
 * 불변식
 *  1. **문서 목록을 하드코딩하지 않는다.** 인덱스와 본문은 `build.mjs` 가 넘긴 `pages`
 *     (= `site.config.mjs` 매니페스트에서 실제로 조립된 페이지)에서만 만들어진다.
 *     GUIDE 가 개정되거나 페이지가 늘면 다음 빌드에서 자동으로 따라간다.
 *  2. 저술 텍스트는 `content/llms-intro.md` **한 곳**뿐이다. 규범 서술은 담지 않고
 *     GUIDE 앵커로 넘긴다(포털은 발행 채널이지 정본이 아니다).
 *  3. 결정적이다 — 타임스탬프·난수·파일시스템·네트워크 접근이 0이다.
 *  4. 산출 텍스트도 guard(R1~R3)와 linkcheck(R4)를 통과해야 한다. 특히 **`.txt` 로 끝나는
 *     경로를 마크다운 링크로 쓰지 않는다** — linkcheck 는 확장자가 붙은 경로를 정적 자산으로
 *     보고 `assets` 목록(현재 `/theme.css` 하나)에 없으면 빌드를 깨뜨린다. 그래서 서로를
 *     가리킬 때는 링크가 아니라 인라인 코드(`llms-full.txt`)로 쓴다.
 */

const FILE_INDEX = 'llms.txt';
const FILE_FULL = 'llms-full.txt';

/** introMd 가 없을 때(개별 shard 작업 중)의 최소 대체 머리말. 정상 빌드에서는 쓰이지 않는다. */
const FALLBACK_INTRO = [
  '# Storige 파트너 문서',
  '',
  '> 머리말(`content/llms-intro.md`)이 아직 없어 자동 생성된 대체본이다.',
].join('\n');

/**
 * @param {object} input
 * @param {Array<{route:string,title:string,summary?:string,sourceMd?:string}>} input.pages
 *        build.mjs 가 렌더 직전 상태로 넘기는 페이지 목록(매니페스트 순서).
 * @param {string} [input.siteUrl]  비어 있으면 루트-상대 경로를 쓴다.
 * @param {string|null} [input.introMd]  content/llms-intro.md 원문.
 * @returns {{ 'llms.txt': string, 'llms-full.txt': string }}  키가 곧 site/ 하위 파일명.
 */
export function emitLlms({ pages, siteUrl, introMd } = {}) {
  const base = normalizeBase(siteUrl);
  const entries = normalizePages(pages);
  const intro = String(introMd ?? FALLBACK_INTRO).trim();

  const head = [intro, '', '## 문서', '', ...entries.map((e) => indexLine(e, base))];

  const indexDoc = [
    ...head,
    '',
    '## 전문',
    '',
    `각 문서의 마크다운 원문을 하나로 합친 \`${FILE_FULL}\` 가 같은 위치에 있다.` +
      ' 컨텍스트 여유가 있으면 그쪽을 읽어라 — 이 파일은 요약과 링크 인덱스일 뿐이라,' +
      ' 여기 없는 내용을 추론으로 메우면 안 된다.',
  ];

  const fullDoc = [
    ...head,
    '',
    '## 전문',
    '',
    '아래부터 위 인덱스와 **같은 순서로** 각 문서의 마크다운 원문이 이어진다.' +
      ` 인덱스만 필요하면 \`${FILE_INDEX}\` 를 읽어라.`,
    '',
    ...entries.flatMap((entry) => fullSection(entry)),
  ];

  return {
    [FILE_INDEX]: finalize(indexDoc),
    [FILE_FULL]: finalize(fullDoc),
  };
}

/** `- [제목](경로): 요약` — llms.txt 관례의 링크 목록 한 줄. */
function indexLine(entry, base) {
  const target = `${base}${entry.route}`;
  return entry.summary ? `- [${entry.title}](${target}): ${entry.summary}` : `- [${entry.title}](${target})`;
}

/**
 * llms-full.txt 의 문서 1건 블록.
 *
 * 구분자로 `---` 를 쓰지 않는 이유: GUIDE 슬라이스가 **자기 끝에 이미 `---` 를 갖고 있어**
 * 문서 경계에 수평선이 두 개 겹친다. 대신 HTML 주석 마커를 쓴다 — 렌더링에 보이지 않고,
 * 소비자가 경계를 기계적으로 자를 수 있으며, 본문의 어떤 마크다운과도 충돌하지 않는다.
 *
 * 제목은 H1 로 둔다. 실린 본문이 `## N.` 부터 시작하므로 문서 블록이 항상 한 단계 위다.
 * 경로는 **링크가 아니라 인라인 코드**로 쓴다 — 인덱스에 이미 링크가 있어 중복이다.
 */
function fullSection(entry) {
  const block = [`<!-- BEGIN ${entry.route} -->`, '', `# ${entry.title}`, '', `경로: \`${entry.route}\``];
  if (entry.summary) block.push('', entry.summary);
  block.push('', entry.sourceMd.trim(), '', `<!-- END ${entry.route} -->`, '');
  return block;
}

/** 매니페스트 순서를 유지하되, 본문이 비었거나 라우트가 없는 항목은 싣지 않는다. */
function normalizePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => page && typeof page.route === 'string' && page.route)
    .map((page) => ({
      route: page.route,
      title: String(page.title ?? page.route).trim(),
      summary: page.summary ? String(page.summary).trim() : '',
      sourceMd: typeof page.sourceMd === 'string' ? page.sourceMd : '',
    }))
    .filter((page) => page.sourceMd.trim().length > 0);
}

/**
 * 절대 URL 접두를 정규화한다. 끝의 `/` 를 떼서 `${base}${route}` 가 항상 슬래시 1개로 이어지게 한다
 * (route 는 항상 `/` 로 시작). siteUrl 이 비면 빈 문자열 → 루트-상대 경로.
 */
function normalizeBase(siteUrl) {
  const value = String(siteUrl ?? '').trim();
  return value ? value.replace(/\/+$/, '') : '';
}

/**
 * 줄 배열 → 파일 텍스트. 끝을 개행 1개로 맞추기만 한다.
 * 본문 안의 빈 줄을 접는 등의 정규화는 **하지 않는다** — 실린 마크다운은 GUIDE 원문
 * 그대로여야 하고(발행 채널이지 편집자가 아니다), 코드펜스 안의 공백도 의미가 있다.
 */
function finalize(lines) {
  return `${lines.join('\n').trimEnd()}\n`;
}
