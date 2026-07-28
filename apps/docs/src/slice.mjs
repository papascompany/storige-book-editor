/**
 * slice.mjs — GUIDE H2 슬라이서 (shard ① 소유)
 *
 * 불변식(계약 §3-F):
 *   1. H2(`^## `) 경계 탐지 + 래핑만 한다. **본문 바이트 무변형** — 문자열 치환·앵커
 *      자동 재작성·재포맷을 하지 않는다.
 *   2. 펜스(``` / ~~~) 내부의 `## ` 는 경계로 보지 않는다. GUIDE 는 bash/json/html 펜스를
 *      25쌍 갖고 있고 그 안의 `#` 주석이 heading 으로 오인되면 슬라이스가 잘린다.
 *   3. 슬라이스 경계는 `awk '/^## N\./{f=1} /^## (N+1)\./{f=0} f'` 와 **바이트 동일**하다
 *      (검증 게이트 G-② 가 그 awk 로 §3 무변형을 기계 증명한다).
 */
import { createHash } from 'node:crypto';

/** 코드펜스를 인식하며 줄 단위로 순회. 각 줄의 시작 오프셋을 함께 돌려준다. */
function* scanLines(md) {
  let offset = 0;
  let fence = null; // 열린 펜스의 마커 문자열(``` 또는 ~~~ 이상)
  while (offset <= md.length) {
    const nl = md.indexOf('\n', offset);
    const end = nl === -1 ? md.length : nl;
    const line = md.slice(offset, end);

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    let inFence = fence !== null;
    if (fence === null) {
      if (fenceMatch) fence = fenceMatch[1][0].repeat(fenceMatch[1].length);
    } else if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
      // 닫는 펜스: 정보 문자열이 없어야 한다
      if (line.slice(fenceMatch[0].length).trim() === '') fence = null;
    }

    yield { line, start: offset, inFence };

    if (nl === -1) return;
    offset = nl + 1;
  }
}

/**
 * @param {string} md GUIDE 원문
 * @returns {{ preamble: {text:string,start:number,end:number},
 *             sections: Array<{num:number|null, heading:string, text:string, start:number, end:number, sha256:string}> }}
 */
export function sliceByH2(md) {
  /** @type {Array<{heading:string,start:number,num:number|null}>} */
  const marks = [];
  for (const { line, start, inFence } of scanLines(md)) {
    if (inFence) continue;
    if (!line.startsWith('## ')) continue;
    const numMatch = /^##\s+(\d+)\./.exec(line);
    marks.push({ heading: line, start, num: numMatch ? Number(numMatch[1]) : null });
  }

  const preambleEnd = marks.length ? marks[0].start : md.length;
  const preamble = { text: md.slice(0, preambleEnd), start: 0, end: preambleEnd };

  const sections = marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : md.length;
    const text = md.slice(mark.start, end);
    return {
      num: mark.num,
      heading: mark.heading,
      text,
      start: mark.start,
      end,
      sha256: sha256(text),
    };
  });

  return { preamble, sections };
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 매니페스트 항목(`{kind:'guide', section, withPreamble}`)을 실제 슬라이스 텍스트로 해석.
 * withPreamble 인 경우 preamble.end === section.start 이므로 이어붙여도 원문 연속 구간과 동일하다.
 */
export function resolveGuideSlice(sliced, { section, withPreamble = false }) {
  const found = sliced.sections.find((s) => s.num === section);
  if (!found) {
    const seen = sliced.sections.map((s) => s.num).join(', ');
    throw new Error(`GUIDE §${section} 슬라이스를 찾지 못했다 (탐지된 절: ${seen})`);
  }
  const text = withPreamble ? sliced.preamble.text + found.text : found.text;
  return {
    text,
    /** 본문(§N) 만의 SHA — awk 추출 결과와 대조 가능한 값 */
    sectionSha256: found.sha256,
    sha256: withPreamble ? sha256(text) : found.sha256,
    heading: found.heading,
  };
}
