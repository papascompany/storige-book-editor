/**
 * 골든 비교 엔진 자체 회귀 테스트 (node:test, 의존성 0).
 * 실행: node --test scripts/pdf-golden/compare.test.mjs
 * 저장소 샘플 PDF(docs/*.pdf)로 비교 엔진의 동작을 검증한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { comparePdfs } from './compare.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = join(root, 'docs', 'admin-flow.pdf');
const B = join(root, 'docs', 'worker-work-flow.pdf');

test('동일 내용 PDF 는 PASS + byteIdentical', async () => {
  const r = await comparePdfs(A, A);
  assert.equal(r.pass, true);
  assert.equal(r.byteIdentical, true);
  assert.equal(r.findings.length, 0);
});

test('페이지 수/내용이 다른 PDF 는 FAIL + 발견 보고', async () => {
  const r = await comparePdfs(A, B);
  assert.equal(r.pass, false);
  assert.equal(r.byteIdentical, false);
  assert.ok(r.findings.some((f) => f.includes('페이지 수 상이')));
});

test('--pixel 은 pixelmatch 부재 시 건너뛰되 구조 통과면 PASS 유지', async () => {
  const r = await comparePdfs(A, A, { pixel: true });
  // pixelmatch 미설치면 skipped, 설치돼 있으면 실제 비교 — 어느 쪽이든 동일 파일은 PASS
  assert.equal(r.pass, true);
});

test('CreationDate 만 다른 PDF 는 PASS (파생 /ID 스크럽 회귀 — 2026-07-03 Track A 검증에서 실증)', async () => {
  // --deterministic-id 의 /ID 는 날짜 포함 전체 콘텐츠에서 파생 → 날짜 라인만 스크럽하면
  // /ID 가 날짜 차이를 실어 날라 같은 코드 산출물끼리도 FAIL 이 났다. /ID 스크럽 후 PASS 확인.
  const mk = (date) =>
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
      `4 0 obj << /CreationDate (D:${date}+09'00') >> endobj`,
      'trailer << /Root 1 0 R /Info 4 0 R >>',
      '%%EOF',
      '',
    ].join('\n');
  const dir = await mkdtemp(join(tmpdir(), 'golden-t-'));
  try {
    const p1 = join(dir, 'a.pdf');
    const p2 = join(dir, 'b.pdf');
    await writeFile(p1, mk('20260703171158'), 'latin1');
    await writeFile(p2, mk('20260703171228'), 'latin1');
    const r = await comparePdfs(p1, p2);
    assert.equal(r.byteIdentical, true, '날짜/파생ID 만 다른 PDF 는 byte-identical 로 판정돼야 함');
    assert.equal(r.pass, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
