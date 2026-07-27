#!/usr/bin/env node
/**
 * strip-sourcemaps.mjs — 배포 산출물에서 소스맵·번들 분석 리포트 제거 (source-exposure 게이트)
 *
 * 왜 필요한가:
 *  - `build.sourcemap: 'hidden'` 은 `//# sourceMappingURL=` **주석만** 없앤다. .map 파일 자체는
 *    dist 에 남고 Vercel 이 정적 자산으로 그대로 서빙하므로, 파일명(=JS 해시)만 알면 받아갈 수 있다.
 *    원본 TS 전문이 sourcesContent 에 통째로 들어 있으므로 실질 노출은 그대로다 → 물리 삭제가 필수.
 *  - 삭제를 vite 플러그인(filesToDeleteAfterUpload)에 맡기지 않는 이유는 두 가지다.
 *    ① 유출 검사(check-source-exposure --dist)가 .map 의 sourcesContent 를 스캔하는 가장 민감한
 *       탐지 채널이라, 그 게이트가 돈 **뒤에** 지워야 커버리지를 잃지 않는다.
 *    ② 플러그인 내장 삭제는 업로드 실패/스킵과 무관하게 finally 에서 실행돼
 *       '맵 삭제 O · 업로드 X'(= 스택트레이스 영구 minified) 무증상 조합을 만든다.
 *
 * 동작:
 *  기대 정책은 **빌드와 같은 env 로 스스로 계산한다**(산출물에서 추론하지 않는다).
 *    expectHidden = (SENTRY_AUTH_TOKEN·SENTRY_ORG·SENTRY_PROJECT 3종) || SOURCEMAP_STRIP=1 || --force-strip
 *  산출물 검사는 **교차 확인**으로만 쓰고, '실재하는 .map 을 가리키는 말미 참조'만 위반으로 센다.
 *  - expectHidden 인데 그런 참조가 있다 → sourcemap:hidden 이 적용되지 않은 것 → **exit 1(배포 차단)**.
 *    ⚠️ 종전 구현은 참조 주석 유무만 보고 'public 모드=보존'으로 판정했는데, dist 안 벤더 파일 한 개만
 *       주석을 갖고 있어도 전체가 뒤집혀 맵이 그대로 배포되는 무증상 no-op 이 됐다. 실제로 onnxruntime 의
 *       ort.bundle.min-*.mjs 2건이 그 형태다(가리키는 맵은 dist 에 없어 이미 dangling = 무해).
 *       그래서 ① 정책은 env 로 받고 ② 교차확인은 맵 실재 여부까지 확인하도록 바꿨다.
 *  - expectHidden 이면 .map 전량 삭제. 업로드가 실패했어도(=`.sentry-upload-failed` 마커) 삭제한다 —
 *    hidden 은 참조 주석이 없어 Sentry 가 맵을 발견할 수단(sourceMappingURL 주석 / SourceMap 헤더)이
 *    아예 없다. 보존해도 심볼리케이션은 못 살리고 노출만 남는 양쪽 손해다. 대신 "이 배포는 스택트레이스가
 *    minified" 라고 크게 경고한다(빌드는 통과 — Sentry 장애가 편집기 배포를 막으면 안 된다).
 *  - expectHidden 이 아니면(= 업로드 미배선, 현행 유지 모드) 맵을 보존한다. 심볼리케이션 손실 없음.
 *  - stats.html(rollup-plugin-visualizer 산출물)은 ANALYZE=1 이 아니면 항상 제거 — 남으면
 *    모듈 트리·내부 경로 수천 건이 공개된다.
 *
 * 사용:
 *   node scripts/strip-sourcemaps.mjs --dist dist
 *   node scripts/strip-sourcemaps.mjs --dist dist-embed --force-strip   # env 무관 항상 제거
 *   node scripts/strip-sourcemaps.mjs --self-test                       # 판정 로직 회귀 테스트
 * 종료코드: 0=정상(보존 포함) / 1=정책 불일치·삭제 실패(배포 차단) / 2=self-test 실패
 */
