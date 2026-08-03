/**
 * 스프레드 후보 판정 회귀 가드 (2026-08-03).
 *
 * 실결함: 내지 펼침면(regionScope='inner')은 표지용 `spec` 이 없어 '높이만 비교' 폴백으로 빠졌고,
 * 그 결과 **폭 검증이 전혀 없이** 후보에 떠 세트 판형과 다른 내지 펼침면이 연결될 수 있었다.
 */
import { describe, it, expect } from 'vitest';
import { matchesSpreadCandidate, nearlyEqualMm } from './spreadCandidate';

const innerT = (pageWidthMm: number, pageHeightMm: number, height = 0) => ({
  height,
  spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm, pageHeightMm } },
});
const coverT = (coverWidthMm: number, coverHeightMm: number) => ({
  spreadConfig: { spec: { coverWidthMm, coverHeightMm } },
});

describe('matchesSpreadCandidate — 내지 펼침면(inner)', () => {
  it('한 면 치수가 세트 판형과 같으면 후보', () => {
    expect(matchesSpreadCandidate(innerT(210, 297), 210, 297)).toBe(true);
  });

  it('폭이 다르면 제외 — 종전 폴백은 이 케이스를 통과시켰다(핵심 회귀 가드)', () => {
    // 높이만 같고 폭이 다른 내지 펼침면: 종전 `t.height === height` 폴백으로 통과했었다
    expect(matchesSpreadCandidate(innerT(150, 297, 297), 210, 297)).toBe(false);
  });

  it('높이가 다르면 제외', () => {
    expect(matchesSpreadCandidate(innerT(210, 200), 210, 297)).toBe(false);
  });

  it('부동소수 잔차(0.01mm 미만)는 같은 치수로 본다', () => {
    expect(matchesSpreadCandidate(innerT(210.000000000003, 297), 210, 297)).toBe(true);
  });

  it('innerSpec 이 없는 inner 레코드는 폴백(높이 비교)으로 떨어진다', () => {
    const t = { height: 297, spreadConfig: { regionScope: 'inner' } };
    expect(matchesSpreadCandidate(t, 210, 297)).toBe(true);
    expect(matchesSpreadCandidate({ ...t, height: 200 }, 210, 297)).toBe(false);
  });
});

describe('matchesSpreadCandidate — 표지 펼침면(cover) 무회귀', () => {
  it('표지 한 면 치수 정확 일치면 후보', () => {
    expect(matchesSpreadCandidate(coverT(210, 297), 210, 297)).toBe(true);
  });

  it('표지는 정확 비교를 유지한다 — 잔차도 불일치로 본다(종전 동작 보존)', () => {
    expect(matchesSpreadCandidate(coverT(210.000000000003, 297), 210, 297)).toBe(false);
  });

  it('치수가 다르면 제외', () => {
    expect(matchesSpreadCandidate(coverT(148, 210), 210, 297)).toBe(false);
  });

  it('spreadConfig 없는 레거시는 높이만 비교(종전 폴백 유지)', () => {
    expect(matchesSpreadCandidate({ height: 297 }, 210, 297)).toBe(true);
    expect(matchesSpreadCandidate({ height: 200 }, 210, 297)).toBe(false);
  });
});

describe('nearlyEqualMm', () => {
  it('0.01mm 미만 차이는 같음, 이상은 다름', () => {
    expect(nearlyEqualMm(10, 10.005)).toBe(true);
    expect(nearlyEqualMm(10, 10.02)).toBe(false);
  });
  it('undefined 는 항상 false', () => {
    expect(nearlyEqualMm(undefined, 10)).toBe(false);
    expect(nearlyEqualMm(10, undefined)).toBe(false);
  });
});
