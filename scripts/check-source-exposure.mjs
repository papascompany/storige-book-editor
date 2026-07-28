#!/usr/bin/env node
/**
 * check-source-exposure.mjs — 외부 식별자 · 내부 IP 유출 방지 게이트
 *
 * 두 종류의 유출을 검사한다.
 *   ① 외부 식별자(DENY) — 내부 정책상 배포 산출물·소스에 포함되면 안 되는 외부 고유
 *      식별자·키·상수의 **문자열 유입**(배포 번들·DOM·네트워크에 남아 출처를 드러내는 신호).
 *   ② IPv4 리터럴(IP-URL / IP-CONFIG) — 내부 서버 주소(사설·공인 무관)가 소스·설정·
 *      문서에 평문으로 남는 것. 레포가 PUBLIC 이므로 IP 한 줄이 곧 내부 형상 공개다.
 *
 * 매치가 있으면 file:line 을 출력하고 비0 종료한다(→ 빌드/CI 실패 = 배포 차단).
 * 정책 예외는 `KNOWN_EXCEPTIONS` 에만 둘 수 있고, **통과 시에도 항상 리포트에 출력된다**
 * (조용히 숨긴 예외 = 없는 게이트).
 *
 * ⚠️ **리포트는 적발한 값을 그대로 찍지 않는다**(`redact()`). 이 게이트는 PUBLIC 레포의
 *    CI(.github/workflows/ci.yml)에서 돌고, 공개 레포의 Actions 로그는 누구나 읽는다.
 *    적발값·매치 라인을 평문으로 출력하면 "내부 주소를 공개 표면에서 없애는 게이트"가
 *    스스로 그 주소를 공개 로그에 옮겨 적는다(예외 항목은 통과해도 **매 실행** 출력되므로
 *    상시 노출이었다). 위치(file:line)와 규칙명만으로 조치에 충분하고, 값 구분이 필요할
 *    때를 위해 비가역 지문 4자리(`#a1b2`)만 남긴다.
 *
 * 사용:
 *   node scripts/check-source-exposure.mjs                # 소스 스캔(기본: 루트 설정 *.json + apps, packages, examples, docs)
 *   node scripts/check-source-exposure.mjs --dist dist    # 빌드 산출물 스캔(식별자 전용 — 아래 주석 참조)
 *   node scripts/check-source-exposure.mjs path1 path2    # 명시 경로 스캔
 *                                                        # 예: apps/docs/site (문서 포털 postbuild)
 *
 * 참고: 금지 목록은 정책 준수를 위해 이 파일 내에 평문으로 두지 않는다(인코딩 보관).
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const dec = (b) => Buffer.from(b, 'base64').toString('utf8');

// 금지 식별자(인코딩 보관). dist(minify된 번들)에서는 우연 충돌 방지 위해 고유성 높은 것만.
const DENY_DIST = ['ZWRpY3Vz', 'dGJzZWFs', 'X19TSE9QTElOS19VU0VSXzIwMjRfXw=='].map(dec);
const DENY_SOURCE = [...DENY_DIST, dec('c3RpY3V0')];

const argv = process.argv.slice(2);
const distMode = argv.includes('--dist');
const targets = argv.filter((a) => a !== '--dist');

const DENY = distMode ? DENY_DIST : DENY_SOURCE;
const DENY_PATTERN = DENY.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const RE = new RegExp(DENY_PATTERN, 'i');
/** 리포트 마스킹 전용(전역). 판정용 `RE` 와 lastIndex 를 공유하지 않도록 별도 인스턴스다. */
const RE_GLOBAL = new RegExp(DENY_PATTERN, 'gi');

