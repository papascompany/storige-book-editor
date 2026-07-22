/**
 * spine-calc.ts — 책등(세네카) 계산 순수 엔진 (R-44, 2026-07-21)
 *
 * bookmoa SSOT(`bookmoa-mobile/src/lib/spine-calc.js`)의 0오차 자구 이식.
 * 원 출처(라이브 소스 실측, bookmoa 2026-07-21):
 *  · 양장: mybookmake.com/app/cal_01.php — bookCalculate()
 *  · 무선: youshindang.com/assets/calc/calc.asp — calseneka()
 *
 * API(spine.service v2)·워커(validateSpine 기대폭)·Track C 표지 파생이 전부
 * 이 모듈만 import 한다 — 검증 기준값 산출과 제작 산출이 동일 산식 공유
 * (HARDCOVER_COVER_VALIDATION_NOTES §1-4).
 *
 * ⚠️ 두 두께표의 단위가 다름:
 *  · PERFECT_SPINE_PAPERS:   mm/페이지(page) — 페이지 수에 바로 곱함
 *  · HARDCOVER_SPINE_PAPERS: mm/장(sheet)   — 낱장수 = 페이지/2 로 곱함
 *  (미색모조80: 무선 0.048/페이지 × 2 ≒ 양장 0.095/장 — 상호 정합)
 */

// ─── 양장 상수 (mybookmake 원본 그대로) ─────────────────────────────
/** 마닐라 합지 두께(mm) — 책등에 가산 */
export const HARDCOVER_MANILA_MM = 4;
/** 책등 최소 두께(mm) */
export const HARDCOVER_MIN_SPINE_MM = 8;
/** 표지 재단여분(mm) — 원본 식 (-3 + 11) 합산치. 앞/뒤표지 각 변에 가산 */
export const HARDCOVER_COVER_EXTRA_MM = 8;
/** 싸바리(감싸기) 여분 총합(mm) — 펼침 가로/세로에 +40 */
export const HARDCOVER_WRAP_MARGIN_MM = 40;

export interface SpinePaperSpec {
  /** 정규 라벨(=DB paper_types.code 시드값) */
  label: string;
  /** 두께 — 표에 따라 mm/페이지(무선) 또는 mm/장(양장) */
  t: number;
  /** 외부(bookmoa innerPaper 등) 라벨 흡수용 별칭 */
  aliases?: string[];
}

/**
 * 양장 내지 지종 두께표 — mm/장(sheet). mybookmake cal_01.php select 원본 35종.
 * aliases: bookmoa productMeta.innerPaper 라벨(아르떼(UW/NW)·모조 계열) 흡수.
 */
export const HARDCOVER_SPINE_PAPERS: SpinePaperSpec[] = [
  { label: '아르떼130', t: 0.191, aliases: ['아르떼(UW)130', '아르떼(NW)130'] },
  { label: '아르떼160', t: 0.230, aliases: ['아르떼(UW)160', '아르떼(NW)160'] },
  { label: '아르떼190', t: 0.270, aliases: ['아르떼(UW)190', '아르떼(NW)190'] },
  { label: '아르떼210', t: 0.296, aliases: ['아르떼(UW)210', '아르떼(NW)210'] },
  { label: '아르떼230', t: 0.322, aliases: ['아르떼(UW)230', '아르떼(NW)230'] },
  { label: '미색모조70', t: 0.082 },
  { label: '미색모조80', t: 0.095 },
  { label: '미색모조100', t: 0.115 },
  { label: '백색모조70', t: 0.085, aliases: ['모조70'] },
  { label: '백색모조80', t: 0.094, aliases: ['모조80'] },
  { label: '백색모조100', t: 0.116, aliases: ['모조100'] },
  { label: '스노우150(무림)', t: 0.140, aliases: ['스노우지150'] },
  { label: '백색모조150', t: 0.177, aliases: ['모조150'] },
  { label: '백색모조180', t: 0.212, aliases: ['모조180'] },
  { label: '아트80(무림)', t: 0.064, aliases: ['아트지80'] },
  { label: '아트100(무림)', t: 0.080, aliases: ['아트지100'] },
  { label: '아트120(무림)', t: 0.096, aliases: ['아트지120'] },
  { label: '아트150(무림)', t: 0.125, aliases: ['아트지150'] },
  { label: '아트180(무림)', t: 0.151, aliases: ['아트지180'] },
  { label: '아트200(무림)', t: 0.178, aliases: ['아트지200'] },
  { label: '아트250(무림)', t: 0.235, aliases: ['아트지250'] },
  { label: '아트300(무림)', t: 0.290, aliases: ['아트지300'] },
  { label: '아트100(한국)', t: 0.077 },
  { label: '스노우100(무림)', t: 0.092, aliases: ['스노우지100'] },
  { label: '아트150(한국)', t: 0.118 },
  { label: '아트180(한국)', t: 0.150 },
  { label: '아트200(한국)', t: 0.179 },
  { label: '아트250(한국)', t: 0.231 },
  { label: '아트300(한국)', t: 0.284 },
  { label: '스노우80(무림)', t: 0.071, aliases: ['스노우지80'] },
  { label: '스노우120(무림)', t: 0.110, aliases: ['스노우지120'] },
  { label: '스노우180(무림)', t: 0.176, aliases: ['스노우지180'] },
  { label: '스노우200(무림)', t: 0.200, aliases: ['스노우지200'] },
  { label: '스노우250(무림)', t: 0.260, aliases: ['스노우지250'] },
  { label: '스노우300(무림)', t: 0.320, aliases: ['스노우지300'] },
];

