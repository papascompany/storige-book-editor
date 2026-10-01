/**
 * 같은 탭 비회원 초안 이어 열기 — sessionId 없이 orderSeqno+mode 로 진입했을 때 주문별 세션 목록이 비어 있으면
 * 비회원 토큰이면 현재 탭에서 같은 주문번호·mode·templateSetId·호스트 범위(부모 출처·토큰 사이트)로 기억한
 * 비회원 세션을 그 세션의 기억 토큰으로 게스트 조회 경로(getGuest) 1회 열어 이어 쓴다.
 *
 * 잠그는 것:
 *   R1 같은 탭에서 비회원 세션 생성 → 닫음 → 같은 주문·mode·templateSetId 재진입 → getGuest 1회,
 *      create·createGuest·get 0회, 그 세션으로 editor.ready
 *   R2 mode·templateSetId·주문번호가 다르면 매핑 미사용 → 새 세션 생성
 *   R3 기억 토큰 만료 → getGuest 0회, 기록 삭제, 새 세션 생성
 *   R4 getGuest 거절(403·404·400) → 토큰 기록·매핑 삭제, SESSION_NOT_FOUND 없이 새 세션 생성
 *   R5 getGuest 5xx·타임아웃·연결 실패 → NETWORK_ERROR fatal 1회, 새 세션 생성 0회, 기록 유지
 *   R6 관리자 편집 탭은 매핑을 쓰지 않고 기록하지도 않는다
 *   R7 콘솔 출력에 게스트 토큰·매핑 키·이어 연 세션 id 원문이 없다
 *   R8 StrictMode 이중 effect 에서도 getGuest 1회
 *   R9 주문별 세션 목록에 항목이 있거나 목록 조회가 실패하면 매핑을 쓰지 않는다(기존 경로)
 *   R10 회원 토큰은 목록이 비어도 매핑을 쓰지 않고 회원 세션을 만든다
 *   R11 비회원 shop 토큰의 사이트·부모 출처가 다르면 매핑 미사용, 같으면 이어 연다
 *   R12 이어 연 응답 세션이 매핑 키와 맞지 않으면 매핑을 지우고 새 세션 생성
 *   R13 명시 sessionId 재오픈이 거절된 뒤 같은 탭에서 sessionId 없이 재진입 → getGuest 0회, 새 세션 생성
 *
 * 하네스는 embed.guestReopen.test.tsx 를 준용한다.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

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
  loadTemplateSetEditor: vi.fn(async () => undefined),
}))
vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({
    loadEmptyEditor: vi.fn(),
    loadTemplateSetEditor: (...a: unknown[]) => contents.loadTemplateSetEditor(...(a as [])),
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

// 회귀(ⓔ 게스트 재오픈 → editor.ready)용: 실제 fabric 캔버스 생성 대신 최소 스텁.
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

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { setAdminEditTab } from './utils/authTokenStorage'
import { rememberEmbedGuestToken, type EmbedGuestDraftKey } from './utils/embedGuestTokenStore'
import { embedAccessTokenScopeOf } from './utils/embedSessionReopen'

const PARENT_ORIGIN = 'https://host.example'
const ORDER_SEQNO = 1234567890123
const MODE = 'both' as const
const TEMPLATE_SET_ID = 'ts-test'
const DRAFT_SESSION_ID = 'sess-draft-1'
const NEW_SESSION_ID = 'sess-new-1'
const DRAFT_TOKEN = 'draft-token-/+=x'
const NEW_TOKEN = 'new-token-/+=y'
const DRAFT_KEY_PREFIX = 'storige_embed_guest_draft_v1:'
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 60 * 1000).toISOString()

type Mode = 'cover' | 'content' | 'both' | 'template'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function axiosHttpError(
  status: number,
  config?: InternalAxiosRequestConfig,
  data: Record<string, unknown> = {},
): AxiosError {
  const cfg = config ?? ({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig)
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: cfg,
  })
}

/** 실제 getGuest 요청과 같은 모양의 요청 설정(토큰이 헤더에 실림) */
function guestRequestConfig(token: string): InternalAxiosRequestConfig {
  const headers = new AxiosHeaders()
  headers.set('x-guest-token', token)
  return { url: `/edit-sessions/guest/${DRAFT_SESSION_ID}`, method: 'get', headers } as InternalAxiosRequestConfig
}

