/**
 * register-photo-print-samples.mjs 회귀 테스트 — 오프라인 dry-run 의 사진틀 기하 출력을 검증한다.
 *   node --test scripts/register-photo-print-samples.test.mjs
 * API 는 닫힌 포트(127.0.0.1:1)로 지정해 접속 실패 → 오프라인 dry-run 경로를 탄다. 네트워크·등록은 쓰지 않는다.
 *
 * 고정하는 결함(2026-10-19 적대 리뷰):
 * - serialization-5: 샘플 사진틀 rect 의 회색 1px stroke 가 printExclude 없이 PDF 에 인쇄됨 → stroke ''·strokeWidth 0 (카드형 틀 포함).
 * - serialization-2 (A 몫): 앞면 사진틀은 재단 밖 도련(bleedMm, 사방)까지 확장을 유지한다(chemical 0mm / digital 3mm).
 *   유테/이미지풀 창을 재단 기준으로 줄이는 것은 canvas-core PhotoPrintPlugin(bleedPx) 몫.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'register-photo-print-samples.mjs');

/** 프리셋 key → 앞면 슬롯·도련 mm (스크립트 PRESETS 와 같은 값) */
const EXPECTED = {
  photo_chem: { slot: 'front', bleedMm: 0 },
  photo_digital_items: { slot: 'front', bleedMm: 3 },
  photo_digital_fixedback: { slot: 'front', bleedMm: 3 },
  photo_digital_sheet: { slot: 'cardFront', bleedMm: 3 },
};

const FRAME_LINE = /^\s+(\w+) 사진틀 (\S+): 재단 밖 확장 mm L(\S+) T(\S+) R(\S+) B(\S+) \(도련 (\S+)\) stroke=(\S+) strokeWidth=(\S+) fill=(\S+)$/;

function runDryRun(onlyKey) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'photo-print-samples-test-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--only', onlyKey], {
      env: {
        ...process.env,
        STORIGE_API_URL: 'http://127.0.0.1:1/api',
        STORIGE_SAMPLES_OUT: path.join(outDir, 'out.json'),
        ADMIN_EMAIL: 'test@example.invalid',
        ADMIN_PASSWORD: 'x',
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function parseFrameLines(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.match(FRAME_LINE))
    .filter(Boolean)
    .map((m) => ({
      slot: m[1],
      id: m[2],
      ext: { l: Number(m[3]), t: Number(m[4]), r: Number(m[5]), b: Number(m[6]) },
      bleedMm: Number(m[7]),
      stroke: JSON.parse(m[8]),
      strokeWidth: Number(m[9]),
      fill: JSON.parse(m[10]),
    }));
}

for (const [key, expected] of Object.entries(EXPECTED)) {
  test(`${key}: 앞면 사진틀 1개 — stroke ''·strokeWidth 0·fill '' (serialization-5), 재단 밖 사방 ${expected.bleedMm}mm 확장 유지 (serialization-2)`, () => {
    const stdout = runDryRun(key);
    assert.match(stdout, /오프라인 dry-run/, '닫힌 포트이므로 오프라인 dry-run 경로여야 한다');
    const frames = parseFrameLines(stdout);
    assert.equal(frames.length, 1, `사진틀 라인 1개 기대\n${stdout}`);
    const [f] = frames;
    assert.equal(f.slot, expected.slot);
    assert.match(f.id, /^frame-/);
    // serialization-5: 저작 stroke 는 printExclude 없이 PDF 에 인쇄되므로 틀에 경계선을 두지 않는다
    assert.equal(f.stroke, '', '사진틀 stroke 는 빈 문자열');
    assert.equal(f.strokeWidth, 0, '사진틀 strokeWidth 는 0');
    assert.equal(f.fill, '', '유테/이미지풀 여백은 캔버스 흰 배경 — 자리표시 fill 없음');
    // serialization-2 (A 몫): 틀은 재단 밖 도련(bleedMm)까지 사방 균등 확장(창 축소는 플러그인이 재단 기준으로 계산)
    assert.equal(f.bleedMm, expected.bleedMm);
    assert.deepEqual(f.ext, { l: expected.bleedMm, t: expected.bleedMm, r: expected.bleedMm, b: expected.bleedMm });
  });
}

test('뒷면 템플릿에는 사진틀이 없고 앞면 슬롯만 사진틀 라인을 낸다(--only 없이 4종 전체)', () => {
  const stdout = runDryRun(Object.keys(EXPECTED).join(','));
  const frames = parseFrameLines(stdout);
  assert.deepEqual(
    frames.map((f) => f.slot),
    Object.values(EXPECTED).map((e) => e.slot),
  );
  assert.ok(frames.every((f) => f.stroke === '' && f.strokeWidth === 0), '모든 사진틀 stroke ""·strokeWidth 0');
});