// examples 는 파트너에게 그대로 배포되는 코드라 소스 스캔 대상에 반드시 포함한다
// (신규 소스 루트를 여기 추가하지 않으면 그 디렉터리는 게이트 밖에 남는다).
// docs 는 파트너 문서 포털(apps/docs)의 **본문 입력**이다 — GUIDE 한 줄이 그대로 공개
// 사이트에 실리므로 산출물 스캔만으로는 늦다(입력측에서 먼저 걸어야 한다).
const DEFAULT_TARGETS = ['apps', 'packages', 'examples', 'docs'];
// 제외 디렉터리: 내부 전용 문서(.cursor)·의존성·빌드 캐시는 정상적으로 목록을 포함하므로
// 반드시 제외한다. dist 모드에서는 dist 자체를 봐야 하므로 뺀다.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cursor', '.turbo', '.next', 'coverage', 'build', 'dist',
]);
if (distMode) SKIP_DIRS.delete('dist');

// .md/.txt 는 문서 포털(apps/docs) 때문에 코드와 동급 위험이다. 포털은 GUIDE(.md)를
// 슬라이스해 공개 HTML 로 발행하고 llms.txt / llms-full.txt(.txt)에 전 페이지 원문을
// 그대로 다시 싣는다 — 이 두 확장자가 빠져 있으면 산출물 스캔이 llms 파일을 통째로
// 건너뛴다(가장 많은 원문을 담은 파일이 게이트 밖에 남는 상태였다).
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.css', '.scss', '.html', '.vue', '.svelte', '.map',
  '.md', '.txt',
]);

