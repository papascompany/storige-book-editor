import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CalendarSessionMeta, ProductProfile } from '@storige/types'

const rehydrateOne = vi.fn<(editor: unknown, canvas: unknown, index: number) => Promise<number>>(async () => 0)
vi.mock('@/utils/calendarRehydrate', () => ({
  rehydrateCalendarGrids: (e: unknown, c: unknown, i: number) => rehydrateOne(e, c, i),
}))

import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import {
  calendarSessionMetadataFields,
  readCalendarSessionMeta,
  rehydrateAllCalendarGrids,
  restoreCalendarSessionMeta,
} from './calendarRehydrateAll'

/**
 * P1-d 캘린더 (2026-10-17): 전 캔버스 그리드 재합성 + dirty 마킹, 세션 metadata.calendar 판독/복원/동봉.
 * NULL 프로파일(legacy)이면 모두 no-op({}·0·false).
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
      weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: false },
      dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  }
}

const savedMeta: CalendarSessionMeta = {
  startYear: 2027,
  startMonth: 4,
  show: { holidays: false, lunar: true, solarTerms: true },
  anniversaries: [{ id: 'a1', date: '2027-05-05', lunar: false, text: '생일' }],
  dataVersion: 'kr-2025-2035-v1',
}

beforeEach(() => {
  rehydrateOne.mockReset().mockResolvedValue(0)
  useSettingsStore.getState().setProductProfile(null)
  useCalendarStore.getState().reset()
  useSaveStore.setState({ isDirty: false } as never)
  useAppStore.setState({ allCanvas: [], allEditors: [] } as never)
})

describe('rehydrateAllCalendarGrids', () => {
  it('프로파일 null(legacy) → 0, 캔버스 순회·dirty 마킹 없음', async () => {
    useAppStore.setState({ allCanvas: [{ id: 'c0' }], allEditors: [{ id: 'e0' }] } as never)
    expect(await rehydrateAllCalendarGrids()).toBe(0)
    expect(rehydrateOne).not.toHaveBeenCalled()
    expect(useSaveStore.getState().isDirty).toBe(false)
  })

  it('캘린더 세트: 모든 캔버스를 index 순으로 호출하고 합계 반환 + dirty 마킹 1회', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile())
    const canvases = [{ id: 'c0' }, { id: 'c1' }, { id: 'c2' }]
    const editors = [{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }]
    useAppStore.setState({ allCanvas: canvases, allEditors: editors } as never)
    rehydrateOne.mockResolvedValueOnce(0).mockResolvedValueOnce(2).mockResolvedValueOnce(1)

    expect(await rehydrateAllCalendarGrids()).toBe(3)
    expect(rehydrateOne.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [editors[0], canvases[0], 0],
      [editors[1], canvases[1], 1],
      [editors[2], canvases[2], 2],
    ])
    expect(useSaveStore.getState().isDirty).toBe(true)
  })

  it('다시 그린 그리드가 0개면 dirty 마킹하지 않는다', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile())
    useAppStore.setState({ allCanvas: [{ id: 'c0' }], allEditors: [{ id: 'e0' }] } as never)
    expect(await rehydrateAllCalendarGrids()).toBe(0)
    expect(useSaveStore.getState().isDirty).toBe(false)
  })
})

describe('readCalendarSessionMeta', () => {
  const fallback = {
    startYear: 2027,
    startMonth: 1,
    show: { holidays: true, lunar: false, solarTerms: false },
    anniversaries: [],
    dataVersion: 'kr-2025-2035-v1',
  }

  it('정상 메타는 그대로(기념일 style·isLeapMonth 보존)', () => {
    const meta = {
      ...savedMeta,
      anniversaries: [{ id: 'a1', date: '2027-01-01', lunar: true, isLeapMonth: false, text: '설', style: { fill: '#f00' } }],
    }
    expect(readCalendarSessionMeta({ calendar: meta, other: 1 }, fallback)).toEqual(meta)
  })

  it('startYear/startMonth 비정수·월 범위 밖·anniversaries 비배열·calendar 없음 → null', () => {
    expect(readCalendarSessionMeta(null, fallback)).toBeNull()
    expect(readCalendarSessionMeta({}, fallback)).toBeNull()
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, startYear: '2027' } }, fallback)).toBeNull()
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, startMonth: 13 } }, fallback)).toBeNull()
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, startMonth: 0 } }, fallback)).toBeNull()
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, anniversaries: null } }, fallback)).toBeNull()
  })

  it('show·dataVersion 누락은 fallback 으로 채우고, 형식 불량 기념일은 버린다', () => {
    const result = readCalendarSessionMeta(
      {
        calendar: {
          startYear: 2028,
          startMonth: 2,
          anniversaries: [
            { id: 'ok', date: '2028-03-01', lunar: false, text: '삼일절' },
            { id: '', date: '2028-03-02', lunar: false, text: 'no-id' },
            { id: 'bad-date', date: '2028/03/02', lunar: false, text: 'x' },
            { id: 'no-text', date: '2028-03-03', lunar: false },
            'nope',
          ],
        },
      },
      fallback,
    )
    expect(result).toEqual({
      startYear: 2028,
      startMonth: 2,
      show: fallback.show,
      anniversaries: [{ id: 'ok', date: '2028-03-01', lunar: false, text: '삼일절' }],
      dataVersion: 'kr-2025-2035-v1',
    })
  })
})

describe('restoreCalendarSessionMeta / calendarSessionMetadataFields', () => {
  it('프로파일 null: restore false·store 불변, fields {}', () => {
    expect(restoreCalendarSessionMeta({ calendar: savedMeta })).toBe(false)
    expect(useCalendarStore.getState().meta).toBeNull()
    expect(calendarSessionMetadataFields()).toEqual({})
  })

  it('캘린더 세트: 유효 메타는 restore 로 스토어 교체, fields 는 { metadata: { productProfile, calendar } }', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    expect(restoreCalendarSessionMeta({ calendar: savedMeta })).toBe(true)
    expect(useCalendarStore.getState().meta).toEqual(savedMeta)
    expect(calendarSessionMetadataFields()).toEqual({ metadata: { productProfile: profile, calendar: savedMeta } })
  })

  it('캘린더 세트: 메타 없음/무효면 setFromProfile 기본값 유지', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    expect(restoreCalendarSessionMeta(null)).toBe(false)
    expect(restoreCalendarSessionMeta({ calendar: { startYear: 2027 } })).toBe(false)
    expect(useCalendarStore.getState().meta).toMatchObject({ startYear: 2027, startMonth: 1, anniversaries: [] })
  })
})