import { readdirSync, statSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 번들러가 붙인 **말미 참조 주석**만 인식한다.
 *   `\n//# sourceMappingURL=foo.js.map` + (선택 공백) + EOF
 * data: URI(인라인 맵)와 코드 안 문자열은 제외한다 — 예: vendor-paper 청크에는 paper.js 의
 * PaperScript 컴파일러가 **런타임에** 인라인 맵 주석을 만들어 붙이는 코드가 문자열로 들어 있어,
 * 단순 substring 검사로는 오탐한다(실측: 파일 끝에서 2,637바이트 지점 — tail 2KB 검사를 겨우 비껴갔다).
 * 오탐하면 'public 모드'로 오판해 맵을 지우지 않고 그대로 배포한다 = 조치 무효.
 */
export const TRAILING_SOURCEMAP_REF = /(?:^|\n)\/\/[#@] sourceMappingURL=(?!data:)(\S+)\s*$/;

/** dist 하위 전체 파일 경로 수집 */
export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

/**
 * 파일 말미의 소스맵 참조 대상 파일명 (없으면 null). 한 줄짜리 거대 번들 대비 tail 4KB 검사.
 */
export function trailingSourcemapRef(file) {
  try {
    const buf = readFileSync(file);
    const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString('utf8');
    const m = TRAILING_SOURCEMAP_REF.exec(tail);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** 말미 참조 주석 존재 여부 (self-test 호환용) */
export function hasTrailingSourcemapRef(file) {
  return trailingSourcemapRef(file) !== null;
}

/**
 * 정책 위반 후보 — **실재하는 .map 을 가리키는** 말미 참조만 센다.
 *
 * ⚠️ 벤더 산출물은 자기 맵을 참조하지만 그 맵이 dist 에 없는 경우가 흔하다(실측: onnxruntime 의
 *    ort.bundle.min-*.mjs → ort.bundle.min.mjs.map 미존재 = 이미 dangling, 배포에 무해).
 *    이런 것까지 위반으로 세면 정상 빌드가 매번 차단된다. 반대로 우리 청크가 실재하는 맵을
 *    참조하고 있다면 sourcemap:'hidden' 이 적용되지 않은 것이므로 진짜 차단 대상이다.
 */
export function findPolicyOffenders(referrers) {
  const offenders = [];
  for (const f of referrers) {
    const ref = trailingSourcemapRef(f);
    if (!ref) continue;
    const mapPath = resolve(dirname(f), ref);
    if (existsSync(mapPath)) offenders.push(f);
  }
  return offenders;
}

/**
 * 빌드가 hidden+삭제 정책으로 돌았어야 하는지 — **vite.config 와 동일한 계산**.
 * 산출물에서 추론하지 않는다(벤더 파일 1개에 전체 판정이 뒤집히던 구조를 폐기).
 */
export function expectHiddenFromEnv(env = process.env, forceStrip = false) {
  if (forceStrip) return true;
  const org = (env.SENTRY_ORG || '').trim();
  const project = (env.SENTRY_PROJECT || '').trim();
  const token = (env.SENTRY_AUTH_TOKEN || '').trim();
  return Boolean(org && project && token) || env.SOURCEMAP_STRIP === '1';
}

/**
 * 삭제 여부 판정 (순수 함수 — self-test 대상)
 *
 * ⚠️ uploadFailed 여도 삭제한다. hidden 은 참조 주석이 없어 Sentry 가 맵을 찾을 방법이 없으므로
 *    (발견 수단 = sourceMappingURL 주석 또는 SourceMap 헤더뿐), 보존은 '심볼리케이션 못 살리고
 *    노출만 유지'라 순손해다.
 * ⚠️ expectHidden 인데 참조 주석이 남아 있으면 빌드 설정이 안 먹은 것이다 → 보존이 아니라 **차단**.
 * @returns {{action: 'none'|'keep-public'|'delete'|'delete-unsymbolicated'|'error-config', reason: string}}
 */
export function decide({ mapCount, publicMode, uploadFailed, expectHidden }) {
  if (expectHidden && publicMode) {
    return {
      action: 'error-config',
      reason: 'hidden 을 기대했는데 산출물에 sourceMappingURL 참조 주석이 남아 있다 — 빌드 설정 미적용',
    };
  }
  if (mapCount === 0) return { action: 'none', reason: '.map 0건' };
  if (!expectHidden) return { action: 'keep-public', reason: '업로드 미배선(현행 유지 모드) — 맵 보존' };
  if (uploadFailed) return { action: 'delete-unsymbolicated', reason: 'Sentry 업로드 실패 — 맵은 제거하되 경고' };
  return { action: 'delete', reason: 'hidden 모드 + 업로드 정상' };
}

function main() {
  const argv = process.argv.slice(2);
  const distIdx = argv.indexOf('--dist');
  const distArg = distIdx >= 0 ? argv[distIdx + 1] : 'dist';
  const distDir = resolve(process.cwd(), distArg);
  const forceStrip = argv.includes('--force-strip');

  if (!existsSync(distDir)) {
    console.error(`[strip-sourcemaps] 산출물 디렉터리를 찾을 수 없다: ${distDir}`);
    return 1;
  }

  const files = walk(distDir);
  const maps = files.filter((f) => f.endsWith('.map'));
  // .mjs/.cjs 도 참조 주석을 가질 수 있다(예: onnxruntime 의 ort.bundle.min-*.mjs) — 교차 확인 대상에 포함.
  const referrers = files.filter((f) => /\.(js|mjs|cjs|css)$/.test(f));

  // ── 1) 번들 분석 리포트 제거 (분석 목적으로 명시한 경우만 남긴다) ──────────────
  if (process.env.ANALYZE !== '1') {
    for (const f of files.filter((x) => x.endsWith('stats.html'))) {
      rmSync(f, { force: true });
      console.log(`[strip-sourcemaps] 번들 분석 리포트 제거: ${relative(distDir, f)}`);
    }
  }

  // ── 2) 소스맵 정책 판정 ────────────────────────────────────────────────────
  const failMarker = join(distDir, '.sentry-upload-failed');
  const uploadFailed = existsSync(failMarker);
  const expectHidden = expectHiddenFromEnv(process.env, forceStrip);
  const offenders = findPolicyOffenders(referrers);
  const { action, reason } = decide({
    mapCount: maps.length,
    publicMode: offenders.length > 0,
    uploadFailed,
    expectHidden,
  });

  if (action === 'error-config') {
    // 마커가 있으면 치워 배포 산출물에 남지 않게 한다(어차피 실패로 끝나지만 방어적).
    if (uploadFailed) rmSync(failMarker, { force: true });
    console.error(
      `[strip-sourcemaps] ✗ ${reason}\n` +
        `   참조 주석이 남은 파일: ${offenders.map((f) => relative(distDir, f)).join(', ')}\n` +
        '   = sourcemap:hidden 이 적용되지 않았다(참조가 가리키는 .map 이 실제로 존재한다). 배포를 중단한다\n' +
        '   — 맵을 지우면 모든 청크에 dangling 참조가 남고, 두면 원본 소스가 공개된다. 빌드 설정을 고쳐라.'
    );
    return 1;
  }

  if (action === 'none') {
    console.log('[strip-sourcemaps] .map 0건 — 처리할 것 없음');
    return 0;
  }

  if (action === 'keep-public') {
    console.log(
      `[strip-sourcemaps] ${reason} — .map ${maps.length}건 보존.\n` +
        '   노출을 끊으려면 SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT 를 설정하거나 SOURCEMAP_STRIP=1 로 빌드할 것.'
    );
    return 0;
  }

  if (action === 'delete-unsymbolicated') {
    const detail = readFileSync(failMarker, 'utf8').trim();
    rmSync(failMarker, { force: true });
    console.warn(
      `[strip-sourcemaps] ⚠️ Sentry 소스맵 업로드가 실패했다 — 맵은 예정대로 제거한다(노출 차단 유지).\n` +
        `   사유: ${detail}\n` +
        '   ⚠️ 이 배포에서 발생하는 Sentry 이슈는 minified 스택으로 남는다. 업로드를 고친 뒤 재배포할 것.'
    );
    // 삭제는 아래 공통 경로에서 계속 수행한다.
  }

  // ── 3) 삭제 ────────────────────────────────────────────────────────────────
  let bytes = 0;
  for (const f of maps) {
    try {
      bytes += statSync(f).size;
      rmSync(f, { force: true });
    } catch (err) {
      console.error(`[strip-sourcemaps] 삭제 실패 — 소스맵이 배포될 수 있다: ${f}`, err);
      return 1;
    }
  }

  const remaining = walk(distDir).filter((f) => f.endsWith('.map'));
  if (remaining.length > 0) {
    console.error(`[strip-sourcemaps] 삭제 후에도 .map ${remaining.length}건 잔존 — 배포 차단`);
    return 1;
  }

  console.log(
    `[strip-sourcemaps] ✓ .map ${maps.length}건 제거 (${(bytes / 1024 / 1024).toFixed(1)}MB) — 배포 산출물에 소스맵 없음`
  );
  return 0;
}

// ---------------------------------------------------------------------------
// self-test — 판정 로직 회귀 방지 (CI 에서 editor/admin 빌드를 돌리지 않으므로 여기가 유일 가드)
// ---------------------------------------------------------------------------
function selfTest() {
  let failed = 0;
  const check = (name, cond) => {
    console.log(`${cond ? '  ✓' : '  ✗'} ${name}`);
    if (!cond) failed++;
  };

  const dir = mkdtempSync(join(tmpdir(), 'strip-sourcemaps-'));

  // ① 번들러 말미 주석 = public 모드로 인식
  const withRef = join(dir, 'a.js');
  writeFileSync(withRef, 'console.log(1)\n//# sourceMappingURL=a.js.map\n');
  check('말미 //# sourceMappingURL=<파일> 을 인식', hasTrailingSourcemapRef(withRef));

  // ② 코드 안 문자열은 오탐하지 않는다 (paper.js PaperScript 실측 패턴)
  const paperLike = join(dir, 'vendor-paper.js');
  writeFileSync(
    paperLike,
    'var v="";/^(inline|both)$/.test(A)&&(v+=`\\n//# sourceMappingURL=data:application/json;base64,`+btoa(x));' +
      'export{v};' +
      'x'.repeat(3000)
  );
  check('코드 내부 문자열(data: 인라인 생성기)은 오탐하지 않음', !hasTrailingSourcemapRef(paperLike));

  // ③ data: URI 인라인 맵 주석도 참조로 보지 않는다(삭제할 외부 .map 이 없으므로)
  const inlineRef = join(dir, 'b.js');
  writeFileSync(inlineRef, 'console.log(1)\n//# sourceMappingURL=data:application/json;base64,e30=\n');
  check('data: 인라인 맵 주석은 public 모드로 보지 않음', !hasTrailingSourcemapRef(inlineRef));

  // ④ hidden 모드(주석 없음)
  const hidden = join(dir, 'c.js');
  writeFileSync(hidden, 'console.log(1)\n');
  check('주석 없는 파일은 hidden 모드', !hasTrailingSourcemapRef(hidden));

  // ⑤ 한 줄짜리 거대 번들에서도 말미 주석을 놓치지 않는다(tail 창 경계)
  const huge = join(dir, 'huge.js');
  writeFileSync(huge, 'a'.repeat(200000) + '\n//# sourceMappingURL=huge.js.map');
  check('한 줄 200KB 번들의 말미 주석도 인식', hasTrailingSourcemapRef(huge));

  // ⑥ .mjs 벤더 파일도 교차확인 대상 (onnxruntime ort.bundle.min-*.mjs 실측 패턴)
  const vendorMjs = join(dir, 'ort.bundle.min-XYZ.mjs');
  writeFileSync(vendorMjs, 'export const a=1;\n//# sourceMappingURL=ort.bundle.min.mjs.map\n');
  check('.mjs 벤더의 말미 주석도 인식', hasTrailingSourcemapRef(vendorMjs));

  // ⑥-2 교차확인은 '실재하는 맵을 가리키는 참조'만 위반으로 센다 (벤더 dangling 오탐 방지)
  const offDir = join(dir, 'offenders');
  mkdirSync(offDir, { recursive: true });
  writeFileSync(join(offDir, 'vendor.mjs'), 'export const a=1;\n//# sourceMappingURL=vendor-missing.mjs.map\n');
  check('벤더의 dangling 참조(맵 미존재)는 위반 아님', findPolicyOffenders([join(offDir, 'vendor.mjs')]).length === 0);
  writeFileSync(join(offDir, 'ours.js'), 'console.log(1)\n//# sourceMappingURL=ours.js.map\n');
  writeFileSync(join(offDir, 'ours.js.map'), '{"version":3}');
  check('실재하는 맵을 가리키는 참조는 위반', findPolicyOffenders([join(offDir, 'ours.js')]).length === 1);

  // ⑦ 기대 정책 계산 (vite.config 와 동일 규칙)
  check('토큰 3종 → expectHidden', expectHiddenFromEnv({ SENTRY_ORG: 'o', SENTRY_PROJECT: 'p', SENTRY_AUTH_TOKEN: 't' }));
  check('토큰 2종만 → false', !expectHiddenFromEnv({ SENTRY_ORG: 'o', SENTRY_AUTH_TOKEN: 't' }));
  check('공백/개행만 든 값은 없는 것으로 접힘', !expectHiddenFromEnv({ SENTRY_ORG: ' ', SENTRY_PROJECT: '\n', SENTRY_AUTH_TOKEN: 't' }));
  check('개행 붙은 정상 값 3종은 true(vercel env add 오염 내성)', expectHiddenFromEnv({ SENTRY_ORG: 'o\n', SENTRY_PROJECT: 'p\n', SENTRY_AUTH_TOKEN: 't\n' }));
  check('SOURCEMAP_STRIP=1 → true', expectHiddenFromEnv({ SOURCEMAP_STRIP: '1' }));
  check('--force-strip → true', expectHiddenFromEnv({}, true));
  check('아무것도 없으면 false', !expectHiddenFromEnv({}));

  // ⑧ 판정표 — expectHidden 이 정책의 유일한 소스, 산출물 검사는 교차확인
  const D = (o) => decide({ mapCount: 3, uploadFailed: false, ...o }).action;
  check('맵 0건 → none', decide({ mapCount: 0, publicMode: false, uploadFailed: false, expectHidden: true }).action === 'none');
  check('업로드 미배선(expectHidden=false) → 보존', D({ publicMode: true, expectHidden: false }) === 'keep-public');
  check(
    '⚠️ hidden 기대인데 참조 주석 잔존 → 보존이 아니라 차단(error-config)',
    D({ publicMode: true, expectHidden: true }) === 'error-config'
  );
  check(
    '업로드 실패 → 삭제(+경고) — hidden 은 보존해도 심볼리케이션 불가',
    D({ publicMode: false, expectHidden: true, uploadFailed: true }) === 'delete-unsymbolicated'
  );
  check('hidden + 업로드 정상 → 삭제', D({ publicMode: false, expectHidden: true }) === 'delete');
  check('차단 판정은 업로드 실패보다 우선', D({ publicMode: true, expectHidden: true, uploadFailed: true }) === 'error-config');

  // ⑦ end-to-end: hidden dist 에서 맵·stats.html 이 실제로 사라진다
  const e2e = join(dir, 'dist');
  mkdirSync(join(e2e, 'assets'), { recursive: true });
  writeFileSync(join(e2e, 'assets', 'app.js'), 'console.log(1)\n');
  writeFileSync(join(e2e, 'assets', 'app.js.map'), '{"version":3,"sourcesContent":["secret"]}');
  writeFileSync(join(e2e, 'assets', 'app.css'), '.a{color:red}');
  writeFileSync(join(e2e, 'assets', 'app.css.map'), '{"version":3}');
  writeFileSync(join(e2e, 'stats.html'), '<html>module tree</html>');
  const prevCwd = process.cwd();
  const prevArgv = process.argv;
  const prevStrip = process.env.SOURCEMAP_STRIP;
  process.env.SOURCEMAP_STRIP = '1'; // e2e 는 hidden 정책 가정
  process.chdir(dir);
  process.argv = ['node', 'strip-sourcemaps.mjs', '--dist', 'dist'];
  const code = main();
  process.argv = prevArgv;
  process.chdir(prevCwd);
  check('e2e: 종료코드 0', code === 0);
  check('e2e: .map 전량 삭제', walk(e2e).filter((f) => f.endsWith('.map')).length === 0);
  check('e2e: stats.html 삭제', !existsSync(join(e2e, 'stats.html')));
  check('e2e: JS/CSS 는 보존', existsSync(join(e2e, 'assets', 'app.js')) && existsSync(join(e2e, 'assets', 'app.css')));

  // ⑧ e2e: 업로드 실패 마커가 있어도 맵은 제거되고 마커 자체도 산출물에 남지 않는다
  const e2eFail = join(dir, 'dist-fail');
  mkdirSync(join(e2eFail, 'assets'), { recursive: true });
  writeFileSync(join(e2eFail, 'assets', 'app.js'), 'console.log(1)\n');
  writeFileSync(join(e2eFail, 'assets', 'app.js.map'), '{"version":3,"sourcesContent":["secret"]}');
  writeFileSync(join(e2eFail, '.sentry-upload-failed'), 'connect ECONNREFUSED\n');
  process.chdir(dir);
  process.argv = ['node', 'strip-sourcemaps.mjs', '--dist', 'dist-fail'];
  const failCode = main();
  process.argv = prevArgv;
  process.chdir(prevCwd);
  check('e2e(업로드 실패): 종료코드 0 = 배포 계속', failCode === 0);
  check('e2e(업로드 실패): .map 제거됨', walk(e2eFail).filter((f) => f.endsWith('.map')).length === 0);
  check('e2e(업로드 실패): 마커가 산출물에 남지 않음', !existsSync(join(e2eFail, '.sentry-upload-failed')));

  // ⑨ e2e: hidden 을 기대했는데 참조 주석이 남아 있으면 **배포 차단**(exit 1) + 맵 보존(dangling 방지)
  //    회귀 방지 핵심 — 종전 구현은 여기서 조용히 exit 0 로 통과했다.
  const e2eBad = join(dir, 'dist-bad');
  mkdirSync(join(e2eBad, 'assets'), { recursive: true });
  writeFileSync(join(e2eBad, 'assets', 'app.js'), 'console.log(1)\n//# sourceMappingURL=app.js.map\n');
  writeFileSync(join(e2eBad, 'assets', 'app.js.map'), '{"version":3,"sourcesContent":["secret"]}');
  process.chdir(dir);
  process.argv = ['node', 'strip-sourcemaps.mjs', '--dist', 'dist-bad'];
  const badCode = main();
  process.argv = prevArgv;
  process.chdir(prevCwd);
  check('e2e(정책 불일치): 종료코드 1 = 배포 차단', badCode === 1);
  check('e2e(정책 불일치): 맵은 남긴다(dangling 참조 방지)', walk(e2eBad).filter((f) => f.endsWith('.map')).length === 1);

  // ⑩ e2e: --force-strip 은 env 없이도 hidden 정책으로 동작 (embed 빌드 경로)
  const e2eForce = join(dir, 'dist-embed');
  mkdirSync(e2eForce, { recursive: true });
  writeFileSync(join(e2eForce, 'bundle.iife.js'), 'console.log(1)\n');
  writeFileSync(join(e2eForce, 'bundle.iife.js.map'), '{"version":3,"sourcesContent":["secret"]}');
  delete process.env.SOURCEMAP_STRIP;
  process.chdir(dir);
  process.argv = ['node', 'strip-sourcemaps.mjs', '--dist', 'dist-embed', '--force-strip'];
  const forceCode = main();
  process.argv = prevArgv;
  process.chdir(prevCwd);
  if (prevStrip === undefined) delete process.env.SOURCEMAP_STRIP;
  else process.env.SOURCEMAP_STRIP = prevStrip;
  check('e2e(--force-strip): 종료코드 0', forceCode === 0);
  check('e2e(--force-strip): env 없이도 .map 제거', walk(e2eForce).filter((f) => f.endsWith('.map')).length === 0);

  rmSync(dir, { recursive: true, force: true });
  console.log(failed === 0 ? '\n[strip-sourcemaps] self-test 통과' : `\n[strip-sourcemaps] self-test 실패 ${failed}건`);
  return failed === 0 ? 0 : 2;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : main());
