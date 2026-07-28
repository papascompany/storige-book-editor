#!/usr/bin/env node
/**
 * check-source-exposure.mjs — 외부 식별자 유출 방지 게이트
 *
 * 내부 정책상 배포 산출물(브라우저 번들)·소스에 포함되면 안 되는 외부 식별자 목록을
 * 검사한다. 기능 자체가 아니라 **외부 고유 식별자·키·상수의 문자열 유입**만 차단한다
 * (배포 번들·DOM·네트워크에 남아 출처를 드러내는 신호). 매치가 있으면 file:line 을
 * 출력하고 비0 종료한다(→ 빌드/CI 실패 = 배포 차단). 정책 상세는 내부 문서 참조.
 *
 * 사용:
 *   node scripts/check-source-exposure.mjs                # 소스 스캔(기본: apps, packages, examples, docs)
 *   node scripts/check-source-exposure.mjs --dist dist    # 빌드 산출물 스캔(보수적 목록)
 *   node scripts/check-source-exposure.mjs path1 path2    # 명시 경로 스캔
 *                                                        # 예: apps/docs/site (문서 포털 postbuild)
 *
 * 참고: 금지 목록은 정책 준수를 위해 이 파일 내에 평문으로 두지 않는다(인코딩 보관).
 */
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
const RE = new RegExp(DENY.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

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

const hits = [];

function walk(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(p))) return;
    for (const entry of readdirSync(p)) walk(join(p, entry));
    return;
  }
  if (!st.isFile() || !TEXT_EXT.has(extname(p))) return;
  let txt;
  try { txt = readFileSync(p, 'utf8'); } catch { return; }
  if (!RE.test(txt)) return;
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (RE.test(lines[i])) hits.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
  }
}

const scanTargets = targets.length ? targets : DEFAULT_TARGETS;
for (const t of scanTargets) walk(t);

const scope = distMode ? '번들' : '소스';
if (hits.length) {
  console.error(`\n✗ 유출 방지 검사 실패 — 금지 외부 식별자 ${hits.length}건 (${scope} 스캔)`);
  for (const h of hits) console.error('  ' + h);
  console.error('\n→ storige 자체 네임스페이스/키/상수로 재명명하세요. (내부 정책 문서 참조)\n');
  process.exit(1);
}
console.log(`✓ 유출 방지 검사 통과 — 금지 식별자 0건 (${scope}: ${scanTargets.join(', ')})`);
