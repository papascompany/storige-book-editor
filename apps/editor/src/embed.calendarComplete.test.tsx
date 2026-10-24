/**
 * P1-d 캘린더 (2026-10-17): editor.complete additive `product` 키 + 세션 PATCH metadata.calendar.
 *   - calendar 프로파일 세트(26캔버스): result 에 product {kind:'calendar', editorType, canvasCount:26, sheetCount:13, faces:2},
 *     `files`·`pages` 중첩 구조 불변, 세션 update 에 metadata { productProfile, calendar } 동봉.
 *   - NULL 프로파일(legacy): result 에 product 키 없음, payload 키 집합이 기존과 동일, update payload 는 { canvasData } 그대로.
 *   - instance.complete(프로그래매틱) 경로도 같은 product 값.
 *
 * 하네스는 embed.singleModeMultiCanvasPdf.test.tsx 를 준용한다(store.ready=true 로 초기화 생략, 캔버스·에디터는 더미).
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

const calendarProfile: ProductProfile = {
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

function wireCalendarProfile() {
  act(() => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    useCalendarStore.getState().setFromProfile(calendarProfile)
    useCalendarStore.getState().setStartMonth(2027, 3)
    useCalendarStore.getState().addAnniversary({ id: 'a1', date: '2027-05-05', lunar: false, text: '생일' })
  })
}

const expectedCalendarMeta = {
  startYear: 2027,
  startMonth: 3,
  show: { holidays: true, lunar: false, solarTerms: false },
  anniversaries: [{ id: 'a1', date: '2027-05-05', lunar: false, text: '생일' }],
  dataVersion: 'kr-2025-2035-v1',
}

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
  completedAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
}

/** 종전 editor.complete payload 키 집합(NULL 프로파일, 비스프레드, pricing 미설정, 샘플 폴백 없음) — 고정 */
const LEGACY_COMPLETE_KEYS = ['editCode', 'files', 'orderSeqno', 'pageCount', 'pages', 'savedAt', 'sessionId', 'size']

function completePayload(): EditorResult {
  const call = parentPost.mock.calls.find((c) => (c[0] as { event?: string })?.event === 'editor.complete')
  expect(call).toBeDefined()
  return (call![0] as { payload: EditorResult }).payload
}

const canvasDataOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, props: core.extendFabricOption }))

