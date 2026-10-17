import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import {
  isStartMonthAllowed,
  parseMonthKey,
  type CalendarAnniversary,
  type CalendarDisplayOptions,
  type CalendarMonthRange,
  type CalendarSessionMeta,
  type ProductProfile,
  formatMonthKey,
} from '@storige/types'

/**
 * useCalendarStore — 캘린더 세션 메타(`edit_sessions.metadata.calendar`) 순수 상태 (P1 캘린더, 2026-10-17)
 *
 * - 템플릿셋 `productProfile.kind==='calendar'` 일 때만 `meta` 가 채워진다(legacy 세트는 null).
 * - UI·fabric 호출 없음. 그리드 재합성은 `utils/calendarRehydrate` 가 이 스토어를 읽어 수행한다.
 * - `setStartMonth` 는 프로파일 `allowedRange` 밖이면 false 를 반환하고 상태를 바꾸지 않는다.
 */

export interface CalendarStoreState {
  /** null = 캘린더 상품이 아님(legacy) */
  meta: CalendarSessionMeta | null
  /** 시작연월 허용 범위(프로파일 사본) — setStartMonth 판정용 */
  allowedRange: CalendarMonthRange | null

  /** 프로파일로 기본 메타 구성(시작연월 = allowedRange.from). calendar 없는 프로파일/null → reset */
  setFromProfile: (profile: ProductProfile | null | undefined) => void
  /** 저장된 세션 메타 복원(프로파일 적용 뒤 호출) */
  restore: (meta: CalendarSessionMeta) => void
  /** @returns allowedRange 안이면 true(적용), 밖이거나 meta 없음이면 false(변경 없음) */
  setStartMonth: (year: number, month: number) => boolean
  setShow: (partial: Partial<CalendarDisplayOptions>) => void
  /** @returns 추가된 기념일 id (meta 없으면 null) */
  addAnniversary: (input: Omit<CalendarAnniversary, 'id'> & { id?: string }) => string | null
  updateAnniversary: (id: string, patch: Partial<Omit<CalendarAnniversary, 'id'>>) => void
  removeAnniversary: (id: string) => void
  /** 날짜칸 더블클릭으로 열 날짜('YYYY-MM-DD') — FeatureSidebar 가 세팅, CalendarPanel 이 소비 후 null */
  pendingDate: string | null
  setPendingDate: (date: string | null) => void
  reset: () => void
}

function cloneMeta(meta: CalendarSessionMeta): CalendarSessionMeta {
  return {
    startYear: meta.startYear,
    startMonth: meta.startMonth,
    show: { ...meta.show },
    anniversaries: Array.isArray(meta.anniversaries) ? meta.anniversaries.map((a) => ({ ...a })) : [],
    dataVersion: meta.dataVersion,
  }
}

export const useCalendarStore = create<CalendarStoreState>((set, get) => ({
  meta: null,
  allowedRange: null,
  pendingDate: null,
  setPendingDate: (date) => set({ pendingDate: date }),

  setFromProfile: (profile) => {
    const cal = profile?.kind === 'calendar' ? profile.calendar : undefined
    if (!cal) {
      set({ meta: null, allowedRange: null })
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

  addAnniversary: (input) => {
    const { meta } = get()
    if (!meta) return null
    const id = input.id ?? uuid()
    const item: CalendarAnniversary = { ...input, id }
    set({ meta: { ...meta, anniversaries: [...meta.anniversaries, item] } })
    return id
  },

  updateAnniversary: (id, patch) => {
    const { meta } = get()
    if (!meta) return
    set({
      meta: {
        ...meta,
        anniversaries: meta.anniversaries.map((a) => (a.id === id ? { ...a, ...patch, id } : a)),
      },
    })
  },

  removeAnniversary: (id) => {
    const { meta } = get()
    if (!meta) return
    set({ meta: { ...meta, anniversaries: meta.anniversaries.filter((a) => a.id !== id) } })
  },

  reset: () => set({ meta: null, allowedRange: null, pendingDate: null }),
}))
