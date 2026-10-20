/**
 * P2-d 사진인화 (2026-10-19): editor.complete additive `items` 키 + `product.kind 'photo-print'` + 세션 PATCH metadata.items.
 *   - digital 프로파일 6캔버스: product {kind:'photo-print', canvasCount 6, sheetCount 3, faces 2} + items 3건(캔버스 수 동기화·옵션 반영),
 *     `files`·`pages` 중첩 구조 불변, 세션 update 에 metadata { productProfile, items } 동봉(calendar 키 없음).
 *   - NULL 프로파일(legacy): result 에 product/items 키 없음, payload 키 집합이 기존과 동일, update payload 는 { canvasData } 그대로.
 *   - instance.save/complete(프로그래매틱) 경로도 같은 값.
 *
 * 하네스는 embed.calendarComplete.test.tsx 를 준용한다(store.ready=true 로 초기화 생략, 캔버스·에디터는 더미).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'
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

import { EmbeddedEditor, type EditorInstanceMethods, type EditorResult } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useEditorStore } from './stores/useEditorStore'
import { useSaveStore } from './stores/useSaveStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useCalendarStore } from './stores/useCalendarStore'
import { usePhotoPrintStore } from './stores/usePhotoPrintStore'
import { core } from '@storige/canvas-core'

const PARENT_ORIGIN = 'https://host.example'
const parentPost = vi.fn()

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

function seedCanvases(n: number) {
  const allCanvas = Array.from({ length: n }, (_, i) => fakeCanvas(`c${i}`))
  const allEditors = Array.from({ length: n }, (_, i) => fakeEditor(`e${i}`))
  act(() => {
    useAppStore.setState({ ready: true, canvas: allCanvas[0], editor: allEditors[0], allCanvas, allEditors, activeSelection: [] } as never)
    useEditorStore.setState({ pages: allCanvas.map(() => ({ templateType: 'page' })) } as never)
    useSaveStore.setState({ isDirty: false } as never)
  })
  return { allCanvas, allEditors }
}

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_free',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true, borderInsetMm: 2 },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 20, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

function wirePhotoProfile(canvasCount: number) {
  act(() => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    useCalendarStore.getState().setFromProfile(photoProfile)
    usePhotoPrintStore.getState().setFromProfile(photoProfile)
    usePhotoPrintStore.getState().syncWithCanvasCount(canvasCount)
    usePhotoPrintStore.getState().setItemOption(1, { copies: 3, border: 'white', grayscale: true })
  })
}

const baseItem = {
  sizeCode: '4x6',
  copies: 1,
  border: 'none',
  fit: 'paper-full',
  finish: 'matte',
  brightnessFix: false,
  dateOverlay: false,
  grayscale: false,
  lowRes: false,
}
const expectedItems = [
  { ...baseItem, index: 0, canvasIndex: 0 },
  { ...baseItem, index: 1, canvasIndex: 2, copies: 3, border: 'white', grayscale: true },
  { ...baseItem, index: 2, canvasIndex: 4 },
]

let lastInstanceRef: { current: EditorInstanceMethods | null } = { current: null }

function renderEmbed(props: Partial<{ sessionId: string }> = {}) {
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
  contentFileId: 'f-content',
  coverFile: null,
  completedAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
}

/** 종전 editor.complete payload 키 집합(NULL 프로파일, 비스프레드, pricing 미설정, 샘플 폴백 없음) — 고정 */
const LEGACY_COMPLETE_KEYS = ['editCode', 'files', 'orderSeqno', 'pageCount', 'pages', 'savedAt', 'sessionId', 'size']

function completePayload(): EditorResult {
  const call = parentPost.mock.calls.find((c) => (c[0] as { event?: string })?.event === 'editor.complete')
  expect(call).toBeDefined()
  return (call![0] as { payload: EditorResult }).payload
}

const canvasDataOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, props: core.extendFabricOption }))

