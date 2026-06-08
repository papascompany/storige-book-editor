import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mmToPx,
  pxToMm,
  ptToMm,
  ptToPx,
  mmToPt,
  roundMm01,
  DEFAULT_DPI,
} from './units.mjs';

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test('DEFAULT_DPI 는 150 (Storige math.ts 와 일치)', () => {
  assert.equal(DEFAULT_DPI, 150);
});

test('mmToPx: 25.4mm(1inch) → 150px @150dpi', () => {
  approx(mmToPx(25.4), 150);
  approx(mmToPx(0), 0);
});

test('pxToMm: 150px → 25.4mm @150dpi', () => {
  approx(pxToMm(150), 25.4);
});

test('mm↔px 왕복 무손실', () => {
  approx(pxToMm(mmToPx(100)), 100);
  approx(mmToPx(pxToMm(321)), 321);
});

test('ptToMm: 72pt(1inch) → 25.4mm', () => {
  approx(ptToMm(72), 25.4);
  approx(ptToMm(144), 50.8);
});

test('ptToPx: 72pt → 150px @150dpi (pt*DPI/72)', () => {
  approx(ptToPx(72), 150);
});

test('pt → mm → px 사슬이 ptToPx 와 동일', () => {
  // IDML 좌표 변환 사슬의 일관성: 직접 ptToPx 와 (ptToMm→mmToPx) 가 같아야 한다
  approx(mmToPx(ptToMm(123.45)), ptToPx(123.45));
});

test('mmToPt 역변환', () => {
  approx(mmToPt(25.4), 72);
});

test('roundMm01: 0.1mm 반올림', () => {
  approx(roundMm01(429.96), 430.0);
  approx(roundMm01(12.34), 12.3);
});
