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

  describe('아르떼 무선 확장(2026-07-21 오너 실측 승인 — per-sheet÷2 정확 환산)', () => {
    it('무선 아르떼 5평량 편입 + 양장표 ×2 정합(±0.002)', () => {
      for (const g of ['130', '160', '190', '210', '230']) {
        const p = perfT(`아르떼${g}`);
        expect(p).toBeGreaterThan(0);
        expect(Math.abs(p * 2 - hardT(`아르떼${g}`))).toBeLessThanOrEqual(0.002);
      }
    });

    it('무선 200p 아르떼130(0.096/페이지) → 19.2mm', () => {
      const r = calcPerfectSpine({ pages: 200, pageThicknessMm: perfT('아르떼130') });
      expect(r).toMatchObject({ ok: true, spineMm: 19.2 });
    });

    it('bookmoa 라벨 해석: "아르떼(UW)130" 이 무선표에서도 해석됨', () => {
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '아르떼(UW)130')?.label).toBe('아르떼130');
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '아르떼(NW)230')?.label).toBe('아르떼230');
    });
  });

  describe('caliper 실측 배치(2026-07-22 오너 회신 — bookmoa reply3 §5, 모달 동일값)', () => {
    const BATCH: Array<[label: string, perPage: number, perSheet: number]> = [
      ['아르떼90', 0.055, 0.11],
      ['아르떼105', 0.0775, 0.155],
      ['아르떼310', 0.2, 0.4],
      ['백색모조220', 0.125, 0.25],
      ['백색모조260', 0.15, 0.3],
      ['뉴플러스백색 80g', 0.0405, 0.081],
      ['뉴플러스미색 80g', 0.0405, 0.081],
      ['이라이트80', 0.065, 0.13],
      ['드로잉220', 0.16, 0.32],
      ['도화지170', 0.134, 0.268],
    ];

    it('10항목 양 표 편입 + per-page = per-sheet ÷ 2 정확 환산 잠금', () => {
      for (const [label, perPage, perSheet] of BATCH) {
        expect(perfT(label)).toBe(perPage);
        expect(hardT(label)).toBe(perSheet);
        expect(perPage * 2).toBeCloseTo(perSheet, 10);
      }
    });

    it('bookmoa 모달 라이브값 파리티: 무선 이라이트80 200p → 13.0mm / 양장 → 17mm', () => {
      const p = calcPerfectSpine({ pages: 200, pageThicknessMm: perfT('이라이트80') });
      expect(p.ok && p.spineMm).toBe(13);
      const h = calcHardcoverSpine({ pages: 200, sheetThicknessMm: hardT('이라이트80') });
      expect(h.ok && h.spineMm).toBe(17); // 합지4 + ceil(100×0.130)=13
    });

    it('소수 4자리 보존: 무선 아르떼105 200p → 15.5mm (scale-3 반올림이면 15.6 — 계약 위반)', () => {
      const r = calcPerfectSpine({ pages: 200, pageThicknessMm: perfT('아르떼105') });
      expect(r.ok && r.spineMm).toBe(15.5);
    });

    it('별칭 해석: 모조220→백색모조220 · 뉴플러스(백색)80 · 아르떼(NW)310', () => {
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '모조220')?.label).toBe('백색모조220');
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '뉴플러스(백색)80')?.label).toBe('뉴플러스백색 80g');
      expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '아르떼(NW)310')?.label).toBe('아르떼310');
    });

    it('실재하지 않는 라벨만 미매핑(오타 방어) — 정상 지종 커버리지는 R-55로 완성', () => {
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '존재하지않는지종999')).toBeUndefined();
      expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '존재하지않는지종999')).toBeUndefined();
    });
  });

  describe('caliper 마지막 배치(2026-07-23 R-55 — 미매핑 잔여 0 완성, 모달 동일값)', () => {
    it('무선 신규 6종 값 잠금(아트지·스노우지 80/250/300 — 250/300은 산지 중앙값)', () => {
      expect(perfT('아트지 80g')).toBe(0.032);
      expect(perfT('아트지 250g')).toBe(0.1165);
      expect(perfT('아트지 300g')).toBe(0.1435);
      expect(perfT('스노우지 80g')).toBe(0.0355);
      expect(perfT('스노우지 250g')).toBe(0.13);
      expect(perfT('스노우지 300g')).toBe(0.16);
    });

    it('양장 신규 3항목 + 단일행 공존(뉴플러스100)·÷2 정합', () => {
      expect(hardT('백색모조120')).toBe(0.14);
      expect(hardT('뉴플러스백색 100g')).toBe(0.101);
      expect(hardT('뉴플러스미색 100g')).toBe(0.101);
      // ÷2 정합(정확 케이스): 스노우지·아트지80은 양장 무림값과 정확 절반
      expect(perfT('스노우지 80g') * 2).toBeCloseTo(hardT('스노우80(무림)'), 10);
      expect(perfT('스노우지 250g') * 2).toBeCloseTo(hardT('스노우250(무림)'), 10);
      expect(perfT('스노우지 300g') * 2).toBeCloseTo(hardT('스노우300(무림)'), 10);
      expect(perfT('아트지 80g') * 2).toBeCloseTo(hardT('아트80(무림)'), 10);
    });

    it('미세 갱신 잠금(R-55 §1): 백모조 120g=0.070 · 뉴플러스100=0.0505 — 양장과 ÷2 정합', () => {
      expect(perfT('백모조 120g')).toBe(0.07);
      expect(perfT('뉴플러스백색 100g')).toBe(0.0505);
      expect(perfT('백모조 120g') * 2).toBeCloseTo(hardT('백색모조120'), 10);
      expect(perfT('뉴플러스백색 100g') * 2).toBeCloseTo(hardT('뉴플러스백색 100g'), 10);
    });

    it('bookmoa 모달 라이브값 파리티: 무선 아트지250 200p → 23.3mm / 양장 백색모조120 200p → 18mm', () => {
      const p = calcPerfectSpine({ pages: 200, pageThicknessMm: perfT('아트지 250g') });
      expect(p.ok && p.spineMm).toBe(23.3);
      const h = calcHardcoverSpine({ pages: 200, sheetThicknessMm: hardT('백색모조120') });
      expect(h.ok && h.spineMm).toBe(18); // 합지4 + ceil(100×0.140)=14
    });

    it('해석: "아트지250"(정규화)·"모조120"(binding별 분리) — 무선/양장 각각 올바른 행', () => {
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '아트지250')?.label).toBe('아트지 250g');
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '스노우지300')?.label).toBe('스노우지 300g');
      expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '모조120')?.label).toBe('백모조 120g');
      expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '모조120')?.label).toBe('백색모조120');
      expect(resolveSpinePaper(HARDCOVER_SPINE_PAPERS, '뉴플러스(미색)100')?.label).toBe('뉴플러스미색 100g');
    });
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
    // R-55로 정상 지종 커버리지 완성 — 미해석은 미등록 라벨(오타 등)만 해당
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, '존재하지않는지종999')).toBeUndefined();
    expect(resolveSpinePaper(PERFECT_SPINE_PAPERS, undefined)).toBeUndefined();
  });
});