/**
 * 무선 내지 지종 두께표 — mm/페이지(page). youshindang calc.asp select 원본 29종.
 * ⚠️ 원본 '백모조 180g'=0.010은 명백한 오타(70~150g 추세 0.043→0.084) — 0.100 정정 이식(bookmoa 동일).
 * aliases: bookmoa 라벨("모조80"=백모조 계열, "뉴플러스(백색)100" 등) 흡수.
 * 공백·말미 g 차이는 normalizeSpinePaperLabel 이 흡수하므로 실질 개명만 alias 로 둔다.
 */
export const PERFECT_SPINE_PAPERS: SpinePaperSpec[] = [
  { label: '백모조 70g', t: 0.043, aliases: ['모조70'] },
  { label: '백모조 80g', t: 0.048, aliases: ['모조80'] },
  { label: '백모조 100g', t: 0.058, aliases: ['모조100'] },
  { label: '백모조 120g', t: 0.069, aliases: ['모조120'] },
  { label: '백모조 150g', t: 0.084, aliases: ['모조150'] },
  { label: '백모조 180g', t: 0.100, aliases: ['모조180'] },
  { label: '미색모조 70g', t: 0.043 },
  { label: '미색모조 80g', t: 0.048 },
  { label: '미색모조 100g', t: 0.058 },
  { label: '스노우지 100g', t: 0.045 },
  { label: '스노우지 120g', t: 0.058 },
  { label: '스노우지 150g', t: 0.070 },
  { label: '스노우지 180g', t: 0.090 },
  { label: '스노우지 200g', t: 0.103 },
  { label: '아트지 100g', t: 0.040 },
  { label: '아트지 120g', t: 0.048 },
  { label: '아트지 150g', t: 0.060 },
  { label: '아트지 180g', t: 0.078 },
  { label: '아트지 200g', t: 0.094 },
  { label: '뉴플러스백색 100g', t: 0.051, aliases: ['뉴플러스(백색)100'] },
  { label: '뉴플러스미색 100g', t: 0.051, aliases: ['뉴플러스(미색)100'] },
  { label: '랑데뷰화이트 105g', t: 0.074 },
  { label: '랑데뷰화이트 130g', t: 0.090 },
  { label: '랑데뷰화이트 160g', t: 0.110 },
  { label: '랑데뷰화이트 190g', t: 0.130 },
  { label: '랑데뷰네추럴 105g', t: 0.074 },
  { label: '랑데뷰네추럴 130g', t: 0.090 },
  { label: '랑데뷰네추럴 160g', t: 0.110 },
  { label: '랑데뷰네추럴 190g', t: 0.130 },
  // ── 아르떼 무선 확장(2026-07-21 오너 실측 웹 출처 승인) ──
  // youshindang 원본에는 아르떼가 없으나 bookmoa 무선+아르떼 조합이 실재(제본-지종 비종속).
  // 실물 두께 실측(192/230/270/297/320㎛ — 오너 확인)이 양장표(mm/장)와 1~2㎛ 내 일치
  // → per-page = per-sheet ÷ 2 정확 환산(1장=2페이지)으로 편입. 90·105·310 평량은
  // 실측 출처 부재로 계속 미매핑. 라벨은 양장표와 동일(=DB 단일 행에 perPage 백필).
  { label: '아르떼130', t: 0.096, aliases: ['아르떼(UW)130', '아르떼(NW)130'] },
  { label: '아르떼160', t: 0.115, aliases: ['아르떼(UW)160', '아르떼(NW)160'] },
  { label: '아르떼190', t: 0.135, aliases: ['아르떼(UW)190', '아르떼(NW)190'] },
  { label: '아르떼210', t: 0.148, aliases: ['아르떼(UW)210', '아르떼(NW)210'] },
  { label: '아르떼230', t: 0.161, aliases: ['아르떼(UW)230', '아르떼(NW)230'] },
];

