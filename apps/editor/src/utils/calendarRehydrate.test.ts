import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ProductProfile } from '@storige/types'
import type Editor from '@storige/canvas-core'
import type { CalendarRenderContext } from '@storige/canvas-core'
import type { fabric } from 'fabric'

const getCalendarDataMock = vi.fn<(version: string) => unknown>(() => null)
vi.mock('@storige/canvas-core', () => ({
  getCalendarData: (v: string) => getCalendarDataMock(v),
}))

import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { rehydrateCalendarGrids } from './calendarRehydrate'

/**
 * P1 캘린더 (2026-10-17): 복원 직후 그리드 재합성 헬퍼.
 * - legacy(프로파일 null) → 플러그인·데이터 조회 없이 0
 * - 플러그인 없음 → 0, 데이터 없음 → warn 1줄 + 0
 * - 정상 → ctx(시작연월·캔버스 월·show·기념일) 구성 후 plugin.rehydrate
 * - rehydrate 예외 → warn + 0(진입 차단 금지)
 */
function calendarProfile(): ProductProfile {
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
      weekStart: 1,
      show: { holidays: true, lunar: false, solarTerms: false },
      dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  }
}

const rehydrateMock = vi.fn<(ctx: CalendarRenderContext) => Promise<number>>(async () => 3)
function makeEditor(withPlugin: boolean): Editor {
  return {
    getPlugin: vi.fn((name: string) => (withPlugin && name === 'CalendarPlugin' ? { rehydrate: rehydrateMock } : undefined)),
  } as unknown as Editor
}
const fakeCanvas = {} as fabric.Canvas
const fakeData = { version: 'kr-2025-2035-v1', range: { from: '2025-01', to: '2035-12' }, holidays: {}, solarTerms: {}, lunarYears: {} }

beforeEach(() => {
  useSettingsStore.getState().setProductProfile(null)
  useCalendarStore.getState().reset()
  getCalendarDataMock.mockReset().mockReturnValue(null)
  rehydrateMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rehydrateCalendarGrids', () => {
  it('프로파일 null(legacy) → 0, 플러그인·데이터 조회 없음', async () => {
    const editor = makeEditor(true)
    expect(await rehydrateCalendarGrids(editor, fakeCanvas, 1)).toBe(0)
    expect(editor.getPlugin).not.toHaveBeenCalled()
    expect(getCalendarDataMock).not.toHaveBeenCalled()
  })

  it('CalendarPlugin 미등록 → 0', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile())
    expect(await rehydrateCalendarGrids(makeEditor(false), fakeCanvas, 1)).toBe(0)
    expect(getCalendarDataMock).not.toHaveBeenCalled()
  })

  it('날짜 데이터 null → warn 1줄 + 0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useSettingsStore.getState().setProductProfile(calendarProfile())
    expect(await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 1)).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(rehydrateMock).not.toHaveBeenCalled()
  })

  it('정상: 세션 메타(2027-03, lunar on, 기념일 1건)로 ctx 구성 → plugin.rehydrate 결과 반환', async () => {
    getCalendarDataMock.mockReturnValue(fakeData)
    useSettingsStore.getState().setProductProfile(calendarProfile())
    useCalendarStore.getState().setFromProfile(calendarProfile())
    useCalendarStore.getState().setStartMonth(2027, 3)
    useCalendarStore.getState().setShow({ lunar: true })
    useCalendarStore.getState().addAnniversary({ id: 'a1', date: '2027-05-05', lunar: true, text: '생일', style: { fill: '#f00' } })

    expect(await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 3)).toBe(3)
    expect(getCalendarDataMock).toHaveBeenCalledWith('kr-2025-2035-v1')
    expect(rehydrateMock).toHaveBeenCalledTimes(1)
    expect(rehydrateMock.mock.calls[0][0]).toEqual({
      startYear: 2027,
      startMonth: 3,
      canvasMonthOffset: 1,
      weekStart: 1,
      show: { holidays: true, lunar: true, solarTerms: false },
      anniversaries: [{ date: '2027-05-05', lunar: true, isLeapMonth: undefined, text: '생일' }],
      data: fakeData,
    })
  })

  it('표지 캔버스(0)·에필로그(25)는 canvasMonthOffset null', async () => {
    getCalendarDataMock.mockReturnValue(fakeData)
    useSettingsStore.getState().setProductProfile(calendarProfile())
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 0)
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 25)
    expect(rehydrateMock.mock.calls.map((c) => c[0].canvasMonthOffset)).toEqual([null, null])
    // 세션 메타 없음 → allowedRange.from(2027-01) 시작
    expect(rehydrateMock.mock.calls[0][0]).toMatchObject({ startYear: 2027, startMonth: 1, anniversaries: [] })
  })

  it('plugin.rehydrate 예외 → warn + 0(진입 차단 금지)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getCalendarDataMock.mockReturnValue(fakeData)
    rehydrateMock.mockRejectedValueOnce(new Error('boom'))
    useSettingsStore.getState().setProductProfile(calendarProfile())
    expect(await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 1)).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
