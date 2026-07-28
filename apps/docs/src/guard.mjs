/**
 * guard.mjs — 산출물 전수 어서션 (shard ① 소유, 외부 의존 0)
 *
 * 계약 §3-H 의 R1~R3 을 산출물(site/**) 전수 스캔으로 강제한다. 위반이 1건이라도 있으면
 * 빌드가 죽는다. 존재 이유는 루트 `vercel.json` 에 VPS 실 IP 가 평문으로 남아 있던 이력이다 —
 * 문서 사이트는 검색 가능한 표면이라 내부 형상이 새면 되돌릴 수 없다.
 *
 * R1 절대 URL 호스트 화이트리스트 (IP-in-URL 은 여기서 전부 걸린다)
 * R2 bare IPv4 리터럴 0건 (루프백 예외만)
 * R3 내부 포인터 blocklist 0건
 *
 * ⚠️ **적용 범위는 산출물(site/**)뿐이다.** 레포 루트 `vercel.json` 은 이 게이트가 보지 않는다 —
 *    포털 빌드의 입력이 아니기 때문이다. 그런데 그 파일에는 아직 내부 VPS IPv4 가 평문으로
 *    남아 있고(오너 결정 대기), Vercel 프로젝트의 Root Directory 를 `apps/docs` 가 아니라
 *    레포 루트로 두면 포털이 그 rewrites 를 상속해 `/api/*`·`/storage/*` 를 내부 주소로
 *    평문 프록시한다. 즉 **R1/R2 가 초록이어도 이 경로는 막히지 않는다.**
 *    → 그 구멍은 `scripts/check-source-exposure.mjs` 의 IP-URL / IP-CONFIG 규칙이 담당하고,
 *      예외 사유와 오너 액션은 같은 파일의 `KNOWN_EXCEPTIONS` 에 등재돼 매 실행마다 출력된다.
 */
import { readFileSync } from 'node:fs';

/** R3 — 산출물에 있으면 안 되는 내부 포인터 / 시크릿 형태 */
const BLOCKLIST_LITERAL = [
  'PARTNER_PLATFORM_API_V1_DESIGN', // 내부 설계서(벤치마크·오너결정 포함) — 포털 비게재
  '.cursor', // 타 세션 소유 내부 기획 디렉터리
  'CLAUDE.local', // 로컬 운영 시크릿 메모
  'W4 스텁', // 내부 스프린트 표기
  '시드 게이트', // 내부 스프린트 표기
];

const BLOCKLIST_REGEX = [
  // 웹훅 시크릿 실값. 포맷 설명(`whsec_...` 같은 플레이스홀더)은 16자 미만이라 통과한다.
  { name: 'webhook-secret', re: /whsec_[A-Za-z0-9]{16,}/g },
  // 파트너 키 실값. 포맷 설명 `sk-storige-{48hex}` 은 매치되지 않는다(의도).
  { name: 'partner-key', re: /sk-storige-[0-9a-f]{8,}/g },
];

const URL_RE = /\bhttps?:\/\/[^\s"'`<>()[\]{}\\]+/gi;
const IPV4_RE = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g;

/**
 * @param {Array<{path:string, text:string}>} files
 * @param {{hostAllowlist:string[], ipv4Allowlist:string[]}} opts
 * @returns {Array<{rule:string, file:string, line:number, detail:string}>}
 */
export function auditFiles(files, opts) {
  const violations = [];
  for (const file of files) {
    const lines = file.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      // HTML 엔티티를 되돌린 뒤 스캔한다. 되돌리지 않으면 `&quot;`·`&lt;` 가 URL 문자로 남아
      // 호스트가 `example.com&quot` 처럼 잘못 잘린다(오탐). 보고는 원문 줄로 한다.
      const line = decodeEntities(raw);
      const at = (rule, detail) =>
        violations.push({ rule, file: file.path, line: i + 1, detail, snippet: raw.trim().slice(0, 160) });

      // R1 — 절대 URL 호스트
      for (const url of line.match(URL_RE) ?? []) {
        const host = urlHost(url);
        // 호스트가 비면 플레이스홀더(`https://<presigned-url>`)다 — 노출될 내부 형상이 없다.
        if (!host) continue;
        if (!hostAllowed(host, opts.hostAllowlist)) at('R1', `화이트리스트 밖 호스트: ${host}`);
      }

      // R2 — bare IPv4
      for (const match of line.matchAll(IPV4_RE)) {
        const ip = match[1];
        if (!ip.split('.').every((o) => o.length <= 3 && Number(o) <= 255)) continue;
        if (opts.ipv4Allowlist.includes(ip)) continue;
        at('R2', `IPv4 리터럴: ${ip}`);
      }

      // R3 — 내부 포인터
      for (const token of BLOCKLIST_LITERAL) {
        if (line.includes(token)) at('R3', `금지 토큰: ${token}`);
      }
      for (const { name, re } of BLOCKLIST_REGEX) {
        re.lastIndex = 0;
        if (re.test(line)) at('R3', `금지 패턴(${name})`);
      }
    }
  }
  return violations;
}

/** HTML 엔티티 최소 디코드 (`&amp;` 는 반드시 마지막) */
export function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function urlHost(rawUrl) {
  const afterScheme = rawUrl.replace(/^https?:\/\//i, '');
  const authority = afterScheme.split(/[/?#]/)[0];
  const withoutUserInfo = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  // 호스트명에 올 수 없는 문자에서 잘라낸다. `app.example.com&mode=both` 같은 쿼리 잔재와
  // 문장 끝 구두점(`example.com.`)이 호스트로 오인되는 것을 막는다.
  const hostPart = /^[A-Za-z0-9._:\[\]-]*/.exec(withoutUserInfo)?.[0] ?? '';
  const host = hostPart
    .replace(/:\d*$/, '')
    .replace(/[.\-]+$/, '')
    .toLowerCase();
  return host || null;
}

export function hostAllowed(host, allowlist) {
  for (const entry of allowlist) {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // '.example.com'
      if (host.endsWith(suffix)) return true;
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

export function readTextFiles(paths) {
  return paths.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

/**
 * 리포트용 마스킹. 위반 리포트는 **PUBLIC 레포의 CI 로그**로 나간다(공개 Actions 로그는
 * 누구나 읽는다). 적발한 IPv4·시크릿 실값을 그대로 찍으면 "내부 형상을 공개 표면에서
 * 없애는 게이트"가 스스로 그 값을 공개 로그에 옮겨 적는다. 위치(file:line)와 규칙명만으로
 * 조치에 충분하므로 값은 가린다.
 *
 * 호스트명(R1)은 가리지 않는다 — 대부분 화이트리스트 누락이라 **어떤 호스트인지 모르면
 * 고칠 수 없고**, IP 형태의 호스트는 아래 IPv4 규칙이 어차피 덮는다.
 */
function redactForLog(text) {
  return String(text)
    .replace(IPV4_RE, (m, ip) =>
      ip.split('.').every((o) => o.length <= 3 && Number(o) <= 255) ? '<IPv4 마스킹>' : m,
    )
    .replace(/whsec_[A-Za-z0-9]{16,}/g, 'whsec_<마스킹>')
    .replace(/sk-storige-[0-9a-f]{8,}/g, 'sk-storige-<마스킹>');
}

export function formatViolations(violations) {
  return violations
    .map(
      (v) =>
        `  [${v.rule}] ${v.file}:${v.line} — ${redactForLog(v.detail)}\n        ${redactForLog(v.snippet)}`,
    )
    .join('\n');
}
