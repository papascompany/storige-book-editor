/**
 * 골든 비교 엔진 자체 회귀 테스트 (node:test, 의존성 0).
 * 실행: node --test scripts/pdf-golden/compare.test.mjs
 * 저장소 샘플 PDF(docs/*.pdf)로 비교 엔진의 동작을 검증한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
