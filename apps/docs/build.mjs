#!/usr/bin/env node
/**
 * build.mjs — 문서 포털 빌드 오케스트레이터 (shard ① 소유)
 *
 * 입력  docs/PLATFORM_INTEGRATION_GUIDE.md  (읽기 전용 — 빌드가 절대 쓰지 않는다)
 *       apps/docs/content/*.md              (②③ 저술)
 *       openapi-partner.json                (빌드타임 생성물 — gitignored)
 * 출력  apps/docs/site/**                   (html · theme.css · llms.txt · llms-full.txt · robots.txt)
 *
 * 모드
 *   기본      strict — 매니페스트 전 항목이 존재해야 한다(R5). 통합 게이트용.
 *   --dev     누락 콘텐츠를 경고로 낮춘다. shard 개별 게이트용(타 shard 파일이 아직 없어도 통과).
 *
 * 결정적이다: 타임스탬프·난수·네트워크 0. 같은 입력 → 같은 출력.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  GUIDE_PATH,
  HOST_ALLOWLIST,
  IPV4_ALLOWLIST,
  LLMS_INTRO,
  NAV_ORDER,
  OPENAPI,
  PAGES,
  PENDING_ANCHORS,
  SITE,
} from './site.config.mjs';
import { auditFiles, formatViolations, readTextFiles, urlHost } from './src/guard.mjs';
import { checkLinks, normalizeRoute } from './src/linkcheck.mjs';
import { renderMarkdown } from './src/render-md.mjs';
import { renderOpenApiMarkdown } from './src/render-openapi.mjs';
import { resolveGuideSlice, sliceByH2 } from './src/slice.mjs';
import { renderLayout } from './templates/layout.mjs';

const DOCS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(DOCS_DIR, '../..');
const SITE_DIR = join(DOCS_DIR, 'site');

const dev = process.argv.slice(2).includes('--dev');
const mode = dev ? '--dev (누락 허용)' : 'strict';
/**
 * 노출 게이트의 **빌드측 축**. 이 플래그가 켜지면 (a) 전 HTML 에 robots meta, (b) `robots.txt`
 * `Disallow: /` 를 산출한다. 세 번째 축인 HTTP `X-Robots-Tag` 는 빌드가 아니라 `vercel.json`
 * `headers` 소관이다 — `.txt` 산출물에는 meta 를 넣을 자리가 없어서 헤더가 유일한 커버리지다.
 * 공개하려면 **이 env 와 그 헤더 블록을 함께** 지워야 한다(apps/docs/DEPLOY.md §0-1).
 */
const noindex = process.env.STORIGE_DOCS_NOINDEX === '1';
const warnings = [];
const missing = [];

log(`Storige 문서 포털 빌드 — ${mode}`);

// ── 1. GUIDE 슬라이스 ────────────────────────────────────────────────────────
const guidePath = join(REPO_ROOT, GUIDE_PATH);
if (!existsSync(guidePath)) fail(`GUIDE 를 찾을 수 없다: ${guidePath}`);
const guideRaw = readFileSync(guidePath, 'utf8');
const sliced = sliceByH2(guideRaw);
log(`GUIDE 슬라이스 — H2 ${sliced.sections.length}개 탐지 (${GUIDE_PATH})`);

// ── 2. OpenAPI 스펙 해석 ────────────────────────────────────────────────────
const specPath = resolveSpecPath();
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const api = renderOpenApiMarkdown(spec, OPENAPI);
log(
  `OpenAPI 스펙 — paths=${api.stats.paths}, operations=${api.stats.operations}, schemas=${api.stats.schemas}` +
    ` (${relative(REPO_ROOT, specPath)})`,
);

// ── 3. 페이지 조립 ──────────────────────────────────────────────────────────
const built = [];
for (const page of PAGES) {
  const assembled = assemblePage(page);
  if (!assembled) continue;
  built.push({ ...page, ...assembled });
}

if (missing.length && !dev) {
  fail(
    `매니페스트 소스 누락 ${missing.length}건 (R5) — strict 빌드는 통과할 수 없다:\n` +
      missing.map((m) => `  - ${m}`).join('\n') +
      `\n→ 개별 shard 작업 중이면 \`pnpm --filter @storige/docs build -- --dev\` 를 쓰라.`,
  );
}

const navGroups = NAV_ORDER.map((label) => ({
  label,
  items: built.filter((p) => p.nav === label).map((p) => ({ route: p.route, title: p.title })),
})).filter((group) => group.items.length > 0);

