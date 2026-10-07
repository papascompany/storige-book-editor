/**
 * W8-2b (FREEZE v1.16) — 재편집 템플릿셋 결정: 세션 세트(S) 우선, 세션 세트 조회가 HTTP 404 이고
 * 다른 호스트 세트(U)가 있을 때만 U 로 1회 다시 시도한다(샘플 폴백이 없는 설정 = 프로덕션 기본).
 *
 * 잠그는 것:
 *   G1  sessionId 재오픈, U=S(EmbedView 도출) → S 조회 1회, ready payload 종전과 같음, 불일치·Sentry 0
 *   G2  U=S 명시(주문번호·mode 동반) → G1 과 같음
 *   G3  U≠S 정상 → S 로만 조회·복원, ready.templateSetId=S + templateSetMismatch(resolution 'session'),
 *       Sentry warning 1회, onReady 인자(legacy storige:ready 소스)도 같은 값
 *   G4  U≠S, S 404 → U 로 두 번째 조회·복원, reason 'SESSION_SET_UNAVAILABLE', editor.error 0
 *   G5  S·U 모두 404 → TEMPLATE_SET_NOT_FOUND {templateSetId: U, fatal} 1회
 *   G6  S 5xx·타임아웃 → NETWORK_ERROR fatal, U 조회 0
 *   G7  주문번호 진입에서 주문 세션 세트 Y ≠ URL 세트 X → Y 로 열고 불일치 기록
 *   G8  신규 편집·게스트 초안 재개 → 불일치 없음, ready payload 종전과 같음
 *   G9  복원 재초기화 → ready 재발신 0, 세트 불변, Sentry warning 추가 0
 *   G10 U≠S, S 404 가 아닌 4xx → 폴백 없이 TEMPLATE_SET_NOT_FOUND {templateSetId: S}, U 조회 0
 *   G11 U≠S, S 응답에 id 없음(HTTP 가 아닌 실패) → 폴백 없이 fatal(S), U 조회 0
 *   G12 S 조회 중 초기화 취소 → 다시 던져 조용히 끝남, U 조회 0, editor.error 0
 *   G13 D4 AI 패널 세트 전환 차단 판정(FeatureSidebar aiTemplateSetSwitchBlocked) — 같은 주소로 다시 열면
 *       기존 세션으로 열리는 진입(sessionId·주문 세션 재사용·회원 세션 생성)은 true, 비회원 주문 초안
 *       재개·게스트 폴백 생성·세션 없는 진입은 false, 복원 재초기화는 앞선 값 유지(G9)
 *
 * 하네스는 embed.templateSetLoadFailure.test.tsx·embed.sessionVersionRestore.test.tsx 를 따른다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

const captured = vi.hoisted(() => ({
  sessionVersions: null as null | { list: () => Promise<unknown>; restore: (id: string) => Promise<void> },
}))

vi.mock('./components/editor/EditorHeader', () => ({
  default: (props: { sessionVersions?: typeof captured.sessionVersions }) => {
    captured.sessionVersions = props.sessionVersions ?? null
    return null
  },
}))
vi.mock('./components/editor/ToolBar', () => ({ default: () => null }))
vi.mock('./components/editor/ObjectActionBar', () => ({ default: () => null }))
const sidebar = vi.hoisted(() => ({ blocked: [] as Array<boolean | undefined> }))
vi.mock('./components/editor/FeatureSidebar', () => ({
  default: (props: { aiTemplateSetSwitchBlocked?: boolean }) => {
    sidebar.blocked.push(props.aiTemplateSetSwitchBlocked)
    return null
  },
}))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({ WorkspaceModal: () => null }))
vi.mock('./components/RestoreBackupBanner', () => ({ RestoreBackupBanner: () => null }))
vi.mock('./components/editor/ObjectDeleteConfirm', () => ({ default: () => null }))
vi.mock('./components/editor/EditorWorkflowControls', () => ({ EditorWorkflowControls: () => null }))

const contents = vi.hoisted(() => ({
  loadTemplateSetEditor: vi.fn(async (_config: { templateSetId: string }) => undefined),
}))
vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({
    loadEmptyEditor: vi.fn(),
    loadTemplateSetEditor: (config: { templateSetId: string }) => contents.loadTemplateSetEditor(config),
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

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('./lib/sentry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/sentry')>()
  return {
    ...actual,
    Sentry: { ...actual.Sentry, captureMessage: (...a: unknown[]) => sentry.captureMessage(...a) },
  }
})

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
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
    restoreVersion: (...a: unknown[]) => api.restoreVersion(...(a as [])),
    restoreGuestVersion: (...a: unknown[]) => api.restoreGuestVersion(...(a as [])),
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: { getTemplateSetWithTemplates: (...a: unknown[]) => api.getTemplateSetWithTemplates(...(a as [])) },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ success: true, data: { role: 'customer' } })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods, type EditorReadyInfo } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { useAuthStore } from './stores/useAuthStore'
import { CanvasInitCancelledError } from './utils/createCanvas'
import { rememberEmbedGuestToken } from './utils/embedGuestTokenStore'

const PARENT_ORIGIN = 'https://host.example'
const SESSION_ID = 'sess-1'
const S = 'ts-session'
const U = 'ts-url'
const ORDER_SEQNO = 1234567890123

const MSG = {
  connectivity: '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
  server: '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
  notFound: '이 상품의 편집 정보를 찾을 수 없습니다. 이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요.',
} as const

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function axiosHttpError(status: number): AxiosError {
  const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: cfg,
  })
}

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function templateSetFetches(): string[] {
  return api.getTemplateSetWithTemplates.mock.calls.map((c) => String(c[0]))
}

function mismatchWarnings(): Array<{ level?: string; extra?: Record<string, unknown> }> {
  return sentry.captureMessage.mock.calls
    .filter((c) => c[0] === '[template-set-mismatch]')
    .map((c) => c[1] as { level?: string; extra?: Record<string, unknown> })
}

/** FeatureSidebar 가 마지막으로 받은 AI 패널 세트 전환 차단 값(W8-2b D4) */
function lastSidebarBlocked(): boolean | undefined {
  return sidebar.blocked[sidebar.blocked.length - 1]
}

function memberSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    status: 'editing',
    templateSetId: S,
    canvasData: [{ page: 1 }],
    metadata: {},
    guestToken: null,
    guestExpiresAt: null,
    ...overrides,
  }
}

/** 조회 id 별 결과 — 함수면 throw/반환, 없으면 정상 템플릿셋 */
function templateSetsBy(map: Record<string, () => unknown>): void {
  api.getTemplateSetWithTemplates.mockImplementation(async (id: string) => {
    const f = map[id]
    if (f) return f()
    return { id, name: `TS ${id}`, width: 210, height: 297 }
  })
}

type EmbedProps = Partial<{
  templateSetId: string
  sessionId: string
  orderSeqno: number
  mode: 'cover' | 'content' | 'both' | 'template'
}>

function renderEmbed(
  props: EmbedProps,
  callbacks: { onError?: (e: unknown) => void; onReady?: (info?: EditorReadyInfo) => void } = {},
) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId={props.templateSetId ?? U}
      sessionId={props.sessionId}
      orderSeqno={props.orderSeqno}
      mode={props.mode}
      parentOrigin={PARENT_ORIGIN}
      instanceRef={instanceRef}
      {...callbacks}
    />,
  )
}

async function flushInit() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

function resetEditorStores() {
  act(() => {
    useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
    useSaveStore.setState({ isDirty: false, status: 'idle' } as never)
  })
}

function restoredLogged(): boolean {
  return vi
    .mocked(console.log)
    .mock.calls.some(([first]) => String(first).includes('canvasData restored'))
}

function restoreSkipped(): boolean {
  return vi
    .mocked(console.warn)
    .mock.calls.some(([first]) => String(first).includes('복원 스킵'))
}

async function expectFatal(payload: Record<string, unknown>) {
  expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
  await flushInit()
  expect(posted('editor.error')).toEqual([payload])
  expect(posted('editor.ready')).toHaveLength(0)
}

