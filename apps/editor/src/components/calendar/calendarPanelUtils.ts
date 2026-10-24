import { CALENDAR_GRID_EXTENSION_TYPE, resolveAnniversarySolarDate, type CalendarData, type CalendarGridStyle } from '@storige/canvas-core'
import {
  addMonths,
  formatMonthKey,
  parseMonthKey,
  resolveCalendarCanvasSlot,
  resolveCalendarYearSpan,
  resolveCalendarYearStart,
  type CalendarAnniversary,
  type CalendarAnniversaryStyle,
  type CalendarMonthRange,
  type CalendarProfile,
  type CalendarYearSpan,
  type YearMonth,
} from '@storige/types'

/**
 * calendarPanelUtils.ts — CalendarPanel 순수 헬퍼 (P1-d 캘린더, 2026-10-17)
 * fabric·스토어 의존 없음. 날짜 키는 'YYYY-MM-DD'.
 */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** 양력 월의 일수 */
export function daysInSolarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** allowedRange(from~to) 안의 연월 목록(오름차순). 형식 불량이면 빈 배열 */
export function listAllowedYearMonths(range: CalendarMonthRange | null | undefined): YearMonth[] {
  if (!range) return []
  const from = parseMonthKey(range.from)
  const to = parseMonthKey(range.to)
  if (!from || !to) return []
  const out: YearMonth[] = []
  const fromIdx = from.year * 12 + (from.month - 1)
  const toIdx = to.year * 12 + (to.month - 1)
  for (let idx = fromIdx; idx <= toIdx && out.length < 600; idx += 1) {
    out.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 })
  }
  return out
}

/** 기념일 연도 Select 후보 — allowedRange 전후 1년을 포함(범위 밖 기념일도 입력·수정할 수 있게) */
export function listAnniversaryYears(range: CalendarMonthRange | null | undefined, start: YearMonth): number[] {
  const from = (range && parseMonthKey(range.from)?.year) ?? start.year
  const to = (range && parseMonthKey(range.to)?.year) ?? start.year
  const lo = Math.min(from, start.year) - 1
  const hi = Math.max(to, start.year) + 2
  const years: number[] = []
  for (let y = lo; y <= hi; y += 1) years.push(y)
  return years
}

/**
 * 기념일 → 양력 날짜. data 가 null 이면 양력 기념일만 판정(음력은 null = 판정 불가).
 */
export function resolveAnniversarySolar(a: Pick<CalendarAnniversary, 'date' | 'lunar' | 'isLeapMonth' | 'text'>, data: CalendarData | null): string | null {
  if (!a.lunar) {
    const p = parseDateKey(a.date)
    if (!p || p.day > daysInSolarMonth(p.year, p.month)) return null
    return a.date
  }
  if (!data) return null
  return resolveAnniversarySolarDate({ date: a.date, lunar: true, isLeapMonth: a.isLeapMonth, text: a.text }, data)
}

/** 양력 날짜가 [시작연월, 시작+11개월] 안인지. 판정 불가(null)면 true(배지 없음) */
export function isSolarDateInCalendarRange(solar: string | null, start: YearMonth): boolean {
  if (!solar) return true
  const p = parseDateKey(solar)
  if (!p) return true
  const idx = p.year * 12 + (p.month - 1)
  const startIdx = start.year * 12 + (start.month - 1)
  return idx >= startIdx && idx <= startIdx + 11
}

/** 시작연월 → 마지막 월 키('YYYY-MM') */
export function calendarEndMonthKey(start: YearMonth): string {
  return formatMonthKey(addMonths(start, 11))
}

/** 시작연월 → 마지막 월 안내 표기('2028년 2월' — 시작 표기와 같이 월 0 패딩 없음) */
export function formatCalendarEndMonthLabel(start: YearMonth): string {
  const end = addMonths(start, 11)
  return `${end.year}년 ${end.month}월`
}

/**
 * 같은 양력 날짜(환산 기준)의 기존 기념일 id. `excludeId` 는 수정 중인 항목.
 * 양력 환산이 불가한 쪽(데이터 없음·무효 날짜)은 원문 date+lunar 가 같을 때만 중복으로 본다.
 */
export function findDuplicateAnniversary(
  list: CalendarAnniversary[],
  candidate: Pick<CalendarAnniversary, 'date' | 'lunar' | 'isLeapMonth' | 'text'>,
  data: CalendarData | null,
  excludeId?: string,
): CalendarAnniversary | null {
  const candSolar = resolveAnniversarySolar(candidate, data)
  for (const a of list) {
    if (excludeId && a.id === excludeId) continue
    const solar = resolveAnniversarySolar(a, data)
    if (candSolar && solar) {
      if (candSolar === solar) return a
      continue
    }
    if (a.date === candidate.date && a.lunar === candidate.lunar && Boolean(a.isLeapMonth) === Boolean(candidate.isLeapMonth)) return a
  }
  return null
}

export function formatAnniversaryDateLabel(a: Pick<CalendarAnniversary, 'date' | 'lunar' | 'isLeapMonth'>): string {
  const p = parseDateKey(a.date)
  const base = p ? `${p.year}년 ${p.month}월 ${p.day}일` : a.date
  if (!a.lunar) return base
  return `음력 ${a.isLeapMonth ? '윤' : ''}${base}`
}

