// @vitest-environment happy-dom
//
// 템플릿 세트를 처음 열 때 모든 쪽의 사진틀(extensionType 'frame')이 클릭 채움 핸들러를 가져야 한다.
// 사진틀 리스너는 런타임 전용(직렬화 안 됨)이라 로드 직후 다시 붙여야 하는데, 종전에는 세트 페이지
// 로드 콜백이 사진인화 세트에만 붙여 캘린더·프로파일 NULL 세트의 2쪽 이후 사진틀은 리스너 0개였다
// (새로 고침하면 embed 복원 경로가 붙여서 해소). 실 fabric 캔버스 + 실 makeFrameInteractive 로 확인한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'

vi.unmock('fabric')

const h = vi.hoisted(() => ({
  getTemplateSetWithTemplates: vi.fn(),
  selectFiles: vi.fn(async () => [] as File[]),
  rebindEnabled: true,
}))

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    templateSetsApi: { ...actual.templateSetsApi, getTemplateSetWithTemplates: h.getTemplateSetWithTemplates },
  }
})

vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  // SpreadPlugin: 표지 가이드·라벨 렌더는 이 테스트 대상이 아니다(스프레드 경로 진행용 스텁).
  class SpreadPluginStub {
    init(): void {}
  }
  return { ...actual, selectFiles: h.selectFiles, SpreadPlugin: SpreadPluginStub }
})

vi.mock('@/utils/spineCalculator', () => ({
  initSpineConfig: vi.fn(),
  recalculateSpineWidth: vi.fn(async () => ({ success: false })),
}))

// 직렬화 비교용 스위치: false 면 재바인딩을 끈 로드(= 리스너 없는 상태)와 비교한다.
vi.mock('@/utils/frameInteractive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/frameInteractive')>()
  return {
    ...actual,
    rebindFrameInteractivity: (...args: Parameters<typeof actual.rebindFrameInteractivity>) => {
      if (h.rebindEnabled) actual.rebindFrameInteractivity(...args)
    },
  }
})

// createCanvas: 실 fabric StaticCanvas + ServicePlugin.loadJSON(=loadFromJSON) 스텁 에디터를 스토어에 추가.
vi.mock('@/utils/createCanvas', () => ({
  createCanvas: vi.fn(async () => {
    const { useAppStore: store } = await import('@/stores/useAppStore')
    const { canvas, editor } = makePage()
    const s = store.getState()
    store.setState({ allCanvas: [...s.allCanvas, canvas], allEditors: [...s.allEditors, editor] } as never)
  }),
}))

import { fabric } from 'fabric'
import { core } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useEditorContents } from './useEditorContents'

type Plain = Record<string, unknown>
type Listeners = Record<string, unknown[] | undefined>

function makePage() {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 800, renderOnAddRemove: false })
  const c = canvas as unknown as Plain
  c.requestRenderAll = () => canvas
  c.renderAll = () => canvas
  c.getContext = () => ({})
  c.clearContext = () => canvas
  c.discardActiveObject = () => canvas
  c.setActiveObject = () => canvas
  const imagePlugin = {}
  const servicePlugin = {
    loadJSON: (data: unknown, cb?: () => void) => {
      canvas.loadFromJSON(data as string, () => cb?.())
    },
  }
  const editor = {
    emit: () => undefined,
    use: () => undefined,
    getPlugin: (name: string) =>
      name === 'ServicePlugin' ? servicePlugin : name === 'ImageProcessingPlugin' ? imagePlugin : undefined,
  }
  return { canvas, editor }
}

const WS: Plain = { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 600, fill: '#fff' }
const page = (i: number, type: string) => ({
  id: `tpl-${i}`,
  name: `쪽 ${i + 1}`,
  type,
  width: 100,
  height: 100,
  canvasData: {
    version: '5.3.0',
    objects: [
      WS,
      { type: 'rect', id: `frame-${i}`, extensionType: 'frame', left: 50, top: 50, width: 200, height: 200, fill: '#ccc' },
      { type: 'rect', id: `deco-${i}`, left: 300, top: 300, width: 40, height: 40, fill: '#f00' },
    ],
  },
})

