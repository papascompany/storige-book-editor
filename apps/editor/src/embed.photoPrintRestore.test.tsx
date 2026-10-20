/**
 * P2-d 사진인화 (2026-10-19): 세션 복원·런처 선생성 세션의 캔버스 수 (D1 editor-flow-4 / D2 editor-flow-3·tests-2·contract-4).
 *
 * 잠그는 것:
 *   D1-a 재오픈(canvasData 4장): 로더에 restoredInnerCanvasCount 3(= length−1, 로더가 kind 'photo-print' 면 +1 로 4장 시드)·
 *        photoItemCount 없음 → 로더가 4장을 시드하면 증설 없이 4장 전량 복원, "세션 복원 캔버스 부족" 오류 로그 없음.
 *   D1-b 심층방어: 로더가 3장만 시드해도 사진인화 세트는 addPage 로 1장 증설해 4장 전량 복원(오류 로그 없음).
 *        NULL 프로파일 단일 모드는 종전대로 증설 없이 오류 로그 1회(바이트 동일).
 *   D2   런처 선생성(canvasData 없음, metadata.items 2건): 로더에 photoItemCount 2 → 로더가 4장(2×stride) 시드 →
 *        스토어 items 2건(copies 5/2·옵션 보존, 잘림 없음) → 첫 저장(instance.save) payload 의 metadata.items 2건.
 *        items 가 없으면 photoItemCount 키 자체가 없다.
 *
 * 하네스는 embed.guestReopen.test.tsx 를 준용한다(초기화 경로 실행, useEditorContents 는 로더 시뮬레이션 mock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'

vi.mock('./components/editor/EditorHeader', () => ({ default: () => null }))
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

const contents = vi.hoisted(() => ({
  loadTemplateSetEditor: vi.fn(async (_config: unknown) => undefined),
}))
vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({
    loadEmptyEditor: vi.fn(),
    loadTemplateSetEditor: (config: unknown) => contents.loadTemplateSetEditor(config),
  }),
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
const loadFromJSON = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  return { ...actual, core: { ...actual.core, loadFromJSON: (...a: unknown[]) => loadFromJSON(...(a as [])) } }
})

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
  update: vi.fn(),
  updateGuest: vi.fn(),
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
import { useSettingsStore } from './stores/useSettingsStore'
import { usePhotoPrintStore } from './stores/usePhotoPrintStore'
import { core } from '@storige/canvas-core'

const PARENT_ORIGIN = 'https://host.example'
const SESSION_ID = 'sess-photo-1'

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

function fakeCanvas(id: string) {
  return {
    id,
    toJSON: vi.fn((props: string[]) => ({ id, props })),
    on: () => {},
    off: () => {},
    getObjects: () => [],
    requestRenderAll: () => {},
    renderAll: () => {},
    discardActiveObject: () => {},
    setDimensions: () => {},
  }
}
function fakeEditor(id: string) {
  return { id, getPlugin: () => undefined, on: () => {}, off: () => {}, emit: () => {} }
}

const addPage = vi.fn(async () => {
  const s = useAppStore.getState()
  const k = s.allCanvas.length
  useAppStore.setState({ allCanvas: [...s.allCanvas, fakeCanvas(`grown${k}`)], allEditors: [...s.allEditors, fakeEditor(`e${k}`)] } as never)
})

/** 로더 시뮬레이션 — 프로파일 배선 + count 장 캔버스 등록(useEditorContents.loadTemplateSetEditor 의 결과 상태) */
function seedLoader(profile: ProductProfile | null, count: number) {
  const allCanvas = Array.from({ length: count }, (_, i) => fakeCanvas(`c${i}`))
  const allEditors = Array.from({ length: count }, (_, i) => fakeEditor(`e${i}`))
  useSettingsStore.getState().setProductProfile(profile)
  usePhotoPrintStore.getState().setFromProfile(profile)
  useAppStore.setState({
    canvas: allCanvas[0],
    editor: allEditors[0],
    allCanvas,
    allEditors,
    activeSelection: [],
    isSpreadMode: false,
    addPage,
    setPage: vi.fn(),
  } as never)
  useEditorStore.setState({ pages: allCanvas.map(() => ({ templateType: 'page' })) } as never)
}

type LoaderConfig = { restoredInnerCanvasCount?: number; photoItemCount?: number; pageCount?: number }
function loaderConfig(): LoaderConfig {
  expect(contents.loadTemplateSetEditor).toHaveBeenCalledTimes(1)
  return contents.loadTemplateSetEditor.mock.calls[0][0] as LoaderConfig
}

function session(overrides: Record<string, unknown> = {}) {
  return { id: SESSION_ID, status: 'editing', templateSetId: 'ts-test', canvasData: null, metadata: {}, guestToken: null, ...overrides }
}
const canvasDataOf = (n: number) => Array.from({ length: n }, (_, i) => ({ saved: i }))

let lastInstanceRef: { current: EditorInstanceMethods | null } = { current: null }
function renderEmbed() {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  lastInstanceRef = instanceRef
  return render(<EmbeddedEditor templateSetId="ts-test" sessionId={SESSION_ID} parentOrigin={PARENT_ORIGIN} instanceRef={instanceRef} />)
}

async function flushInit() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

