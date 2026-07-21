/**
 * spine-formula.spec.ts — 책등 계산 순수 엔진 골든 파리티 (R-44)
 *
 * bookmoa SSOT `src/lib/spine-calc.test.js`(vitest 14케이스)의 jest 이식 —
 * 골든 값 출처: 원본 계산기 라이브 실측(2026-07-21, mybookmake/youshindang).
 * @storige/types 이식본이 SSOT 와 0오차임을 잠근다. 값 변경 = 계약 위반.
 */
import {
  HARDCOVER_SPINE_PAPERS,
  PERFECT_SPINE_PAPERS,
  calcHardcoverSpine,
  calcHardcoverCoverSpread,
  calcPerfectSpine,
  hardcoverCoverSpreadFromSpine,
  resolveSpinePaper,
} from '@storige/types';

const hardT = (label: string) =>
  HARDCOVER_SPINE_PAPERS.find((p) => p.label === label)?.t as number;
const perfT = (label: string) =>
  PERFECT_SPINE_PAPERS.find((p) => p.label === label)?.t as number;

describe('양장 책등(calcHardcoverSpine) — mybookmake 골든 파리티', () => {
  it('원본 기본값: 40p 아르떼130(0.191) → 내지 4mm, 책등 8mm(최소치)', () => {
    const r = calcHardcoverSpine({ pages: 40, sheetThicknessMm: hardT('아르떼130') });
    expect(r).toMatchObject({ ok: true, pageThickMm: 4, spineMm: 8 });
  });

  it('200p 미색모조80(0.095) → 내지 ceil(9.5)=10mm, 책등 14mm (AC#4)', () => {
    const r = calcHardcoverSpine({ pages: 200, sheetThicknessMm: hardT('미색모조80') });
    expect(r).toMatchObject({ ok: true, pageThickMm: 10, spineMm: 14 });
  });

  it('얇은 책 최소 8mm 보장: 12p 아트80(무림)(0.064) → 합지4+1=5 → 8', () => {
    const r = calcHardcoverSpine({ pages: 12, sheetThicknessMm: hardT('아트80(무림)') });
    expect(r).toMatchObject({ ok: true, pageThickMm: 1, spineMm: 8 });
  });

  it('유효성: 12 미만 / 4의 배수 아님 / 지종 미선택 → ok:false + reason', () => {
    expect(calcHardcoverSpine({ pages: 8, sheetThicknessMm: 0.1 }).ok).toBe(false);
    expect(calcHardcoverSpine({ pages: 42, sheetThicknessMm: 0.1 }).ok).toBe(false);
    expect(calcHardcoverSpine({ pages: 40, sheetThicknessMm: 0 }).ok).toBe(false);
    const r = calcHardcoverSpine({ pages: 42, sheetThicknessMm: 0.1 });
    expect(!r.ok && r.reason).toContain('4의 배수');
  });

  it('부동소수 방어: toFixed(3) 후 ceil — 원본 순서 보존', () => {
    // 84p × 0.191/장: 42×0.191 = 8.022 → ceil 9
    const r = calcHardcoverSpine({ pages: 84, sheetThicknessMm: 0.191 });
    expect(r.ok && r.pageThickMm).toBe(9);
    // 정수 경계: 1000p × 0.082 → 500×0.082 = 41(정수) → ceil 41 유지(float 잔차로 42 금지)
    const edge = calcHardcoverSpine({ pages: 1000, sheetThicknessMm: 0.082 });
    expect(edge.ok && edge.pageThickMm).toBe(41);
  });
});