// ── 4. 산출 ────────────────────────────────────────────────────────────────
rmSync(SITE_DIR, { recursive: true, force: true });
mkdirSync(SITE_DIR, { recursive: true });

const emittedPages = [];
for (const page of built) {
  const html = renderLayout({
    title: page.title,
    description: page.summary || SITE.description,
    lang: SITE.lang,
    siteTitle: SITE.shortTitle,
    route: page.route,
    navGroups,
    headings: page.headings,
    body: page.html,
    provenance: page.provenance,
    noindex,
  });
  const outFile = routeToFile(page.route);
  writeOut(outFile, html);
  emittedPages.push({ route: page.route, file: outFile, html });
}

const themeCss = readFileSync(join(DOCS_DIR, 'theme.css'), 'utf8');
writeOut('theme.css', themeCss);

// robots.txt — 모드와 무관하게 **항상** 산출한다. 없으면 404(=허용)로 해석되므로,
// "차단 모드인데 파일이 없다"와 "공개 모드"가 산출물에서 구분되지 않는다.
writeOut('robots.txt', renderRobots(noindex));
log(`robots.txt 산출 — ${noindex ? '크롤 차단 (Disallow: /)' : '크롤 허용'}`);

// ── 5. llms.txt (③ 소유 모듈 — 고정 경로 import) ─────────────────────────────
const textFiles = await emitLlmsOutputs();

// ── 6. 게이트: guard(R1~R3) → linkcheck(R4) ─────────────────────────────────
const scanTargets = [
  ...emittedPages.map((p) => join(SITE_DIR, p.file)),
  join(SITE_DIR, 'theme.css'),
  join(SITE_DIR, 'robots.txt'),
  ...textFiles.map((t) => join(SITE_DIR, t.file)),
];
const hostAllowlist = [...HOST_ALLOWLIST];
if (SITE.siteUrl) {
  const host = urlHost(SITE.siteUrl);
  if (host && !hostAllowlist.includes(host)) {
    hostAllowlist.push(host);
    log(`guard R1 — STORIGE_DOCS_SITE_URL 호스트를 화이트리스트에 추가: ${host}`);
  }
}

const violations = auditFiles(
  readTextFiles(scanTargets).map((f) => ({ ...f, path: relative(REPO_ROOT, f.path) })),
  { hostAllowlist, ipv4Allowlist: IPV4_ALLOWLIST },
);
if (violations.length) {
  fail(`guard 위반 ${violations.length}건 (R1~R3) — 산출물에 내부 형상/금지 식별자가 있다:\n${formatViolations(violations)}`);
}
log(`guard R1~R3 통과 — 스캔 ${scanTargets.length}파일, 위반 0건`);

const linkProblems = checkLinks({
  pages: emittedPages,
  textFiles,
  assets: ['/theme.css'],
  siteUrl: SITE.siteUrl,
});

// --dev 에서만, **아직 저술되지 않은 타 shard 산출물**을 가리키는 링크를 경고로 낮춘다.
// 오타·잘못된 앵커는 --dev 에서도 그대로 죽는다(게이트를 장식으로 만들지 않기 위해).
const skippedRoutes = new Set(
  PAGES.filter((p) => !built.some((b) => b.route === p.route)).map((p) => normalizeRoute(p.route)),
);
const pending = new Set(PENDING_ANCHORS);
const tolerated = [];
const fatal = [];
for (const problem of linkProblems) {
  const routeMissing = /^존재하지 않는 라우트: (.+)$/.exec(problem.reason);
  const isPendingRoute = routeMissing && skippedRoutes.has(routeMissing[1]);
  const isPendingAnchor = pending.has(problem.target);
  if (dev && (isPendingRoute || isPendingAnchor)) tolerated.push(problem);
  else fatal.push(problem);
}
if (fatal.length) {
  fail(
    `linkcheck 실패 ${fatal.length}건 (R4):\n` +
      fatal.map((p) => `  ${p.file} → ${p.target}: ${p.reason}`).join('\n'),
  );
}
if (tolerated.length) {
  const targets = [...new Set(tolerated.map((p) => p.target))];
  warnings.push(
    `linkcheck — 미저술 전방 참조 ${tolerated.length}건 경고로 낮춤(--dev 한정): ${targets.join(', ')}`,
  );
}
log(`linkcheck R4 통과 — 내부 링크 전수 해석 성공 (치명 0건${tolerated.length ? `, 전방참조 경고 ${tolerated.length}건` : ''})`);