describe('EmbeddedEditor — editor.complete items (P2-d 사진인화)', () => {
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
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 102, height: 152 })
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
      useSettingsStore.getState().setProductProfile(null)
      useCalendarStore.getState().reset()
      usePhotoPrintStore.getState().reset()
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

  it('digital 6캔버스 편집완료: product {photo-print, 6, sheetCount 3, faces 2} + items 3건 + files/pages 불변 + metadata.items PATCH', async () => {
    seedCanvases(6)
    wirePhotoProfile(6)
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    const payload = completePayload()
    expect(payload.product).toEqual({
      kind: 'photo-print',
      editorType: 'photo_digital_free',
      canvasCount: 6,
      sheetCount: 3,
      faces: 2,
    })
    expect(payload.items).toEqual(expectedItems)
    // FROZEN 중첩: files·pages 는 종전과 같은 형태·값
    expect(payload.files).toEqual({ coverFileId: undefined, contentFileId: 'f-content', thumbnailUrl: undefined })
    expect(payload.pages).toEqual({ initial: 1, final: 6 })
    expect(payload.pageCount).toBe(6)
    expect(Object.keys(payload).sort()).toEqual([...LEGACY_COMPLETE_KEYS, 'items', 'product'].sort())
    // 세션 PATCH: canvasData + metadata { productProfile, items } (calendar 키 없음)
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(6),
      metadata: { productProfile: photoProfile, items: expectedItems },
    })
    const metadata = (api.update.mock.calls[0][1] as { metadata: Record<string, unknown> }).metadata
    expect(Object.keys(metadata)).toEqual(['productProfile', 'items'])
  })

  it('항목 수가 캔버스 수와 어긋나 있어도 완료 시점 캔버스 수로 동기화한다(페이지 삭제 뒤)', async () => {
    seedCanvases(4)
    wirePhotoProfile(6) // 스토어엔 3건 — 캔버스는 4장(= 2건)
    renderEmbed({ sessionId: 'sess-1' })
    expect(await finish()).toBe('completed')
    const payload = completePayload()
    expect(payload.product).toMatchObject({ canvasCount: 4, sheetCount: 2 })
    expect(payload.items).toEqual(expectedItems.slice(0, 2))
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(4),
      metadata: { productProfile: photoProfile, items: expectedItems.slice(0, 2) },
    })
  })

  it('NULL 프로파일(legacy) 편집완료: product/items 키 없음, payload 키 집합 종전과 동일, update payload { canvasData } 그대로', async () => {
    seedCanvases(3)
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    const payload = completePayload()
    expect(payload).not.toHaveProperty('product')
    expect(payload).not.toHaveProperty('items')
    expect(Object.keys(payload).sort()).toEqual(LEGACY_COMPLETE_KEYS)
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: canvasDataOf(3) })
    const updateArg = api.update.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(updateArg)).toEqual(['canvasData'])
  })

  it('instance.save / instance.complete (프로그래매틱): photo-print 세트는 metadata.items + items, legacy 는 종전 payload', async () => {
    seedCanvases(6)
    wirePhotoProfile(6)
    api.update.mockResolvedValue({ id: 'sess-1', updatedAt: '2026-10-19T00:00:00.000Z', coverFile: null })
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(6),
      status: 'editing',
      metadata: { productProfile: photoProfile, items: expectedItems },
    })

    api.update.mockClear()
    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(6),
      metadata: { productProfile: photoProfile, items: expectedItems },
    })
    expect(completePayload().items).toEqual(expectedItems)
    expect(completePayload().product).toMatchObject({ kind: 'photo-print', sheetCount: 3 })

    // legacy: 프로파일 제거 후 같은 인스턴스 경로 → 종전 payload 그대로
    act(() => {
      useSettingsStore.getState().setProductProfile(null)
      usePhotoPrintStore.getState().reset()
    })
    api.update.mockClear()
    parentPost.mockReset()
    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: canvasDataOf(6), status: 'editing' })
    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenLastCalledWith('sess-1', { canvasData: canvasDataOf(6) })
    expect(completePayload()).not.toHaveProperty('product')
    expect(completePayload()).not.toHaveProperty('items')
  })
})