/**
 * 지종 라벨 정규화 — 공백 제거 + 말미 평량 단위 'g' 제거.
 * "미색모조 80g" ↔ "미색모조80" 같은 표기 차이를 흡수한다.
 * 괄호 표기((무림)/(한국)/(UW) 등)는 의미 구분자라 제거하지 않는다 — 개명은 aliases 로만.
 */
export function normalizeSpinePaperLabel(label: string): string {
  return label.replace(/\s+/g, '').replace(/g$/i, '').toLowerCase();
}

export type SpineCalcResult =
  | {
      ok: true;
      /** 책등 폭(mm) — 무선: 소수 2자리, 양장: 정수 */
      spineMm: number;
      /** 무선: 홀수 +1 보정 후 유효 페이지수 */
      effPages?: number;
      /** 양장: 내지뭉치 두께(mm, 올림 정수) */
      pageThickMm?: number;
    }
  | { ok: false; reason: string };

/**
 * 무선(perfect) 책등 계산 — youshindang calseneka 자구 이식.
 * 공식: 홀수 페이지 +1 보정 → round(effPages × 페이지당두께 × 100) / 100 (소수 2자리 반올림).
 * margin 가산 없음(v1 공식과의 차이 — bookmoa 골든 정합).
 */
export function calcPerfectSpine(params: { pages: number; pageThicknessMm: number }): SpineCalcResult {
  const p = Number(params.pages);
  const t = Number(params.pageThicknessMm);
  if (!Number.isFinite(p) || p < 1) return { ok: false, reason: '페이지수를 입력해주세요.' };
  if (!Number.isFinite(t) || t <= 0) return { ok: false, reason: '지종을 선택해주세요.' };
  const effPages = p % 2 ? p + 1 : p;
  const spineMm = Math.round(effPages * t * 100) / 100;
  return { ok: true, spineMm, effPages };
}

/**
 * 양장 산술 코어(유효성 없음) — API v2 분기 등 "비차단 정책" 소비자가 유효성만
 * 경고로 강등하고 산식은 공유하기 위한 단일 구현(인라인 복제 금지 — 드리프트 방지).
 * 공식: 내지뭉치 = ceil( Number( ((페이지/2) × 장당두께).toFixed(3) ) )  ← toFixed(3) 은
 * float 잔차가 정수 경계에서 ceil 을 한 단계 올리는 오류를 막는 원본 규칙(순서 보존 필수).
 * 책등 = max( 합지 4mm + 내지뭉치, 최소 8mm ), 정수 mm.
 */
export function hardcoverSpineRaw(
  pages: number,
  sheetThicknessMm: number,
): { pageThickMm: number; spineMm: number } {
  const pageThickMm = Math.ceil(Number(((pages / 2) * sheetThicknessMm).toFixed(3)));
  const spineMm = Math.max(HARDCOVER_MANILA_MM + pageThickMm, HARDCOVER_MIN_SPINE_MM);
  return { pageThickMm, spineMm };
}

/**
 * 양장(hardcover) 책등 계산 — mybookmake bookCalculate 자구 이식.
 * 유효성(p≥12 && p%4==0)은 원본 alert 조건 — 호출측 정책에 따라 reason 을 경고로 강등 가능.
 * 산술은 hardcoverSpineRaw 단일 구현 공유.
 */