/** 서버 응답 모양의 비회원 세션(order_seqno 는 bigint 라 문자열로 올 수 있다) */
function guestSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT_SESSION_ID,
    status: 'editing',
    orderSeqno: String(ORDER_SEQNO),
    memberSeqno: 0,
    mode: MODE,
    templateSetId: TEMPLATE_SET_ID,
    canvasData: null,
    metadata: {},
    guestToken: DRAFT_TOKEN,
    guestExpiresAt: FUTURE,
    ...overrides,
  }
}

function newGuestSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return guestSession({ id: NEW_SESSION_ID, guestToken: NEW_TOKEN, ...overrides })
}

/** 같은 탭에서 앞서 비회원 초안을 열었던 상태(기본 호스트 범위: 부모 출처 PARENT_ORIGIN, 사이트 없음) */
function seedDraft(
  expiresAt: string = FUTURE,
  key: EmbedGuestDraftKey = {
    orderSeqno: ORDER_SEQNO,
    mode: MODE,
    templateSetId: TEMPLATE_SET_ID,
    hostOrigin: PARENT_ORIGIN,
  },
) {
  rememberEmbedGuestToken(DRAFT_SESSION_ID, DRAFT_TOKEN, expiresAt, key)
}

const tokenRecordKey = (id: string) => `storige_embed_guest_v1:${id}`

function draftEntries(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i) as string
    if (k.startsWith(DRAFT_KEY_PREFIX)) out.push([k, sessionStorage.getItem(k) as string])
  }
  return out
}

