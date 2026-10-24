/**
 * calendar/types.ts — 캘린더 날짜 데이터·순수 함수 계약 (P1, 2026-10-17)
 *
 * 데이터는 `data/<version>.ts` 정적 모듈(외부 API 호출 없음). 출처: 공공데이터포털 특일정보(공휴일·대체공휴일),
 * KASI 음양력·24절기. 갱신은 데이터 파일 교체 + `@storige/types` `CALENDAR_DATA_VERSIONS` 등록 + 오너 승인.
 * fabric·DOM 의존 없음 — `core.ts` 순수 함수와 `CalendarPlugin` 이 공유한다.
 */

/** 'YYYY-MM-DD' */
export type DateKey = string;

export interface CalendarHoliday {
  date: DateKey;
  name: string;
  /** 대체공휴일이면 true, `for` 는 원 공휴일 이름 */
  substitute?: boolean;
  for?: string;
  /** 임시공휴일·선거일 등 규정 밖 지정(데이터 릴리스로만 반영) */
  temporary?: boolean;
}

export interface CalendarSolarTerm {
  date: DateKey;
  /** 소한·대한·입춘 … 동지 (24절기) */
  name: string;
}

export interface LunarMonthInfo {
  /** 음력 월(1~12) */
  month: number;
  /** 윤달이면 true (같은 month 번호의 평달 바로 뒤에 온다) */
  leap: boolean;
  /** 29 | 30 */
  days: number;
  /** 이 음력 월 1일의 양력 날짜 */
  start: DateKey;
}

export interface LunarYearInfo {
  /** 음력 1월 1일(설날)의 양력 날짜 */
  newYear: DateKey;
  /** 음력 월 순서대로(윤달 포함 12 또는 13개) */
  months: LunarMonthInfo[];
}

export interface CalendarData {
  /** `CALENDAR_DATA_VERSIONS` 키와 같아야 한다 (예: 'kr-2025-2035-v1') */
  version: string;
  /** 'YYYY-MM' 양력 범위 */
  range: { from: string; to: string };
  source: string;
  generatedAt: string;
  /** 양력 연도('2025') → 공휴일(대체공휴일 포함, 날짜 오름차순) */
  holidays: Record<string, CalendarHoliday[]>;
  /** 양력 연도 → 24절기(날짜 오름차순) */
  solarTerms: Record<string, CalendarSolarTerm[]>;
  /** 음력 연도('2024'…) → 월 구성. range.from 직전 음력 연도부터 포함해야 양력 1월 환산이 가능하다. */
  lunarYears: Record<string, LunarYearInfo>;
}

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
}

export interface AnniversaryInput {
  /** 'YYYY-MM-DD' — lunar=true 면 음력 */
  date: string;
  lunar: boolean;
  isLeapMonth?: boolean;
  text: string;
}

export interface MonthCell {
  date: DateKey;
  year: number;
  month: number;
  day: number;
  /** 0=일 … 6=토 */
  weekday: number;
  /** 해당 월의 날짜면 true(전월·익월 채움 칸은 false) */
  inMonth: boolean;
  isHoliday: boolean;
  holidayNames: string[];
  lunar: LunarDate | null;
  solarTerm: string | null;
  /** 이 날짜에 해당하는 기념일 문구(양력 환산 후) */
  anniversaries: string[];
}

export interface MonthMatrix {
  year: number;
  month: number;
  weekStart: 0 | 1;
  /** 열 순서의 요일(weekStart=0 → [0,1,2,3,4,5,6], 1 → [1,2,3,4,5,6,0]) */
  weekdayOrder: number[];
  /** 항상 6행 × 7열 */
  rows: MonthCell[][];
  /** 실제 날짜가 있는 행 수(4~6) */
  usedRows: number;
}

/** 연달력(그리드 variant 'year', 설계 C8, v1.26) — 첫 달부터 연속 개월의 월 행렬 */
export interface YearMatrix {
  /** 첫 달 */
  year: number;
  /** 1~12 */
  month: number;
  weekStart: 0 | 1;
  weekdayOrder: number[];
  /** 첫 달부터 연속 monthCount(기본 12)개월, 각 원소는 buildMonthMatrix 결과 그대로 */
  months: MonthMatrix[];
}
