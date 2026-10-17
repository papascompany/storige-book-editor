import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'

const { rehydrateAll, getCalendarDataMock } = vi.hoisted(() => ({
  rehydrateAll: vi.fn(async () => 1),
  getCalendarDataMock: vi.fn<(version: string) => unknown>(),
}))
vi.mock('@/utils/calendarRehydrateAll', () => ({
  rehydrateAllCalendarGrids: () => rehydrateAll(),
}))
vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  return { ...actual, getCalendarData: (v: string) => getCalendarDataMock(v) }
})

import { resolveAnniversarySolarDate, CALENDAR_DATA_KR_2025_2035_V1 } from '@storige/canvas-core'
import CalendarPanel, { DUPLICATE_DATE_MESSAGE, LUNAR_DATA_PENDING_MESSAGE, OUT_OF_RANGE_BADGE, START_MONTH_CONFIRM_MESSAGE } from './CalendarPanel'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'

/**
 * P1-d 캘린더 (2026-10-17): CalendarPanel — 시작연월 범위 밖 거부, 기념일 중복 거부, 범위 밖 배지,
 * 음력 데이터 없음 비활성, pendingDate(날짜칸 더블클릭) → 폼, editMode 그리드 도구 노출.
 */
const calendarProfile: ProductProfile = {
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

type DblClickHandler = (opt: { target?: unknown; e: unknown }) => void

function wireCalendar(opts: { editMode?: boolean } = {}) {
  const handlers: Record<string, DblClickHandler[]> = {}
  const canvas = {
    id: 'c1',
    on: vi.fn((ev: string, h: DblClickHandler) => {
      ;(handlers[ev] ??= []).push(h)
    }),
    off: vi.fn((ev: string, h: DblClickHandler) => {
      handlers[ev] = (handlers[ev] ?? []).filter((x) => x !== h)
    }),
    getPointer: vi.fn(() => ({ x: 10, y: 20 })),
    getObjects: vi.fn(() => []),
  }
  const plugin = { hitTestDate: vi.fn(() => '2027-04-10' as string | null) }
  const editor = { getPlugin: vi.fn((name: string) => (name === 'CalendarPlugin' ? plugin : undefined)) }
  useAppStore.setState({ ready: true, canvas, editor, allCanvas: [canvas], allEditors: [editor] } as never)
  useSettingsStore.getState().setProductProfile(calendarProfile)
  useCalendarStore.getState().setFromProfile(calendarProfile)
  if (opts.editMode !== undefined) {
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: opts.editMode as boolean } }))
  }
  const view = render(<CalendarPanel />)
  return { canvas, plugin, handlers, ...view }
}

const startYearSelect = () => screen.getByLabelText('시작 연도') as HTMLSelectElement
const startMonthSelect = () => screen.getByLabelText('시작 월') as HTMLSelectElement
const applyButton = () => screen.getByRole('button', { name: '적용' })

async function submitAnniversary(fields: { year?: number; month: number; day: number; text: string; lunar?: boolean }) {
  const form = screen.getByRole('form', { name: /기념일 (추가|수정)/ })
  if (fields.year !== undefined) fireEvent.change(within(form).getByLabelText('기념일 연도'), { target: { value: String(fields.year) } })
  fireEvent.change(within(form).getByLabelText('기념일 월'), { target: { value: String(fields.month) } })
  fireEvent.change(within(form).getByLabelText('기념일 일'), { target: { value: String(fields.day) } })
  if (fields.lunar) fireEvent.click(within(form).getByLabelText('음력'))
  fireEvent.change(within(form).getByLabelText('기념일 문구'), { target: { value: fields.text } })
  await act(async () => {
    fireEvent.submit(form)
  })
}

beforeEach(() => {
  rehydrateAll.mockClear()
  getCalendarDataMock.mockImplementation((v: string) => (v === CALENDAR_DATA_KR_2025_2035_V1.version ? CALENDAR_DATA_KR_2025_2035_V1 : null))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => {
    useAppStore.setState({ ready: false, canvas: null, editor: null, allCanvas: [], allEditors: [] } as never)
    useSettingsStore.getState().setProductProfile(null)
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
    useCalendarStore.getState().reset()
  })
})

