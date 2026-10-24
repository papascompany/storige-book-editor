/**
 * calendar/core.ts — 캘린더 순수 함수 (P1, 2026-10-17)
 *
 * fabric·DOM 의존 없음. 모든 함수는 `CalendarData`(정적 데이터)를 인자로 받는다.
 * ⚠️ 시그니처 계약(2026-10-17) — 시그니처를 바꾸면 CalendarPlugin·editor 호출부도 바뀐다.
 *
 * 날짜 산술은 `Date.UTC` 기반(타임존 무관). 음력 환산은 `data.lunarYears[*].months[*].start` 표를 탐색하며
 * 데이터 밖 날짜는 null 을 돌려준다(throw 하지 않음).
 */
import type {
  AnniversaryInput,
  AnniversaryTextStyle,
  CalendarData,
  CalendarHoliday,
  CalendarMinorTerm,
  CalendarSolarTerm,
  DateKey,
  LunarDate,
  LunarMonthInfo,
  MonthCell,
  MonthMatrix,
  YearMatrix,
} from './types';
import { CALENDAR_YEAR_MONTH_COUNT } from '@storige/types';

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** month 1~12 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' → {year, month, day}. 형식·달력상 무효면 null */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  if (typeof key !== 'string') return null;
  const m = DATE_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** 'YYYY-MM-DD' → UTC epoch 일수(정수). 무효면 null */
function dayNumberOf(key: DateKey): number | null {
  const p = parseDateKey(key);
  if (!p) return null;
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY);
}

function dayNumberToKey(dayNumber: number): DateKey {
  const d = new Date(dayNumber * MS_PER_DAY);
  return formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0=일 … 6=토. 무효 키면 NaN */
export function weekdayOf(key: DateKey): number {
  const n = dayNumberOf(key);
  if (n === null) return NaN;
  // 1970-01-01(day 0)은 목요일(4)
  return (((n + 4) % 7) + 7) % 7;
}

/** 'YYYY-MM' 비교용 정수 */
function monthIndexOf(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/** 양력 날짜가 데이터 범위(range.from~to 월) 안인지 */
export function isDateInRange(key: DateKey, data: CalendarData): boolean {
  const p = parseDateKey(key);
  if (!p) return false;
  const from = monthIndexOf(data.range.from);
  const to = monthIndexOf(data.range.to);
  if (from === null || to === null) return false;
  const idx = p.year * 12 + (p.month - 1);
  return idx >= from && idx <= to;
}

interface LunarMonthSpan {
  year: number;
  info: LunarMonthInfo;
  startDay: number;
}

const spanCache = new WeakMap<CalendarData, LunarMonthSpan[]>();

/** 데이터의 모든 음력 월을 시작일 오름차순으로 평탄화(데이터 객체별 캐시) */
function lunarSpans(data: CalendarData): LunarMonthSpan[] {
  const cached = spanCache.get(data);
  if (cached) return cached;
  const spans: LunarMonthSpan[] = [];
  for (const yearKey of Object.keys(data.lunarYears)) {
    const year = Number(yearKey);
    for (const info of data.lunarYears[yearKey].months) {
      const startDay = dayNumberOf(info.start);
      if (startDay === null) continue;
      spans.push({ year, info, startDay });
    }
  }
  spans.sort((a, b) => a.startDay - b.startDay);
  spanCache.set(data, spans);
  return spans;
}

/** 양력 → 음력. 데이터 밖이면 null */
export function solarToLunar(key: DateKey, data: CalendarData): LunarDate | null {
  const day = dayNumberOf(key);
  if (day === null) return null;
  const spans = lunarSpans(data);
  if (spans.length === 0) return null;
  // 이진 탐색: startDay <= day 인 마지막 span
  let lo = 0;
  let hi = spans.length - 1;
  if (day < spans[0].startDay) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid].startDay <= day) lo = mid;
    else hi = mid - 1;
  }
  const span = spans[lo];
  const offset = day - span.startDay;
  if (offset >= span.info.days) return null; // 마지막 월 뒤(데이터 밖)
  return { year: span.year, month: span.info.month, day: offset + 1, isLeapMonth: span.info.leap };
}