describe('EmbeddedEditor — W8-2b 재편집 템플릿셋 결정(세션 세트 우선 + 404 한정 폴백)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    vi.stubEnv('DEV', false)
    captured.sessionVersions = null
    sidebar.blocked.length = 0
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
    sessionStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    sentry.captureMessage.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.findByOrder.mockResolvedValue({ sessions: [], total: 0 })
    api.get.mockResolvedValue(memberSession())
    templateSetsBy({})
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resetEditorStores()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    act(() => {
      useAuthStore.setState({ token: '', me: null } as never)
    })
    resetEditorStores()
  })

  it('G1 sessionId 재오픈, U=S(EmbedView 도출) → S 조회 1회, ready payload 종전과 같음, 불일치·Sentry 0', async () => {
    const onReady = vi.fn()
    renderEmbed({ templateSetId: S, sessionId: SESSION_ID }, { onReady })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(templateSetFetches()).toEqual([S])
    expect(posted('editor.ready')[0]).toEqual({ sessionId: SESSION_ID, templateSetId: S, version: '1.0.0' })
    expect(onReady).toHaveBeenCalledWith({ templateSetId: S })
    expect(restoredLogged()).toBe(true)
    expect(mismatchWarnings()).toHaveLength(0)
    expect(posted('editor.error')).toHaveLength(0)
  })

  it('G2 U=S 를 명시(주문번호·mode 동반)해도 G1 과 같다', async () => {
    renderEmbed({ templateSetId: S, sessionId: SESSION_ID, orderSeqno: ORDER_SEQNO, mode: 'both' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(templateSetFetches()).toEqual([S])
    expect(posted('editor.ready')[0]).toEqual({ sessionId: SESSION_ID, templateSetId: S, version: '1.0.0' })
    expect(api.findByOrder).not.toHaveBeenCalled()
    expect(mismatchWarnings()).toHaveLength(0)
  })

  it("G3 U≠S → S 로만 조회·복원, ready.templateSetId=S + templateSetMismatch(resolution 'session'), Sentry warning 1회", async () => {
    const onReady = vi.fn()
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID }, { onReady })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    const mismatch = { requested: U, session: S, resolution: 'session' }
    expect(templateSetFetches()).toEqual([S])
    expect(contents.loadTemplateSetEditor).toHaveBeenCalledWith(expect.objectContaining({ templateSetId: S }))
    expect(restoredLogged()).toBe(true)
    expect(restoreSkipped()).toBe(false)
    expect(posted('editor.ready')[0]).toEqual({
      sessionId: SESSION_ID,
      templateSetId: S,
      version: '1.0.0',
      templateSetMismatch: mismatch,
    })
    // onReady 인자 = EmbedView 레거시 storige:ready 의 소스
    expect(onReady).toHaveBeenCalledWith({ templateSetId: S, templateSetMismatch: mismatch })
    expect(mismatchWarnings()).toEqual([
      {
        level: 'warning',
        extra: { requested: U, session: S, resolution: 'session', reason: null, sessionId: SESSION_ID, orderSeqno: null },
      },
    ])
    expect(posted('editor.error')).toHaveLength(0)
  })

  it("G4 U≠S, S 404 → U 로 두 번째 조회·복원, reason 'SESSION_SET_UNAVAILABLE', editor.error 0", async () => {
    templateSetsBy({
      [S]: () => {
        throw axiosHttpError(404)
      },
    })
    const onReady = vi.fn()
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID }, { onReady })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    const mismatch = { requested: U, session: S, resolution: 'requested', reason: 'SESSION_SET_UNAVAILABLE' }
    expect(templateSetFetches()).toEqual([S, U])
    expect(contents.loadTemplateSetEditor).toHaveBeenCalledWith(expect.objectContaining({ templateSetId: U }))
    expect(restoredLogged()).toBe(true)
    expect(restoreSkipped()).toBe(false)
    expect(posted('editor.ready')[0]).toEqual({
      sessionId: SESSION_ID,
      templateSetId: U,
      version: '1.0.0',
      templateSetMismatch: mismatch,
    })
    expect(onReady).toHaveBeenCalledWith({ templateSetId: U, templateSetMismatch: mismatch })
    expect(mismatchWarnings()).toHaveLength(1)
    expect(mismatchWarnings()[0].extra).toMatchObject({ resolution: 'requested', reason: 'SESSION_SET_UNAVAILABLE' })
    expect(posted('editor.error')).toHaveLength(0)
  })

  it('G5 S·U 모두 404 → TEMPLATE_SET_NOT_FOUND {templateSetId: U, fatal} 1회', async () => {
    templateSetsBy({
      [S]: () => {
        throw axiosHttpError(404)
      },
      [U]: () => {
        throw axiosHttpError(404)
      },
    })
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID })
    await expectFatal({ code: 'TEMPLATE_SET_NOT_FOUND', message: MSG.notFound, templateSetId: U, fatal: true })
    expect(templateSetFetches()).toEqual([S, U])
    expect(contents.loadTemplateSetEditor).not.toHaveBeenCalled()
  })

  it.each([
    ['503', () => axiosHttpError(503), MSG.server],
    ['500', () => axiosHttpError(500), MSG.server],
    ['타임아웃', () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'), MSG.connectivity],
  ] as const)('G6 U≠S, S %s → NETWORK_ERROR fatal, U 조회 0', async (_label, makeErr, message) => {
    templateSetsBy({
      [S]: () => {
        throw makeErr()
      },
    })
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID })
    await expectFatal({ code: 'NETWORK_ERROR', message, fatal: true })
    expect(templateSetFetches()).toEqual([S])
  })

  it.each([400, 403, 410, 422])(
    'G10 U≠S, S %s(404 가 아닌 4xx) → 폴백 없이 TEMPLATE_SET_NOT_FOUND {templateSetId: S}, U 조회 0',
    async (status) => {
      templateSetsBy({
        [S]: () => {
          throw axiosHttpError(status)
        },
      })
      renderEmbed({ templateSetId: U, sessionId: SESSION_ID })
      await expectFatal({ code: 'TEMPLATE_SET_NOT_FOUND', message: MSG.notFound, templateSetId: S, fatal: true })
      expect(templateSetFetches()).toEqual([S])
    },
  )

  it('G11 U≠S, S 응답에 id 없음(HTTP 가 아닌 실패) → 폴백 없이 fatal(S), U 조회 0', async () => {
    templateSetsBy({ [S]: () => ({ templateSet: { name: 'no id' } }) })
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID })
    await expectFatal({ code: 'TEMPLATE_SET_NOT_FOUND', message: MSG.notFound, templateSetId: S, fatal: true })
    expect(templateSetFetches()).toEqual([S])
  })

  it('G12 S 조회 중 초기화 취소 → 조용히 끝남, U 조회 0, editor.error 0', async () => {
    templateSetsBy({
      [S]: () => {
        throw new CanvasInitCancelledError('init-1')
      },
    })
    const onError = vi.fn()
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID }, { onError })
    await waitFor(() => expect(api.getTemplateSetWithTemplates).toHaveBeenCalled())
    await flushInit()
    expect(templateSetFetches()).toEqual([S])
    expect(posted('editor.error')).toHaveLength(0)
    expect(posted('editor.ready')).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByText('에디터 초기화 실패')).toBeNull()
  })

  it('G7 주문번호 진입: 주문 세션 세트 Y ≠ URL 세트 X → Y 로 열고 불일치 기록', async () => {
    api.findByOrder.mockResolvedValue({
      sessions: [memberSession({ id: 'sess-order', templateSetId: 'ts-Y', canvasData: null, memberSeqno: 7 })],
      total: 1,
    })
    renderEmbed({ templateSetId: 'ts-X', orderSeqno: ORDER_SEQNO, mode: 'both' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(templateSetFetches()).toEqual(['ts-Y'])
    expect(api.create).not.toHaveBeenCalled()
    expect(posted('editor.ready')[0]).toEqual({
      sessionId: 'sess-order',
      templateSetId: 'ts-Y',
      version: '1.0.0',
      templateSetMismatch: { requested: 'ts-X', session: 'ts-Y', resolution: 'session' },
    })
    expect(mismatchWarnings()).toHaveLength(1)
    expect(mismatchWarnings()[0].extra).toMatchObject({ sessionId: 'sess-order', orderSeqno: ORDER_SEQNO })
  })

  it('G8 신규 편집(세션 생성) → 불일치 없음, ready payload 종전과 같음', async () => {
    api.create.mockResolvedValue({ id: 'sess-new', status: 'editing', templateSetId: U, canvasData: null, metadata: {} })
    renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(templateSetFetches()).toEqual([U])
    expect(posted('editor.ready')[0]).toEqual({ sessionId: 'sess-new', templateSetId: U, version: '1.0.0' })
    expect(mismatchWarnings()).toHaveLength(0)
  })

  it('G8 게스트 초안 재개 → 불일치 없음, ready payload 종전과 같음', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    rememberEmbedGuestToken('sess-draft-1', 'draft-token', future, {
      orderSeqno: ORDER_SEQNO,
      mode: 'both',
      templateSetId: U,
      hostOrigin: PARENT_ORIGIN,
    })
    api.getGuest.mockResolvedValue({
      id: 'sess-draft-1',
      status: 'editing',
      orderSeqno: String(ORDER_SEQNO),
      memberSeqno: 0,
      mode: 'both',
      templateSetId: U,
      canvasData: null,
      metadata: {},
      guestToken: 'draft-token',
      guestExpiresAt: future,
    })
    renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(templateSetFetches()).toEqual([U])
    expect(posted('editor.ready')[0]).toEqual({ sessionId: 'sess-draft-1', templateSetId: U, version: '1.0.0' })
    expect(mismatchWarnings()).toHaveLength(0)
  })

  it('G9 복원 재초기화 → ready 재발신 0, 세트 불변(S), Sentry warning 추가 0', async () => {
    api.get.mockResolvedValue(memberSession({ canvasData: null }))
    renderEmbed({ templateSetId: U, sessionId: SESSION_ID })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    expect(mismatchWarnings()).toHaveLength(1)
    expect(templateSetFetches()).toEqual([S])

    api.restoreVersion.mockResolvedValue(memberSession({ canvasData: null }))
    const source = captured.sessionVersions!
    // act 안에서 await 하면 재초기화 렌더가 act 종료까지 미뤄진다 — act 밖에서 호출하고 flush 만 act 로.
    let restoreErr: unknown = null
    const pending = source.restore('v-1').catch((e: unknown) => {
      restoreErr = e
    })
    await flushInit()
    await pending
    await flushInit()

    expect(restoreErr).toBeNull()
    expect(api.restoreVersion).toHaveBeenCalledWith(SESSION_ID, 'v-1')
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(templateSetFetches()).toEqual([S, S])
    expect(posted('editor.ready')).toHaveLength(1)
    expect(mismatchWarnings()).toHaveLength(1)
    expect(posted('editor.error')).toHaveLength(0)
    // 재초기화는 진입 주소가 그대로이므로 AI 패널 세트 전환 차단도 그대로(G13)
    expect(lastSidebarBlocked()).toBe(true)
  })

  describe('G13 D4 AI 패널 세트 전환 차단 판정 — 같은 주소로 다시 열면 기존 세션으로 열리는가', () => {
    it('sessionId 재오픈 → 차단', async () => {
      renderEmbed({ templateSetId: S, sessionId: SESSION_ID })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(lastSidebarBlocked()).toBe(true)
    })

    it('주문번호 진입(sessionId 없음)에서 주문 세션 재사용 → 차단', async () => {
      api.findByOrder.mockResolvedValue({
        sessions: [memberSession({ id: 'sess-order', templateSetId: U, memberSeqno: 7 })],
        total: 1,
      })
      renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.create).not.toHaveBeenCalled()
      expect(lastSidebarBlocked()).toBe(true)
    })

    it('주문번호 진입 신규 편집(회원 세션 생성) → 차단(다음 주문 조회가 이 세션을 돌려준다)', async () => {
      api.create.mockResolvedValue({ id: 'sess-new', status: 'editing', templateSetId: U, canvasData: null, metadata: {} })
      renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(lastSidebarBlocked()).toBe(true)
    })

    it('회원 세션 생성 거절(400 MEMBER_REQUIRED) 뒤 게스트 세션 생성 → 차단 안 함', async () => {
      const err = axiosHttpError(400)
      ;(err.response as { data: unknown }).data = { code: 'MEMBER_REQUIRED' }
      api.create.mockRejectedValue(err)
      api.createGuest.mockResolvedValue({
        id: 'sess-guest',
        status: 'editing',
        orderSeqno: String(ORDER_SEQNO),
        memberSeqno: 0,
        mode: 'both',
        templateSetId: U,
        canvasData: null,
        metadata: {},
        guestToken: 'guest-token',
        guestExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.createGuest).toHaveBeenCalledTimes(1)
      expect(lastSidebarBlocked()).toBe(false)
    })

    it('비회원 주문 초안 재개 → 차단 안 함(초안 매핑 키에 templateSetId 가 있어 새 세트면 새 세션)', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      rememberEmbedGuestToken('sess-draft-1', 'draft-token', future, {
        orderSeqno: ORDER_SEQNO,
        mode: 'both',
        templateSetId: U,
        hostOrigin: PARENT_ORIGIN,
      })
      api.getGuest.mockResolvedValue({
        id: 'sess-draft-1',
        status: 'editing',
        orderSeqno: String(ORDER_SEQNO),
        memberSeqno: 0,
        mode: 'both',
        templateSetId: U,
        canvasData: null,
        metadata: {},
        guestToken: 'draft-token',
        guestExpiresAt: future,
      })
      renderEmbed({ templateSetId: U, orderSeqno: ORDER_SEQNO, mode: 'both' })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.getGuest).toHaveBeenCalledTimes(1)
      expect(lastSidebarBlocked()).toBe(false)
    })

    it('세션 없는 진입(templateSetId 만) → 차단 안 함', async () => {
      renderEmbed({ templateSetId: U })
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.findByOrder).not.toHaveBeenCalled()
      expect(lastSidebarBlocked()).toBe(false)
    })
  })
})