describe('CalendarPanel — 시작연월', () => {
  it('NULL 프로파일(legacy)·비 editMode: 안내만 렌더하고 섹션 없음', () => {
    render(<CalendarPanel />)
    expect(screen.getByText('캘린더 상품이 아닙니다.')).toBeInTheDocument()
    expect(screen.queryByLabelText('시작 연도')).toBeNull()
  })

  it('연/월 옵션은 allowedRange 안의 연월만, 변경 없으면 적용 비활성', () => {
    wireCalendar()
    expect(Array.from(startYearSelect().options).map((o) => o.value)).toEqual(['2027'])
    expect(startMonthSelect().options).toHaveLength(12)
    expect(applyButton()).toBeDisabled()
  })

  it('허용 범위 안 변경: 확인 문구 → setStartMonth → rehydrateAll 1회', async () => {
    wireCalendar()
    fireEvent.change(startMonthSelect(), { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(applyButton())
    })
    expect(window.confirm).toHaveBeenCalledWith(START_MONTH_CONFIRM_MESSAGE)
    expect(useCalendarStore.getState().meta).toMatchObject({ startYear: 2027, startMonth: 3 })
    expect(rehydrateAll).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/현재 2027년 3월 ~ 2028년 02월/)).toBeInTheDocument()
  })

  it('확인 취소 → 변경·재합성 없음', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    wireCalendar()
    fireEvent.change(startMonthSelect(), { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(applyButton())
    })
    expect(useCalendarStore.getState().meta).toMatchObject({ startMonth: 1 })
    expect(rehydrateAll).not.toHaveBeenCalled()
  })

  it('허용 범위 밖(프로파일 범위 축소 후 적용) → 인라인 오류 "허용 범위({from}~{to}) 밖입니다", 상태·재합성 없음', async () => {
    wireCalendar()
    fireEvent.change(startMonthSelect(), { target: { value: '6' } })
    act(() => {
      useCalendarStore.setState({ allowedRange: { from: '2027-01', to: '2027-03' } })
    })
    await act(async () => {
      fireEvent.click(applyButton())
    })
    expect(screen.getByRole('alert')).toHaveTextContent('허용 범위(2027-01~2027-03) 밖입니다')
    expect(useCalendarStore.getState().meta).toMatchObject({ startYear: 2027, startMonth: 1 })
    expect(rehydrateAll).not.toHaveBeenCalled()
  })
})

describe('CalendarPanel — 표기 옵션', () => {
  it('토글 → setShow + rehydrateAll', async () => {
    wireCalendar()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('음력'))
    })
    expect(useCalendarStore.getState().meta?.show).toEqual({ holidays: true, lunar: true, solarTerms: false })
    expect(rehydrateAll).toHaveBeenCalledTimes(1)
  })
})