describe('EmbeddedEditor — 사진인화 세션 복원·런처 items 캔버스 수 (D1/D2)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  const parentPost = vi.fn()
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', { value: { postMessage: parentPost }, configurable: true, writable: true })
    sessionStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 102, height: 152 })
    api.update.mockResolvedValue({ id: SESSION_ID, updatedAt: '2026-10-19T00:00:00.000Z', coverFile: null })
    contents.loadTemplateSetEditor.mockReset()
    loadFromJSON.mockClear()
    addPage.mockClear()
    localStorage.setItem('auth_token', 'test-token')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, editor: null, allCanvas: [], allEditors: [], activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
      useSettingsStore.getState().setProductProfile(null)
      usePhotoPrintStore.getState().reset()
    })
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
      usePhotoPrintStore.getState().reset()
    })
  })

  const deficitErrors = () => errorSpy.mock.calls.filter((c) => String(c[0]).includes('세션 복원 캔버스 부족'))

  it('D1-a 재오픈 canvasData 4장: 로더 config restoredInnerCanvasCount 3·photoItemCount 없음, 로더가 4장 시드하면 증설 없이 4장 전량 복원·오류 로그 없음', async () => {
    api.get.mockResolvedValue(session({ canvasData: canvasDataOf(4), metadata: { items: [{ copies: 5 }, { copies: 2 }] } }))
    contents.loadTemplateSetEditor.mockImplementation(async () => { seedLoader(photoProfile, 4) })
    renderEmbed()
    await flushInit()

    const config = loaderConfig()
    expect(config.restoredInnerCanvasCount).toBe(3)
    expect(config).not.toHaveProperty('photoItemCount')
    expect(addPage).not.toHaveBeenCalled()
    expect(loadFromJSON).toHaveBeenCalledTimes(4)
    expect(useAppStore.getState().allCanvas).toHaveLength(4)
    expect(deficitErrors()).toHaveLength(0)
    // 저장 items 2건은 그대로(캔버스 4 = 2건)
    expect(usePhotoPrintStore.getState().items.map((i) => i.copies)).toEqual([5, 2])
  })

  it('D1-b 심층방어: 로더가 3장만 시드해도 사진인화 세트는 addPage 1회로 4장 전량 복원(오류 로그 없음)', async () => {
    api.get.mockResolvedValue(session({ canvasData: canvasDataOf(4) }))
    contents.loadTemplateSetEditor.mockImplementation(async () => { seedLoader(photoProfile, 3) })
    renderEmbed()
    await flushInit()

    expect(addPage).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().allCanvas).toHaveLength(4)
    expect(loadFromJSON).toHaveBeenCalledTimes(4)
    expect(deficitErrors()).toHaveLength(0)
  })

  it('D1-b 대조(NULL 프로파일 단일 모드): 증설 없이 3장만 복원 + "세션 복원 캔버스 부족" 오류 로그 1회(종전 동작)', async () => {
    api.get.mockResolvedValue(session({ canvasData: canvasDataOf(4) }))
    contents.loadTemplateSetEditor.mockImplementation(async () => { seedLoader(null, 3) })
    renderEmbed()
    await flushInit()

    expect(addPage).not.toHaveBeenCalled()
    expect(useAppStore.getState().allCanvas).toHaveLength(3)
    expect(loadFromJSON).toHaveBeenCalledTimes(3)
    expect(deficitErrors()).toHaveLength(1)
  })

  it('D2 런처 선생성(canvasData 없음, items 2건): 로더 config photoItemCount 2 → 4장 시드 → 스토어 items 2건(copies 5/2·옵션 보존) → 첫 저장 metadata.items 2건', async () => {
    api.get.mockResolvedValue(
      session({ metadata: { items: [{ copies: 5 }, { copies: 2, border: 'white', fit: 'image-full', grayscale: true }] } }),
    )
    contents.loadTemplateSetEditor.mockImplementation(async (config: unknown) => {
      const n = (config as LoaderConfig).photoItemCount ?? 1
      seedLoader(photoProfile, n * 2)
    })
    renderEmbed()
    await flushInit()

    expect(loaderConfig().photoItemCount).toBe(2)
    expect(useAppStore.getState().allCanvas).toHaveLength(4)
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ index: 0, canvasIndex: 0, copies: 5 })
    expect(items[1]).toMatchObject({ index: 1, canvasIndex: 2, copies: 2, border: 'white', fit: 'image-full', grayscale: true })

    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledTimes(1)
    const payload = api.update.mock.calls[0][1] as { canvasData: unknown[]; metadata: { items: Array<{ copies: number }> } }
    expect(payload.canvasData).toHaveLength(4)
    expect(payload.metadata.items.map((i) => i.copies)).toEqual([5, 2])
    expect(payload.canvasData[0]).toEqual({ id: 'c0', props: core.extendFabricOption })
  })

  it('D2 대조: metadata.items 없음 → 로더 config 에 photoItemCount 키 없음, 무편집 세션은 dirty 아님, 첫 저장은 프로파일 기본 항목(2장 = 1건)', async () => {
    api.get.mockResolvedValue(session())
    contents.loadTemplateSetEditor.mockImplementation(async () => { seedLoader(photoProfile, 2) })
    renderEmbed()
    await flushInit()

    expect(loaderConfig()).not.toHaveProperty('photoItemCount')
    expect(useSaveStore.getState().isDirty).toBe(false)
    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    const payload = api.update.mock.calls[0][1] as { canvasData: unknown[]; metadata: { items: Array<{ copies: number }> } }
    expect(payload.canvasData).toHaveLength(2)
    expect(payload.metadata.items.map((i) => i.copies)).toEqual([1])
  })
})
