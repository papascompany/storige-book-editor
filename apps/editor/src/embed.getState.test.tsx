/**
 * getState 명령 응답(editor.state)과 IIFE getState() 의 쪽수·현재 화면 순번.
 *   - 초기화 완료 뒤에만 pageCount·currentPage 를 싣는다(기존 4키·requestId echo 그대로).
 *   - currentPage 는 편집 대상 캔버스 위치를 모르면 키를 뺀다(IIFE 는 0).
 *   - pageCount 는 같은 상태의 editor.complete(헤더 편집완료·인스턴스 complete) pageCount 와 같다.
 *   - 변경 이력 복원 중에는 키가 없고, 재초기화 뒤 키가 돌아온다(editor.ready 는 1회).
 *
 * 하네스는 embed.finishOutcome.test.tsx 를 준용한다(전체 초기화는 회원 세션 조회 → 템플릿 로드 스텁).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import type { FinishOutcome } from './utils/finishOutcome'

const captured = vi.hoisted(() => ({
  onFinish: null as null | (() => Promise<FinishOutcome | void>),
  sessionVersions: null as null | { list: () => Promise<unknown>; restore: (id: string) => Promise<void> },
}))

vi.mock('./components/editor/EditorHeader', () => ({
  default: (props: {
    onFinish?: () => Promise<FinishOutcome | void>
    sessionVersions?: typeof captured.sessionVersions
  }) => {
    captured.onFinish = props.onFinish ?? null
    captured.sessionVersions = props.sessionVersions ?? null
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
vi.mock('./hooks/useSnapSettingsSync', () => ({ useSnapSettingsSync: () => undefined }))
vi.mock('./hooks/useCoverRegion', () => ({
  useObjectOutOfTrimToast: () => undefined,
  useSafeZoneWarningToast: () => undefined,
  useImageLowDpiToast: () => undefined,
}))
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

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
  update: vi.fn(),
  updateGuest: vi.fn(),
  complete: vi.fn(),
  restoreVersion: vi.fn(),
  restoreGuestVersion: vi.fn(),
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
    restoreVersion: (...a: unknown[]) => api.restoreVersion(...(a as [])),
    restoreGuestVersion: (...a: unknown[]) => api.restoreGuestVersion(...(a as [])),
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: { getTemplateSetWithTemplates: (...a: unknown[]) => api.getTemplateSetWithTemplates(...(a as [])) },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ role: 'customer' })) },
}))

import {
  EmbeddedEditor,
  EMBED_HOST_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  StorigeEditorInstance,
  type EditorInstanceMethods,
} from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useEditorStore } from './stores/useEditorStore'

const PARENT_ORIGIN = 'https://host.example'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

type WindowLike = typeof window
type MessageSource = MessageEvent['source']

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()
let parentStub: WindowLike

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function requestState(requestId: string): Record<string, unknown> {
  const before = posted('editor.state').length
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: EMBED_HOST_MESSAGE_SOURCE, version: EMBED_MESSAGE_VERSION, command: 'getState', requestId },
        origin: PARENT_ORIGIN,
        source: parentStub as MessageSource,
      }),
    )
  })
  const states = posted('editor.state')
  expect(states).toHaveLength(before + 1)
  return states[states.length - 1]
}

const MEMBER_SESSION = {
  id: 'sess-1',
  orderSeqno: 1234567890123,
  status: 'editing',
  templateSetId: 'ts-test',
  canvasData: null,
  metadata: {},
  guestToken: null,
  updatedAt: '2026-10-03T00:00:00.000Z',
}

const COMPLETED_SESSION = {
  ...MEMBER_SESSION,
  status: 'completed',
  coverFileId: null,
  contentFileId: null,
  coverFile: null,
  completedAt: '2026-10-03T00:00:00.000Z',
}

function renderEmbed(instanceRef = { current: null as EditorInstanceMethods | null }) {
  const view = render(
    <EmbeddedEditor templateSetId="ts-test" sessionId="sess-1" parentOrigin={PARENT_ORIGIN} instanceRef={instanceRef} />,
  )
  return { ...view, instanceRef }
}

async function renderInitialized() {
  api.get.mockResolvedValue(MEMBER_SESSION)
  const result = renderEmbed()
  await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
  return result
}

function fakeCanvas(id: string) {
  return { id, toJSON: () => ({ id }), getObjects: () => [], off: () => {}, dispose: () => {} }
}

interface PageFixture {
  count: number
  /** 1부터 센 편집 대상 캔버스. 0 이면 편집 대상 없음 */
  current: number
  isSpreadMode: boolean
  regionScope: 'inner' | 'cover' | null
  pagesPerCanvas: number
}

