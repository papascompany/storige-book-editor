// @vitest-environment happy-dom
//
// P1 캘린더 (2026-10-17): 날짜칸 더블클릭 구독은 항상 마운트되는 FeatureSidebar 가 맡는다.
// (그리드를 클릭하면 선택 패널로 바뀌어 CalendarPanel 이 언마운트되므로 패널 안 구독은 두 번째 클릭 전에 사라진다.)
//
// 고정하는 계약:
//  (1) 캘린더 프로파일이면 활성 캔버스 'mouse:dblclick' 을 구독하고, 그리드 날짜칸 더블클릭 →
//      useCalendarStore.pendingDate 세팅 + 선택 해제 + 달력 메뉴(tapMenu 'CALENDAR') 전환
//  (2) 이미 달력 메뉴면 tapMenu 를 다시 부르지 않는다(토글로 닫히지 않게)
//  (3) 프로파일 NULL(legacy) 세트는 구독하지 않는다 — 바이트 동일
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('@/components/AiPanel', () => ({ default: () => null }))
vi.mock('@/tools/AppText', () => ({ default: () => null }))
vi.mock('@/tools/AppImage', () => ({ default: () => null }))
vi.mock('@/tools/AppElement', () => ({ default: () => null }))
vi.mock('@/tools/AppBackground', () => ({ default: () => null }))
vi.mock('@/tools/AppTemplate', () => ({ default: () => null }))
vi.mock('@/tools/AppTemplateSwap', () => ({ default: () => null }))
vi.mock('@/tools/AppFrame', () => ({ default: () => null }))
vi.mock('@/tools/SmartCodes', () => ({ default: () => null }))
vi.mock('@/components/calendar/CalendarPanel', () => ({ default: () => null }))
vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  return {
    ...actual,
    CalendarPlugin: { isGrid: (o: unknown) => (o as { extensionType?: string } | undefined)?.extensionType === 'calendar-grid' },
  }
})

import FeatureSidebar from './FeatureSidebar'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import type { ProductProfile } from '@storige/types'

const calendarProfile: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk',
  pages: { kind: 'fixed', count: 26, labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
    allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true }, dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
}

type Handler = (opt: { target?: unknown; e: unknown }) => void

function wire(profile: ProductProfile | null, currentMenu: { type: string; label: string } | null = null) {
  const handlers: Record<string, Handler[]> = {}
  const canvas = {
    on: vi.fn((ev: string, h: Handler) => { (handlers[ev] ??= []).push(h) }),
    off: vi.fn((ev: string, h: Handler) => { handlers[ev] = (handlers[ev] ?? []).filter((x) => x !== h) }),
    getPointer: vi.fn(() => ({ x: 1, y: 2 })),
    discardActiveObject: vi.fn(),
    requestRenderAll: vi.fn(),
    getObjects: vi.fn(() => []),
  }
  const plugin = { hitTestDate: vi.fn(() => '2027-03-05') }
  const editor = { getPlugin: vi.fn((name: string) => (name === 'CalendarPlugin' ? plugin : undefined)) }
  const tapMenu = vi.fn()
  useAppStore.setState({ ready: true, canvas, editor, currentMenu, activeSelection: [], tapMenu } as never)
  useSettingsStore.getState().setProductProfile(profile)
  useCalendarStore.getState().setFromProfile(profile)
  return { handlers, canvas, plugin, tapMenu }
}

describe('FeatureSidebar — 캘린더 날짜칸 더블클릭 구독', () => {
  beforeEach(() => {
    act(() => {
      useCalendarStore.getState().reset()
      useSettingsStore.getState().setProductProfile(null)
    })
  })

  it('(1) 그리드 날짜칸 더블클릭 → pendingDate + 선택 해제 + 달력 메뉴 전환', () => {
    const { handlers, canvas, plugin, tapMenu } = wire(calendarProfile, { type: 'TEXT', label: '텍스트' })
    render(<FeatureSidebar />)
    expect(handlers['mouse:dblclick']).toHaveLength(1)
    const grid = { extensionType: 'calendar-grid' }
    act(() => {
      handlers['mouse:dblclick'][0]({ target: grid, e: {} })
    })
    expect(plugin.hitTestDate).toHaveBeenCalledWith(grid, { x: 1, y: 2 })
    expect(useCalendarStore.getState().pendingDate).toBe('2027-03-05')
    expect(canvas.discardActiveObject).toHaveBeenCalledTimes(1)
    expect(tapMenu).toHaveBeenCalledWith(expect.objectContaining({ type: 'CALENDAR', label: '달력' }))
  })

  it('(2) 이미 달력 메뉴면 tapMenu 를 다시 부르지 않는다', () => {
    const { handlers, tapMenu } = wire(calendarProfile, { type: 'CALENDAR', label: '달력' })
    render(<FeatureSidebar />)
    act(() => {
      handlers['mouse:dblclick'][0]({ target: { extensionType: 'calendar-grid' }, e: {} })
    })
    expect(useCalendarStore.getState().pendingDate).toBe('2027-03-05')
    expect(tapMenu).not.toHaveBeenCalled()
  })

  it('(1) 그리드가 아닌 객체·날짜칸 밖은 무시한다', () => {
    const { handlers, plugin, tapMenu } = wire(calendarProfile, { type: 'TEXT', label: '텍스트' })
    render(<FeatureSidebar />)
    expect(handlers['mouse:dblclick']).toHaveLength(1)
    plugin.hitTestDate.mockReturnValueOnce(null as never)
    act(() => {
      handlers['mouse:dblclick'][0]({ target: { extensionType: 'other' }, e: {} })
    })
    expect(plugin.hitTestDate).not.toHaveBeenCalled()
    act(() => {
      handlers['mouse:dblclick'][0]({ target: { extensionType: 'calendar-grid' }, e: {} })
    })
    expect(plugin.hitTestDate).toHaveBeenCalledTimes(1)
    expect(useCalendarStore.getState().pendingDate).toBeNull()
    expect(tapMenu).not.toHaveBeenCalled()
  })

  it('(3) NULL 프로파일(legacy)은 구독하지 않는다', () => {
    const { handlers, canvas } = wire(null, { type: 'TEXT', label: '텍스트' })
    render(<FeatureSidebar />)
    expect(handlers['mouse:dblclick'] ?? []).toHaveLength(0)
    expect(canvas.on).not.toHaveBeenCalledWith('mouse:dblclick', expect.anything())
  })
})