export function calcHardcoverSpine(params: { pages: number; sheetThicknessMm: number }): SpineCalcResult {
  const p = Number(params.pages);
  const t = Number(params.sheetThicknessMm);
  if (!Number.isFinite(p) || p < 12) return { ok: false, reason: '페이지는 12 이상 입력해주세요.' };
  if (p % 4 !== 0) return { ok: false, reason: '페이지는 4의 배수로 입력해주세요.' };
  if (!Number.isFinite(t) || t <= 0) return { ok: false, reason: '지종을 선택해주세요.' };
  const { pageThickMm, spineMm } = hardcoverSpineRaw(p, t);
  return { ok: true, spineMm, pageThickMm };
}

export type HardcoverCoverSpreadResult =
  | {
      ok: true;
      spineMm: number;
      pageThickMm: number;
      /** 앞/뒤표지 각 폭(mm) = W + 8 */
      coverWMm: number;
      /** 표지 높이(mm) = H + 8 */
      coverHMm: number;
      /** 싸바리 전개 전체 가로(mm) = coverW×2 + spine + 40 */
      totalWMm: number;
      /** 싸바리 전개 전체 세로(mm) = coverH + 40 */
      totalHMm: number;
    }
  | { ok: false; reason: string };

/**
 * 양장 표지(싸바리) 전개 제작 사이즈 — mybookmake 자구 이식.
 * 재단 W×H 기준. 골든: 210×297·40p·아르떼130(0.191) → spine 8 · 표지 218×305 · 전개 484×345.
 * 워커 표지 PDF 기대치·표지 파생(Track C)·admin 산출이 모두 이 함수를 쓴다.
 */
export function calcHardcoverCoverSpread(params: {
  widthMm: number;
  heightMm: number;
  pages: number;
  sheetThicknessMm: number;
}): HardcoverCoverSpreadResult {
  const w = Number(params.widthMm);
  const h = Number(params.heightMm);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    return { ok: false, reason: '가로·세로(mm)를 입력해주세요.' };
  }
  const s = calcHardcoverSpine({ pages: params.pages, sheetThicknessMm: params.sheetThicknessMm });
  if (!s.ok) return s;
  const coverWMm = w + HARDCOVER_COVER_EXTRA_MM;
  const coverHMm = h + HARDCOVER_COVER_EXTRA_MM;
  return {
    ok: true,
    spineMm: s.spineMm,
    pageThickMm: s.pageThickMm as number,
    coverWMm,
    coverHMm,
    totalWMm: coverWMm * 2 + s.spineMm + HARDCOVER_WRAP_MARGIN_MM,
    totalHMm: coverHMm + HARDCOVER_WRAP_MARGIN_MM,
  };
}

/**
 * 책등 폭이 이미 확정(서버 권위값)일 때의 양장 싸바리 전개 기대치 —
 * 워커 검증처럼 지종 두께 없이 spine 만 아는 소비자용.
 */
export function hardcoverCoverSpreadFromSpine(params: {
  widthMm: number;
  heightMm: number;
  spineMm: number;
}): { totalWMm: number; totalHMm: number; coverWMm: number; coverHMm: number } {
  const coverWMm = params.widthMm + HARDCOVER_COVER_EXTRA_MM;
  const coverHMm = params.heightMm + HARDCOVER_COVER_EXTRA_MM;
  return {
    coverWMm,
    coverHMm,
    totalWMm: coverWMm * 2 + params.spineMm + HARDCOVER_WRAP_MARGIN_MM,
    totalHMm: coverHMm + HARDCOVER_WRAP_MARGIN_MM,
  };
}

/**
 * 두께표에서 지종 해석 — 정확 라벨 → aliases → 정규화 비교 순.
 * 미해석 시 undefined (호출측이 SPINE_PARAMS_UNRESOLVED 류로 처리).
 */
export function resolveSpinePaper(
  table: SpinePaperSpec[],
  input: string | null | undefined,
): SpinePaperSpec | undefined {
  if (!input) return undefined;
  const exact = table.find((p) => p.label === input || p.aliases?.includes(input));
  if (exact) return exact;
  const norm = normalizeSpinePaperLabel(input);
  return table.find(
    (p) =>
      normalizeSpinePaperLabel(p.label) === norm ||
      p.aliases?.some((a) => normalizeSpinePaperLabel(a) === norm),
  );
}
