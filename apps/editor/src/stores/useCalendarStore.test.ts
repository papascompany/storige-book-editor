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

/**
 * T2 그리드·기념일 안전성 (2026-10-22): 같은 날짜(양력 환산 기준) 기념일 거부를 store 경계로 확장.
 * 음력 환산 픽스처는 calendar/core.test 가 고정한 값(kr-2025-2035-v1: 음력 2026-11-28 = 양력 2027-01-05).
 */
describe('useCalendarStore — 같은 날짜 기념일 거부 (add/update)', () => {
  beforeEach(() => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
  })

  it('addAnniversary: 같은 양력 날짜가 있으면 null·추가하지 않음, 다른 날짜는 추가(문구가 같아도 날짜가 다르면 허용)', () => {
    const first = useCalendarStore.getState().addAnniversary({ date: '2027-03-05', lunar: false, text: '결혼기념일' })
    expect(first).toBeTruthy()
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-03-05', lunar: false, text: '다른 문구' })).toBeNull()
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(1)
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-03-06', lunar: false, text: '결혼기념일' })).toBeTruthy()
    expect(useCalendarStore.getState().meta?.anniversaries.map((a) => a.date)).toEqual(['2027-03-05', '2027-03-06'])
  })

  it('updateAnniversary: 다른 기념일과 같은 날짜로 바꾸면 false·변경 없음, 자기 날짜 유지(문구만)·빈 날짜로 이동은 true', () => {
    const a = useCalendarStore.getState().addAnniversary({ date: '2027-03-05', lunar: false, text: 'A' }) as string
    const b = useCalendarStore.getState().addAnniversary({ date: '2027-03-06', lunar: false, text: 'B' }) as string
    const before = useCalendarStore.getState().meta

    expect(useCalendarStore.getState().updateAnniversary(b, { date: '2027-03-05' })).toBe(false)
    expect(useCalendarStore.getState().meta).toBe(before)

    expect(useCalendarStore.getState().updateAnniversary(b, { text: 'B2' })).toBe(true)
    expect(useCalendarStore.getState().meta?.anniversaries[1]).toMatchObject({ id: b, date: '2027-03-06', text: 'B2' })

    expect(useCalendarStore.getState().updateAnniversary(a, { date: '2027-03-07', text: 'A2' })).toBe(true)
    expect(useCalendarStore.getState().meta?.anniversaries[0]).toMatchObject({ id: a, date: '2027-03-07', text: 'A2', lunar: false })

    expect(useCalendarStore.getState().updateAnniversary('없는-id', { text: 'x' })).toBe(false)
  })

  it('음력 기념일은 양력 환산 기준으로 중복 판정 — 양력 2027-01-05 ↔ 음력 2026-11-28 양방향 거부', () => {
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-01-05', lunar: false, text: '양력' })).toBeTruthy()
    expect(useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, text: '음력 생일' })).toBeNull()
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(1)

    useCalendarStore.getState().reset()
    useCalendarStore.getState().setFromProfile(calendarProfile())
    const lunarId = useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, text: '음력 생일' }) as string
    expect(lunarId).toBeTruthy()
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-01-05', lunar: false, text: '양력' })).toBeNull()
    // 다른 양력일(2027-01-06) 추가는 허용. 음력 항목을 2026-11-29(= 양력 2027-01-06)로 옮기면 환산 충돌로 false,
    // 2026-11-27(= 2027-01-04)로 옮기면 true — 그 뒤 비워진 음력 2026-11-28 재추가는 허용(충돌 없음)
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-01-06', lunar: false, text: '다음날' })).toBeTruthy()
    expect(useCalendarStore.getState().updateAnniversary(lunarId, { date: '2026-11-29' })).toBe(false)
    expect(useCalendarStore.getState().updateAnniversary(lunarId, { date: '2026-11-27' })).toBe(true)
    expect(useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, text: '다시' })).toBeTruthy()
    expect(useCalendarStore.getState().meta?.anniversaries.map((a) => a.date)).toEqual(['2026-11-27', '2027-01-06', '2026-11-28'])
  })

  it('날짜 데이터가 없는 dataVersion 이면 음력은 환산 불가 — 원문(date·lunar·윤달)이 같을 때만 중복', () => {
    useCalendarStore.getState().reset()
    useCalendarStore.getState().setFromProfile(calendarProfile({ dataVersion: 'kr-unknown-v0' }))
    expect(useCalendarStore.getState().addAnniversary({ date: '2027-01-05', lunar: false, text: '양력' })).toBeTruthy()
    // 환산 불가 → 양력 2027-01-05 와 충돌로 보지 않는다(데이터 부재는 거부 사유가 아니다)
    expect(useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, text: '음력' })).toBeTruthy()
    expect(useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, text: '같은 음력' })).toBeNull()
    expect(useCalendarStore.getState().addAnniversary({ date: '2026-11-28', lunar: true, isLeapMonth: true, text: '윤달' })).toBeTruthy()
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(3)
  })

  it('meta 없으면(legacy) updateAnniversary 는 false', () => {
    useCalendarStore.getState().reset()
    expect(useCalendarStore.getState().updateAnniversary('a', { text: 'x' })).toBe(false)
  })

  it('restore 는 비파괴 — 같은 날짜 기념일이 들어와도 검사·삭제하지 않고 그대로 복원한다', () => {
    const saved = {
      startYear: 2027,
      startMonth: 1,
      show: { holidays: true, lunar: false, solarTerms: true },
      anniversaries: [
        { id: 'd1', date: '2027-05-05', lunar: false, text: '어린이날' },
        { id: 'd2', date: '2027-05-05', lunar: false, text: '생일' },
      ],
      dataVersion: 'kr-2025-2035-v1',
    }
    useCalendarStore.getState().restore(saved)
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual(saved.anniversaries)
  })
})