const CALENDAR: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
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

const PHOTO_PRINT: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 10, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

/** 세트(4쪽)를 처음 연다 — 첫 쪽 캔버스만 있는 embed 초기 상태에서 loadTemplateSetEditor 호출 */
async function openSet(productProfile: ProductProfile | null, pageCount = 4) {
  const first = makePage()
  useAppStore.setState({
    canvas: first.canvas,
    editor: first.editor,
    allCanvas: [first.canvas],
    allEditors: [first.editor],
  } as never)
  const details = Array.from({ length: pageCount }, (_, i) => page(i, 'page'))
  h.getTemplateSetWithTemplates.mockResolvedValue({
    templateSet: { id: 'set-1', name: '세트', width: 100, height: 100, editorMode: 'single', productProfile },
    templateDetails: details,
  })
  const { result } = renderHook(() => useEditorContents())
  await result.current.loadTemplateSetEditor({ templateSetId: 'set-1' } as never)
  return useAppStore.getState().allCanvas as unknown as fabric.StaticCanvas[]
}

/** 표지(spread) + 낱장 내지 3쪽 책 세트를 처음 연다 — 내지는 addInnerPage 로 캔버스를 만든 뒤 loadJSON */
async function openSpreadSet() {
  const first = makePage()
  useAppStore.setState({
    canvas: first.canvas,
    editor: first.editor,
    allCanvas: [first.canvas],
    allEditors: [first.editor],
    addInnerPage: async () => {
      const { canvas, editor } = makePage()
      const s = useAppStore.getState()
      useAppStore.setState({ allCanvas: [...s.allCanvas, canvas], allEditors: [...s.allEditors, editor] } as never)
    },
  } as never)
  const cover = {
    ...page(0, 'spread'),
    width: 200,
    height: 100,
    spreadConfig: { spec: { coverWidthMm: 100, coverHeightMm: 100, wingEnabled: false, wingWidthMm: 0 } },
  }
  h.getTemplateSetWithTemplates.mockResolvedValue({
    templateSet: { id: 'set-book', name: '책', width: 100, height: 100, editorMode: 'book', productProfile: null },
    templateDetails: [cover, page(1, 'page'), page(2, 'page'), page(3, 'page')],
  })
  const { result } = renderHook(() => useEditorContents())
  await result.current.loadTemplateSetEditor({ templateSetId: 'set-book' } as never)
  return useAppStore.getState().allCanvas as unknown as fabric.StaticCanvas[]
}

const framesOf = (canvas: fabric.StaticCanvas) =>
  canvas.getObjects().filter((o) => (o as unknown as Plain).extensionType === 'frame')
const listenerCount = (obj: fabric.Object, event: string) =>
  ((obj as unknown as { __eventListeners?: Listeners }).__eventListeners?.[event] ?? []).length