describe('EmbeddedEditor — editor.complete product (P1-d 캘린더)', () => {
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
      useSettingsStore.getState().setProductProfile(null)
      useCalendarStore.getState().reset()
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

  it('calendar 프로파일 26캔버스 편집완료: product {calendar, 26, sheetCount 13, faces 2} + files/pages 중첩 불변 + metadata.calendar PATCH', async () => {
    seedCanvases(26)
    wireCalendarProfile()
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    const payload = completePayload()
    expect(payload.product).toEqual({
      kind: 'calendar',
      editorType: 'calendar_desk_large',
      canvasCount: 26,
      sheetCount: 13,
      faces: 2,
    })
    // FROZEN 중첩: files·pages 는 종전과 같은 형태·값
    expect(payload.files).toEqual({ coverFileId: undefined, contentFileId: 'f-content', thumbnailUrl: undefined })
    expect(payload.pages).toEqual({ initial: 1, final: 26 })
    expect(payload.pageCount).toBe(26)
    expect(Object.keys(payload).sort()).toEqual([...LEGACY_COMPLETE_KEYS, 'product'].sort())
    // 세션 PATCH: canvasData + metadata { productProfile, calendar } (API 얕은 병합)
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(26),
      metadata: { productProfile: calendarProfile, calendar: expectedCalendarMeta },
    })
    // 프로파일 세트 전용 PDF export 옵션(2026-10-17): 8번째 인자로 세 옵션 true.
    // 7번째(onProgress)는 B10(2026-10-25)부터 편집완료 진행 표시용 콜백(출력 무영향, 진행 보고 전용)
    expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1)
    const pdfArgs = saveMultiPagePDFAsBlob.mock.calls[0] as unknown[]
    expect(pdfArgs[4]).toBeUndefined()
    expect(pdfArgs[5]).toBe(300)
    expect(typeof pdfArgs[6]).toBe('function')
    expect(pdfArgs[7]).toEqual({ omitUnusedFonts: true, excludeWorkspaceFromExport: true, neutralizeTransparentFills: true })
  })

  it('NULL 프로파일(legacy) 편집완료: product 키 없음, payload 키 집합 종전과 동일, update payload { canvasData } 그대로', async () => {
    seedCanvases(3)
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    // 프로파일 NULL 세트는 export 옵션 미전달(undefined) — ServicePlugin 종전 경로·바이트 그대로
    expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1)
    const pdfArgs = saveMultiPagePDFAsBlob.mock.calls[0] as unknown[]
    expect(pdfArgs[5]).toBe(300)
    expect(pdfArgs[7]).toBeUndefined()
    const payload = completePayload()
    expect(payload).not.toHaveProperty('product')
    expect(Object.keys(payload).sort()).toEqual(LEGACY_COMPLETE_KEYS)
    expect(payload.files).toEqual({ coverFileId: undefined, contentFileId: 'f-content', thumbnailUrl: undefined })
    expect(payload.pages).toEqual({ initial: 1, final: 3 })
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: canvasDataOf(3) })
    const updateArg = api.update.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(updateArg)).toEqual(['canvasData'])
  })

  it('instance.complete / instance.save (프로그래매틱): calendar 세트는 product + metadata.calendar, legacy 는 종전 payload', async () => {
    seedCanvases(26)
    wireCalendarProfile()
    api.update.mockResolvedValue({ id: 'sess-1', updatedAt: '2026-10-17T00:00:00.000Z', coverFile: null })
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(26),
      status: 'editing',
      metadata: { productProfile: calendarProfile, calendar: expectedCalendarMeta },
    })

    api.update.mockClear()
    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', {
      canvasData: canvasDataOf(26),
      metadata: { productProfile: calendarProfile, calendar: expectedCalendarMeta },
    })
    expect(completePayload().product).toEqual({
      kind: 'calendar',
      editorType: 'calendar_desk_large',
      canvasCount: 26,
      sheetCount: 13,
      faces: 2,
    })

    // legacy: 프로파일 제거 후 같은 인스턴스 경로 → 종전 payload 그대로
    act(() => {
      useSettingsStore.getState().setProductProfile(null)
      useCalendarStore.getState().reset()
    })
    api.update.mockClear()
    parentPost.mockReset()
    await act(async () => {
      await lastInstanceRef.current!.save()
    })
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: canvasDataOf(26), status: 'editing' })
    await act(async () => {
      await lastInstanceRef.current!.complete()
    })
    expect(api.update).toHaveBeenLastCalledWith('sess-1', { canvasData: canvasDataOf(26) })
    expect(completePayload()).not.toHaveProperty('product')
  })

  it('sheet 프로파일(faces=1, 3캔버스): product {sheet, canvasCount 3, sheetCount 3, faces 1}', async () => {
    seedCanvases(3)
    const sheetProfile: ProductProfile = {
      version: 1,
      kind: 'sheet',
      editorType: 'sheet_single',
      pages: { kind: 'range', min: 1, max: 10, labelRule: 'sheet' },
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
      output: { mode: 'single-pdf' },
    }
    act(() => {
      useSettingsStore.getState().setProductProfile(sheetProfile)
      useCalendarStore.getState().setFromProfile(sheetProfile)
    })
    renderEmbed({ sessionId: 'sess-1' })

    expect(await finish()).toBe('completed')
    expect(completePayload().product).toEqual({ kind: 'sheet', editorType: 'sheet_single', canvasCount: 3, sheetCount: 3, faces: 1 })
    // 캘린더가 아니면 metadata.calendar 는 싣지 않는다
    expect(api.update).toHaveBeenCalledWith('sess-1', { canvasData: canvasDataOf(3) })
  })
})