describe('양장 표지 전개(calcHardcoverCoverSpread) — mybookmake 골든 파리티', () => {
  it('원본 기본값 210×297·40p·아르떼130 → 표지 218×305, 전개 484×345 (AC#5)', () => {
    const r = calcHardcoverCoverSpread({
      widthMm: 210, heightMm: 297, pages: 40, sheetThicknessMm: hardT('아르떼130'),
    });
    expect(r).toMatchObject({
      ok: true, spineMm: 8, coverWMm: 218, coverHMm: 305, totalWMm: 484, totalHMm: 345,
    });
  });

  it('152×225(신국판)·200p·미색모조80 → 책등 14, 표지 160×233, 전개 374×273', () => {
    const r = calcHardcoverCoverSpread({
      widthMm: 152, heightMm: 225, pages: 200, sheetThicknessMm: hardT('미색모조80'),
    });
    expect(r).toMatchObject({
      ok: true, spineMm: 14, coverWMm: 160, coverHMm: 233, totalWMm: 374, totalHMm: 273,
    });
  });

  it('치수 미입력/페이지 오류는 ok:false 전파', () => {
    expect(
      calcHardcoverCoverSpread({ widthMm: 0, heightMm: 297, pages: 40, sheetThicknessMm: 0.191 }).ok,
    ).toBe(false);
    expect(
      calcHardcoverCoverSpread({ widthMm: 210, heightMm: 297, pages: 10, sheetThicknessMm: 0.191 }).ok,
    ).toBe(false);
  });

  it('spine 확정값 전개(hardcoverCoverSpreadFromSpine) = 두께 기반 전개와 동치', () => {
    // 워커는 서버 권위 spineWidthMm 만 알고 두께를 모른다 — 두 경로 산술 동치 잠금
    const full = calcHardcoverCoverSpread({
      widthMm: 210, heightMm: 297, pages: 40, sheetThicknessMm: hardT('아르떼130'),
    });
    const fromSpine = hardcoverCoverSpreadFromSpine({ widthMm: 210, heightMm: 297, spineMm: 8 });
    expect(full.ok && [full.totalWMm, full.totalHMm]).toEqual([fromSpine.totalWMm, fromSpine.totalHMm]);
  });
});

describe('무선 책등(calcPerfectSpine) — youshindang 골든 파리티', () => {
  it('200p 미색모조 80g(0.048) → 9.6mm (AC#1)', () => {
    const r = calcPerfectSpine({ pages: 200, pageThicknessMm: perfT('미색모조 80g') });
    expect(r).toMatchObject({ ok: true, spineMm: 9.6, effPages: 200 });
  });

  it('홀수 보정: 201p → 202p → 9.7mm (AC#2)', () => {
    const r = calcPerfectSpine({ pages: 201, pageThicknessMm: perfT('미색모조 80g') });
    expect(r).toMatchObject({ ok: true, spineMm: 9.7, effPages: 202 });
  });

  it('소수 2자리 반올림: 100p 백모조 70g(0.043) → 4.3mm', () => {
    const r = calcPerfectSpine({ pages: 100, pageThicknessMm: perfT('백모조 70g') });
    expect(r.ok && r.spineMm).toBe(4.3);
  });

  it('16p 미색모조 80g → 0.77mm — 소수 유지, 정수화 금지 (AC#3)', () => {
    const r = calcPerfectSpine({ pages: 16, pageThicknessMm: perfT('미색모조 80g') });
    expect(r.ok && r.spineMm).toBe(0.77);
  });

  it('유효성: 0p / 지종 미선택 → ok:false', () => {
    expect(calcPerfectSpine({ pages: 0, pageThicknessMm: 0.048 }).ok).toBe(false);
    expect(calcPerfectSpine({ pages: 100, pageThicknessMm: 0 }).ok).toBe(false);
  });

  it('두께표 정정 보존: 백모조 180g = 0.100 (원본 오타 0.010 금지)', () => {
    expect(perfT('백모조 180g')).toBe(0.1);
  });

  it('두 표 상호 정합: 미색모조80 — 무선 페이지당 ×2 ≈ 양장 장당 (±0.002)', () => {
    expect(Math.abs(perfT('미색모조 80g') * 2 - hardT('미색모조80'))).toBeLessThanOrEqual(0.002);
  });
});

describe('지종 해석(resolveSpinePaper) — bookmoa 라벨 흡수', () => {
  it('정규화: "미색모조80" → 무선 "미색모조 80g" (공백·g 차이 흡수)', () => {
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '미색모조80')?.label).toBe('미색모조 80g');
  });

  it('alias: "아르떼(UW)130" → 양장 "아르떼130"', () => {
    expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '아르떼(UW)130')?.label).toBe('아르떼130');
  });

  it('alias: "모조80" → 무선 "백모조 80g" / 양장 "백색모조80" (표별 독립 해석)', () => {
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '모조80')?.label).toBe('백모조 80g');
    expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '모조80')?.label).toBe('백색모조80');
  });

  it('괄호 구분자는 정규화로 뭉개지 않음: 아트200(무림) ≠ 아트200(한국)', () => {
    expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '아트200(한국)')?.t).toBe(0.179);
    expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '아트200(무림)')?.t).toBe(0.178);
  });

  it('미해석 지종 → undefined (SPINE_PARAMS_UNRESOLVED 경로)', () => {
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '이라이트80')).toBeUndefined();
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, undefined)).toBeUndefined();
  });
});
