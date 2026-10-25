import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import {
  isCalendarYearDeltaAllowed,
  isStartMonthAllowed,
  parseMonthKey,
  type CalendarAnniversary,
  type CalendarDisplayOptions,
  type CalendarMonthRange,
  type CalendarSessionMeta,
  type CalendarYearDeltas,
  type CalendarYearPolicy,
  type ProductProfile,
  formatMonthKey,
} from '@storige/types'
import { getCalendarData } from '@storige/canvas-core'
import { findDuplicateAnniversary } from '@/components/calendar/calendarPanelUtils'

/**
 * useCalendarStore — 캘린더 세션 메타(`edit_sessions.metadata.calendar`) 순수 상태 (P1 캘린더, 2026-10-17)
 *
 * - 템플릿셋 `productProfile.kind==='calendar'` 일 때만 `meta` 가 채워진다(legacy 세트는 null).
 * - UI·fabric 호출 없음. 그리드 재합성은 `utils/calendarRehydrate` 가 이 스토어를 읽어 수행한다.
 * - `setStartMonth` 는 프로파일 `allowedRange` 밖이면 false 를 반환하고 상태를 바꾸지 않는다.
 * - T2 그리드·기념일 안전성(2026-10-22): `addAnniversary`/`updateAnniversary` 는 같은 날짜(양력 환산 기준,
 *   `calendarPanelUtils.findDuplicateAnniversary` 와 같은 판정)의 기념일이 이미 있으면 거부한다(null/false, 변경 없음).
 *   `restore` 는 비파괴 — 저장분·런처 입력의 중복은 검사·삭제하지 않는다(경고는 `calendarRehydrateAll` 이 1회).
 * - T3b 연달력(2026-10-24): `yearDeltas`(표지·에필로그 연달력 연도, 시작연도 기준 상대값)는 프로파일
 *   `calendar.yearPolicy.select` 허용 폭 안의 정수만 기록한다(`setYearDelta`). 정책·select 가 없으면 기록하지 않는다.
 *   값이 하나도 없으면 키를 두지 않는다 — 연도를 고르지 않은 세션의 저장 payload 키 집합은 종전과 같다.
 */

/** 연달력 연도를 고를 수 있는 캔버스 역할 */
export type CalendarYearRole = keyof CalendarYearDeltas

export interface CalendarStoreState {
  /** null = 캘린더 상품이 아님(legacy) */
  meta: CalendarSessionMeta | null
  /** 시작연월 허용 범위(프로파일 사본) — setStartMonth 판정용 */
  allowedRange: CalendarMonthRange | null
  /** 연달력 정책(프로파일 사본) — setYearDelta 판정용. 프로파일에 없으면 null */
  yearPolicy: CalendarYearPolicy | null

  /** 프로파일로 기본 메타 구성(시작연월 = allowedRange.from). calendar 없는 프로파일/null → reset */
  setFromProfile: (profile: ProductProfile | null | undefined) => void
  /** 저장된 세션 메타 복원(프로파일 적용 뒤 호출) */
  restore: (meta: CalendarSessionMeta) => void
  /** @returns allowedRange 안이면 true(적용), 밖이거나 meta 없음이면 false(변경 없음) */
  setStartMonth: (year: number, month: number) => boolean
  setShow: (partial: Partial<CalendarDisplayOptions>) => void
  /**
   * 표지·에필로그 연달력 연도 선택. `null` = 선택 해제(템플릿 값 사용).
   * @returns 적용했으면 true. meta 없음·정책 select 없음·허용 폭 밖/비정수면 false(변경 없음)
   */
  setYearDelta: (role: CalendarYearRole, delta: number | null) => boolean
  /** @returns 추가된 기념일 id. meta 없음(legacy) 또는 같은 날짜(양력 환산) 기념일이 이미 있으면 null(추가하지 않음) */
  addAnniversary: (input: Omit<CalendarAnniversary, 'id'> & { id?: string }) => string | null
  /** @returns 갱신했으면 true. meta 없음·해당 id 없음·갱신 결과가 다른 기념일과 같은 날짜면 false(변경 없음) */
  updateAnniversary: (id: string, patch: Partial<Omit<CalendarAnniversary, 'id'>>) => boolean
  removeAnniversary: (id: string) => void
  /**
   * 적용한 캘린더 디자인(스킨) key 기록. undefined = 기본 디자인(키 제거). 형식 검사는 판독기(readCalendarSessionMeta)와
   * 적용 경로가 맡는다. meta 없음(legacy)이면 아무것도 하지 않는다.
   */
  setSkinKey: (key?: string) => void
  /** 날짜칸 더블클릭으로 열 날짜('YYYY-MM-DD') — FeatureSidebar 가 세팅, CalendarPanel 이 소비 후 null */
  pendingDate: string | null
  setPendingDate: (date: string | null) => void
  reset: () => void
}

function cloneMeta(meta: CalendarSessionMeta): CalendarSessionMeta {
  const out: CalendarSessionMeta = {
    startYear: meta.startYear,
    startMonth: meta.startMonth,
    show: { ...meta.show },
    anniversaries: Array.isArray(meta.anniversaries) ? meta.anniversaries.map((a) => ({ ...a })) : [],
    dataVersion: meta.dataVersion,
  }
  // yearDeltas 는 있을 때만 복사(없는 세션의 키 집합 불변). 정책 필터는 판독기(readCalendarSessionMeta)가 맡는다
  if (meta.yearDeltas && Object.keys(meta.yearDeltas).length > 0) out.yearDeltas = { ...meta.yearDeltas }
  // skinKey 도 있을 때만(스킨을 고르지 않은 세션의 키 집합 불변)
  if (typeof meta.skinKey === 'string' && meta.skinKey.length > 0) out.skinKey = meta.skinKey
  return out
}