// ── IPv4 규칙 ────────────────────────────────────────────────────────────────
//
// 존재 이유(실적발): 레포 **루트** `vercel.json` 의 rewrites destination 에 내부 VPS
// IPv4 가 평문으로 남아 있었는데, 기존 게이트 3개 중 어느 것도 그 파일을 보지 못했다 —
// DENY 목록은 외부 브랜드 문자열만 봤고, DEFAULT_TARGETS 는 디렉터리 4개뿐이라 **루트
// 레벨 파일이 통째로 미스캔**이었으며, 문서 포털 guard(R1/R2)는 `apps/docs/site` **산출물**
// 만 본다. 그래서 여기서 ⓐ 루트 설정 파일을 스캔 대상에 넣고 ⓑ IPv4 규칙을 추가한다.
//
// IP-URL    : URL authority 에 들어간 IPv4 (`http://203.0.113.9:4000/api` 형태).
//             내부 주소가 실제 트래픽 목적지로 박힌 가장 위험한 형태라 **모든 스캔 파일**에 적용.
// IP-CONFIG : 설정 파일(config-class) 안의 bare IPv4. 설정 파일은 산문이 아니라
//             오탐(버전 번호·문단 번호)이 사실상 없으므로 URL 밖 표기도 전부 잡는다.
//
// 산문(.md)의 bare IPv4 까지 전역으로 잡지 않는 이유: 내부 WBS 문서의 절 번호(`2.3.3.1`)가
// 숫자상 유효한 IPv4 와 구분되지 않아 오탐이 확실하다. 산문에 박힌 내부 주소는 대부분
// URL 형태(IP-URL)로 등장하고, 문서 포털 산출물은 guard R1/R2 가 bare 표기까지 이중으로 막는다.
// ⚠️ /g 정규식에 .test() 를 섞어 쓰면 lastIndex 가 남아 다음 호출이 앞부분을 건너뛴다
//    (matchAll 은 원본의 lastIndex 를 복사해 간다). 그래서 탐색용(/g)과 판정용을 분리한다.
const IPV4_TOKEN_RE = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g;
const IPV4_TEST_RE = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])/;
/** 호스트 전체가 IPv4 일 때만 IP-URL 로 본다(`1.2.3.4.5` 같은 비-IPv4 오탐 차단). */
const IPV4_STRICT_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const URL_RE = /\bhttps?:\/\/[^\s"'`<>()[\]{}\\]+/gi;

/** 문서·로컬 개발용으로 평문 등장이 정상인 주소만 예외. 사설 대역(RFC1918)은 예외가 아니다. */
const SAFE_IPV4 = [
  { test: (ip) => ip.startsWith('127.'), why: '루프백' },
  { test: (ip) => ip === '0.0.0.0', why: '미지정 주소(바인드 표기)' },
  // RFC 5737 문서화 전용 대역 — 예제에 쓰라고 예약된 주소라 내부 형상이 아니다.
  { test: (ip) => ip.startsWith('192.0.2.'), why: 'RFC5737 예제 대역' },
  { test: (ip) => ip.startsWith('198.51.100.'), why: 'RFC5737 예제 대역' },
  { test: (ip) => ip.startsWith('203.0.113.'), why: 'RFC5737 예제 대역' },
];

/**
 * IPv4 규칙 면제 경로. SSRF 방어 코드/테스트는 차단 대상 대역(10/8·169.254/16 …)을
 * **열거하는 것이 그 자체로 기능**이라 규칙을 적용할 수 없다. 두 경로 모두 서버 내부
 * 코드이고 브라우저 번들·공개 문서로 나가지 않는다(= 유출 표면이 아니다).
 * ⚠️ 여기에 경로를 추가하는 것은 게이트를 끄는 것과 같다 — 사유 없이 늘리지 말 것.
 */
const IPV4_EXEMPT_PREFIXES = [
  'apps/api/',    // SSRF 가드 + webhook/worker-jobs SSRF 스펙 (사설·메타데이터 IP 픽스처)
  'apps/worker/', // url-safety 대역 테이블 + 스펙
];

/** 설정 파일 판정 — 루트 레벨 *.json 전부 + 어느 깊이든 `vercel.json`. */
function isConfigFile(path) {
  const rel = normalize(path);
  const name = basename(rel);
  if (name === 'vercel.json') return true;
  return !rel.includes('/') && extname(rel) === '.json';
}

// ── 예외 대장 (통과해도 항상 출력된다) ───────────────────────────────────────
//
// 규칙: ① 파일·규칙 단위로만 예외를 만든다 ② 사유와 **오너 액션**을 반드시 적는다
//       ③ 해소되면 항목을 지운다(해소 후에도 남아 있으면 게이트가 "예외 해소됨"으로 경고).
const KNOWN_EXCEPTIONS = [
  {
    file: 'vercel.json',
    rules: ['IP-CONFIG', 'IP-URL'],
    reason:
      '레포 루트 vercel.json 의 `/api/:path*`·`/storage/:path*` rewrites destination 이 내부 VPS IPv4 평문. ' +
      '이 파일을 사용하는 Vercel 프로젝트의 정체가 미확인이고(운영 문서의 VPS 도메인과 다른 주소다) ' +
      '임의로 고치면 그 프로젝트의 API/스토리지 프록시가 끊긴다 → 오너 결정 사안이라 게이트가 차단하지 않는다.',
    impact:
      '문서 포털(apps/docs)의 Vercel Root Directory 를 `apps/docs` 가 아닌 레포 루트로 설정하면 ' +
      '포털이 이 rewrites 를 상속해 /api/*·/storage/* 를 내부 주소로 평문 프록시한다. ' +
      '현재 방어선은 대시보드 설정 1개뿐이다.',
    ownerAction:
      '① 루트 vercel.json 을 쓰는 Vercel 프로젝트 식별(없으면 파일 삭제) ' +
      '② destination 을 도메인(운영 API 도메인)으로 교체하거나 파일을 해당 앱 디렉터리로 이관 ' +
      '③ 문서 포털 프로젝트의 Root Directory 가 `apps/docs` 인지 재확인 ' +
      '④ 교체 후 이 예외 항목을 삭제(그때부터 게이트가 실차단한다)',
  },
];

// ── 스캔 ────────────────────────────────────────────────────────────────────

const hits = [];
const waived = [];
const exceptionUse = new Map(KNOWN_EXCEPTIONS.map((e, i) => [i, 0]));

function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function ipv4Exempt(path) {
  const rel = normalize(path);
  return IPV4_EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function isValidIpv4(ip) {
  return ip.split('.').every((o) => o.length <= 3 && Number(o) <= 255);
}

function safeIpv4(ip) {
  return SAFE_IPV4.some((r) => r.test(ip));
}

function urlHostOf(url) {
  const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  const withoutUserInfo = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  return withoutUserInfo.replace(/:\d*$/, '');
}

function exceptionFor(path, rule) {
  const rel = normalize(path);
  for (let i = 0; i < KNOWN_EXCEPTIONS.length; i++) {
    const e = KNOWN_EXCEPTIONS[i];
    if (normalize(e.file) === rel && e.rules.includes(rule)) {
      exceptionUse.set(i, (exceptionUse.get(i) ?? 0) + 1);
      return e;
    }
  }
  return null;
}

/**
 * 적발값 마스킹. 지문은 **값마다 안정적**이라 "같은 주소인가"는 구분되지만 값 자체는
 * 복원되지 않는다(솔트 고정 sha256 앞 4자리). 리포트에 나가는 모든 문자열은 이 함수를
 * 통과해야 한다 — 공개 CI 로그가 유출 경로가 되지 않게 하는 유일한 방어선이다.
 */
function fingerprint(value) {
  return createHash('sha256').update(`storige-exposure-gate:${value}`).digest('hex').slice(0, 4);
}

function redact(text) {
  let out = String(text);
  // ① IPv4 — 유효한 것만(버전 번호·절 번호는 건드리지 않는다).
  out = out.replace(IPV4_TOKEN_RE, (m, ip) => (isValidIpv4(ip) ? `<IPv4#${fingerprint(ip)}>` : m));
  IPV4_TOKEN_RE.lastIndex = 0;
  // ② 금지 식별자 — 이 파일이 평문 보관을 피하는 바로 그 문자열이라 로그에도 남기지 않는다.
  //    탐지(RE)가 대소문자 무시라 마스킹도 반드시 무시해야 한다(대소문자만 바꾼 유입이
  //    "적발됐는데 로그에는 평문" 상태로 남는 구멍을 막는다).
  out = out.replace(RE_GLOBAL, (m) => `<금지식별자#${fingerprint(m.toLowerCase())}>`);
  return out;
}

function record(rule, path, lineNo, detail, snippet) {
  const entry = {
    rule,
    where: `${path}:${lineNo}`,
    detail: redact(detail),
    snippet: redact(snippet.trim().slice(0, 160)),
  };
  const exception = exceptionFor(path, rule);
  if (exception) waived.push({ ...entry, exception });
  else hits.push(entry);
}

function scanFile(path) {
  let txt;
  try { txt = readFileSync(path, 'utf8'); } catch { return; }

  const configFile = !distMode && isConfigFile(path);
  const checkIpv4 = !distMode && !ipv4Exempt(path);
  // 파일 단위 선필터 — 대부분의 파일은 여기서 끝난다(전수 라인 루프 회피).
  if (!RE.test(txt) && !(checkIpv4 && IPV4_TEST_RE.test(txt))) return;

  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ① 외부 식별자
    if (RE.test(line)) record('DENY', path, i + 1, '금지 외부 식별자', line);

    if (!checkIpv4) continue;

    // ② IPv4 — URL authority (전 파일 적용)
    const flagged = new Set();
    for (const url of line.match(URL_RE) ?? []) {
      const host = urlHostOf(url);
      if (!IPV4_STRICT_RE.test(host) || !isValidIpv4(host) || safeIpv4(host)) continue;
      if (flagged.has(host)) continue;
      flagged.add(host);
      record('IP-URL', path, i + 1, `URL 호스트가 IPv4 리터럴: ${host}`, line);
    }

    // ③ IPv4 — 설정 파일의 bare 표기
    if (!configFile) continue;
    IPV4_TOKEN_RE.lastIndex = 0;
    for (const match of line.matchAll(IPV4_TOKEN_RE)) {
      const ip = match[1];
      if (!isValidIpv4(ip) || safeIpv4(ip)) continue;
      if (flagged.has(ip)) continue;
      flagged.add(ip);
      record('IP-CONFIG', path, i + 1, `설정 파일 내 IPv4 리터럴: ${ip}`, line);
    }
  }
}

function walk(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(p))) return;
    for (const entry of readdirSync(p)) walk(join(p, entry));
    return;
  }
  if (!st.isFile() || !TEXT_EXT.has(extname(p))) return;
  scanFile(p);
}

