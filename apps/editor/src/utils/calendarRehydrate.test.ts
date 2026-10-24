import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ProductProfile } from '@storige/types'
import type Editor from '@storige/canvas-core'
import type { CalendarRenderContext } from '@storige/canvas-core'
import type { fabric } from 'fabric'

const getCalendarDataMock = vi.fn<(version: string) => unknown>(() => null)
// getCalendarData 만 목 — 나머지(resolveAnniversarySolarDate 등)는 실물. T2(2026-10-22) 이후 useCalendarStore.addAnniversary 가
// 같은 날짜 거부 판정에 음력 환산을 쓰므로 전체 치환 목이면 아래 '정상' 케이스의 음력 기념일 추가가 터진다.
vi.mock('@storige/canvas-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@storige/canvas-core')>()),
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

describe('rehydrateCalendarGrids — 연달력 ctx.yearSpan·yearDelta (T3b)', () => {
  function yearProfile(yearPolicy: NonNullable<ProductProfile['calendar']>['yearPolicy']): ProductProfile {
    const p = calendarProfile()
    return { ...p, calendar: { ...p.calendar!, yearPolicy } }
  }

  it('yearSpan = 프로파일 yearPolicy.span(없으면 undefined), 표지(0)·에필로그(25)는 세션 yearDeltas[역할], 월 캔버스는 yearDelta 없음', async () => {
    getCalendarDataMock.mockReturnValue(fakeData)
    const profile = yearProfile({ span: 'start-span', select: { minDelta: -1, maxDelta: 1 } })
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    useCalendarStore.getState().setYearDelta('cover', 1)
    useCalendarStore.getState().setYearDelta('epilogue', -1)

    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 0)
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 25)
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 3)
    const ctxs = rehydrateMock.mock.calls.map((c) => c[0])
    expect(ctxs.map((c) => c.yearSpan)).toEqual(['start-span', 'start-span', 'start-span'])
    expect(ctxs[0].yearDelta).toBe(1)
    expect(ctxs[1].yearDelta).toBe(-1)
    expect(ctxs[2]).not.toHaveProperty('yearDelta')
  })

  it('yearPolicy 없음 → yearSpan undefined·yearDelta 없음(종전 ctx 와 같은 키)', async () => {
    getCalendarDataMock.mockReturnValue(fakeData)
    useSettingsStore.getState().setProductProfile(calendarProfile())
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 0)
    const ctx = rehydrateMock.mock.calls[0][0]
    expect(ctx.yearSpan).toBeUndefined()
    expect(ctx).not.toHaveProperty('yearDelta')
  })

  it.each([
    ['허용 폭 밖 2', 2],
    ['거대값 1e15', 1e15],
    ['NaN', Number.NaN],
    ['문자열 "1"', '1'],
    ['소수 0.5', 0.5],
  ] as const)('스토어에 직접 들어온 %s 는 ctx.yearDelta 로 넘기지 않는다(템플릿 값 사용)', async (_label, bad) => {
    getCalendarDataMock.mockReturnValue(fakeData)
    const profile = yearProfile({ select: { minDelta: 0, maxDelta: 1 } })
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    const meta = useCalendarStore.getState().meta!
    // 런처·PATCH 가 판독기를 우회해 스토어를 채운 경우를 가정
    useCalendarStore.setState({ meta: { ...meta, yearDeltas: { cover: bad as number } } })
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 0)
    expect(rehydrateMock.mock.calls[0][0]).not.toHaveProperty('yearDelta')
  })

  it('정책에 select 가 없으면 세션 값이 있어도 무시한다', async () => {
    getCalendarDataMock.mockReturnValue(fakeData)
    const profile = yearProfile({ span: 'calendar-year' })
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    const meta = useCalendarStore.getState().meta!
    useCalendarStore.setState({ meta: { ...meta, yearDeltas: { cover: 0 } } })
    await rehydrateCalendarGrids(makeEditor(true), fakeCanvas, 0)
    expect(rehydrateMock.mock.calls[0][0]).toMatchObject({ yearSpan: 'calendar-year' })
    expect(rehydrateMock.mock.calls[0][0]).not.toHaveProperty('yearDelta')
  })
})