/** 서명 없는 JWT 모양 토큰(페이로드만 의미 있음) */
function jwtLike(payload: Record<string, unknown>): string {
  const b64url = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`
}

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

type EmbedProps = Partial<{
  orderSeqno: number
  mode: Mode
  templateSetId: string
  sessionId: string
  parentOrigin: string
}>

function editorFor(
  props: EmbedProps = {},
  callbacks: { onError?: (e: unknown) => void; onReady?: () => void } = {},
) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return (
    <EmbeddedEditor
      templateSetId={props.templateSetId ?? TEMPLATE_SET_ID}
      orderSeqno={props.orderSeqno ?? ORDER_SEQNO}
      mode={props.mode ?? MODE}
      sessionId={props.sessionId}
      parentOrigin={props.parentOrigin ?? PARENT_ORIGIN}
      instanceRef={instanceRef}
      {...callbacks}
    />
  )
}

function renderEmbed(
  props: EmbedProps = {},
  callbacks: { onError?: (e: unknown) => void; onReady?: () => void } = {},
) {
  return render(editorFor(props, callbacks))
}

async function flushInit() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

function resetEditorStores() {
  act(() => {
    useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
    useSaveStore.setState({ isDirty: false } as never)
  })
}

/** 회원 세션 생성이 거절되고 비회원 세션으로 만들어지는 비회원 shop 토큰 흐름 */
function guestCreateFlow(session: Record<string, unknown> = newGuestSession()) {
  api.create.mockRejectedValue(axiosHttpError(400, undefined, { code: 'MEMBER_REQUIRED' }))
  api.createGuest.mockResolvedValue(session)
}

function expectNewSessionCreated() {
  expect(api.createGuest).toHaveBeenCalledTimes(1)
  expect(posted('editor.ready')).toHaveLength(1)
  expect(posted('editor.ready')[0]).toMatchObject({ sessionId: NEW_SESSION_ID })
  expect(posted('editor.error')).toHaveLength(0)
}

describe('EmbeddedEditor — 같은 탭 비회원 초안 이어 열기(주문별 세션 목록이 비었을 때)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
    sessionStorage.clear()
    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.findByOrder.mockResolvedValue({ sessions: [], total: 0 })
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: TEMPLATE_SET_ID, name: 'TS', width: 210, height: 297 })
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
    resetEditorStores()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    resetEditorStores()
  })

  it('R1 비회원 세션 생성 → 닫음 → 같은 주문·mode·templateSetId 재진입 → getGuest 1회, 생성 0회, 그 세션으로 editor.ready', async () => {
    guestCreateFlow(guestSession())
    const first = renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.createGuest).toHaveBeenCalledTimes(1)
    expect(api.getGuest).not.toHaveBeenCalled()
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
    first.unmount()
    resetEditorStores()

    for (const fn of Object.values(api)) fn.mockClear()
    parentPost.mockReset()
    api.getGuest.mockResolvedValue(guestSession({ canvasData: null }))
    const onReady = vi.fn()
    renderEmbed({}, { onReady })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.findByOrder).toHaveBeenCalledTimes(1)
    expect(api.getGuest.mock.calls).toEqual([[DRAFT_SESSION_ID, DRAFT_TOKEN]])
    expect(api.create).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: DRAFT_SESSION_ID })
    expect(posted('editor.error')).toHaveLength(0)
    // 기억 갱신 — 토큰 기록·매핑 유지
    expect(JSON.parse(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID)) as string)).toEqual({
      guestToken: DRAFT_TOKEN,
      expiresAt: FUTURE,
    })
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
  })

  it('R1 이어 연 응답에 게스트 토큰이 없으면 조회에 쓴 토큰으로 기억을 갱신한다', async () => {
    seedDraft()
    const resumed = guestSession({ guestExpiresAt: FUTURE })
    delete resumed.guestToken
    api.getGuest.mockResolvedValue(resumed)
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID)) as string).guestToken).toBe(DRAFT_TOKEN)
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
  })

  it.each([
    ['mode', { mode: 'cover' as Mode }],
    ['templateSetId', { templateSetId: 'ts-other' }],
    ['주문번호', { orderSeqno: ORDER_SEQNO + 1 }],
  ])('R2 %s 가 다르면 매핑을 쓰지 않는다 → getGuest 0회, 새 세션 생성', async (_label, props) => {
    seedDraft()
    guestCreateFlow()
    renderEmbed(props)

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
    // 앞서 기억한 다른 키의 초안 기록은 그대로 둔다
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).not.toBeNull()
  })

  it('R3 기억 토큰이 만료됐으면 getGuest 0회, 기록 삭제, 새 세션 생성', async () => {
    seedDraft(PAST)
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).toBeNull()
    // 매핑은 새로 만든 세션을 가리킨다
    expect(draftEntries().map(([, v]) => v)).toEqual([NEW_SESSION_ID])
  })

  it.each([
    [403, 'GUEST_SESSION_EXPIRED'],
    [403, 'GUEST_TOKEN_MISMATCH'],
    [404, undefined],
    [400, undefined],
  ])('R4 getGuest %i %s → 토큰 기록·매핑 삭제 후 새 세션 생성(SESSION_NOT_FOUND 없음)', async (status, code) => {
    seedDraft()
    api.getGuest.mockRejectedValue(axiosHttpError(status, guestRequestConfig(DRAFT_TOKEN), code ? { code } : {}))
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.getGuest.mock.invocationCallOrder[0]).toBeLessThan(api.createGuest.mock.invocationCallOrder[0])
    expect(api.get).not.toHaveBeenCalled()
    expectNewSessionCreated()
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).toBeNull()
    expect(draftEntries().map(([, v]) => v)).toEqual([NEW_SESSION_ID])
  })

  it('R5 getGuest 503 → NETWORK_ERROR fatal 1회, 새 세션 생성 0회, 기록 유지, 오류에 토큰 원문 없음', async () => {
    seedDraft()
    const thrown = axiosHttpError(503, guestRequestConfig(DRAFT_TOKEN))
    api.getGuest.mockRejectedValue(thrown)
    guestCreateFlow()
    renderEmbed()

    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'NETWORK_ERROR',
      fatal: true,
      message: '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
    })
    expect(posted('editor.ready')).toHaveLength(0)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).not.toBeNull()
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
    expect(thrown.config?.headers['x-guest-token']).toBe('[redacted]')
    expect(JSON.stringify(thrown.toJSON())).not.toContain(DRAFT_TOKEN)
    expect(JSON.stringify(errors[0])).not.toContain(DRAFT_TOKEN)
  })

  it('R5 getGuest 타임아웃·응답 없는 연결 실패 → NETWORK_ERROR(네트워크 문구), 새 세션 생성 0회', async () => {
    for (const thrown of [
      new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', guestRequestConfig(DRAFT_TOKEN)),
      new AxiosError('Network Error', 'ERR_NETWORK', guestRequestConfig(DRAFT_TOKEN)),
    ]) {
      parentPost.mockReset()
      for (const fn of Object.values(api)) fn.mockClear()
      seedDraft()
      api.getGuest.mockRejectedValue(thrown)
      guestCreateFlow()
      const view = renderEmbed()

      expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
      await flushInit()
      const errors = posted('editor.error')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        code: 'NETWORK_ERROR',
        fatal: true,
        message: '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
      })
      expect(api.create).not.toHaveBeenCalled()
      expect(api.createGuest).not.toHaveBeenCalled()
      expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).not.toBeNull()
      view.unmount()
      resetEditorStores()
    }
  })

  it('R6 관리자 편집 탭은 매핑을 쓰지 않는다 → getGuest 0회, 새 세션 생성, 매핑 미기록', async () => {
    seedDraft()
    setAdminEditTab(true)
    // 관리자 편집 탭은 인증 토큰을 탭 단위 sessionStorage 에서 읽는다.
    sessionStorage.setItem('auth_token', 'test-token')
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
    // 앞선 매핑(관리자 탭 전환 전 기록)만 남고 새 세션은 기록되지 않는다
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
    expect(sessionStorage.getItem(tokenRecordKey(NEW_SESSION_ID))).toBeNull()
  })

  it('R7 이어 열기·거절 경로의 콘솔 출력에 게스트 토큰·매핑 키·이어 연 세션 id 원문이 없다', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const consoleText = () =>
      spies
        .flatMap((s) => s.mock.calls)
        .flat()
        .map((a) => {
          if (typeof a === 'string') return a
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join('\n')

    seedDraft()
    api.getGuest.mockResolvedValue(guestSession())
    const first = renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    first.unmount()
    resetEditorStores()

    parentPost.mockReset()
    api.getGuest.mockRejectedValue(axiosHttpError(403, guestRequestConfig(DRAFT_TOKEN), { code: 'GUEST_TOKEN_MISMATCH' }))
    guestCreateFlow()
    renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))

    const text = consoleText()
    expect(text).toContain('[EmbeddedEditor] Resumed remembered guest draft for order')
    expect(text).toContain('[EmbeddedEditor] Remembered guest draft rejected')
    expect(text).not.toContain(DRAFT_TOKEN)
    expect(text).not.toContain(encodeURIComponent(DRAFT_TOKEN))
    expect(text).not.toContain(NEW_TOKEN)
    expect(text).not.toContain(DRAFT_KEY_PREFIX)
    expect(text).not.toContain(DRAFT_SESSION_ID)
  })

  it('R8 StrictMode 이중 effect 에서도 getGuest 1회, 생성 0회, editor.ready', async () => {
    seedDraft()
    api.getGuest.mockResolvedValue(guestSession())
    render(<StrictMode>{editorFor()}</StrictMode>)

    await waitFor(() => expect(posted('editor.ready').length).toBeGreaterThanOrEqual(1))
    await flushInit()
    // 이중 effect 로 초기화가 두 번 시작되지만(주문별 세션 목록 조회 2회) 게스트 조회는 1회
    expect(api.findByOrder).toHaveBeenCalledTimes(2)
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: DRAFT_SESSION_ID })
    expect(posted('editor.error')).toHaveLength(0)
  })

  it('R9 주문별 세션 목록에 회원 항목이 있으면 그 항목을 쓰고 매핑은 쓰지 않는다', async () => {
    seedDraft()
    api.findByOrder.mockResolvedValue({
      sessions: [guestSession({ id: 'sess-member-1', guestToken: null, guestExpiresAt: null, memberSeqno: 123 })],
      total: 1,
    })
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: 'sess-member-1' })
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
  })

  it('R9 주문별 세션 목록 조회가 실패하면 매핑을 쓰지 않고 종전처럼 새 세션을 만든다', async () => {
    seedDraft()
    api.findByOrder.mockRejectedValue(axiosHttpError(500))
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
  })

  it('R10 회원 토큰은 목록이 비고 같은 탭 매핑이 있어도 getGuest 0회, 회원 세션 생성 1회', async () => {
    localStorage.setItem('auth_token', jwtLike({ sub: '123', role: 'customer', source: 'shop' }))
    seedDraft()
    api.create.mockResolvedValue(
      guestSession({ id: 'sess-member-new', guestToken: null, guestExpiresAt: null, memberSeqno: 123 }),
    )
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: 'sess-member-new' })
    expect(posted('editor.error')).toHaveLength(0)
    // 비회원 초안 기록은 그대로 둔다
    expect(draftEntries().map(([, v]) => v)).toEqual([DRAFT_SESSION_ID])
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).not.toBeNull()
  })

  it('R11 비회원 shop 토큰: 생성 → 재진입은 같은 사이트면 이어 열고, 다른 사이트 토큰이면 새 세션', async () => {
    localStorage.setItem('auth_token', jwtLike({ sub: '0', role: 'customer', source: 'shop', siteId: 'site-a' }))
    guestCreateFlow(guestSession())
    const first = renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    first.unmount()
    resetEditorStores()

    for (const fn of Object.values(api)) fn.mockClear()
    parentPost.mockReset()
    api.getGuest.mockResolvedValue(guestSession())
    const second = renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: DRAFT_SESSION_ID })
    second.unmount()
    resetEditorStores()

    for (const fn of Object.values(api)) fn.mockClear()
    parentPost.mockReset()
    localStorage.setItem('auth_token', jwtLike({ sub: '0', role: 'customer', source: 'shop', siteId: 'site-b' }))
    guestCreateFlow()
    renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
  })

  it('R11 부모 출처가 다르면 매핑을 쓰지 않는다 → getGuest 0회, 새 세션 생성', async () => {
    seedDraft()
    guestCreateFlow()
    renderEmbed({ parentOrigin: 'https://other-host.example' })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
  })

  it.each([
    ['mode', { mode: 'cover' }],
    ['templateSetId', { templateSetId: 'ts-other' }],
    ['주문번호', { orderSeqno: String(ORDER_SEQNO + 1) }],
    ['세션 id', { id: 'sess-other' }],
  ])('R12 이어 연 응답의 %s 가 매핑 키와 다르면 매핑만 지우고 새 세션 생성', async (_label, overrides) => {
    seedDraft()
    api.getGuest.mockResolvedValue(guestSession(overrides))
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expectNewSessionCreated()
    // 토큰 기록은 남기고, 매핑은 새로 만든 세션을 가리킨다
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).not.toBeNull()
    expect(draftEntries().map(([, v]) => v)).toEqual([NEW_SESSION_ID])
  })

  it('R13 명시 sessionId 재오픈 거절(SESSION_NOT_FOUND) 뒤 sessionId 없이 재진입 → getGuest 0회, 새 세션 생성', async () => {
    seedDraft()
    api.getGuest.mockRejectedValue(
      axiosHttpError(403, guestRequestConfig(DRAFT_TOKEN), { code: 'GUEST_SESSION_EXPIRED' }),
    )
    api.get.mockRejectedValue(axiosHttpError(403, undefined, { code: 'GUEST_TOKEN_REQUIRED' }))
    const first = renderEmbed({ sessionId: DRAFT_SESSION_ID })
    await waitFor(() => expect(posted('editor.error')).toHaveLength(1))
    expect(posted('editor.error')[0]).toMatchObject({ code: 'SESSION_NOT_FOUND', fatal: true })
    expect(sessionStorage.getItem(tokenRecordKey(DRAFT_SESSION_ID))).toBeNull()
    first.unmount()
    resetEditorStores()

    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.findByOrder.mockResolvedValue({ sessions: [], total: 0 })
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: TEMPLATE_SET_ID, name: 'TS', width: 210, height: 297 })
    parentPost.mockReset()
    guestCreateFlow()
    renderEmbed()

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expectNewSessionCreated()
    expect(draftEntries().map(([, v]) => v)).toEqual([NEW_SESSION_ID])
  })
})

describe('embedAccessTokenScopeOf — 인증 토큰의 회원 여부·사이트 id', () => {
  it('sub 가 양의 정수면 회원, 0·빈 값·비숫자면 비회원', () => {
    expect(embedAccessTokenScopeOf(jwtLike({ sub: '123' })).member).toBe(true)
    expect(embedAccessTokenScopeOf(jwtLike({ sub: 1607115440 })).member).toBe(true)
    for (const sub of ['0', '', '0123', '-1', '1.5', 'abc', null]) {
      expect(embedAccessTokenScopeOf(jwtLike({ sub })).member).toBe(false)
    }
    expect(embedAccessTokenScopeOf(jwtLike({})).member).toBe(false)
  })

  it('siteId 문자열을 돌려주고 없거나 빈 값이면 null', () => {
    expect(embedAccessTokenScopeOf(jwtLike({ sub: '0', siteId: 'site-a' })).siteId).toBe('site-a')
    expect(embedAccessTokenScopeOf(jwtLike({ sub: '0', siteId: '' })).siteId).toBeNull()
    expect(embedAccessTokenScopeOf(jwtLike({ sub: '0' })).siteId).toBeNull()
  })

  it('비 UTF-8 ASCII 이름 클레임이 있어도 판독한다', () => {
    const json = JSON.stringify({ sub: '7', name: '홍길동', siteId: 's' })
    const bytes = new TextEncoder().encode(json)
    const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(embedAccessTokenScopeOf(`h.${payload}.s`)).toEqual({ member: true, siteId: 's' })
  })

  it('JWT 형식이 아니거나 해석할 수 없으면 비회원·사이트 없음', () => {
    for (const token of [null, undefined, '', 'test-token', 'a.b', 'a.%%%.c', `a.${btoa('not json')}.c`, `a.${btoa('1')}.c`]) {
      expect(embedAccessTokenScopeOf(token)).toEqual({ member: false, siteId: null })
    }
  })
})
