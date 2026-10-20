import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'

const seedPhotoPrintCanvas = vi.fn(async () => true)
const syncPhotoPrintItemsWithCanvases = vi.fn(() => [])
const showToast = vi.fn()
vi.mock('@/utils/photoPrintSeed', () => ({ seedPhotoPrintCanvas: (...a: unknown[]) => seedPhotoPrintCanvas(...(a as [])) }))
vi.mock('@/utils/photoPrintRehydrateAll', () => ({ syncPhotoPrintItemsWithCanvases: () => syncPhotoPrintItemsWithCanvases() }))
vi.mock('@/stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

import SidePanel from './SidePanel'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'
import { DEFAULT_PAGE_STEP_BASIS } from '@/utils/pageStep'

/**
 * P2-d 사진인화 (2026-10-19): productProfile pages.kind=range 세트는 SidePanel '페이지' 섹션의 추가/삭제 UI 를 그대로 쓰고
 * (fixed 와 달리 숨기지 않음), digital 은 pageStep=2 경로로 2장 단위 추가/삭제한다. 추가한 캔버스마다
 * seedPhotoPrintCanvas(k) 를 부르고, 추가/삭제 뒤 항목 수를 캔버스 수에 동기화한다. NULL 프로파일은 시드/동기화 호출 없음.
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

const digitalProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_free',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 20, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

const chemicalProfile: ProductProfile = {
  ...digitalProfile,
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: { ...digitalProfile.photoPrint!, process: 'chemical' },
  output: { mode: 'single-pdf' },
}

const addPageMock = vi.fn(async () => {})
const deletePageMock = vi.fn()

function wire(opts: { canvasCount: number; profile: ProductProfile | null; pageStep: number | null; min: number; max: number }) {
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
    usePhotoPrintStore.getState().reset()
  })
})

/** 항목 A/B/C(매수 5/2/4) — 이 파일의 프로파일은 어휘가 1개뿐이라 매수로 어느 사진의 항목이 남는지 구분한다 */
function seedItems(profile: ProductProfile, canvasCount: number) {
  const store = usePhotoPrintStore.getState()
  store.setFromProfile(profile)
  store.syncWithCanvasCount(canvasCount)
  store.setCopies(0, 5)
  store.setCopies(1, 2)
  store.setCopies(2, 4)
}
const itemSummary = () => usePhotoPrintStore.getState().items.map((i) => [i.index, i.canvasIndex, i.copies])

describe('SidePanel — range 프로파일 (P2-d 사진인화)', () => {
  it('digital range(2~40, pageStep 2) 6캔버스: 추가 버튼 노출 → 2장 추가 + 캔버스마다 시드 + 동기화 1회', async () => {
    wire({ canvasCount: 6, profile: digitalProfile, pageStep: 2, min: 2, max: 40 })
    expect(screen.queryByLabelText('페이지 추가')).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(2)
    expect(seedPhotoPrintCanvas).toHaveBeenCalledTimes(2)
    // 시드 인덱스 = 추가 직후의 마지막 캔버스(mock addPage 는 allCanvas 를 늘리지 않으므로 5)
    expect(seedPhotoPrintCanvas.mock.calls.map((c) => (c as unknown[])[0])).toEqual([5, 5])
    expect(syncPhotoPrintItemsWithCanvases).toHaveBeenCalledTimes(1)
  })

  it('digital 삭제: 대상 + 인접 1장 묶음 삭제 뒤 동기화, 최소(2) 를 깨면 차단', () => {
    wire({ canvasCount: 6, profile: digitalProfile, pageStep: 2, min: 2, max: 40 })
    expect(deleteButtons()).toHaveLength(6)
    fireEvent.click(deleteButtons()[2])
    expect(deletePageMock).toHaveBeenCalledTimes(2)
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c2', 'c3'])
    expect(syncPhotoPrintItemsWithCanvases).toHaveBeenCalledTimes(1)
  })

  it('digital 2캔버스(= min): 삭제 버튼 없음, 추가는 가능', async () => {
    wire({ canvasCount: 2, profile: digitalProfile, pageStep: 2, min: 2, max: 40 })
    expect(deleteButtons()).toHaveLength(0)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(2)
  })

  it('digital max(=6) 도달: 추가 시 alert 차단, 시드 없음', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    wire({ canvasCount: 6, profile: digitalProfile, pageStep: 2, min: 2, max: 6 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(alertSpy).toHaveBeenCalled()
    expect(addPageMock).not.toHaveBeenCalled()
    expect(seedPhotoPrintCanvas).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('chemical range(1~200, pageStep null) 3캔버스: 1장 단위 추가 + 시드 1회, 삭제 1장 + 동기화', async () => {
    wire({ canvasCount: 3, profile: chemicalProfile, pageStep: null, min: 1, max: 200 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
    expect(seedPhotoPrintCanvas).toHaveBeenCalledTimes(1)
    expect(syncPhotoPrintItemsWithCanvases).toHaveBeenCalledTimes(1)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c1'])
    expect(syncPhotoPrintItemsWithCanvases).toHaveBeenCalledTimes(2)
  })

  it('NULL 프로파일(legacy): 기존 추가/삭제 동작 그대로, 시드/동기화 호출 없음', async () => {
    wire({ canvasCount: 4, profile: null, pageStep: null, min: 1, max: 99 })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('페이지 추가'))
    })
    expect(addPageMock).toHaveBeenCalledTimes(1)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c1'])
    expect(seedPhotoPrintCanvas).not.toHaveBeenCalled()
    expect(syncPhotoPrintItemsWithCanvases).not.toHaveBeenCalled()
  })
})

describe('SidePanel — 사진 단위 삭제 (editor-flow-2 / api-sheetmap-1 / tests-1)', () => {
  it('digital 6캔버스: 뒷면 c3(사진 2 뒤) 삭제 → 사진 2 의 [c2, c3] 묶음([뒤_i, 앞_{i+1}] 아님) + 스토어 항목 B 제거 → [A, C] 옵션·매수 유지', () => {
    wire({ canvasCount: 6, profile: digitalProfile, pageStep: 2, min: 2, max: 40 })
    seedItems(digitalProfile, 6)
    fireEvent.click(deleteButtons()[3])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c2', 'c3'])
    // 끝 잘림(syncWithCanvasCount)이었다면 [5, 2] 가 남아 C 의 매수 4 가 B 사진에 붙었다
    expect(itemSummary()).toEqual([
      [0, 0, 5],
      [1, 2, 4],
    ])
    expect(syncPhotoPrintItemsWithCanvases).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('사진 2(앞/뒤)이 삭제되었습니다.', 'info', 2500)
  })

  it('digital: 앞면 c0(사진 1 앞) 삭제 → [c0, c1] + 항목 A 제거 → 첫 항목이 B(매수 2)', () => {
    wire({ canvasCount: 6, profile: digitalProfile, pageStep: 2, min: 2, max: 40 })
    seedItems(digitalProfile, 6)
    fireEvent.click(deleteButtons()[0])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c0', 'c1'])
    expect(itemSummary()).toEqual([
      [0, 0, 2],
      [1, 2, 4],
    ])
  })

  it('chemical 3캔버스: c1(사진 2) 삭제 → c1 만 + 항목 B 제거 → [A, C]', () => {
    wire({ canvasCount: 3, profile: chemicalProfile, pageStep: null, min: 1, max: 200 })
    seedItems(chemicalProfile, 3)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock.mock.calls.map((c) => c[0])).toEqual(['c1'])
    expect(itemSummary()).toEqual([
      [0, 0, 5],
      [1, 1, 4],
    ])
    expect(showToast).toHaveBeenCalledWith('사진 2이 삭제되었습니다.', 'info', 2500)
  })

  it('digital 5캔버스·min 4: 사진 단위(2장) 삭제가 최소를 깨면 토스트 거부, 캔버스·항목 불변', () => {
    wire({ canvasCount: 5, profile: digitalProfile, pageStep: 2, min: 4, max: 40 })
    seedItems(digitalProfile, 5)
    const before = itemSummary()
    expect(deleteButtons().length).toBeGreaterThan(0)
    fireEvent.click(deleteButtons()[1])
    expect(deletePageMock).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('최소 사진 수 제한으로 삭제할 수 없습니다.', 'warning', 2500)
    expect(itemSummary()).toEqual(before)
    expect(syncPhotoPrintItemsWithCanvases).not.toHaveBeenCalled()
  })
})
