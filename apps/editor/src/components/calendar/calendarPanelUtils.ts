import { resolveAnniversarySolarDate, type CalendarData } from '@storige/canvas-core'
import { addMonths, formatMonthKey, parseMonthKey, type CalendarAnniversary, type CalendarMonthRange, type YearMonth } from '@storige/types'

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
