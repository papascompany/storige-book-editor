#!/usr/bin/env node
/**
 * vercel-ignore-build.mjs — Vercel ignoreCommand(빌드 생략 판정). apps/editor·apps/admin vercel.json 이 부른다.
 *
 *   node ../../scripts/vercel-ignore-build.mjs <감시 경로...>
 *
 * 종료 코드(Vercel 규약): 0 = 빌드 생략, 1 = 빌드. 판정이 불확실하면 항상 1(빌드)이다.
 * 실행 위치는 프로젝트 Root Directory(apps/<app>)다 — 감시 경로는 그 기준 상대 경로로 넘긴다.
 *
 * 왜 스크립트인가:
 *   VERCEL_GIT_PREVIOUS_SHA 는 그 브랜치의 '마지막 성공 배포' 커밋이다. 생략된 커밋은 성공 배포가 아니므로
 *   코드와 무관한 push 가 이어지면 이 커밋이 점점 멀어진다. Vercel 은 depth 10 으로 얕게 clone 하므로
 *   10 커밋을 넘으면 clone 안에 그 커밋이 없고, 종전 한 줄 명령은 그때 무조건 빌드했다(문서 push 만으로
 *   운영 재배포). 여기서는 그 커밋 하나만 depth=1 로 가져와(트리만 있으면 diff 가 된다) 다시 판정한다.
 *   가져오지 못하면 종전과 같이 빌드한다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FETCH_TIMEOUT_MS = 60_000;

function git(args, opts = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  });
}

function hasCommit(sha) {
  return git(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}

/** 이전 배포 커밋을 가져올 원격 후보. origin 이 없거나 인증 URL 이 만료됐을 때를 대비해 공개 URL 을 둘째로 둔다. */
export function fetchSources(env) {
  const sources = ['origin'];
  if (env.VERCEL_GIT_PROVIDER === 'github' && env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG) {
    sources.push(`https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`);
  }
  return sources;
}

/**
 * @returns {{ code: 0 | 1, reason: string }}
 */
export function decide(env, paths) {
  const prev = (env.VERCEL_GIT_PREVIOUS_SHA ?? '').trim();
  if (paths.length === 0) return { code: 1, reason: '감시 경로 인자가 없다' };
  // 없는 경로는 git diff 에서 '변경 없음'이 되어 영구 생략으로 이어진다 — 오타·이동을 빌드로 드러낸다.
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length > 0) return { code: 1, reason: `감시 경로가 없다: ${missing.join(' ')}` };
  if (!/^[0-9a-f]{7,40}$/i.test(prev)) {
    return { code: 1, reason: prev ? 'VERCEL_GIT_PREVIOUS_SHA 형식이 아니다' : 'VERCEL_GIT_PREVIOUS_SHA 없음(첫 배포)' };
  }
  const short = prev.slice(0, 7);

  if (!hasCommit(prev)) {
    for (const src of fetchSources(env)) {
      const r = git(['fetch', '--quiet', '--no-tags', '--depth=1', src, prev], { timeout: FETCH_TIMEOUT_MS });
      if (r.status === 0 && hasCommit(prev)) {
        console.log(`[ignore-build] 이전 배포 커밋 ${short} 을 얕은 clone 에 보충했다(${src === 'origin' ? 'origin' : '공개 URL'})`);
        break;
      }
    }
    if (!hasCommit(prev)) return { code: 1, reason: `이전 배포 커밋 ${short} 을 가져오지 못했다` };
  }

  const d = git(['diff', '--quiet', prev, 'HEAD', '--', ...paths]);
  if (d.status === 0) return { code: 0, reason: `${short}..HEAD 감시 경로 변경 없음` };
  if (d.status === 1) return { code: 1, reason: `${short}..HEAD 감시 경로 변경 있음` };
  return { code: 1, reason: `git diff 오류(status=${d.status ?? d.signal})` };
}

/**
 * 직접 실행인지 — 실행 경로에 심볼릭 링크가 끼어도 실제 경로로 비교한다.
 * import.meta.url 은 실제 경로이므로 문자열 비교만 하면 링크 경로 실행이 판정 없이 0(생략)으로 끝난다.
 */
function invokedDirectly() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(arg).href === import.meta.url;
  }
}

if (invokedDirectly()) {
  const { code, reason } = decide(process.env, process.argv.slice(2));
  console.log(`[ignore-build] ${code === 0 ? '생략' : '빌드'} — ${reason}`);
  process.exit(code);
}
