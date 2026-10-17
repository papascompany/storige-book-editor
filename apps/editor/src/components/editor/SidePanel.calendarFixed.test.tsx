import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'
import SidePanel from './SidePanel'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { DEFAULT_PAGE_STEP_BASIS } from '@/utils/pageStep'

/**
 * P1 캘린더 (2026-10-17): productProfile pages.kind=fixed 세트는 SidePanel '페이지' 섹션의
 * 추가 버튼을 렌더하지 않고 삭제 버튼도 없다. NULL 프로파일(legacy)은 기존 min/max 게이트 그대로.
 */
function makeFakeCanvas(id: string) {
  return {
    id,
    on: vi.fn(),
    off: vi.fn(),
    getObjects: vi.fn(() => [] as unknown[]),
    requestRenderAll: vi.fn(),
    renderAll: vi.fn(),
    setActiveObject: vi.fn(),
    discardActiveObject: vi.fn(),
  }
}

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

const addPageMock = vi.fn(async () => {})
const deletePageMock = vi.fn()

function wire(opts: { canvasCount: number; profile: ProductProfile | null; min: number; max: number }) {
  const all = Array.from({ length: opts.canvasCount }, (_, i) => makeFakeCanvas(`c${i}`))
  useAppStore.setState({
    canvas: all[0],
    allCanvas: all,
    objects: [],
    screenshots: all.map(() => ''),
    activeSelection: [],
    isSpreadMode: false,
    addPage: addPageMock,
    deletePage: deletePageMock,
  } as never)
  useEditorStore.setState({ pageStep: null, pageStepBasis: DEFAULT_PAGE_STEP_BASIS } as never)
  useSettingsStore.getState().setProductProfile(opts.profile)
  useSettingsStore.setState((s) => ({
    currentSettings: {
      ...s.currentSettings,
      page: { count: opts.canvasCount, min: opts.min, max: opts.max, interval: 1 },
    },
  }))
  render(<SidePanel show onClose={() => {}} />)
  fireEvent.click(screen.getByText('페이지')) // 기본 접힘 → 펼침
}

const deleteButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.delete-btn'))

beforeEach(() => {
  vi.clearAllMocks()
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => {
    useAppStore.setState({ canvas: null, allCanvas: [], objects: [], screenshots: [], activeSelection: [] } as never)
    useEditorStore.setState({ pageStep: null, pageStepBasis: DEFAULT_PAGE_STEP_BASIS } as never)
    useSettingsStore.getState().setProductProfile(null)
  })
})

describe('SidePanel — 고정 캔버스 수 프로파일 (P1 캘린더)', () => {
  it('fixed 26 세트: "페이지 추가" 버튼 없음, 삭제 버튼 없음', () => {
    wire({ canvasCount: 26, profile: calendarProfile, min: 26, max: 26 })
    expect(screen.queryByLabelText('페이지 추가')).toBeNull()
    expect(deleteButtons()).toHaveLength(0)
  })

  it('fixed 세트인데 settings.page 가 느슨해도(호스트 한도 등) 추가/삭제 UI 는 숨긴다', () => {
    wire({ canvasCount: 26, profile: calendarProfile, min: 1, max: 99 })
    expect(screen.queryByLabelText('페이지 추가')).toBeNull()
    expect(deleteButtons()).toHaveLength(0)
  })

  it('NULL 프로파일(legacy): 기존 추가/삭제 동작 그대로', async () => {
    wire({ canvasCount: 4, profile: null, min: 1, max: 99 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
    expect(deleteButtons()).toHaveLength(4)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c1'])
  })
})