/** 음력 → 양력. 해당 음력 연도·월(윤달 여부)·일이 데이터에 없으면 null */
export function lunarToSolar(lunar: LunarDate, data: CalendarData): DateKey | null {
  if (!lunar) return null;
  const yearInfo = data.lunarYears[String(lunar.year)];
  if (!yearInfo) return null;
  const leap = Boolean(lunar.isLeapMonth);
  const info = yearInfo.months.find((m) => m.month === lunar.month && m.leap === leap);
  if (!info) return null;
  if (!Number.isInteger(lunar.day) || lunar.day < 1 || lunar.day > info.days) return null;
  const startDay = dayNumberOf(info.start);
  if (startDay === null) return null;
  return dayNumberToKey(startDay + lunar.day - 1);
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${pad2(month)}-`;
}

export function getHolidaysForMonth(year: number, month: number, data: CalendarData): CalendarHoliday[] {
  const list = data.holidays[String(year)];
  if (!list) return [];
  const prefix = monthPrefix(year, month);
  return list.filter((h) => h.date.startsWith(prefix));
}

export function getSolarTermsForMonth(year: number, month: number, data: CalendarData): CalendarSolarTerm[] {
  const list = data.solarTerms[String(year)];
  if (!list) return [];
  const prefix = monthPrefix(year, month);
  return list.filter((t) => t.date.startsWith(prefix));
}

/** 잡절(삼복, T4). 데이터에 `minorTerms` 가 없거나(구 데이터) 그 연도가 없으면 빈 배열 */
export function getMinorTermsForMonth(year: number, month: number, data: CalendarData): CalendarMinorTerm[] {
  const list = data.minorTerms?.[String(year)];
  if (!list) return [];
  const prefix = monthPrefix(year, month);
  return list.filter((t) => t.date.startsWith(prefix));
}

/**
 * 기념일 → 양력 날짜. lunar=false 면 date 그대로(형식 검증), lunar=true 면 음력 환산.
 * 환산 불가(데이터 밖·윤달 없음·30일 없는 달)면 null.
 */
export function resolveAnniversarySolarDate(a: AnniversaryInput, data: CalendarData): DateKey | null {
  if (!a) return null;
  const p = parseDateKeyLoose(a.date);
  if (!p) return null;
  if (!a.lunar) {
    // 양력: 달력상 유효해야 한다
    return parseDateKey(a.date) ? a.date : null;
  }
  return lunarToSolar({ year: p.year, month: p.month, day: p.day, isLeapMonth: Boolean(a.isLeapMonth) }, data);
}

/** 음력 키용 — 형식만 검사(음력 30일 유효성은 데이터로 판정) */
function parseDateKeyLoose(key: string): { year: number; month: number; day: number } | null {
  if (typeof key !== 'string') return null;
  const m = DATE_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * 기념일 문구 스타일 정제(D1(b) 최소: 색·굵게). 세션 metadata 는 자유형이라 렌더(화면·PDF)에 넘기기 전에
 * 색은 hex('#rgb'/'#rrggbb')만, 굵기는 'normal'|'bold' 만 남긴다. 남는 키가 없으면 null.
 */
export function sanitizeAnniversaryTextStyle(style: unknown): AnniversaryTextStyle | null {
  if (typeof style !== 'object' || style === null) return null;
  const s = style as Record<string, unknown>;
  const out: AnniversaryTextStyle = {};
  if (typeof s.fill === 'string' && HEX_COLOR_RE.test(s.fill)) out.fill = s.fill;
  if (s.fontWeight === 'normal' || s.fontWeight === 'bold') out.fontWeight = s.fontWeight;
  return Object.keys(out).length > 0 ? out : null;
}

export interface BuildMonthMatrixOptions {
  weekStart: 0 | 1;
  data: CalendarData;
  anniversaries?: AnniversaryInput[];
  /**
   * 임시공휴일·선거일(`CalendarHoliday.temporary === true`)을 휴일로 칠지. 기본 false(2026-10-17 오너 결정):
   * 법정 공휴일(규정상 공휴일 + `substitute` 대체공휴일)만 `isHoliday`/`holidayNames` 에 들어간다.
   */
  includeTemporaryHolidays?: boolean;
}

const ROWS = 6;
const COLS = 7;

/**
 * 항상 6행×7열. 전월·익월 채움 칸은 inMonth=false. 공휴일·음력·절기·기념일을 칸에 채운다.
 * `temporary` 휴일은 `includeTemporaryHolidays` 가 true 일 때만 휴일로 취급한다.
 */
export function buildMonthMatrix(year: number, month: number, opts: BuildMonthMatrixOptions): MonthMatrix {
  const weekStart: 0 | 1 = opts.weekStart === 1 ? 1 : 0;
  const data = opts.data;
  const includeTemporary = opts.includeTemporaryHolidays === true;
  const weekdayOrder = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

  const firstDay = Math.round(Date.UTC(year, month - 1, 1) / MS_PER_DAY);
  const firstWeekday = (((firstDay + 4) % 7) + 7) % 7;
  const leadingBlanks = (firstWeekday - weekStart + 7) % 7;
  const dim = daysInMonth(year, month);
  const usedRows = Math.ceil((leadingBlanks + dim) / COLS);
  const gridStart = firstDay - leadingBlanks;

  // 공휴일·절기 인덱스(날짜 → 목록). 전월·익월 칸도 채우도록 3개 연도 범위를 본다.
  const holidayMap = new Map<DateKey, string[]>();
  const termMap = new Map<DateKey, string>();
  for (const y of [year - 1, year, year + 1]) {
    for (const h of data.holidays[String(y)] ?? []) {
      if (h.temporary === true && !includeTemporary) continue;
      const names = holidayMap.get(h.date);
      if (names) names.push(h.name);
      else holidayMap.set(h.date, [h.name]);
    }
    for (const t of data.solarTerms[String(y)] ?? []) {
      if (!termMap.has(t.date)) termMap.set(t.date, t.name);
    }
  }
  const anniversaryMap = new Map<DateKey, string[]>();
  // 문구 스타일(T3b): anniversaryMap 과 같은 순서로 쌓고, 유효 스타일이 하나라도 있는 날짜만 칸에 싣는다
  const anniversaryStyleMap = new Map<DateKey, Array<AnniversaryTextStyle | null>>();
  const styledDates = new Set<DateKey>();
  for (const a of opts.anniversaries ?? []) {
    const solar = resolveAnniversarySolarDate(a, data);
    if (!solar) continue;
    const list = anniversaryMap.get(solar);
    if (list) list.push(a.text);
    else anniversaryMap.set(solar, [a.text]);
    const style = sanitizeAnniversaryTextStyle(a.style);
    const styles = anniversaryStyleMap.get(solar);
    if (styles) styles.push(style);
    else anniversaryStyleMap.set(solar, [style]);
    if (style) styledDates.add(solar);
  }

  const rows: MonthCell[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: MonthCell[] = [];
    for (let c = 0; c < COLS; c++) {
      const dayNumber = gridStart + r * COLS + c;
      const d = new Date(dayNumber * MS_PER_DAY);
      const cy = d.getUTCFullYear();
      const cm = d.getUTCMonth() + 1;
      const cd = d.getUTCDate();
      const date = formatDateKey(cy, cm, cd);
      const holidayNames = holidayMap.get(date) ?? [];
      row.push({
        date,
        year: cy,
        month: cm,
        day: cd,
        weekday: weekdayOrder[c],
        inMonth: cy === year && cm === month,
        isHoliday: holidayNames.length > 0,
        holidayNames: [...holidayNames],
        lunar: solarToLunar(date, data),
        solarTerm: termMap.get(date) ?? null,
        anniversaries: [...(anniversaryMap.get(date) ?? [])],
        ...(styledDates.has(date) ? { anniversaryStyles: [...(anniversaryStyleMap.get(date) ?? [])] } : {}),
      });
    }
    rows.push(row);
  }

  return { year, month, weekStart, weekdayOrder, rows, usedRows };
}

/**
 * (year, month) 부터 연속 `monthCount`(기본 CALENDAR_YEAR_MONTH_COUNT=12)개월. 연도 경계는 월 인덱스 산술로 넘긴다.
 * 윤년·weekStart·공휴일(temporary 옵션)·음력·기념일은 buildMonthMatrix 재사용 — 데이터 밖 연도도 throw 없이 칸을 채운다.
 */
export function buildYearMatrix(
  year: number,
  month: number,
  opts: BuildMonthMatrixOptions,
  monthCount: number = CALENDAR_YEAR_MONTH_COUNT,
): YearMatrix {
  const weekStart: 0 | 1 = opts.weekStart === 1 ? 1 : 0;
  const count = Number.isInteger(monthCount) && monthCount > 0 ? monthCount : CALENDAR_YEAR_MONTH_COUNT;
  const base = year * 12 + (month - 1);
  const months: MonthMatrix[] = [];
  for (let k = 0; k < count; k++) {
    const idx = base + k;
    months.push(buildMonthMatrix(Math.floor(idx / 12), (idx % 12 + 12) % 12 + 1, { ...opts, weekStart }));
  }
  const first = months[0];
  return { year: first.year, month: first.month, weekStart, weekdayOrder: [...first.weekdayOrder], months };
}
