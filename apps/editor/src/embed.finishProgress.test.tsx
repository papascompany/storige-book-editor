/**
 * B10 (2026-10-25): 편집완료 진행 표시(단계·캔버스 진행 수) + 진행 중 이탈 경고(beforeunload).
 *   - 회원 단일모드: 저장 → PDF 생성(ServicePlugin onProgress 로 캔버스 n/총수) → 업로드 → 완료 단계 갱신,
 *     진행 중 beforeunload 는 preventDefault, editor.complete 발신 시점엔 이미 해제(호스트 즉시 이동에 경고 없음)
 *   - 실패: 오버레이 닫힘·경고 해제, editor.error 페이로드는 종전과 같음
 *   - 비회원: 저장 단계 같은 오버레이·경고, editor.complete → editor.needAuth 순서 유지
 *   - 진행 표시를 위한 새 postMessage 는 없다(이벤트 목록 고정)
 *
 * 하네스는 embed.singleModeMultiCanvasPdf.test.tsx / embed.finishOutcome.test.tsx 를 준용한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'
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
  upload: vi.fn(),
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
  filesApi: { upload: (...a: unknown[]) => api.upload(...(a as [])) },
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ role: 'customer' })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useEditorStore } from './stores/useEditorStore'
import { useSaveStore } from './stores/useSaveStore'

const PARENT_ORIGIN = 'https://host.example'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

/** 각 발신 시점에 beforeunload 를 쏴서 경고가 걸려 있었는지 기록한다(동기 해제 검증). */
const guardAtPost: Array<{ event: string; prevented: boolean }> = []
const parentPost = vi.fn((msg: Envelope) => {
  guardAtPost.push({ event: msg.event, prevented: fireBeforeUnload() })
})

function fireBeforeUnload(): boolean {
  const ev = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(ev)
  return ev.defaultPrevented
}

function postedEvents(): string[] {
  return parentPost.mock.calls.map(([m]) => (m as Envelope).event)
}
function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.map(([m]) => m as Envelope).filter((m) => m.event === event).map((m) => m.payload)
}

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

type OnProgress = (page: number, total: number) => void

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const saveMultiPagePDFAsBlob = vi.fn<(...args: unknown[]) => Promise<Blob | null>>(async () => null)
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
}

function renderEmbed(props: Partial<{ sessionId: string }> = {}) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(<EmbeddedEditor templateSetId="ts-test" parentOrigin={PARENT_ORIGIN} instanceRef={instanceRef} {...props} />)
}

function stageStates(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const li of Array.from(document.querySelectorAll('[data-testid="finish-progress-overlay"] li[data-stage]'))) {
    out[li.getAttribute('data-stage') ?? ''] = li.getAttribute('data-state')
  }
  return out
}
function activeStage(): string | undefined {
  return Object.entries(stageStates()).find(([, s]) => s === 'active')?.[0]
}

const COMPLETED_SESSION = {
  id: 'sess-1',
  orderSeqno: 1234567890123,
  status: 'completed',
  coverFileId: 'f-cover',
  contentFileId: null,
  coverFile: null,
  completedAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
}