// ─── 연달력(variant 'year', T3b 2026-10-24) ─────────────────────────────────

/**
 * 연달력 한 개의 기간 표기 — 플러그인 연도 제목과 같은 규칙.
 * 'calendar-year' → '2027년', 'start-span' → '2027.3 – 2028.2'. 기간 기준은 `resolveCalendarYearSpan`(정책 > 기본 규칙).
 */
export function formatYearCalendarLabel(span: CalendarYearSpan | undefined, start: YearMonth, delta: number): string {
  const first = resolveCalendarYearStart(span, start, delta)
  if (resolveCalendarYearSpan(span, start) === 'calendar-year') return `${first.year}년`
  const last = addMonths(first, 11)
  return `${first.year}.${first.month} – ${last.year}.${last.month}`
}

/** 역할별 첫 연달력의 템플릿 연도 이동(정수가 아니면 0). 연달력이 없는 역할은 키 없음 */
export interface YearGridScan {
  /** 어느 캔버스에든 연달력이 하나라도 있으면 true */
  any: boolean
  cover?: number
  epilogue?: number
}

interface CanvasLike {
  getObjects?: () => unknown[]
}

/**
 * 캔버스들의 최상위 객체에서 연달력(calendar-grid + variant 'year')을 찾는다. 캔버스 역할은 프로파일 슬롯 규칙
 * (`resolveCalendarCanvasSlot`)으로 판정 — 고객 연도 선택은 표지·에필로그 캔버스의 연달력에만 걸린다.
 */
export function scanYearGrids(
  canvases: ReadonlyArray<CanvasLike | null | undefined>,
  cal: Pick<CalendarProfile, 'coverCanvases' | 'canvasesPerMonth' | 'epilogueCanvases'> | null | undefined,
): YearGridScan {
  const out: YearGridScan = { any: false }
  canvases.forEach((cvs, index) => {
    const objects = typeof cvs?.getObjects === 'function' ? cvs.getObjects() : []
    for (const o of objects) {
      const obj = o as { extensionType?: unknown; extension?: { variant?: unknown; yearDelta?: unknown } } | null
      if (!obj || obj.extensionType !== CALENDAR_GRID_EXTENSION_TYPE || obj.extension?.variant !== 'year') continue
      out.any = true
      const slot = cal ? resolveCalendarCanvasSlot(cal, index) : null
      if (slot && (slot.role === 'cover' || slot.role === 'epilogue') && out[slot.role] === undefined) {
        const d = obj.extension.yearDelta
        out[slot.role] = Number.isInteger(d) ? (d as number) : 0
      }
    }
  })
  return out
}

/**
 * 관리자 그리드 스타일 입력(D1 최소 4종). 빈 값('') = 지정 안 함(키 생략 → 플러그인의 variant 별 기본값).
 * 연도 제목은 `style.showTitle`(템플릿의 제목 자리)만 쓴다 — `extension.show.yearTitle` 은 쓰지 않는다:
 * 플러그인이 `ext.show.yearTitle ?? ctx.show.yearTitle` 순으로 읽으므로 템플릿에 값이 있으면 고객 on/off 가 무력화된다.
 */
export interface GridStyleDraft {
  fontFamily: string
  headerLang: '' | 'en' | 'ko'
  showTitle: '' | 'on' | 'off'
  showLines: '' | 'on' | 'off'
}

export const EMPTY_GRID_STYLE_DRAFT: GridStyleDraft = { fontFamily: '', headerLang: '', showTitle: '', showLines: '' }

/** 입력값 → `CalendarGridStyle` 부분(지정한 키만). 지정한 키가 없으면 undefined */
export function gridStyleFromDraft(draft: GridStyleDraft): Pick<CalendarGridStyle, 'fontFamily' | 'headerLang' | 'showTitle' | 'showLines'> | undefined {
  const style: Pick<CalendarGridStyle, 'fontFamily' | 'headerLang' | 'showTitle' | 'showLines'> = {}
  if (draft.fontFamily !== '') style.fontFamily = draft.fontFamily
  if (draft.headerLang !== '') style.headerLang = draft.headerLang
  if (draft.showTitle !== '') style.showTitle = draft.showTitle === 'on'
  if (draft.showLines !== '') style.showLines = draft.showLines === 'on'
  return Object.keys(style).length > 0 ? style : undefined
}

// ─── 기념일 문구 스타일(D1(b) 최소: 색·굵게) ─────────────────────────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * 기념일 스타일 갱신 — 색(`fill`)·굵게(`fontWeight`)만 바꾸고 저장분의 다른 키(fontFamily 등)는 유지한다.
 * fill 은 '#rrggbb' 일 때만, null 이면 키 제거. bold false 면 fontWeight 키 제거. 결과가 비면 undefined.
 */
export function mergeAnniversaryStyle(
  base: CalendarAnniversaryStyle | undefined,
  fill: string | null,
  bold: boolean,
): CalendarAnniversaryStyle | undefined {
  const next: CalendarAnniversaryStyle = { ...(base ?? {}) }
  delete next.fill
  delete next.fontWeight
  if (fill !== null && HEX_COLOR_RE.test(fill)) next.fill = fill.toLowerCase()
  if (bold) next.fontWeight = 'bold'
  return Object.keys(next).length > 0 ? next : undefined
}