// ── 7. 리포트 ──────────────────────────────────────────────────────────────
for (const warning of warnings) log(`⚠ ${warning}`);
log(`완료 — 페이지 ${emittedPages.length}개 + 텍스트 ${textFiles.length}개 → ${relative(REPO_ROOT, SITE_DIR)}/`);
for (const page of emittedPages) log(`   ${page.route.padEnd(22)} ${page.file}`);

// ─────────────────────────────────────────────────────────────────────────────

function assemblePage(page) {
  const source = page.source;

  if (source.kind === 'guide') {
    const slice = resolveGuideSlice(sliced, source);
    // 무변형 증명용 — 타 세션이 §3 을 개정해 오면 이 SHA 로 대조한다(계약 §3-F).
    log(
      `   §${source.section} 슬라이스 sha256=${slice.sectionSha256}` +
        (source.section === 3 ? '  ← 임베드 구역(타 세션 소유, 바이트 무변형 통과)' : ''),
    );
    const { html, headings } = renderMarkdown(slice.text);
    return {
      html,
      headings,
      sourceMd: slice.text,
      provenance: `이 페이지는 <code>${GUIDE_PATH}</code> §${source.section} 의 발췌다 — 본문은 무변형이며, 포털은 발행 채널일 뿐 별도 정본이 아니다.`,
    };
  }

  if (source.kind === 'content') {
    const md = readOptional(source.file, page.route);
    if (md === null) return null;
    const { html, headings } = renderMarkdown(md);
    return {
      html,
      headings,
      sourceMd: md,
      provenance: `포털 저술 문서. 규범 서술의 정본은 <a href="/guide/">연동 가이드</a> 다.`,
    };
  }

  if (source.kind === 'openapi') {
    const intro = readOptional(source.intro, page.route);
    if (intro === null && !dev) return null;
    const md = `${intro ?? ''}\n\n${api.markdown}\n`;
    const { html, headings } = renderMarkdown(md);
    return {
      html,
      headings,
      sourceMd: md,
      provenance: `아래 레퍼런스는 서버 라우트 정의에서 자동 생성했다. 응답 <code>data</code> 스키마는 스펙에 존재하지 않아 렌더하지 않는다.`,
    };
  }

  throw new Error(`알 수 없는 source.kind: ${source.kind}`);
}

function readOptional(relPath, route) {
  const abs = join(DOCS_DIR, relPath);
  if (existsSync(abs)) return readFileSync(abs, 'utf8');
  missing.push(`${relPath} (라우트 ${route})`);
  warnings.push(`콘텐츠 누락으로 건너뜀: ${relPath} → ${route}`);
  return null;
}

async function emitLlmsOutputs() {
  const modulePath = join(DOCS_DIR, 'src/emit-llms.mjs');
  if (!existsSync(modulePath)) {
    const note = 'src/emit-llms.mjs 없음 — llms.txt / llms-full.txt 생략 (shard ③ 소유 모듈)';
    if (!dev) fail(`${note}\n→ strict 빌드는 이 모듈을 요구한다.`);
    warnings.push(note);
    return [];
  }

  const introPath = join(DOCS_DIR, LLMS_INTRO);
  let introMd = null;
  if (existsSync(introPath)) {
    introMd = readFileSync(introPath, 'utf8');
  } else {
    missing.push(`${LLMS_INTRO} (llms.txt 머리말)`);
    warnings.push(`llms 머리말 누락: ${LLMS_INTRO}`);
    if (!dev) fail(`strict 빌드에 ${LLMS_INTRO} 가 필요하다.`);
  }

  const { emitLlms } = await import(pathToFileURL(modulePath).href);
  const outputs = emitLlms({
    pages: built.map((p) => ({
      route: p.route,
      title: p.title,
      summary: p.summary,
      sourceMd: p.sourceMd,
    })),
    siteUrl: SITE.siteUrl,
    introMd,
  });

  const written = [];
  for (const [name, text] of Object.entries(outputs ?? {})) {
    if (typeof text !== 'string') fail(`emitLlms 가 문자열이 아닌 값을 반환했다: ${name}`);
    writeOut(name, text);
    written.push({ file: name, text });
  }
  log(`llms 산출 — ${written.map((w) => w.file).join(', ') || '(없음)'}`);
  return written;
}