export const useCalendarStore = create<CalendarStoreState>((set, get) => ({
  meta: null,
  allowedRange: null,
  yearPolicy: null,
  pendingDate: null,
  setPendingDate: (date) => set({ pendingDate: date }),

  setFromProfile: (profile) => {
    const cal = profile?.kind === 'calendar' ? profile.calendar : undefined
    if (!cal) {
      set({ meta: null, allowedRange: null, yearPolicy: null })
      return
    }
    // allowedRange.from 은 validateProductProfile 이 'YYYY-MM' 을 보장하지만 방어적으로 오늘 달로 폴백
    const from = parseMonthKey(cal.allowedRange.from)
    const now = new Date()
    set({
      meta: {
        startYear: from ? from.year : now.getFullYear(),
        startMonth: from ? from.month : now.getMonth() + 1,
        show: { ...cal.show },
        anniversaries: [],
        dataVersion: cal.dataVersion,
      },
      allowedRange: { from: cal.allowedRange.from, to: cal.allowedRange.to },
      yearPolicy: cal.yearPolicy ?? null,
    })
  },

  restore: (meta) => {
    // 프로파일 허용 범위를 좁힌 뒤 옛 세션을 열면 범위 밖 시작연월이 들어올 수 있다 — setStartMonth 와 같은 판정으로
    // 범위 밖이면 시작연월만 프로파일 기본값(현재 meta)으로 두고 나머지(표기 옵션·기념일)는 복원한다.
    const range = get().allowedRange
    const current = get().meta
    const key = formatMonthKey({ year: meta.startYear, month: meta.startMonth })
    const outOfRange = !!range && (key < range.from || key > range.to)
    const restored = cloneMeta(meta)
    if (outOfRange && current) {
      console.warn(`[calendar] 저장된 시작연월 ${key} 이 허용 범위 ${range?.from}~${range?.to} 밖 — 프로파일 기본 ${current.startYear}-${current.startMonth} 유지`)
      restored.startYear = current.startYear
      restored.startMonth = current.startMonth
    }
    set({ meta: restored })
  },

  setStartMonth: (year, month) => {
    const { meta, allowedRange } = get()
    if (!meta) return false
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return false
    if (allowedRange && !isStartMonthAllowed({ allowedRange }, { year, month })) return false
    set({ meta: { ...meta, startYear: year, startMonth: month } })
    return true
  },

  setShow: (partial) => {
    const { meta } = get()
    if (!meta) return
    set({ meta: { ...meta, show: { ...meta.show, ...partial } } })
  },

  setYearDelta: (role, delta) => {
    const { meta, yearPolicy } = get()
    if (!meta) return false
    if (role !== 'cover' && role !== 'epilogue') return false
    // 정책에 select 가 없으면 고객 연도 선택 자체가 없다 — 해제(null)도 기록하지 않는다
    if (!yearPolicy?.select) return false
    const next: CalendarYearDeltas = { ...(meta.yearDeltas ?? {}) }
    if (delta === null) {
      delete next[role]
    } else {
      if (!isCalendarYearDeltaAllowed(yearPolicy, delta)) return false
      next[role] = delta
    }
    const updated: CalendarSessionMeta = { ...meta }
    if (Object.keys(next).length > 0) updated.yearDeltas = next
    else delete updated.yearDeltas
    set({ meta: updated })
    return true
  },

  addAnniversary: (input) => {
    const { meta } = get()
    if (!meta) return null
    // 같은 날짜 거부 — 데이터 버전을 모르면(getCalendarData null) 음력은 환산 불가라 원문(date·lunar·윤달) 동일만 중복으로 본다
    if (findDuplicateAnniversary(meta.anniversaries, input, getCalendarData(meta.dataVersion))) return null
    const id = input.id ?? uuid()
    const item: CalendarAnniversary = { ...input, id }
    set({ meta: { ...meta, anniversaries: [...meta.anniversaries, item] } })
    return id
  },

  updateAnniversary: (id, patch) => {
    const { meta } = get()
    if (!meta) return false
    const current = meta.anniversaries.find((a) => a.id === id)
    if (!current) return false
    const next: CalendarAnniversary = { ...current, ...patch, id }
    // 자기 자신(excludeId)은 제외 — 문구만 바꾸는 갱신은 통과
    if (findDuplicateAnniversary(meta.anniversaries, next, getCalendarData(meta.dataVersion), id)) return false
    set({
      meta: {
        ...meta,
        anniversaries: meta.anniversaries.map((a) => (a.id === id ? next : a)),
      },
    })
    return true
  },

  removeAnniversary: (id) => {
    const { meta } = get()
    if (!meta) return
    set({ meta: { ...meta, anniversaries: meta.anniversaries.filter((a) => a.id !== id) } })
  },

  setSkinKey: (key) => {
    const { meta } = get()
    if (!meta) return
    const updated: CalendarSessionMeta = { ...meta }
    if (typeof key === 'string' && key.length > 0) updated.skinKey = key
    else delete updated.skinKey
    set({ meta: updated })
  },

  reset: () => set({ meta: null, allowedRange: null, yearPolicy: null, pendingDate: null }),
}))
