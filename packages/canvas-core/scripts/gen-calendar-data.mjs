#!/usr/bin/env node
/**
 * gen-calendar-data.mjs — 한국 캘린더 정적 데이터(kr-2025-2035-v1) 생성기 (P1-c, 2026-10-17)
 *
 * 실행: `pnpm --filter @storige/canvas-core gen:calendar-data`
 *       (= `node scripts/gen-calendar-data.mjs`, Node ≥ 20, 외부 의존성 0, 네트워크 0)
 * 출력: `src/calendar/data/kr-2025-2035-v1.ts` — generatedAt 를 제외하면 재실행 시 결정적.
 *
 * 알고리즘 요약
 *  - 천문 계산은 Jean Meeus, Astronomical Algorithms(2판) 기준.
 *    · 신월(합삭) 순간: 49장(평균 위상 + 주기항 25개 + 추가 보정 14개). 분 단위 정확도.
 *    · 태양 겉보기 황경: 25장 저정밀(0.01°, 시각 ±15분). 24절기 = 황경 15° 배수, 중기 = 30° 배수.
 *    · ΔT(TT−UT): 2025년 69.2초에서 연 0.55초 선형 외삽(2035년 ≈ 74.7초).
 *    · 모든 날짜는 KST(UTC+9) 자오선 기준.
 *  - 음력(한국 = 중국식 농력, KST): 각 달은 합삭이 든 KST 날짜에 시작. 동지(270°)를 품은 달이 11월.
 *    두 동지 사이의 달이 13개면 윤년이고, 그중 중기가 없는 첫 달이 윤달(앞 달 번호를 따른다).
 *  - 공휴일: 관공서의 공휴일에 관한 규정(2023-05 개정 대체공휴일 기준). 규정 밖 지정일(임시공휴일·선거일)은
 *    `scripts/calendar-overrides.json` 에서 병합한다(대체공휴일 계산에는 참여하지 않는다).
 *
 * 검증: 실행 로그에 참고값(설날·추석·부처님오신날·윤달·절기·대체공휴일) 대조 결과와
 *       KST 자정 ±30분 안에 든 천문 이벤트(날짜 경계 위험)를 출력한다. 차이가 있으면 강제하지 말고 보고한다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../src/calendar/data/kr-2025-2035-v1.ts');
const OVERRIDES_PATH = resolve(__dirname, './calendar-overrides.json');

const VERSION = 'kr-2025-2035-v1';
const RANGE = { from: '2025-01', to: '2035-12' };
const SOLAR_YEAR_FROM = 2025;
const SOLAR_YEAR_TO = 2035;
/** 양력 1월 환산을 위해 직전 음력 연도(2024)부터 출력 */
const LUNAR_YEAR_FROM = 2024;
const LUNAR_YEAR_TO = 2035;
const KST_OFFSET_DAYS = 9 / 24;

// ─── 날짜 유틸(정수 JDN 기반, 타임존 무관) ────────────────────────────────

const DEG = Math.PI / 180;
const sinD = (d) => Math.sin(d * DEG);
const norm360 = (d) => ((d % 360) + 360) % 360;

