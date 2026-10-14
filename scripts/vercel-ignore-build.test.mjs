/**
 * vercel-ignore-build.mjs 회귀 테스트 — 실제 git 으로 Vercel 의 depth 10 얕은 clone 을 재현한다.
 *   node --test scripts/vercel-ignore-build.test.mjs
 * 원격은 file:// 저장소이고 SHA 지정 fetch 를 허용한다(GitHub 와 같은 조건). 네트워크는 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vercel-ignore-build.mjs');
const EDITOR_PATHS = ['./', '../../packages/types', '../../pnpm-lock.yaml'];

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(repo, rel, content) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `edit ${rel}`);
  return git(repo, 'rev-parse', 'HEAD');
}

/** history 를 만들고 depth 10 으로 clone 한 경로와 기록한 SHA 들을 돌려준다. */
function setup(build) {
  const root = mkdtempSync(path.join(tmpdir(), 'vib-'));
  const origin = path.join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'master');
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const shas = build(origin);
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', '--depth=10', '--no-local', `file://${origin}`, clone);
  return { root, clone, shas };
}

function run(clone, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...EDITOR_PATHS], {
    cwd: path.join(clone, 'apps/editor'),
    env: { ...GIT_ENV, VERCEL_GIT_PROVIDER: '', ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout };
}

function base(origin) {
  commitFile(origin, 'apps/editor/a.txt', 'a0');
  commitFile(origin, 'packages/types/t.txt', 't0');
  commitFile(origin, 'pnpm-lock.yaml', 'l0');
  return git(origin, 'rev-parse', 'HEAD');
}

function docsOnly(origin, n) {
  for (let i = 0; i < n; i += 1) commitFile(origin, 'docs/d.md', `d${i}`);
}

test('이전 배포 커밋이 clone 밖(거리 12)이고 감시 경로 변경이 없으면 보충 후 생략(0)', (t) => {
  const { root, clone, shas } = setup((o) => {
    const prev = base(o);
    docsOnly(o, 12);
    return { prev };
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.notEqual(spawnSync('git', ['cat-file', '-e', `${shas.prev}^{commit}`], { cwd: clone }).status, 0);
  const r = run(clone, { VERCEL_GIT_PREVIOUS_SHA: shas.prev });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /보충/);
});

test('이전 배포 커밋이 clone 밖이고 그 뒤 editor 변경이 있으면 빌드(1)', (t) => {
  const { root, clone, shas } = setup((o) => {
    const prev = base(o);
    commitFile(o, 'apps/editor/a.txt', 'a1');
    docsOnly(o, 12);
    return { prev };
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(clone, { VERCEL_GIT_PREVIOUS_SHA: shas.prev }).code, 1);
});

test('lockfile 만 바뀌어도 빌드(1)', (t) => {
  const { root, clone, shas } = setup((o) => {
    const prev = base(o);
    docsOnly(o, 11);
    commitFile(o, 'pnpm-lock.yaml', 'l1');
    return { prev };
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(clone, { VERCEL_GIT_PREVIOUS_SHA: shas.prev }).code, 1);
});

test('이전 배포 커밋이 clone 안이면 fetch 없이 판정 — 문서만 바뀌면 생략(0), 공유 패키지가 바뀌면 빌드(1)', (t) => {
  const a = setup((o) => {
    base(o);
    docsOnly(o, 2);
    const prev = git(o, 'rev-parse', 'HEAD');
    docsOnly(o, 3);
    return { prev };
  });
  const b = setup((o) => {
    base(o);
    const prev = git(o, 'rev-parse', 'HEAD');
    commitFile(o, 'packages/types/t.txt', 't1');
    return { prev };
  });
  t.after(() => {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  });
  const ra = run(a.clone, { VERCEL_GIT_PREVIOUS_SHA: a.shas.prev });
  assert.equal(ra.code, 0, ra.out);
  assert.doesNotMatch(ra.out, /보충/);
  assert.equal(run(b.clone, { VERCEL_GIT_PREVIOUS_SHA: b.shas.prev }).code, 1);
});

test('가져올 수 없으면(원격 소실) 종전처럼 빌드(1)', (t) => {
  const { root, clone, shas } = setup((o) => {
    const prev = base(o);
    docsOnly(o, 12);
    return { prev };
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  rmSync(path.join(root, 'origin'), { recursive: true, force: true });
  const r = run(clone, { VERCEL_GIT_PREVIOUS_SHA: shas.prev });
  assert.equal(r.code, 1);
  assert.match(r.out, /가져오지 못했다/);
});

test('PREVIOUS_SHA 가 없거나 형식이 아니면 빌드(1)', (t) => {
  const { root, clone } = setup((o) => {
    base(o);
    return {};
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(clone, { VERCEL_GIT_PREVIOUS_SHA: '' }).code, 1);
  assert.equal(run(clone, { VERCEL_GIT_PREVIOUS_SHA: 'HEAD~1; touch x' }).code, 1);
});

test('감시 경로 인자가 없으면 빌드(1)', (t) => {
  const { root, clone } = setup((o) => {
    base(o);
    return {};
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: path.join(clone, 'apps/editor'),
    env: { ...GIT_ENV, VERCEL_GIT_PREVIOUS_SHA: prev },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
});

test('감시 경로가 없으면(오타·이동) 생략하지 않고 빌드(1)', (t) => {
  const { root, clone } = setup((o) => {
    base(o);
    docsOnly(o, 1);
    return {};
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prev = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: clone, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(process.execPath, [SCRIPT, './', '../../packages/typo'], {
    cwd: path.join(clone, 'apps/editor'),
    env: { ...GIT_ENV, VERCEL_GIT_PREVIOUS_SHA: prev },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /감시 경로가 없다: \.\.\/\.\.\/packages\/typo/);
});

test('심볼릭 링크 경로로 실행해도 판정한다 — PREVIOUS_SHA 가 없으면 빌드(1)', (t) => {
  const { root, clone } = setup((o) => {
    base(o);
    return {};
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const link = path.join(root, 'scripts-link');
  symlinkSync(path.dirname(SCRIPT), link, 'dir');
  const r = spawnSync(process.execPath, [path.join(link, path.basename(SCRIPT)), ...EDITOR_PATHS], {
    cwd: path.join(clone, 'apps/editor'),
    env: { ...GIT_ENV, VERCEL_GIT_PROVIDER: '', VERCEL_GIT_PREVIOUS_SHA: '' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /\[ignore-build\] 빌드 — VERCEL_GIT_PREVIOUS_SHA 없음/);
});
