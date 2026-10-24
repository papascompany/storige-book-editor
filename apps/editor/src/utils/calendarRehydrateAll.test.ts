import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  countDuplicateAnniversaries,
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

  it('show.temporaryHolidays: 저장분 boolean 은 그대로, 없으면 fallback 값, 둘 다 없으면 키 생략(= false) (2026-10-17)', () => {
    const base = { startYear: 2027, startMonth: 4, anniversaries: [] }
    expect(readCalendarSessionMeta({ calendar: { ...base, show: { holidays: true, lunar: false, solarTerms: false, temporaryHolidays: true } } }, fallback)?.show)
      .toEqual({ holidays: true, lunar: false, solarTerms: false, temporaryHolidays: true })
    expect(readCalendarSessionMeta({ calendar: { ...base, show: { holidays: true, lunar: false, solarTerms: false, temporaryHolidays: 'yes' } } }, fallback)?.show)
      .not.toHaveProperty('temporaryHolidays')
    expect(readCalendarSessionMeta({ calendar: { ...base, show: { holidays: true, lunar: false, solarTerms: false } } }, fallback)?.show)
      .not.toHaveProperty('temporaryHolidays')
    expect(readCalendarSessionMeta({ calendar: { ...base } }, { ...fallback, show: { ...fallback.show, temporaryHolidays: true } })?.show)
      .toEqual({ holidays: true, lunar: false, solarTerms: false, temporaryHolidays: true })
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

  it('캘린더 세트: setShow({ temporaryHolidays }) 가 저장 payload metadata.calendar.show 에 실린다 (2026-10-17)', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    expect(calendarSessionMetadataFields().metadata?.calendar.show).toEqual({ holidays: true, lunar: false, solarTerms: false })
    useCalendarStore.getState().setShow({ temporaryHolidays: true })
    expect(calendarSessionMetadataFields().metadata?.calendar.show).toEqual({ holidays: true, lunar: false, solarTerms: false, temporaryHolidays: true })
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

/**
 * T2 그리드·기념일 안전성 (2026-10-22): 복원은 **비파괴** — 같은 날짜 기념일(저장분·런처 입력)을 삭제하지 않고
 * 그대로 복원하고 console.warn 1회만 남긴다. 거부는 store add/update(편집 시점)에서만.
 */
describe('restoreCalendarSessionMeta — 같은 날짜 기념일 비파괴 복원', () => {
  const dupAnniversaries = [
    { id: 'a1', date: '2027-05-05', lunar: false, text: '어린이날' },
    { id: 'a2', date: '2027-05-05', lunar: false, text: '생일' },
    { id: 'a3', date: '2027-01-05', lunar: false, text: '양력' },
    // kr-2025-2035-v1: 음력 2026-11-28 = 양력 2027-01-05 (calendar/core.test 픽스처) → a3 와 중복
    { id: 'a4', date: '2026-11-28', lunar: true, text: '음력 생일' },
    { id: 'a5', date: '2027-03-01', lunar: false, text: '삼일절' },
  ]

  it('중복 입력 유지 + warn 1회: 같은 날짜 2쌍이 섞인 저장분을 모두(순서 그대로) 복원하고 console.warn 은 1번만 호출한다', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(restoreCalendarSessionMeta({ calendar: { ...savedMeta, anniversaries: dupAnniversaries } })).toBe(true)

    expect(useCalendarStore.getState().meta?.anniversaries).toEqual(dupAnniversaries)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('2건')
    // 복원된 중복은 저장 payload 에도 그대로 실린다(데이터 유실 없음)
    expect(calendarSessionMetadataFields().metadata?.calendar.anniversaries).toEqual(dupAnniversaries)
    warn.mockRestore()
  })

  it('중복이 없으면 warn 을 남기지 않는다', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(restoreCalendarSessionMeta({ calendar: savedMeta })).toBe(true)
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual(savedMeta.anniversaries)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('countDuplicateAnniversaries: 양력 환산 기준으로 앞선 항목과 겹치는 수, 데이터 없는 버전은 원문 동일만 센다', () => {
    expect(countDuplicateAnniversaries(dupAnniversaries, 'kr-2025-2035-v1')).toBe(2)
    expect(countDuplicateAnniversaries(savedMeta.anniversaries, 'kr-2025-2035-v1')).toBe(0)
    expect(countDuplicateAnniversaries([], 'kr-2025-2035-v1')).toBe(0)
    // 미지 버전: a4(음력) 는 환산 불가 → a3 와 겹치지 않음, a1/a2 만 1건
    expect(countDuplicateAnniversaries(dupAnniversaries, 'kr-unknown-v0')).toBe(1)
  })
})

/**
 * T3b 연달력 (2026-10-24): 판독기는 `show.yearTitle`(boolean)과 정책 허용 폭 안의 `yearDeltas` 를 보존한다.
 * 정책(`calendar.yearPolicy.select`)이 없으면 `yearDeltas` 는 버린다. 킬스위치는 판독·동봉 경로를 바꾸지 않는다.
 */
describe('readCalendarSessionMeta — 연달력 show.yearTitle·yearDeltas (T3b)', () => {
  const fallback: CalendarSessionMeta = {
    startYear: 2027,
    startMonth: 1,
    show: { holidays: true, lunar: false, solarTerms: false },
    anniversaries: [],
    dataVersion: 'kr-2025-2035-v1',
  }
  const policy = { select: { minDelta: 0, maxDelta: 1 } }
  const base = { startYear: 2027, startMonth: 4, anniversaries: [], dataVersion: 'kr-2025-2035-v1' }

  it('show.yearTitle: 저장분 boolean 은 그대로, 형식 불량은 fallback, 둘 다 없으면 키 생략(= 표시)', () => {
    const show = { holidays: true, lunar: false, solarTerms: false }
    expect(readCalendarSessionMeta({ calendar: { ...base, show: { ...show, yearTitle: false } } }, fallback)?.show).toEqual({ ...show, yearTitle: false })
    expect(readCalendarSessionMeta({ calendar: { ...base, show: { ...show, yearTitle: 'no' } } }, fallback)?.show).not.toHaveProperty('yearTitle')
    expect(readCalendarSessionMeta({ calendar: { ...base, show } }, { ...fallback, show: { ...show, yearTitle: false } })?.show).toEqual({ ...show, yearTitle: false })
  })

  it('yearDeltas: 정책 허용 폭 안 정수만 보존, 밖·비정수·문자열·NaN·거대값은 그 역할만 버린다', () => {
    const read = (yearDeltas: unknown) =>
      readCalendarSessionMeta({ calendar: { ...base, show: fallback.show, yearDeltas } }, fallback, policy)
    expect(read({ cover: 1, epilogue: 0 })?.yearDeltas).toEqual({ cover: 1, epilogue: 0 })
    expect(read({ cover: 1, epilogue: 2 })?.yearDeltas).toEqual({ cover: 1 })
    expect(read({ cover: 1e15, epilogue: Number.NaN })).not.toHaveProperty('yearDeltas')
    expect(read({ cover: '1', epilogue: 0.5 })).not.toHaveProperty('yearDeltas')
    expect(read({ cover: -1, month: 0 })).not.toHaveProperty('yearDeltas')
    expect(read([1, 0])).not.toHaveProperty('yearDeltas')
    expect(read('cover')).not.toHaveProperty('yearDeltas')
  })

  it('정책이 없거나 select 가 없으면 저장된 yearDeltas 를 버린다', () => {
    const meta = { calendar: { ...base, show: fallback.show, yearDeltas: { cover: 0 } } }
    expect(readCalendarSessionMeta(meta, fallback)).not.toHaveProperty('yearDeltas')
    expect(readCalendarSessionMeta(meta, fallback, { span: 'calendar-year' })).not.toHaveProperty('yearDeltas')
  })
})

describe('restoreCalendarSessionMeta — 연달력 보존·킬스위치 (T3b)', () => {
  function yearProfile(): ProductProfile {
    const p = calendarProfile()
    return { ...p, calendar: { ...p.calendar!, yearPolicy: { select: { minDelta: 0, maxDelta: 1 } } } }
  }
  const saved = {
    ...savedMeta,
    show: { ...savedMeta.show, yearTitle: false },
    yearDeltas: { cover: 1, epilogue: 0 },
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('프로파일 정책 기준으로 복원하고 저장 payload metadata.calendar 에 yearTitle·yearDeltas 가 그대로 실린다', () => {
    const profile = yearProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    expect(restoreCalendarSessionMeta({ calendar: { ...saved, yearDeltas: { cover: 1, epilogue: 9 } } })).toBe(true)
    expect(calendarSessionMetadataFields().metadata?.calendar).toEqual({ ...saved, yearDeltas: { cover: 1 } })
  })

  it("킬스위치(VITE_ENABLE_CALENDAR='false') — 플러그인이 없어 재합성 0 이어도 저장본의 yearTitle·yearDeltas 를 다음 저장에 보존", async () => {
    vi.stubEnv('VITE_ENABLE_CALENDAR', 'false')
    const profile = yearProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    useAppStore.setState({ allCanvas: [{ id: 'c0' }], allEditors: [{ getPlugin: () => undefined }] } as never)
    expect(restoreCalendarSessionMeta({ calendar: saved })).toBe(true)
    expect(await rehydrateAllCalendarGrids()).toBe(0)
    expect(useSaveStore.getState().isDirty).toBe(false)
    expect(calendarSessionMetadataFields().metadata?.calendar).toEqual(saved)
  })

  it('yearPolicy 를 지운 세트로 다시 열면 yearDeltas 는 다음 저장에서 빠진다(롤백 = 템플릿 값)', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    expect(restoreCalendarSessionMeta({ calendar: saved })).toBe(true)
    const cal = calendarSessionMetadataFields().metadata?.calendar
    expect(cal).not.toHaveProperty('yearDeltas')
    expect(cal?.show.yearTitle).toBe(false)
  })
})

describe('readCalendarSessionMeta — 잡절 show.minorTerms 재오픈 보존 (T4 v1.27)', () => {
  it('저장분 minorTerms boolean 은 재오픈 뒤 스토어·저장 payload 에 그대로, 형식 불량은 fallback, 둘 다 없으면 키 생략(= 끔)', () => {
    const profile = calendarProfile()
    useSettingsStore.getState().setProductProfile(profile)
    useCalendarStore.getState().setFromProfile(profile)
    const show = { holidays: true, lunar: false, solarTerms: false }
    expect(restoreCalendarSessionMeta({ calendar: { ...savedMeta, show: { ...show, minorTerms: true } } })).toBe(true)
    expect(useCalendarStore.getState().meta?.show.minorTerms).toBe(true)
    expect(calendarSessionMetadataFields().metadata?.calendar.show).toEqual({ ...show, minorTerms: true })

    const fallback = { ...savedMeta, show: { ...show, minorTerms: false } }
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, show: { ...show, minorTerms: 'on' } } }, fallback)?.show.minorTerms).toBe(false)
    expect(readCalendarSessionMeta({ calendar: { ...savedMeta, show } }, null)?.show).not.toHaveProperty('minorTerms')
  })
})