describe('EmbeddedEditor — B10 편집완료 진행 표시·이탈 경고', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    captured.onFinish = null
    parentPost.mockClear()
    guardAtPost.length = 0
    saveMultiPagePDFAsBlob.mockReset()
    saveMultiPagePDFAsBlob.mockImplementation(async () => null)
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

  it('B10-1 회원: 저장 → 생성(n/총수) → 업로드 → 완료 단계 갱신, 진행 중 경고, editor.complete 발신 전 해제', async () => {
    seedCanvases(3)
    const save = deferred<{ id: string }>()
    api.update.mockReturnValueOnce(save.promise)
    const gen = deferred<Blob | null>()
    let onProgress: OnProgress | undefined
    saveMultiPagePDFAsBlob.mockImplementation((...args: unknown[]) => {
      onProgress = args[6] as OnProgress
      return gen.promise
    })
    const upload = deferred<{ id: string }>()
    api.upload.mockReturnValueOnce(upload.promise)
    const done = deferred<typeof COMPLETED_SESSION>()
    api.complete.mockReturnValueOnce(done.promise)

    renderEmbed({ sessionId: 'sess-1' })
    expect(screen.queryByTestId('finish-progress-overlay')).toBeNull()
    expect(fireBeforeUnload()).toBe(false)

    let finishPromise!: Promise<FinishOutcome | void>
    act(() => {
      finishPromise = captured.onFinish!()
    })

    // 저장 단계
    expect(activeStage()).toBe('save')
    expect(fireBeforeUnload()).toBe(true)

    // PDF 생성 단계 — onProgress(캔버스 시작 시 1-based) 로 진행 수 갱신
    await act(async () => {
      save.resolve({ id: 'sess-1' })
    })
    await waitFor(() => expect(saveMultiPagePDFAsBlob).toHaveBeenCalledTimes(1))
    expect(typeof onProgress).toBe('function')
    expect(activeStage()).toBe('generate')
    act(() => onProgress!(1, 3))
    expect(screen.getByTestId('finish-progress-count').textContent).toBe('캔버스 1 / 3')
    act(() => onProgress!(3, 3))
    expect(screen.getByTestId('finish-progress-count').textContent).toBe('캔버스 3 / 3')
    expect(fireBeforeUnload()).toBe(true)

    // 업로드 단계
    await act(async () => {
      gen.resolve(new Blob(['%PDF']))
    })
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1))
    expect(activeStage()).toBe('upload')
    expect(screen.queryByTestId('finish-progress-count')).toBeNull()
    expect(fireBeforeUnload()).toBe(true)

    // 완료 단계
    await act(async () => {
      upload.resolve({ id: 'f-cover' })
    })
    await waitFor(() => expect(api.complete).toHaveBeenCalledTimes(1))
    expect(activeStage()).toBe('complete')
    expect(fireBeforeUnload()).toBe(true)
    // 진행 표시를 위해 보낸 postMessage 없음
    expect(postedEvents()).toEqual([])

    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      done.resolve(COMPLETED_SESSION)
      outcome = await finishPromise
    })
    expect(outcome).toBe('completed')
    expect(postedEvents()).toEqual(['editor.complete'])
    expect(posted('editor.complete')[0]).toMatchObject({
      sessionId: 'sess-1',
      files: { coverFileId: 'f-cover', contentFileId: undefined, thumbnailUrl: undefined },
      pageCount: 3,
    })
    // editor.complete 발신 시점에 경고는 이미 해제(호스트가 곧바로 이동해도 경고 없음)
    expect(guardAtPost).toEqual([{ event: 'editor.complete', prevented: false }])
    expect(screen.queryByTestId('finish-progress-overlay')).toBeNull()
    expect(fireBeforeUnload()).toBe(false)
  })

  it('B10-2 회원 완료 실패: 오버레이 닫힘·경고 해제, editor.error 페이로드 종전 그대로', async () => {
    seedCanvases(1)
    const failed = new Error('complete boom')
    api.complete.mockRejectedValueOnce(failed)
    renderEmbed({ sessionId: 'sess-1' })

    let rejected: unknown = null
    await act(async () => {
      try {
        await captured.onFinish!()
      } catch (e) {
        rejected = e
      }
    })
    expect(rejected).toBe(failed)
    expect(postedEvents()).toEqual(['editor.error'])
    expect(posted('editor.error')[0]).toEqual({ code: 'SAVE_FAILED', message: expect.any(String), fatal: false })
    expect(guardAtPost).toEqual([{ event: 'editor.error', prevented: false }])
    expect(screen.queryByTestId('finish-progress-overlay')).toBeNull()
    expect(fireBeforeUnload()).toBe(false)
  })

  it('B10-3 비회원: 저장 단계 같은 오버레이·경고, editor.complete → editor.needAuth 순서 유지·발신 전 해제', async () => {
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
    })
    api.get.mockResolvedValue({
      id: 'sess-guest-1',
      status: 'editing',
      templateSetId: 'ts-test',
      canvasData: null,
      metadata: {},
      guestToken: 'gt-1',
      guestExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    const save = deferred<{ id: string }>()
    api.updateGuest.mockReturnValueOnce(save.promise)
    renderEmbed({ sessionId: 'sess-guest-1' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    parentPost.mockClear()
    guardAtPost.length = 0

    let finishPromise!: Promise<FinishOutcome | void>
    act(() => {
      finishPromise = captured.onFinish!()
    })
    expect(activeStage()).toBe('save')
    expect(fireBeforeUnload()).toBe(true)

    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      save.resolve({ id: 'sess-guest-1' })
      outcome = await finishPromise
    })
    expect(outcome).toBe('needsAuth')
    expect(postedEvents()).toEqual(['editor.complete', 'editor.needAuth'])
    expect(posted('editor.complete')[0]).toMatchObject({ needsAuth: true, guestToken: 'gt-1', files: {} })
    expect(guardAtPost).toEqual([
      { event: 'editor.complete', prevented: false },
      { event: 'editor.needAuth', prevented: false },
    ])
    expect(screen.queryByTestId('finish-progress-overlay')).toBeNull()
    expect(saveMultiPagePDFAsBlob).not.toHaveBeenCalled()
  })

  it('B10-4 세션 없음(skipped): 오버레이·경고 없음', async () => {
    seedCanvases(1)
    renderEmbed()
    await act(async () => {
      await captured.onFinish!()
    })
    expect(screen.queryByTestId('finish-progress-overlay')).toBeNull()
    expect(fireBeforeUnload()).toBe(false)
    expect(postedEvents()).toEqual([])
  })
})