/** 그레고리력 → JDN(정오 기준 정수) */
function ymdToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** JDN → 그레고리력 {y, m, d} */
function jdnToYmd(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    y: 100 * b + d - 4800 + Math.floor(m / 10),
    m: m + 3 - 12 * Math.floor(m / 10),
    d: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
function jdnToKey(jdn) {
  const { y, m, d } = jdnToYmd(jdn);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function keyToJdn(key) {
  const [y, m, d] = key.split('-').map(Number);
  return ymdToJdn(y, m, d);
}
/** 0=일 … 6=토 */
const weekdayOfJdn = (jdn) => (jdn + 1) % 7;

// ─── 천문 계산(Meeus) ───────────────────────────────────────────────────────

/** ΔT(초) — 2025 기준 69.2초, 연 0.55초 선형 외삽 */
function deltaTSeconds(year) {
  return 69.2 + (year - 2025) * 0.55;
}

/** JDE(TT) → KST 기준 {jdn, fracOfDay(0~1), key} */
function jdeToKst(jde) {
  const year = jdnToYmd(Math.floor(jde + 0.5)).y;
  const jdUt = jde - deltaTSeconds(year) / 86400;
  const jdKst = jdUt + KST_OFFSET_DAYS;
  const jdn = Math.floor(jdKst + 0.5);
  const frac = jdKst + 0.5 - jdn;
  return { jdn, frac, key: jdnToKey(jdn) };
}

/** Meeus 25장 저정밀 — 태양 겉보기 황경(도) */
function sunApparentLongitude(jde) {
  const T = (jde - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinD(M) +
    (0.019993 - 0.000101 * T) * sinD(2 * M) +
    0.000289 * sinD(3 * M);
  const trueLon = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  return norm360(trueLon - 0.00569 - 0.00478 * sinD(omega));
}

/** 태양 황경이 targetDeg 가 되는 JDE(연도 year 근방). 초기 추정 후 뉴턴 반복 */
function solarLongitudeMoment(year, targetDeg) {
  // 춘분(0°) ≈ 3/20. 황경 λ 는 춘분부터 하루 ≈ 0.9856° 증가.
  const equinoxJde = ymdToJdn(year, 3, 20) + 0.5;
  let jde = equinoxJde + (norm360(targetDeg) / 360) * 365.2422;
  for (let i = 0; i < 50; i++) {
    const lon = sunApparentLongitude(jde);
    let diff = norm360(targetDeg - lon);
    if (diff > 180) diff -= 360;
    if (Math.abs(diff) < 1e-7) break;
    jde += diff / 0.98564736;
  }
  return jde;
}

/** Meeus 49장 — k번째 신월(합삭) JDE */
function newMoonJde(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  let corr = 0;
  corr += -0.4072 * sinD(Mp);
  corr += 0.17241 * E * sinD(M);
  corr += 0.01608 * sinD(2 * Mp);
  corr += 0.01039 * sinD(2 * F);
  corr += 0.00739 * E * sinD(Mp - M);
  corr += -0.00514 * E * sinD(Mp + M);
  corr += 0.00208 * E * E * sinD(2 * M);
  corr += -0.00111 * sinD(Mp - 2 * F);
  corr += -0.00057 * sinD(Mp + 2 * F);
  corr += 0.00056 * E * sinD(2 * Mp + M);
  corr += -0.00042 * sinD(3 * Mp);
  corr += 0.00042 * E * sinD(M + 2 * F);
  corr += 0.00038 * E * sinD(M - 2 * F);
  corr += -0.00024 * E * sinD(2 * Mp - M);
  corr += -0.00017 * sinD(Om);
  corr += -0.00007 * sinD(Mp + 2 * M);
  corr += 0.00004 * sinD(2 * Mp - 2 * F);
  corr += 0.00004 * sinD(3 * M);
  corr += 0.00003 * sinD(Mp + M - 2 * F);
  corr += 0.00003 * sinD(2 * Mp + 2 * F);
  corr += -0.00003 * sinD(Mp + M + 2 * F);
  corr += 0.00003 * sinD(Mp - M + 2 * F);
  corr += -0.00002 * sinD(Mp - M - 2 * F);
  corr += -0.00002 * sinD(3 * Mp + M);
  corr += 0.00002 * sinD(4 * Mp);

  const A = [
    [299.77 + 0.107408 * k - 0.009173 * T2, 0.000325],
    [251.88 + 0.016321 * k, 0.000165],
    [251.83 + 26.651886 * k, 0.000164],
    [349.42 + 36.412478 * k, 0.000126],
    [84.66 + 18.206239 * k, 0.00011],
    [141.74 + 53.303771 * k, 0.000062],
    [207.14 + 2.453732 * k, 0.00006],
    [154.84 + 7.30686 * k, 0.000056],
    [34.52 + 27.261239 * k, 0.000047],
    [207.19 + 0.121824 * k, 0.000042],
    [291.34 + 1.844379 * k, 0.00004],
    [161.72 + 24.198154 * k, 0.000037],
    [239.56 + 25.513099 * k, 0.000035],
    [331.55 + 3.592518 * k, 0.000023],
  ];
  let add = 0;
  for (const [ang, coef] of A) add += coef * sinD(ang);

  jde += corr + add;
  return jde;
}

// ─── 24절기 ──────────────────────────────────────────────────────────────────

/** 황경(도) → 절기 이름 */
const SOLAR_TERM_NAMES = {
  285: '소한', 300: '대한', 315: '입춘', 330: '우수', 345: '경칩', 0: '춘분',
  15: '청명', 30: '곡우', 45: '입하', 60: '소만', 75: '망종', 90: '하지',
  105: '소서', 120: '대서', 135: '입추', 150: '처서', 165: '백로', 180: '추분',
  195: '한로', 210: '상강', 225: '입동', 240: '소설', 255: '대설', 270: '동지',
};

/** 해당 양력 연도 안의 절기 24개(1월 소한 ~ 12월 동지) */
function solarTermsOfYear(year, nearMidnight) {
  // 소한(285°)·대한(300°)은 전년도 춘분 기준 궤도, 입춘(315°)~동지(270°)는 당해.
  const list = [];
  const push = (lon, baseYear) => {
    const jde = solarLongitudeMoment(baseYear, lon);
    const kst = jdeToKst(jde);
    recordNearMidnight(nearMidnight, `절기 ${SOLAR_TERM_NAMES[lon]}`, kst);
    list.push({ date: kst.key, name: SOLAR_TERM_NAMES[lon], lon, jdn: kst.jdn });
  };
  push(285, year - 1);
  push(300, year - 1);
  for (let lon = 315; lon < 360; lon += 15) push(lon, year - 1);
  for (let lon = 0; lon <= 270; lon += 15) push(lon, year);
  list.sort((a, b) => a.jdn - b.jdn);
  for (const t of list) {
    if (!t.date.startsWith(String(year))) throw new Error(`절기 ${t.name} 가 ${year}년 밖: ${t.date}`);
  }
  return list;
}

function recordNearMidnight(bucket, label, kst) {
  const minutes = kst.frac * 1440;
  const toMidnight = Math.min(minutes, 1440 - minutes);
  if (toMidnight <= 30) {
    bucket.push(`${label} ${kst.key} ${pad2(Math.floor(minutes / 60))}:${pad2(Math.floor(minutes % 60))} KST (자정 ±${toMidnight.toFixed(0)}분)`);
  }
}

// ─── 음력 ───────────────────────────────────────────────────────────────────

/**
 * 음력 월 목록 구성. 반환: [{ year, month, leap, startJdn, days }] (시간순)
 * 범위: 동지(firstSolsticeYear) 포함 달 ~ 동지(lastSolsticeYear) 포함 달 직전.
 */
function buildLunarMonths(firstSolsticeYear, lastSolsticeYear, nearMidnight) {
  // 동지 KST 날짜(JDN)
  const solsticeJdn = new Map();
  for (let y = firstSolsticeYear; y <= lastSolsticeYear; y++) {
    const kst = jdeToKst(solarLongitudeMoment(y, 270));
    solsticeJdn.set(y, kst.jdn);
  }
  // 중기(30° 배수) KST 날짜 집합 — 범위 전후 여유
  const zhongqi = new Set();
  for (let y = firstSolsticeYear - 1; y <= lastSolsticeYear + 1; y++) {
    for (let lon = 0; lon < 360; lon += 30) {
      const kst = jdeToKst(solarLongitudeMoment(y, lon));
      zhongqi.add(kst.jdn);
    }
  }
  // 신월 KST 날짜(JDN) — 범위 전후 여유
  const kFrom = Math.floor((firstSolsticeYear - 2000 - 0.5) * 12.3685) - 2;
  const kTo = Math.ceil((lastSolsticeYear - 2000 + 1.5) * 12.3685) + 2;
  const newMoons = [];
  for (let k = kFrom; k <= kTo; k++) {
    const kst = jdeToKst(newMoonJde(k));
    recordNearMidnight(nearMidnight, '합삭', kst);
    newMoons.push(kst.jdn);
  }
  for (let i = 1; i < newMoons.length; i++) {
    const len = newMoons[i] - newMoons[i - 1];
    if (len !== 29 && len !== 30) throw new Error(`신월 간격 이상: ${jdnToKey(newMoons[i - 1])} → ${jdnToKey(newMoons[i])} (${len}일)`);
  }
  const monthIndexContaining = (jdn) => {
    for (let i = 0; i < newMoons.length - 1; i++) {
      if (newMoons[i] <= jdn && jdn < newMoons[i + 1]) return i;
    }
    throw new Error(`신월 범위 밖: ${jdnToKey(jdn)}`);
  };
  const hasZhongqi = (i) => {
    for (let j = newMoons[i]; j < newMoons[i + 1]; j++) if (zhongqi.has(j)) return true;
    return false;
  };

  const months = [];
  let year = firstSolsticeYear;
  let number = 11;
  const firstIdx = monthIndexContaining(solsticeJdn.get(firstSolsticeYear));
  months.push({ year, month: 11, leap: false, idx: firstIdx });

  for (let y = firstSolsticeYear; y < lastSolsticeYear; y++) {
    const a = monthIndexContaining(solsticeJdn.get(y));
    const b = monthIndexContaining(solsticeJdn.get(y + 1));
    const count = b - a; // 동지(y) 달 포함 ~ 동지(y+1) 달 직전
    if (count !== 12 && count !== 13) throw new Error(`세차(${y}→${y + 1}) 달 수 이상: ${count}`);
    let leapIdx = -1;
    if (count === 13) {
      for (let i = a + 1; i < b; i++) {
        if (!hasZhongqi(i)) { leapIdx = i; break; }
      }
      if (leapIdx < 0) throw new Error(`세차(${y}→${y + 1}) 13개월인데 무중기 달이 없음`);
    }
    for (let i = a + 1; i <= b; i++) {
      if (i === leapIdx) {
        months.push({ year, month: number, leap: true, idx: i });
        continue;
      }
      number += 1;
      if (number === 13) { number = 1; year += 1; }
      months.push({ year, month: number, leap: false, idx: i });
    }
    if (number !== 11) throw new Error(`세차(${y}→${y + 1}) 끝 달이 11월이 아님: ${number}`);
  }
  return months.map((m) => ({
    year: m.year,
    month: m.month,
    leap: m.leap,
    startJdn: newMoons[m.idx],
    days: newMoons[m.idx + 1] - newMoons[m.idx],
  }));
}

/** 음력 → 양력 JDN (해당 달 없거나 day 초과면 null) */
function lunarToJdn(lunarYears, year, month, day, leap) {
  const info = lunarYears[String(year)];
  if (!info) return null;
  const m = info.months.find((x) => x.month === month && x.leap === leap);
  if (!m || day < 1 || day > m.days) return null;
  return keyToJdn(m.start) + day - 1;
}

// ─── 공휴일 ──────────────────────────────────────────────────────────────────

/**
 * 규정상 공휴일 목록(원 공휴일). group:
 *  - 'none'  : 대체 없음(신정·현충일)
 *  - 'sunHol': 일요일 또는 다른 공휴일과 겹치면 대체(설날·추석 연휴, 토요일 제외)
 *  - 'satSunHol': 토·일 또는 다른 공휴일과 겹치면 대체(삼일절·광복절·개천절·한글날·어린이날·부처님오신날·기독탄신일)
 */
function baseHolidaysOfYear(year, lunarYears) {
  const items = [];
  // since: 해당 연도부터 적용(없으면 전 범위). 2026-04-30 개정(대통령령 제36290호, 2026-05-01 시행)으로 노동절·제헌절 추가.
  const fixed = (m, d, name, group, since) => {
    if (since && year < since) return;
    items.push({ jdn: ymdToJdn(year, m, d), name, group, set: name });
  };
  fixed(1, 1, '신정', 'none');
  fixed(3, 1, '삼일절', 'satSunHol');
  fixed(5, 1, '노동절', 'satSunHol', 2026);
  fixed(5, 5, '어린이날', 'satSunHol');
  fixed(6, 6, '현충일', 'none');
  fixed(7, 17, '제헌절', 'satSunHol', 2026);
  fixed(8, 15, '광복절', 'satSunHol');
  fixed(10, 3, '개천절', 'satSunHol');
  fixed(10, 9, '한글날', 'satSunHol');
  fixed(12, 25, '기독탄신일', 'satSunHol');

  const seol = lunarToJdn(lunarYears, year, 1, 1, false);
  if (seol == null) throw new Error(`${year} 설날 환산 실패`);
  for (const off of [-1, 0, 1]) items.push({ jdn: seol + off, name: '설날', group: 'sunHol', set: '설날' });

  const buddha = lunarToJdn(lunarYears, year, 4, 8, false);
  if (buddha == null) throw new Error(`${year} 부처님오신날 환산 실패`);
  items.push({ jdn: buddha, name: '부처님오신날', group: 'satSunHol', set: '부처님오신날' });

  const chuseok = lunarToJdn(lunarYears, year, 8, 15, false);
  if (chuseok == null) throw new Error(`${year} 추석 환산 실패`);
  for (const off of [-1, 0, 1]) items.push({ jdn: chuseok + off, name: '추석', group: 'sunHol', set: '추석' });

  items.sort((a, b) => a.jdn - b.jdn); // 안정 정렬 — 같은 날은 삽입 순서(고정 → 음력) 유지
  return items;
}

/** 원 공휴일 + 대체공휴일(날짜순). overrides(temporary)는 여기 참여하지 않는다. */
function holidaysWithSubstitutes(year, lunarYears) {
  const base = baseHolidaysOfYear(year, lunarYears);
  const byJdn = new Map();
  for (const h of base) {
    if (!byJdn.has(h.jdn)) byJdn.set(h.jdn, []);
    byJdn.get(h.jdn).push(h);
  }
  // 연휴 세트의 마지막 날
  const setEnd = new Map();
  for (const h of base) setEnd.set(h.set, Math.max(setEnd.get(h.set) ?? -Infinity, h.jdn));

  // 트리거 수집: 날짜별 1건(같은 날 두 공휴일이 겹치면 대체 1건)
  const triggers = [];
  for (const [jdn, list] of [...byJdn.entries()].sort((a, b) => a[0] - b[0])) {
    const wd = weekdayOfJdn(jdn);
    const names = [];
    let after = -Infinity;
    for (const h of list) {
      if (h.group === 'none') continue;
      const overlapsOther = list.some((o) => o.set !== h.set);
      const hit =
        wd === 0 ||
        (wd === 6 && h.group === 'satSunHol') ||
        overlapsOther;
      if (!hit) continue;
      if (!names.includes(h.set)) names.push(h.set);
      after = Math.max(after, setEnd.get(h.set));
    }
    if (names.length) triggers.push({ jdn, names, after });
  }

  const substitutes = [];
  const taken = new Set(byJdn.keys());
  for (const t of triggers) {
    let d = t.after + 1;
    while (taken.has(d) || weekdayOfJdn(d) === 0 || weekdayOfJdn(d) === 6) d += 1;
    taken.add(d);
    const forName = t.names.join('·');
    substitutes.push({ jdn: d, name: `대체공휴일(${forName})`, substitute: true, for: forName });
  }

  const out = [
    ...base.map((h) => ({ jdn: h.jdn, name: h.name })),
    ...substitutes,
  ];
  out.sort((a, b) => a.jdn - b.jdn);
  return out.map((h) => {
    const o = { date: jdnToKey(h.jdn), name: h.name };
    if (h.substitute) { o.substitute = true; o.for = h.for; }
    return o;
  });
}

function loadOverrides() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`overrides 읽기 실패 (${OVERRIDES_PATH}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const map = {};
  for (const [year, list] of Object.entries(raw)) {
    if (year.startsWith('_')) continue; // 머리말 키
    if (!Array.isArray(list)) throw new Error(`overrides[${year}] 는 배열이어야 함`);
    map[year] = list.map((e) => {
      if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.date.startsWith(year)) {
        throw new Error(`overrides[${year}] date 형식 오류: ${JSON.stringify(e)}`);
      }
      if (typeof e.name !== 'string' || !e.name) throw new Error(`overrides[${year}] name 누락: ${JSON.stringify(e)}`);
      const o = { date: e.date, name: e.name };
      if (e.temporary) o.temporary = true;
      return o;
    });
  }
  return map;
}

function mergeOverrides(holidays, overrides) {
  for (const [year, list] of Object.entries(overrides)) {
    if (!holidays[year]) continue; // 범위 밖 연도는 무시
    const arr = holidays[year];
    for (const o of list) {
      if (arr.some((h) => h.date === o.date && h.name === o.name)) continue;
      arr.push(o);
    }
    arr.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'));
  }
}

// ─── 참고값(공표/통용 값, 세션 기억 기반) — 차이가 나면 강제하지 않고 보고 ──────

// 참고값 — 설날은 KASI 달력자료(2027-02-07·2028-01-27, 중국력과 하루 차이)
const REF = {
  seollal: { 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-07', 2028: '2028-01-27', 2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11', 2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08' },
  chuseok: { 2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12', 2031: '2031-10-01', 2032: '2032-09-19', 2033: '2033-09-08', 2034: '2034-09-27', 2035: '2035-09-16' },
  buddha: { 2025: '2025-05-05', 2026: '2026-05-24', 2027: '2027-05-13', 2028: '2028-05-02', 2029: '2029-05-20', 2030: '2030-05-09', 2031: '2031-05-28', 2032: '2032-05-16', 2033: '2033-05-06', 2034: '2034-05-25', 2035: '2035-05-15' },
  leapMonths: { 2025: 6, 2028: 5, 2031: 3, 2033: 11 },
  terms2025: { 소한: '2025-01-05', 대한: '2025-01-20', 입춘: '2025-02-03', 우수: '2025-02-18', 경칩: '2025-03-05', 춘분: '2025-03-20', 청명: '2025-04-04', 곡우: '2025-04-20', 입하: '2025-05-05', 소만: '2025-05-21', 망종: '2025-06-05', 하지: '2025-06-21', 소서: '2025-07-07', 대서: '2025-07-22', 입추: '2025-08-07', 처서: '2025-08-23', 백로: '2025-09-07', 추분: '2025-09-23', 한로: '2025-10-08', 상강: '2025-10-23', 입동: '2025-11-07', 소설: '2025-11-22', 대설: '2025-12-07', 동지: '2025-12-22' },
  terms2026: { 입춘: '2026-02-04', 춘분: '2026-03-20', 청명: '2026-04-05', 망종: '2026-06-06', 하지: '2026-06-21', 대서: '2026-07-23', 추분: '2026-09-23', 동지: '2026-12-22' },
  substitutesPresent: ['2025-03-03', '2025-05-06', '2025-10-08', '2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05', '2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27'],
  substitutesAbsent: ['2026-06-08', '2027-03-02'],
};

function crossCheck(data) {
  const diffs = [];
  const check = (label, got, exp) => { if (got !== exp) diffs.push(`${label}: 알고리즘 ${got} vs 참고 ${exp}`); };
  for (const [y, exp] of Object.entries(REF.seollal)) check(`설날 ${y}`, data.lunarYears[y].newYear, exp);
  for (const [y, exp] of Object.entries(REF.chuseok)) check(`추석 ${y}`, jdnToKey(lunarToJdn(data.lunarYears, Number(y), 8, 15, false)), exp);
  for (const [y, exp] of Object.entries(REF.buddha)) check(`부처님오신날 ${y}`, jdnToKey(lunarToJdn(data.lunarYears, Number(y), 4, 8, false)), exp);
  for (let y = SOLAR_YEAR_FROM; y <= SOLAR_YEAR_TO; y++) {
    const leap = data.lunarYears[String(y)].months.find((m) => m.leap);
    check(`윤달 ${y}`, leap ? leap.month : 'none', REF.leapMonths[y] ?? 'none');
  }
  for (const [name, exp] of Object.entries(REF.terms2025)) check(`절기 2025 ${name}`, data.solarTerms['2025'].find((t) => t.name === name)?.date, exp);
  for (const [name, exp] of Object.entries(REF.terms2026)) check(`절기 2026 ${name}`, data.solarTerms['2026'].find((t) => t.name === name)?.date, exp);
  const allSub = new Set(Object.values(data.holidays).flat().filter((h) => h.substitute).map((h) => h.date));
  for (const d of REF.substitutesPresent) if (!allSub.has(d)) diffs.push(`대체공휴일 ${d}: 알고리즘 없음 vs 참고 있음`);
  for (const d of REF.substitutesAbsent) if (allSub.has(d)) diffs.push(`대체공휴일 ${d}: 알고리즘 있음 vs 참고 없음`);
  return diffs;
}

// ─── 직렬화(결정적) ─────────────────────────────────────────────────────────

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function serialize(data, header) {
  const lines = [];
  lines.push(header);
  lines.push(`import type { CalendarData } from '../types';`);
  lines.push('');
  lines.push(`export const CALENDAR_DATA_KR_2025_2035_V1: CalendarData = {`);
  lines.push(`  version: ${q(data.version)},`);
  lines.push(`  range: { from: ${q(data.range.from)}, to: ${q(data.range.to)} },`);
  lines.push(`  source: ${q(data.source)},`);
  lines.push(`  generatedAt: ${q(data.generatedAt)},`);
  lines.push(`  holidays: {`);
  for (const y of Object.keys(data.holidays)) {
    lines.push(`    ${q(y)}: [`);
    for (const h of data.holidays[y]) {
      const parts = [`date: ${q(h.date)}`, `name: ${q(h.name)}`];
      if (h.substitute) parts.push('substitute: true', `for: ${q(h.for)}`);
      if (h.temporary) parts.push('temporary: true');
      lines.push(`      { ${parts.join(', ')} },`);
    }
    lines.push(`    ],`);
  }
  lines.push(`  },`);
  lines.push(`  solarTerms: {`);
  for (const y of Object.keys(data.solarTerms)) {
    lines.push(`    ${q(y)}: [`);
    for (const t of data.solarTerms[y]) lines.push(`      { date: ${q(t.date)}, name: ${q(t.name)} },`);
    lines.push(`    ],`);
  }
  lines.push(`  },`);
  lines.push(`  lunarYears: {`);
  for (const y of Object.keys(data.lunarYears)) {
    const info = data.lunarYears[y];
    lines.push(`    ${q(y)}: {`);
    lines.push(`      newYear: ${q(info.newYear)},`);
    lines.push(`      months: [`);
    for (const m of info.months) {
      lines.push(`        { month: ${m.month}, leap: ${m.leap}, days: ${m.days}, start: ${q(m.start)} },`);
    }
    lines.push(`      ],`);
    lines.push(`    },`);
  }
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  return lines.join('\n');
}

// ─── main ───────────────────────────────────────────────────────────────────

function main() {
  const nearMidnight = [];

  // 음력: 동지 2023 ~ 동지 2036 (음력 2023-11 ~ 2036-10, 2035-12 까지 완전히 덮음)
  const months = buildLunarMonths(2023, 2036, nearMidnight);
  const lunarYears = {};
  for (let y = LUNAR_YEAR_FROM; y <= LUNAR_YEAR_TO; y++) {
    const ms = months.filter((m) => m.year === y);
    if (ms.length !== 12 && ms.length !== 13) throw new Error(`음력 ${y} 달 수 이상: ${ms.length}`);
    for (let n = 1; n <= 12; n++) {
      if (!ms.some((m) => m.month === n && !m.leap)) throw new Error(`음력 ${y} ${n}월 누락`);
    }
    const first = ms.find((m) => m.month === 1 && !m.leap);
    lunarYears[String(y)] = {
      newYear: jdnToKey(first.startJdn),
      months: ms.map((m) => ({ month: m.month, leap: m.leap, days: m.days, start: jdnToKey(m.startJdn) })),
    };
  }

  const solarTerms = {};
  for (let y = SOLAR_YEAR_FROM; y <= SOLAR_YEAR_TO; y++) {
    solarTerms[String(y)] = solarTermsOfYear(y, nearMidnight).map((t) => ({ date: t.date, name: t.name }));
  }

  const holidays = {};
  for (let y = SOLAR_YEAR_FROM; y <= SOLAR_YEAR_TO; y++) {
    holidays[String(y)] = holidaysWithSubstitutes(y, lunarYears);
  }
  const overrides = loadOverrides();
  mergeOverrides(holidays, overrides);

  const data = {
    version: VERSION,
    range: RANGE,
    source:
      'scripts/gen-calendar-data.mjs — Meeus 천문 계산(신월 49장, 태양 황경 25장 저정밀, KST) + 관공서의 공휴일에 관한 규정(2023-05 대체공휴일) + scripts/calendar-overrides.json(임시공휴일·선거일, 오너 확인 필요)',
    generatedAt: new Date().toISOString(),
    holidays,
    solarTerms,
    lunarYears,
  };

  const diffs = crossCheck(data);

  const header = [
    '/**',
    ' * kr-2025-2035-v1.ts — 한국 캘린더 정적 데이터 (공휴일·대체공휴일·24절기·음력 환산표 2025~2035)',
    ' *',
    ' * ⚠️ 이 파일은 생성물 — 직접 편집 금지. `scripts/calendar-overrides.json` 수정 후 재생성한다.',
    ' *   생성 명령: `pnpm --filter @storige/canvas-core gen:calendar-data` (= node scripts/gen-calendar-data.mjs)',
    ` *   generatedAt: ${data.generatedAt}`,
    ' *',
    ' * 출처·규칙 요약',
    ' *  - 천문: Jean Meeus, Astronomical Algorithms — 신월(49장), 태양 황경(25장 저정밀 0.01°). ΔT 69.2초(2025)+0.55초/년. KST(UTC+9).',
    ' *  - 음력: 합삭 KST 날짜에 월 시작, 동지 포함 달 = 11월, 두 동지 사이 13개월이면 무중기 첫 달이 윤달.',
    ' *  - 공휴일: 관공서의 공휴일에 관한 규정(2023-05 대체공휴일 개정 + 2026-04-30 개정 대통령령 제36290호, 2026-05-01 시행).',
    ' *    신정·삼일절·설날(3일)·부처님오신날·어린이날·현충일·광복절·추석(3일)·개천절·한글날·기독탄신일 + 2026년부터 노동절(5/1)·제헌절(7/17).',
    ' *    대체공휴일: 설날·추석은 일요일/다른 공휴일 겹침, 삼일절·노동절·어린이날·부처님오신날·제헌절·광복절·개천절·한글날·',
    ' *    기독탄신일은 토·일/다른 공휴일 겹침 → 다음 첫 비공휴일(토·일 제외). 신정·현충일 대체 없음.',
    ' *  - temporary: 임시공휴일·선거일(overrides) — 2025 임시공휴일 2건(01-27, 06-03 대통령선거일)·2026 선거일 1건(06-03).',
    ' *    대체공휴일 계산에 참여하지 않는다.',
    ' *',
    ' * 검증 절차',
    ' *  1. 재생성 로그의 참고값 대조(설날·추석·부처님오신날·윤달·절기·대체공휴일)가 0건 차이인지 확인.',
    ' *  2. `src/calendar/data/kr-2025-2035-v1.test.ts` 통과(연속성·중복·범위).',
    ' *  3. 공표 자료(KASI 달력자료·월력요항, 공공데이터포털 특일정보) 대조 후 오너 승인. 2025~2027 공휴일·절기는 KASI 와 대조 완료(2026-10-17).',
    ' *     2028 이후 임시공휴일·선거일은 공표 전.',
    ' */',
  ].join('\n');

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, serialize(data, header), 'utf8');

  console.log(`[gen-calendar-data] 출력: ${OUT_PATH}`);
  console.log(`[gen-calendar-data] 음력 연도 ${LUNAR_YEAR_FROM}~${LUNAR_YEAR_TO} (${Object.keys(lunarYears).length}), 양력 ${SOLAR_YEAR_FROM}~${SOLAR_YEAR_TO}`);
  for (let y = SOLAR_YEAR_FROM; y <= SOLAR_YEAR_TO; y++) {
    const hs = holidays[String(y)];
    const leap = lunarYears[String(y)].months.find((m) => m.leap);
    console.log(
      `  ${y}: 설날 ${lunarYears[String(y)].newYear} 추석 ${jdnToKey(lunarToJdn(lunarYears, y, 8, 15, false))} 윤달 ${leap ? `${leap.month}월` : '없음'} 공휴일 ${hs.length}건(대체 ${hs.filter((h) => h.substitute).length}, 임시 ${hs.filter((h) => h.temporary).length})`,
    );
  }
  console.log(`[gen-calendar-data] 참고값 대조 차이: ${diffs.length}건`);
  for (const d of diffs) console.log(`  - ${d}`);
  console.log(`[gen-calendar-data] KST 자정 ±30분 이벤트(날짜 경계 위험): ${nearMidnight.length}건`);
  for (const n of nearMidnight) console.log(`  - ${n}`);
  if (diffs.length >= 3) {
    console.error('[gen-calendar-data] 참고값과 3건 이상 차이 — 원인 분석 필요(파일은 기록됨)');
    process.exitCode = 2;
  }
}

main();