function setPages(f: PageFixture) {
  const all = Array.from({ length: f.count }, (_, i) => fakeCanvas(`c${i + 1}`))
  act(() => {
    useAppStore.setState({ allCanvas: all, canvas: f.current > 0 ? all[f.current - 1] : null, isSpreadMode: f.isSpreadMode } as never)
    useSettingsStore.setState({ spreadConfig: f.regionScope ? { regionScope: f.regionScope } : null } as never)
    useEditorStore.setState({ pagesPerCanvas: f.pagesPerCanvas } as never)
  })
}

function resetStores() {
  act(() => {
    useAppStore.setState({ ready: false, canvas: null, allCanvas: [], activeSelection: [], isSpreadMode: false } as never)
    useSaveStore.setState({ isDirty: false } as never)
    useSettingsStore.setState({ spreadConfig: null } as never)
    useEditorStore.setState({ pagesPerCanvas: 1 } as never)
  })
}

describe('EmbeddedEditor — getState 쪽수·현재 화면 순번', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    captured.onFinish = null
    captured.sessionVersions = null
    parentPost.mockReset()
    parentStub = { postMessage: parentPost } as unknown as WindowLike
    Object.defineProperty(window, 'parent', { value: parentStub, configurable: true, writable: true })
    sessionStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 210, height: 297 })
    localStorage.setItem('auth_token', 'test-token')
    resetStores()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    resetStores()
  })

  it('G1 초기화를 거치지 않은 상태의 editor.state 는 기본 4키만', () => {
    act(() => {
      useAppStore.setState({ ready: true } as never)
    })
    const { instanceRef } = renderEmbed()
    expect(requestState('r1')).toEqual({ requestId: 'r1', ready: true, dirty: false, sessionId: 'sess-1' })
    expect(instanceRef.current!.getState()).toEqual({ ready: true, modified: false, currentPage: 0, totalPages: 0 })
  })

  it('G2 초기화 완료 뒤 editor.state 에 pageCount·currentPage 가 실리고 기존 키·requestId 는 그대로', async () => {
    const { instanceRef } = await renderInitialized()
    setPages({ count: 3, current: 2, isSpreadMode: false, regionScope: null, pagesPerCanvas: 1 })
    expect(requestState('r2')).toEqual({
      requestId: 'r2',
      ready: true,
      dirty: false,
      sessionId: 'sess-1',
      pageCount: 3,
      currentPage: 2,
    })
    expect(Object.keys(requestState('r2b'))).toEqual(['requestId', 'ready', 'dirty', 'sessionId', 'pageCount', 'currentPage'])
    expect(instanceRef.current!.getState()).toEqual({ ready: true, modified: false, currentPage: 2, totalPages: 3 })
  })

  it('G3 내지 전용 펼침면 캔버스 4 · 4번째 → pageCount 8 / currentPage 4', async () => {
    await renderInitialized()
    setPages({ count: 4, current: 4, isSpreadMode: true, regionScope: 'inner', pagesPerCanvas: 1 })
    expect(requestState('r3')).toMatchObject({ pageCount: 8, currentPage: 4 })
  })

  it('G4 표지+펼침면 내지 캔버스 11 → 표지면 currentPage 1, 6번째면 6 (pageCount 20)', async () => {
    await renderInitialized()
    setPages({ count: 11, current: 1, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 2 })
    expect(requestState('r4')).toMatchObject({ pageCount: 20, currentPage: 1 })
    act(() => {
      useAppStore.setState({ canvas: useAppStore.getState().allCanvas[5] } as never)
    })
    expect(requestState('r4b')).toMatchObject({ pageCount: 20, currentPage: 6 })
  })

  it('G4b 편집 대상 캔버스를 모르면 currentPage 키를 빼고 IIFE currentPage 는 0', async () => {
    const { instanceRef } = await renderInitialized()
    setPages({ count: 3, current: 0, isSpreadMode: false, regionScope: null, pagesPerCanvas: 1 })
    const state = requestState('r4c')
    expect(state).toEqual({ requestId: 'r4c', ready: true, dirty: false, sessionId: 'sess-1', pageCount: 3 })
    expect('currentPage' in state).toBe(false)
    expect(instanceRef.current!.getState()).toEqual({ ready: true, modified: false, currentPage: 0, totalPages: 3 })
  })

  it.each([
    ['낱장', { count: 5, current: 3, isSpreadMode: false, regionScope: null, pagesPerCanvas: 1 }, 5],
    ['내지 전용 펼침면', { count: 10, current: 1, isSpreadMode: true, regionScope: 'inner', pagesPerCanvas: 1 }, 20],
    ['표지+펼침면 내지', { count: 11, current: 1, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 2 }, 20],
    ['표지+낱장 내지', { count: 21, current: 6, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 1 }, 20],
  ] as const)(
    'G5 %s — editor.state pageCount 는 헤더 편집완료·인스턴스 complete 의 editor.complete pageCount 와 같다',
    async (_label, fixture, expectedPageCount) => {
      const { instanceRef } = await renderInitialized()
      setPages(fixture)
      api.update.mockResolvedValue({ id: 'sess-1' })
      api.complete.mockResolvedValue(COMPLETED_SESSION)

      const statePageCount = requestState('r5').pageCount
      expect(statePageCount).toBe(expectedPageCount)
      expect(instanceRef.current!.getState().totalPages).toBe(expectedPageCount)

      await act(async () => {
        await captured.onFinish!()
      })
      await act(async () => {
        await instanceRef.current!.complete()
      })
      const completes = posted('editor.complete')
      expect(completes).toHaveLength(2)
      expect(completes.map((p) => p.pageCount)).toEqual([statePageCount, statePageCount])
    },
  )

  it('G6 IIFE StorigeEditorInstance.getState() 는 마운트 전 0/0', () => {
    const instance = new StorigeEditorInstance({ templateSetId: 'ts-test' } as never)
    expect(instance.getState()).toEqual({ ready: false, modified: false, currentPage: 0, totalPages: 0 })
  })

  it('G7 쪽수 계산이 예외를 내면 기본 4키 응답이 1회 나가고 페이지 키는 없다', async () => {
    const { instanceRef } = await renderInitialized()
    setPages({ count: 3, current: 1, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 1 })
    act(() => {
      useSettingsStore.setState({
        spreadConfig: {
          get regionScope(): string {
            throw new Error('spread config unavailable')
          },
        },
      } as never)
    })
    expect(requestState('r7')).toEqual({ requestId: 'r7', ready: true, dirty: false, sessionId: 'sess-1' })
    expect(instanceRef.current!.getState()).toEqual({ ready: true, modified: false, currentPage: 0, totalPages: 0 })
  })

  it('G8 변경 이력 복원 중에는 페이지 키가 없고, 재초기화 뒤 돌아온다(editor.ready 는 1회)', async () => {
    await renderInitialized()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    setPages({ count: 3, current: 2, isSpreadMode: false, regionScope: null, pagesPerCanvas: 1 })
    expect(requestState('r8a')).toMatchObject({ pageCount: 3, currentPage: 2 })

    let releaseRestore: (v: unknown) => void = () => {}
    api.restoreVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRestore = resolve
        }),
    )
    const source = captured.sessionVersions!
    let restoreErr: unknown = null
    const pending = source.restore('v-1').catch((e: unknown) => {
      restoreErr = e
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(api.restoreVersion).toHaveBeenCalledWith('sess-1', 'v-1')

    const during = requestState('r8b')
    expect(during).toEqual({ requestId: 'r8b', ready: true, dirty: false, sessionId: 'sess-1' })

    await act(async () => {
      releaseRestore({ ...MEMBER_SESSION, canvasData: [{ p: 1 }, { p: 2 }] })
      await new Promise((r) => setTimeout(r, 0))
    })
    await pending
    expect(restoreErr).toBeNull()

    setPages({ count: 2, current: 1, isSpreadMode: false, regionScope: null, pagesPerCanvas: 1 })
    expect(requestState('r8c')).toMatchObject({ pageCount: 2, currentPage: 1 })
    expect(posted('editor.ready')).toHaveLength(1)
  })
})
