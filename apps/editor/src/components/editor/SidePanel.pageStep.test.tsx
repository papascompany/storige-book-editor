import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SidePanel from './SidePanel'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { DEFAULT_PAGE_STEP_BASIS } from '@/utils/pageStep'

/**
 * S8 (2026-09-28): SidePanel '페이지' 섹션의 pageStep 단위 추가/삭제 회귀 스펙.
 * 단일 모드에서 이 섹션이 유일한 추가/삭제 진입점이라(2402462), 1장 단위 우회가 되살아나지 않게 고정한다.
 * - 추가: 배수까지 모자란 만큼(정렬 상태면 step 만큼) addPage 반복
 * - 삭제: 대상 + 인접(뒤쪽 우선) 묶음 삭제, 최소 페이지 수를 깨면 차단
 * - pageStep=null: 기존 1장 단위 동작
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

const addPageMock = vi.fn(async () => {})
const deletePageMock = vi.fn()

function wire(opts: { canvasCount: number; pageStep: number | null; min?: number; max?: number }) {
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
  useEditorStore.setState({ pageStep: opts.pageStep, pageStepBasis: DEFAULT_PAGE_STEP_BASIS } as never)
  useSettingsStore.setState((s) => ({
    currentSettings: {
      ...s.currentSettings,
      page: { count: opts.canvasCount, min: opts.min ?? 1, max: opts.max ?? 99, interval: 1 },
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
  })
})

describe('SidePanel — pageStep 단위 추가/삭제 (S8)', () => {
  it('pageStep=2, 4장(정렬됨): 추가 1회에 2장 추가', async () => {
    wire({ canvasCount: 4, pageStep: 2 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(2)
  })

  it('pageStep=2, 3장(미정렬): 추가 1회에 배수까지 1장만 추가', async () => {
    wire({ canvasCount: 3, pageStep: 2 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
  })

  it('pageStep=4, 최대 페이지를 넘기면 추가하지 않는다', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    wire({ canvasCount: 8, pageStep: 4, max: 10 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).not.toHaveBeenCalled()
    expect(alertSpy).toHaveBeenCalledTimes(1)
    alertSpy.mockRestore()
  })

  it('pageStep=2, 6장: 3번째 페이지 삭제 → 대상+뒤 인접 1장 묶음 삭제', () => {
    wire({ canvasCount: 6, pageStep: 2 })
    fireEvent.click(deleteButtons()[2])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c2', 'c3'])
  })

  it('pageStep=2, 마지막 페이지 삭제 → 뒤가 없으면 앞 인접과 묶는다', () => {
    wire({ canvasCount: 6, pageStep: 2 })
    fireEvent.click(deleteButtons()[5])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c5', 'c4'])
  })

  it('pageStep=2, 삭제 후 최소 페이지 수 미만이면 삭제하지 않는다', () => {
    wire({ canvasCount: 4, pageStep: 2, min: 3 })
    fireEvent.click(deleteButtons()[0])
    expect(deletePageMock).not.toHaveBeenCalled()
  })

  it('pageStep=null: 기존 1장 단위 추가/삭제', async () => {
    wire({ canvasCount: 4, pageStep: null })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c1'])
  })
})

// R-196 host page limits (2026-09-29): 로더가 호스트 병합 범위로 settings.page 를 넓히면
// (단일 [16,300] + 비내지 1장 → {17,301}) 종전 기본 상한(99)을 넘어 추가할 수 있어야 한다.
describe('SidePanel — 호스트 쪽수 한도 settings.page (R-196 회귀 가드)', () => {
  it('page {min:17, max:301} 이면 150장에서 추가 허용', async () => {
    wire({ canvasCount: 150, pageStep: null, min: 17, max: 301 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
  })
})