/**
 * 루트 레벨 설정 파일(*.json). DEFAULT_TARGETS 가 디렉터리뿐이라 루트 파일이 통째로
 * 미스캔이던 구멍을 메운다(vercel.json 평문 IP 실적발). 명시 경로 모드에서는 호출자가
 * 대상을 정하므로 추가하지 않는다(문서 포털 postbuild 는 cwd 가 apps/docs 라 루트가 아니다).
 */
function rootConfigFiles() {
  try {
    return readdirSync('.')
      .filter((name) => extname(name) === '.json')
      .filter((name) => {
        try { return statSync(name).isFile(); } catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

const explicit = targets.length > 0;
const scanTargets = explicit
  ? targets
  : [...(distMode ? [] : rootConfigFiles()), ...DEFAULT_TARGETS];
for (const t of scanTargets) walk(t);

// ── 리포트 ──────────────────────────────────────────────────────────────────

const scope = distMode ? '번들' : '소스';

// 예외는 통과·실패와 무관하게 **항상** 출력한다. 초록 로그만 보고 위험이 사라졌다고
// 착각하지 않게 하는 것이 이 블록의 유일한 목적이다.
if (waived.length) {
  const byException = new Map();
  for (const w of waived) {
    const list = byException.get(w.exception) ?? [];
    list.push(w);
    byException.set(w.exception, list);
  }
  console.warn(`\n⚠ 미해소 예외 ${byException.size}건 — 게이트가 의도적으로 통과시킨 항목(오너 액션 대기)`);
  for (const [exception, list] of byException) {
    console.warn(`\n  · ${exception.file} [${[...new Set(list.map((w) => w.rule))].join(', ')}] — ${list.length}건`);
    for (const w of list) console.warn(`      ${w.where}: ${w.detail}`);
    console.warn(`      사유      : ${exception.reason}`);
    console.warn(`      위험      : ${exception.impact}`);
    console.warn(`      오너 액션 : ${exception.ownerAction}`);
  }
  console.warn('');
}

// 해소된(=더 이상 매치되지 않는) 예외는 대장에서 지워야 한다. 남겨두면 다음 사고 때
// 그 파일이 조용히 통과한다.
const stale = KNOWN_EXCEPTIONS.filter((_, i) => (exceptionUse.get(i) ?? 0) === 0);
if (stale.length && !explicit && !distMode) {
  console.warn(`⚠ 해소된 예외 ${stale.length}건 — KNOWN_EXCEPTIONS 에서 삭제하세요:`);
  for (const e of stale) console.warn(`  · ${e.file} [${e.rules.join(', ')}]`);
  console.warn('');
}

if (hits.length) {
  console.error(`\n✗ 유출 방지 검사 실패 — ${hits.length}건 (${scope} 스캔)`);
  for (const h of hits) console.error(`  [${h.rule}] ${h.where}: ${h.detail}\n        ${h.snippet}`);
  console.error(
    '\n→ DENY: storige 자체 네임스페이스/키/상수로 재명명하세요. (내부 정책 문서 참조)' +
      '\n→ IP-URL / IP-CONFIG: 내부 주소를 도메인으로 교체하세요. 예외가 불가피하면 ' +
      'KNOWN_EXCEPTIONS 에 사유·위험·오너 액션과 함께 등재해야 합니다(무단 삭제 금지).\n',
  );
  process.exit(1);
}
const label = distMode ? '금지 식별자' : '금지 식별자 · 내부 IPv4';
console.log(`✓ 유출 방지 검사 통과 — ${label} 0건 (${scope}: ${scanTargets.join(', ')})`);
