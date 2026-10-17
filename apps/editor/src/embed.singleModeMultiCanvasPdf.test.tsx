/**
 * P0 (2026-10-16): 비스프레드(단일 모드) 편집완료 PDF 대상 캔버스 + IIFE save/complete canvasData.
 *   - 1캔버스 세션: saveMultiPagePDFAsBlob 호출 인자가 종전 `[canvas], [editor], session-<id>, size, undefined, 300`
 *     과 완전히 같다(바이트 동일 경로 고정). watchdog 한도(Math.max(120000, 15000×n) → 1장=120000)는
 *     여기서 단언하지 않는다 — withWatchdog 가 embed.tsx 내부 함수라 spy 대상이 아니다.
 *   - 같은 판형 낱장 N장(page 만): allCanvas/allEditors 전체가 한 PDF 로 넘어가고 canvasData 는 배열.
 *   - spine/wing 혼재(낱장 표지 분할 세트): 종전처럼 현재 캔버스 1장으로 폴백.
 *   - instance.save / instance.complete: 멀티페이지면 canvasData 배열(단일 캔버스로 덮어쓰지 않음),
 *     allCanvas 가 비어 있으면(IIFE/레거시) 종전과 같은 단일 객체.
 *
 * 하네스는 embed.finishOutcome.test.tsx 를 준용한다(store.ready=true 로 초기화 생략, 캔버스·에디터는 더미).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { FinishOutcome } from './utils/finishOutcome'

const captured = vi.hoisted(() => ({
  onFinish: null as null | (() => Promise<FinishOutcome | void>),
}))

vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({ loadEmptyEditor: vi.fn(), loadTemplateSetEditor: vi.fn(async () => undefined) }),
}))
vi.mock('./hooks/useEmbedAutoSave', () => ({
  useEmbedAutoSave: () => ({
    saveNow: vi.fn(async () => true),
    restoreFromLocal: vi.fn(),
    evaluateRestore: () => ({ offer: false, confident: false }),
    deleteLocalBackup: vi.fn(),
    markClean: vi.fn(),
    markServerSynced: vi.fn(),
    triggerSave: Object.assign(() => {}, { cancel: () => {} }),
  }),
}))
vi.mock('./hooks/useEmbedBackGuard', () => ({ useEmbedBackGuard: () => undefined }))
vi.mock('./hooks/useCanvasContainerSizeSync', () => ({ useCanvasContainerSizeSync: () => undefined }))
vi.mock('./hooks/useResolvedPageNavPosition', () => ({ useResolvedPageNavPosition: () => 'bottom' as const }))
vi.mock('./components/editor/EditorHeader', () => ({
  default: (props: { onFinish?: () => Promise<FinishOutcome | void> }) => {
    captured.onFinish = props.onFinish ?? null
    return null
  },
}))
vi.mock('./components/editor/ToolBar', () => ({ default: () => null }))
vi.mock('./components/editor/ObjectActionBar', () => ({ default: () => null }))
vi.mock('./components/editor/FeatureSidebar', () => ({ default: () => null }))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({ WorkspaceModal: () => null }))
vi.mock('./components/RestoreBackupBanner', () => ({ RestoreBackupBanner: () => null }))
vi.mock('./components/editor/ObjectDeleteConfirm', () => ({ default: () => null }))
vi.mock('./components/editor/EditorWorkflowControls', () => ({ EditorWorkflowControls: () => null }))
vi.mock('./utils/createCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/createCanvas')>()
  return {
    ...actual,
    createCanvas: vi.fn(async () => ({
      setDimensions: () => {},
      on: () => {},
      discardActiveObject: () => {},
      requestRenderAll: () => {},
    })),
  }
})
vi.mock('./utils/contentPdfGuide', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/contentPdfGuide')>()
  return { ...actual, ensureSeatExistingContentPdf: vi.fn(async () => undefined) }
})

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
  update: vi.fn(),
  updateGuest: vi.fn(),
  complete: vi.fn(),
  listVersions: vi.fn(async () => []),
  listGuestVersions: vi.fn(async () => []),
  getTemplateSetWithTemplates: vi.fn(),
}))
vi.mock('./api', () => ({
  editSessionsApi: {
    get: (...a: unknown[]) => api.get(...(a as [])),
    getGuest: (...a: unknown[]) => api.getGuest(...(a as [])),
    createGuest: (...a: unknown[]) => api.createGuest(...(a as [])),
    create: (...a: unknown[]) => api.create(...(a as [])),
    findByOrder: (...a: unknown[]) => api.findByOrder(...(a as [])),
    update: (...a: unknown[]) => api.update(...(a as [])),
    updateGuest: (...a: unknown[]) => api.updateGuest(...(a as [])),
    complete: (...a: unknown[]) => api.complete(...(a as [])),
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: { getTemplateSetWithTemplates: (...a: unknown[]) => api.getTemplateSetWithTemplates(...(a as [])) },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ role: 'customer' })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useEditorStore } from './stores/useEditorStore'
import { useSaveStore } from './stores/useSaveStore'
import { core } from '@storige/canvas-core'

const PARENT_ORIGIN = 'https://host.example'
const parentPost = vi.fn()

// 마운트된 훅(useCoverRegion 등)이 on/off 를 구독하므로 no-op 이벤트 메서드를 둔다.
interface FakeCanvas {
  id: string
  toJSON: ReturnType<typeof vi.fn>
  on: () => void
  off: () => void
}
interface FakeEditor {
  id: string
  getPlugin: (name: string) => unknown
  on: () => void
  off: () => void
  emit: () => void
}

const saveMultiPagePDFAsBlob = vi.fn(async () => null)
const servicePlugin = { saveMultiPagePDFAsBlob }

function fakeCanvas(id: string): FakeCanvas {
  return { id, toJSON: vi.fn((props: string[]) => ({ id, props })), on: () => {}, off: () => {} }
}
function fakeEditor(id: string): FakeEditor {
  return {
    id,
    getPlugin: (name: string) => (name === 'ServicePlugin' ? servicePlugin : undefined),
    on: () => {},
    off: () => {},
    emit: () => {},
  }
}

function seedCanvases(n: number, currentIdx = 0, pages: Array<{ templateType: string }> = []) {
  const allCanvas = Array.from({ length: n }, (_, i) => fakeCanvas(`c${i}`))
  const allEditors = Array.from({ length: n }, (_, i) => fakeEditor(`e${i}`))
  const canvas = allCanvas[currentIdx] ?? fakeCanvas('cur')
  const editor = allEditors[currentIdx] ?? fakeEditor('cur')
  act(() => {
    useAppStore.setState({ ready: true, canvas, editor, allCanvas, allEditors, activeSelection: [] } as never)
    useEditorStore.setState({ pages } as never)
    useSaveStore.setState({ isDirty: false } as never)
  })
  return { allCanvas, allEditors, canvas, editor }
}

let lastInstanceRef: { current: EditorInstanceMethods | null } = { current: null }

function renderEmbed(props: Partial<{ sessionId: string; bleed: number }> = {}) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  lastInstanceRef = instanceRef
  return render(
    <EmbeddedEditor templateSetId="ts-test" parentOrigin={PARENT_ORIGIN} instanceRef={instanceRef} {...props} />,
  )
}

const COMPLETED_SESSION = {
  id: 'sess-1',
  orderSeqno: 1234567890123,
  status: 'completed',
  coverFileId: null,
  contentFileId: null,
  coverFile: null,
  completedAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
}

/** 종전 단일 분기의 size 인자 — options.size 미전달 폴백(210×297), bleed 기본 3, printMarkConfig null. */
const LEGACY_SIZE_ARG = { width: 210, height: 297, cutSize: 3, bleedMm: undefined, cropMarkEnabled: undefined }

