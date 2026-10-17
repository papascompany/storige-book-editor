import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useCalendarStore } from './useCalendarStore'

/**
 * P1 캘린더 (2026-10-17): 캘린더 세션 메타 스토어 — 프로파일 기본값·허용 범위·기념일 CRUD.
 */
function calendarProfile(over: Partial<NonNullable<ProductProfile['calendar']>> = {}): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 26, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout: 'desk',
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: true },
      dataVersion: 'kr-2025-2035-v1',
      ...over,
    },
    output: { mode: 'single-pdf' },
  }
}

beforeEach(() => {
  useCalendarStore.getState().reset()
})

describe('useCalendarStore — setFromProfile', () => {
  it('calendar 프로파일이면 시작연월=allowedRange.from, show·dataVersion 복사, 기념일 빈 배열', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    const meta = useCalendarStore.getState().meta
    expect(meta).toEqual({
      startYear: 2027,
      startMonth: 1,
      show: { holidays: true, lunar: false, solarTerms: true },
      anniversaries: [],
      dataVersion: 'kr-2025-2035-v1',
    })
    expect(useCalendarStore.getState().allowedRange).toEqual({ from: '2027-01', to: '2027-12' })
  })

  it('null 프로파일이면 meta·allowedRange 모두 null(legacy)', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    useCalendarStore.getState().setFromProfile(null)
    expect(useCalendarStore.getState().meta).toBeNull()
    expect(useCalendarStore.getState().allowedRange).toBeNull()
  })

  it('kind=sheet 프로파일(calendar 없음)이면 meta null', () => {
    const sheet: ProductProfile = { ...calendarProfile(), kind: 'sheet', calendar: undefined }
    useCalendarStore.getState().setFromProfile(sheet)
    expect(useCalendarStore.getState().meta).toBeNull()
  })
})

describe('useCalendarStore — setStartMonth', () => {
  it('allowedRange 안이면 true 반환·적용', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    expect(useCalendarStore.getState().setStartMonth(2027, 6)).toBe(true)
    expect(useCalendarStore.getState().meta?.startMonth).toBe(6)
  })

  it('allowedRange 밖이면 false 반환·변경 없음', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    expect(useCalendarStore.getState().setStartMonth(2028, 1)).toBe(false)
    expect(useCalendarStore.getState().setStartMonth(2026, 12)).toBe(false)
    expect(useCalendarStore.getState().meta).toMatchObject({ startYear: 2027, startMonth: 1 })
  })

  it('meta 없으면(legacy) false', () => {
    expect(useCalendarStore.getState().setStartMonth(2027, 1)).toBe(false)
  })
})

describe('useCalendarStore — show·기념일·restore', () => {
  it('setShow 는 부분 병합', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    useCalendarStore.getState().setShow({ lunar: true })
    expect(useCalendarStore.getState().meta?.show).toEqual({ holidays: true, lunar: true, solarTerms: true })
  })

  it('addAnniversary → updateAnniversary → removeAnniversary', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    const id = useCalendarStore.getState().addAnniversary({ date: '2027-03-05', lunar: false, text: '결혼기념일' })
    expect(id).toBeTruthy()
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(1)
    useCalendarStore.getState().updateAnniversary(id as string, { text: '기념일' })
    expect(useCalendarStore.getState().meta?.anniversaries[0]).toMatchObject({ id, text: '기념일', lunar: false })
    useCalendarStore.getState().removeAnniversary(id as string)
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual([])
  })

  it('meta 없으면 addAnniversary 는 null', () => {
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-03-05', lunar: false, text: 'x' })).toBeNull()
  })

  it('restore 는 저장 메타를 복사해 들어오고 allowedRange 는 유지', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    const saved = {
      startYear: 2027,
      startMonth: 4,
      show: { holidays: false, lunar: true, solarTerms: false },
      anniversaries: [{ id: 'a1', date: '2027-05-05', lunar: true, text: '생일' }],
      dataVersion: 'kr-2025-2035-v1',
    }
    useCalendarStore.getState().restore(saved)
    expect(useCalendarStore.getState().meta).toEqual(saved)
    expect(useCalendarStore.getState().meta).not.toBe(saved)
    expect(useCalendarStore.getState().allowedRange).toEqual({ from: '2027-01', to: '2027-12' })
  })
})

describe('restore — 허용 범위 재검증', () => {
  it('저장된 시작연월이 프로파일 허용 범위 밖이면 시작연월만 프로파일 기본값으로 두고 나머지는 복원한다', () => {
    const profile = {
      version: 1, kind: 'calendar', editorType: 'calendar_desk',
      pages: { kind: 'fixed', count: 26, labelRule: 'month' },
      sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
      calendar: { layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1, allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0, show: { holidays: true, lunar: true, solarTerms: true }, dataVersion: 'kr-2025-2035-v1' },
      output: { mode: 'single-pdf' },
    } as unknown as import('@storige/types').ProductProfile
    useCalendarStore.getState().setFromProfile(profile)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useCalendarStore.getState().restore({ startYear: 2026, startMonth: 3, show: { holidays: false, lunar: false, solarTerms: false }, anniversaries: [{ id: 'a', date: '2026-03-01', lunar: false, text: '삼일절' }], dataVersion: 'kr-2025-2035-v1' })
    const meta = useCalendarStore.getState().meta
    expect(meta?.startYear).toBe(2027)
    expect(meta?.startMonth).toBe(1)
    expect(meta?.show.holidays).toBe(false)
    expect(meta?.anniversaries).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  it('허용 범위 안이면 그대로 복원한다', () => {
    useCalendarStore.getState().restore({ startYear: 2027, startMonth: 6, show: { holidays: true, lunar: true, solarTerms: true }, anniversaries: [], dataVersion: 'kr-2025-2035-v1' })
    expect(useCalendarStore.getState().meta?.startMonth).toBe(6)
  })
})