/**
 * 스펙 경로 해석.
 *
 * ⚠️ **순서만으로 고르지 않는다.** 예전에는 `.generated/` 사본을 무조건 우선했는데,
 * `pnpm docs:spec` 을 한 번이라도 돌린 머신에는 그 사본이 영원히 남기 때문에
 * `apps/api/openapi-partner.json` 이 새로 생성돼도 **낡은 레퍼런스가 조용히 렌더**됐다.
 * 두 사본이 다르면 최신본(mtime)을 쓰고 경고를 남긴다 — 침묵만은 허용하지 않는다.
 */
function resolveSpecPath() {
  // 명시 지정은 무조건 존중한다(오타로 인한 조용한 폴백을 만들지 않기 위해 없으면 실패).
  const override = process.env.STORIGE_OPENAPI_SPEC;
  if (override) {
    if (!existsSync(override)) fail(`$STORIGE_OPENAPI_SPEC 가 가리키는 스펙이 없다: ${override}`);
    return override;
  }

  const generated = join(DOCS_DIR, '.generated/openapi-partner.json');
  const fromApi = join(REPO_ROOT, 'apps/api/openapi-partner.json');
  const found = [generated, fromApi].filter((p) => existsSync(p));

  if (found.length === 0) {
    fail(
      `openapi-partner.json 을 찾을 수 없다. 탐색 대상:\n` +
        `  1) $STORIGE_OPENAPI_SPEC (지정 시 단독 사용)\n` +
        `  2) apps/docs/.generated/openapi-partner.json\n` +
        `  3) apps/api/openapi-partner.json\n` +
        `  (2·3 이 모두 있고 내용이 다르면 mtime 최신본을 쓰고 경고한다.)\n` +
        `→ 생성 명령(레포 루트에서):\n` +
        `   pnpm --filter @storige/types build\n` +
        `   OPENAPI_PARTNER_OUT=$PWD/apps/docs/.generated/openapi-partner.json pnpm --filter @storige/api openapi:partner\n` +
        `  (이 파일은 gitignored 빌드타임 생성물이라 레포에 없다.)`,
    );
  }
  if (found.length === 1) return found[0];

  // 둘 다 있다. 내용이 같으면 어느 쪽을 써도 산출물이 동일하다.
  if (readFileSync(generated, 'utf8') === readFileSync(fromApi, 'utf8')) return generated;

  const genTime = statSync(generated).mtimeMs;
  const apiTime = statSync(fromApi).mtimeMs;
  const winner = genTime >= apiTime ? generated : fromApi;
  const loser = winner === generated ? fromApi : generated;
  const stamp = (p) => new Date(statSync(p).mtimeMs).toISOString();
  warnings.push(
    `OpenAPI 스펙 사본 2개의 내용이 다르다 — 최신본을 쓴다(스테일 렌더 방지).\n` +
      `    사용: ${relative(REPO_ROOT, winner)}  (mtime ${stamp(winner)})\n` +
      `    무시: ${relative(REPO_ROOT, loser)}  (mtime ${stamp(loser)})\n` +
      `    → 낡은 사본을 지우거나 \`pnpm docs:spec\` 으로 다시 생성하라.`,
  );
  return winner;
}

/**
 * robots.txt 본문. 차단 모드는 `Disallow: /` 로 **크롤 자체**를 막는다.
 * 한계는 DEPLOY.md §0-1 에 적어 뒀다 — 크롤이 막히면 크롤러가 meta/헤더의 noindex 를 읽지도
 * 못하므로, 외부 링크가 걸린 URL 은 본문 없이 목록에 남을 수 있다.
 */
function renderRobots(blocked) {
  return blocked
    ? [
        '# 색인 차단 모드 (STORIGE_DOCS_NOINDEX=1)',
        '# 공개하려면 이 env 와 vercel.json 의 X-Robots-Tag 헤더 블록을 함께 지운다.',
        'User-agent: *',
        'Disallow: /',
        '',
      ].join('\n')
    : [
        '# 공개 모드 — 크롤 허용',
        'User-agent: *',
        'Disallow:',
        '',
      ].join('\n');
}

function routeToFile(route) {
  const normalized = normalizeRoute(route);
  return normalized === '/' ? 'index.html' : `${normalized.slice(1, -1)}/index.html`;
}

function writeOut(relPath, contents) {
  const abs = join(SITE_DIR, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n\n`);
  process.exit(1);
}