describe('EmbeddedEditor — 단일모드 낱장 N장 PDF / IIFE canvasData (P0)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    captured.onFinish = null
    parentPost.mockReset()
    saveMultiPagePDFAsBlob.mockClear()
    Object.defineProperty(window, 'parent', { value: { postMessage: parentPost }, configurable: true, writable: true })
    sessionStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 210, height: 297 })
    api.update.mockResolvedValue({ id: 'sess-1' })
    api.complete.mockResolvedValue(COMPLETED_SESSION)
    localStorage.setItem('auth_token', 'test-token')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, editor: null, allCanvas: [], allEditors: [], activeSelection: [] } as never)
      useEditorStore.setState({ pages: [] } as never)
    })
  })

  async function finish(): Promise<FinishOutcome | void> {
    expect(captured.onFinish).not.toBeNull()
    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      outcome = await captured.onFinish!()
    })
    return outcome
  }

  it('P0-1 1캔버스 세션: saveMultiPagePDFAsBlob 인자가 종전 [canvas],[editor]·size·undefined·300 과 동일, canvasData 단일 객체', async () => {
    const { canvas, editor } = seedCanvases(1, 0, [{ templateType: 'page' }])
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1)
    const [canvases, editors, name, size, fonts, dpi] = saveMultiPagePDFAsBlob.mock.calls[0] as unknown[]
    expect(canvases).toEqual([canvas])
    expect((canvases as unknown[])[0]).toBe(canvas)
    expect(editors).toEqual([editor])
    expect((editors as unknown[])[0]).toBe(editor)
    expect(name).toBe('session-sess-1')
    expect(size).toEqual(LEGACY_SIZE_ARG)
    expect(fonts).toBeUndefined()
    expect(dpi).toBe(300)
    // 세션 canvasData: 단일 객체(종전과 동일), core.extendFabricOption 으로 직렬화
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: { id: 'c0', props: core.extendFabricOption } })
  })

  it('P0-2 같은 판형 낱장 3장(page 만): 전 캔버스/에디터가 한 PDF 로 넘어가고 canvasData 는 3개 배열', async () => {
    const { allCanvas, allEditors } = seedCanvases(3, 1, [
      { templateType: 'page' },
      { templateType: 'page' },
      { templateType: 'page' },
    ])
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1)
    const [canvases, editors, name, size, fonts, dpi] = saveMultiPagePDFAsBlob.mock.calls[0] as unknown[]
    expect(canvases).toBe(allCanvas)
    expect(editors).toBe(allEditors)
    expect(name).toBe('session-sess-1')
    expect(size).toEqual(LEGACY_SIZE_ARG)
    expect(fonts).toBeUndefined()
    expect(dpi).toBe(300)
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: [
        { id: 'c0', props: core.extendFabricOption },
        { id: 'c1', props: core.extendFabricOption },
        { id: 'c2', props: core.extendFabricOption },
      ],
    })
  })

  it('P0-3 spine 포함(낱장 표지 분할 세트): 종전처럼 현재 캔버스 1장으로 폴백(인자 형태 동일)', async () => {
    const { canvas, editor } = seedCanvases(3, 2, [
      { templateType: 'cover' },
      { templateType: 'spine' },
      { templateType: 'cover' },
    ])
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1)
    const [canvases, editors, name, size, fonts, dpi] = saveMultiPagePDFAsBlob.mock.calls[0] as unknown[]
    expect(canvases).toEqual([canvas])
    expect(editors).toEqual([editor])
    expect(name).toBe('session-sess-1')
    expect(size).toEqual(LEGACY_SIZE_ARG)
    expect(fonts).toBeUndefined()
    expect(dpi).toBe(300)
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining('단일모드 PDF: 현재 캔버스 1장으로 폴백'),
      'fallback-mixed-types',
      { canvasCount: 3 },
    )
  })

  it('P0-4 instance.save: 멀티페이지면 canvasData 배열(현재 캔버스 1장으로 덮어쓰지 않음)', async () => {
    seedCanvases(2, 1, [{ templateType: 'page' }, { templateType: 'page' }])
    api.update.mockResolvedValue({ id: 'sess-1', updatedAt: '2026-10-16T00:00:00.000Z', coverFile: null })
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: [
        { id: 'c0', props: core.extendFabricOption },
        { id: 'c1', props: core.extendFabricOption },
      ],
      status: 'editing',
    })
  })

  it('P0-5 instance.save / complete: allCanvas 가 비어 있으면(IIFE·레거시) 종전과 같은 단일 객체', async () => {
    const canvas = fakeCanvas('legacy')
    act(() => {
      useAppStore.setState({ ready: true, canvas, editor: null, allCanvas: [], allEditors: [], activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
    api.update.mockResolvedValue({ id: 'sess-1', updatedAt: '2026-10-16T00:00:00.000Z', coverFile: null })
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: { id: 'legacy', props: core.extendFabricOption },
      status: 'editing',
    })

    api.update.mockClear()
    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: { id: 'legacy', props: core.extendFabricOption } })
    expect(saveMultiPagePDFAsBlob).not.toHaveBeenCalled()
  })

  it('P0-6 instance.complete: 멀티페이지면 canvasData 배열', async () => {
    seedCanvases(2, 0, [{ templateType: 'page' }, { templateType: 'page' }])
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: [
        { id: 'c0', props: core.extendFabricOption },
        { id: 'c1', props: core.extendFabricOption },
      ],
    })
  })
})