describe('CalendarPanel — 기념일', () => {
  it('추가 → 목록 반영 + rehydrateAll, 같은 날짜 재추가는 "이미 등록된 날짜입니다"', async () => {
    wireCalendar()
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await submitAnniversary({ month: 5, day: 5, text: '생일' })
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual([
      expect.objectContaining({ date: '2027-05-05', lunar: false, text: '생일' }),
    ])
    expect(rehydrateAll).toHaveBeenCalledTimes(1)
    expect(screen.getByText('생일')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await submitAnniversary({ month: 5, day: 5, text: '중복' })
    expect(screen.getByRole('alert')).toHaveTextContent(DUPLICATE_DATE_MESSAGE)
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(1)
    expect(rehydrateAll).toHaveBeenCalledTimes(1)
  })

  it('음력 기념일은 양력 환산 기준으로 중복 판정(같은 양력일의 양력 기념일과 충돌)', async () => {
    wireCalendar()
    const solar = resolveAnniversarySolarDate({ date: '2027-01-01', lunar: true, text: '설' }, CALENDAR_DATA_KR_2025_2035_V1)
    expect(solar).toMatch(/^2027-0[12]-\d{2}$/)
    const [, m, d] = (solar as string).split('-').map(Number)

    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await submitAnniversary({ month: m, day: d, text: '양력' })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await submitAnniversary({ month: 1, day: 1, text: '설', lunar: true })
    expect(screen.getByRole('alert')).toHaveTextContent(DUPLICATE_DATE_MESSAGE)
    expect(useCalendarStore.getState().meta?.anniversaries).toHaveLength(1)
  })

  it('범위 밖(시작+11개월 밖) 기념일 행에 배지, 범위 안에는 없음', () => {
    wireCalendar()
    act(() => {
      useCalendarStore.getState().addAnniversary({ id: 'in', date: '2027-12-25', lunar: false, text: '안' })
      useCalendarStore.getState().addAnniversary({ id: 'out', date: '2028-01-01', lunar: false, text: '밖' })
    })
    expect(within(screen.getByTestId('anniversary-in')).queryByText(OUT_OF_RANGE_BADGE)).toBeNull()
    expect(within(screen.getByTestId('anniversary-out')).getByText(OUT_OF_RANGE_BADGE)).toBeInTheDocument()
  })

  it('시작연월 변경으로 범위 밖이 된 기념일에도 배지가 붙는다', async () => {
    wireCalendar()
    act(() => {
      useCalendarStore.getState().addAnniversary({ id: 'jan', date: '2027-01-15', lunar: false, text: '1월' })
    })
    expect(within(screen.getByTestId('anniversary-jan')).queryByText(OUT_OF_RANGE_BADGE)).toBeNull()
    fireEvent.change(startMonthSelect(), { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(applyButton())
    })
    expect(within(screen.getByTestId('anniversary-jan')).getByText(OUT_OF_RANGE_BADGE)).toBeInTheDocument()
  })

  it('삭제 → 목록 제거 + rehydrateAll', async () => {
    wireCalendar()
    act(() => {
      useCalendarStore.getState().addAnniversary({ id: 'x', date: '2027-02-02', lunar: false, text: '지울것' })
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('기념일 삭제 지울것'))
    })
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual([])
    expect(rehydrateAll).toHaveBeenCalledTimes(1)
  })

  it('날짜 데이터 null: 음력 토글 비활성 + "음력 환산 데이터 준비 중"', () => {
    getCalendarDataMock.mockReturnValue(null)
    wireCalendar()
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    const form = screen.getByRole('form', { name: '기념일 추가' })
    expect(within(form).getByLabelText('음력')).toBeDisabled()
    expect(within(form).getByText(LUNAR_DATA_PENDING_MESSAGE)).toBeInTheDocument()
  })

  it('pendingDate(날짜칸 더블클릭 — FeatureSidebar 가 세팅) → 그 날짜로 추가 폼, 기존 기념일이 있으면 수정 폼, 소비 후 null', async () => {
    wireCalendar()
    act(() => {
      useCalendarStore.getState().setPendingDate('2027-04-10')
    })
    const addForm = screen.getByRole('form', { name: '기념일 추가' })
    expect((within(addForm).getByLabelText('기념일 월') as HTMLSelectElement).value).toBe('4')
    expect((within(addForm).getByLabelText('기념일 일') as HTMLSelectElement).value).toBe('10')
    expect(useCalendarStore.getState().pendingDate).toBeNull()
    await submitAnniversary({ month: 4, day: 10, text: '기념' })
    expect(useCalendarStore.getState().meta?.anniversaries).toEqual([expect.objectContaining({ date: '2027-04-10', text: '기념' })])

    act(() => {
      useCalendarStore.getState().setPendingDate('2027-04-10')
    })
    const editForm = screen.getByRole('form', { name: '기념일 수정' })
    expect((within(editForm).getByLabelText('기념일 문구') as HTMLInputElement).value).toBe('기념')
    expect(useCalendarStore.getState().pendingDate).toBeNull()
  })
})

describe('CalendarPanel — editMode 그리드 도구', () => {
  it('editMode 면 그리드 배치 버튼 노출(데이터 있음 → 활성), 비 editMode 면 없음', () => {
    const { unmount } = wireCalendar({ editMode: true })
    expect(screen.getByRole('button', { name: '날짜 그리드 추가(월)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '미니 달력 추가(전월)' })).toBeEnabled()
    unmount()
    wireCalendar({ editMode: false })
    expect(screen.queryByRole('button', { name: '날짜 그리드 추가(월)' })).toBeNull()
  })

  it('editMode + NULL 프로파일: 그리드 도구만 노출, 데이터 null 이면 비활성 + 안내', () => {
    getCalendarDataMock.mockReturnValue(null)
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    useAppStore.setState({ ready: true, canvas: { id: 'c', on: vi.fn(), off: vi.fn() }, editor: null } as never)
    render(<CalendarPanel />)
    expect(screen.getByText('캘린더 상품 프로파일이 없는 세트입니다. 그리드 배치만 가능합니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '날짜 그리드 추가(월)' })).toBeDisabled()
    expect(screen.getByText(/날짜 데이터 준비 중/)).toBeInTheDocument()
  })
})