beforeEach(() => {
  h.rebindEnabled = true
  h.selectFiles.mockClear()
  h.getTemplateSetWithTemplates.mockReset()
  const container = document.createElement('div')
  container.id = 'canvas-containers'
  document.body.appendChild(container)
  useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const originalAddInnerPage = useAppStore.getState().addInnerPage

afterEach(() => {
  document.getElementById('canvas-containers')?.remove()
  useAppStore.setState({ canvas: null, editor: null, allCanvas: [], allEditors: [], addInnerPage: originalAddInnerPage } as never)
  useSettingsStore.getState().setSpreadConfig(null)
  useSettingsStore.getState().setProductProfile(null)
  vi.restoreAllMocks()
})

describe('loadTemplateSetEditor — 처음 연 세트의 모든 쪽 사진틀 클릭 채움', () => {
  it.each([
    ['프로파일 NULL', null, 4],
    ['캘린더(탁상 26캔버스)', CALENDAR, 26],
    ['사진인화', PHOTO_PRINT, 4],
  ] as const)('%s 세트: 모든 캔버스의 사진틀에 mouseover/mouseout/mousedown 이 1개씩, mousedown 은 파일 선택으로 진입', async (_label, profile, pageCount) => {
    const canvases = await openSet(profile, pageCount)
    expect(useSettingsStore.getState().productProfile?.kind ?? null).toBe(profile?.kind ?? null)
    expect(canvases).toHaveLength(pageCount)
    const counts = canvases.map((cvs) =>
      framesOf(cvs).map((f) => [listenerCount(f, 'mouseover'), listenerCount(f, 'mouseout'), listenerCount(f, 'mousedown')]),
    )
    expect(counts).toEqual(Array.from({ length: pageCount }, () => [[1, 1, 1]]))

    // 마지막 쪽 사진틀을 눌러 파일 선택 경로가 호출되는지(취소 → 캔버스 변화 없음)
    const last = canvases[pageCount - 1]
    const before = last.getObjects().length
    const frame = framesOf(last)[0]
    frame.fire('mousedown', { e: new MouseEvent('mousedown') })
    await vi.waitFor(() => expect(h.selectFiles).toHaveBeenCalledTimes(1))
    expect(h.selectFiles).toHaveBeenCalledWith({ accept: 'image/*', multiple: false })
    expect(last.getObjects().length).toBe(before)
  })

  it('사진인화 세트: 세트 콜백과 initPhotoPrintSeededCanvas 가 둘 다 재바인딩해도 리스너는 중복되지 않는다', async () => {
    const spy = vi.spyOn(useImageStore.getState(), 'makeFrameInteractive')
    const canvases = await openSet(PHOTO_PRINT)
    // 2쪽 이후는 두 경로에서 호출(쪽당 2회), 1쪽은 loadCanvasData 1회 — 그래도 리스너는 1개
    const callsPerCanvas = canvases.map((cvs) => spy.mock.calls.filter(([c]) => c === (cvs as unknown)).length)
    expect(callsPerCanvas).toEqual([1, 2, 2, 2])
    for (const cvs of canvases) {
      for (const f of framesOf(cvs)) expect(listenerCount(f, 'mousedown')).toBe(1)
    }
  })

  it('프로파일 NULL 세트: 리스너 부여는 직렬화에 영향 없음 — toJSON(extendFabricOption) 이 재바인딩 없는 로드와 같다', async () => {
    h.rebindEnabled = false
    const plain = (await openSet(null)).map((cvs) => JSON.stringify(cvs.toJSON(core.extendFabricOption)))
    expect(listenerCount(framesOf((useAppStore.getState().allCanvas as unknown as fabric.StaticCanvas[])[1])[0], 'mousedown')).toBe(0)
    useAppStore.setState({ canvas: null, editor: null, allCanvas: [], allEditors: [] } as never)

    h.rebindEnabled = true
    const bound = await openSet(null)
    expect(listenerCount(framesOf(bound[1])[0], 'mousedown')).toBe(1)
    expect(bound.map((cvs) => JSON.stringify(cvs.toJSON(core.extendFabricOption)))).toEqual(plain)
  })

  it('스프레드(표지+낱장 내지) 세트: 표지와 내지 모든 캔버스의 사진틀에 mousedown 이 1개, 내지 사진틀 클릭은 파일 선택으로 진입', async () => {
    const canvases = await openSpreadSet()
    expect(useAppStore.getState().isSpreadMode).toBe(true)
    expect(canvases).toHaveLength(4)
    expect(canvases.map((cvs) => framesOf(cvs).map((f) => listenerCount(f, 'mousedown')))).toEqual([[1], [1], [1], [1]])
    framesOf(canvases[2])[0].fire('mousedown', { e: new MouseEvent('mousedown') })
    await vi.waitFor(() => expect(h.selectFiles).toHaveBeenCalledTimes(1))
  })
})
