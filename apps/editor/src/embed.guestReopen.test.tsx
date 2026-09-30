/**
 * 2026-09-30 — 게스트 세션 재오픈: 현재 탭에 기억된 게스트 토큰이 있으면 게스트 조회 경로를 먼저 쓴다.
 *
 * 잠그는 것:
 *   E2 미만료 기록 → getGuest 1회, get 0회, editor.ready
 *   E3 기록 없음 → 기존 get 경로(회귀 락)
 *   E4 getGuest 403 → 기록 삭제 + get 폴백. get 도 403 이면 SESSION_NOT_FOUND(forbidden) 정확히 1회
 *   E5 getGuest 404(코드 없음) → get 폴백. get 404 면 not_found 1회
 *   E6 getGuest 5xx·타임아웃 → 폴백 없이 기존 NETWORK_ERROR 매핑, get 미호출, 재던진 오류의 요청 설정에 토큰 원문 없음
 *   E6b getGuest 응답 없는 연결 실패(ERR_NETWORK) → get 폴백(최종 판정은 기존 경로)
 *   E7 세션 로드·createGuest 생성 후 기록(expiresAt 포함). 회원 세션·guestToken 없는 응답은 미기록
 *   E8 만료 기록 → getGuest 미호출, get 경로
 *
 * 하네스는 embed.sessionNotFound.test.tsx 를 준용한다.
 */
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

const PARENT_ORIGIN = 'https://host.example'
const SESSION_ID = 'sess-guest-1'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function axiosHttpError(status: number, config?: InternalAxiosRequestConfig): AxiosError {
  const cfg = config ?? ({ headers: new AxiosHeaders() } as InternalAxiosRequestConfig)
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: cfg,
  })
}

/** 실제 getGuest 요청과 같은 모양의 요청 설정(토큰이 헤더에 실림) */
function guestRequestConfig(token: string, withQuery = false): InternalAxiosRequestConfig {
  const headers = new AxiosHeaders()
  headers.set('x-guest-token', token)
  headers.set('Authorization', 'Bearer shop-jwt')
  return {
    url: `/edit-sessions/guest/${SESSION_ID}${withQuery ? `?guestToken=${encodeURIComponent(token)}` : ''}`,
    method: 'get',
    headers,
  } as InternalAxiosRequestConfig
}

const RECORD_KEY = `storige_embed_guest_v1:${SESSION_ID}`
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 60 * 1000).toISOString()
const REC_TOKEN = 'rec-token-/+=x'

function seedRecord(guestToken: string, expiresAt: string | null) {
  sessionStorage.setItem(RECORD_KEY, JSON.stringify({ guestToken, expiresAt }))
}

function guestSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    status: 'editing',
    templateSetId: 'ts-test',
    canvasData: null,
    metadata: {},
    guestToken: REC_TOKEN,
    guestExpiresAt: FUTURE,
    ...overrides,
  }
}

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function renderEmbed(
  props: Partial<{ sessionId: string; orderSeqno: number; mode: 'cover' | 'content' | 'both' | 'template' }> = {},
  callbacks: { onError?: (e: unknown) => void; onReady?: () => void } = {},
) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId="ts-test"
      parentOrigin={PARENT_ORIGIN}
      instanceRef={instanceRef}
      {...props}
      {...callbacks}
    />,
  )
}

async function flushInit() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

function sessionNotFoundErrors() {
  return posted('editor.error').filter((p) => p.code === 'SESSION_NOT_FOUND')
}

describe('EmbeddedEditor — 게스트 세션 재오픈 시 게스트 조회 경로 우선', () => {
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
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 210, height: 297 })
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  it('E2 미만료 기록 → getGuest(sessionId, 기록 토큰) 1회, get 0회, editor.ready', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockResolvedValue(guestSession())
    const onReady = vi.fn()
    renderEmbed({ sessionId: SESSION_ID }, { onReady })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.getGuest).toHaveBeenCalledWith(SESSION_ID, REC_TOKEN)
    expect(api.get).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(sessionNotFoundErrors()).toHaveLength(0)
  })

  it('E3 기록 없음 → 기존 get 경로(getGuest 미호출), editor.ready', async () => {
    api.get.mockResolvedValue(guestSession())
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.get).toHaveBeenCalledWith(SESSION_ID)
    expect(api.getGuest).not.toHaveBeenCalled()
  })

  it('E4 getGuest 403 → 기록 삭제 + get 폴백 → editor.ready', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(axiosHttpError(403, guestRequestConfig(REC_TOKEN)))
    api.get.mockResolvedValue(guestSession({ guestToken: null, guestExpiresAt: null, memberSeqno: 123 }))
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.getGuest.mock.invocationCallOrder[0]).toBeLessThan(api.get.mock.invocationCallOrder[0])
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
    expect(sessionNotFoundErrors()).toHaveLength(0)
  })

  it('E4 getGuest 403 → get 도 403 → SESSION_NOT_FOUND(forbidden) 정확히 1회', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(axiosHttpError(403, guestRequestConfig(REC_TOKEN)))
    api.get.mockRejectedValue(axiosHttpError(403))
    renderEmbed({ sessionId: SESSION_ID })

    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'SESSION_NOT_FOUND', sessionId: SESSION_ID, reason: 'forbidden', fatal: true })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(posted('editor.ready')).toHaveLength(0)
  })

  it('E5 getGuest 404(코드 없음) → get 폴백, get 404 → not_found 1회', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(axiosHttpError(404, guestRequestConfig(REC_TOKEN)))
    api.get.mockRejectedValue(axiosHttpError(404))
    renderEmbed({ sessionId: SESSION_ID })

    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'SESSION_NOT_FOUND', reason: 'not_found' })
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
  })

  it('E5 getGuest 400 → get 폴백 → editor.ready', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(axiosHttpError(400, guestRequestConfig(REC_TOKEN)))
    api.get.mockResolvedValue(guestSession())
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('E6 getGuest 503 → 폴백 없이 NETWORK_ERROR 1회, get 미호출, 재던진 오류의 요청 설정에 토큰 원문 없음', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const thrown = axiosHttpError(503, guestRequestConfig(REC_TOKEN, true))
    api.getGuest.mockRejectedValue(thrown)
    renderEmbed({ sessionId: SESSION_ID })

    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'NETWORK_ERROR',
      fatal: true,
      message: '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
    })
    expect(api.get).not.toHaveBeenCalled()
    expect(sessionNotFoundErrors()).toHaveLength(0)

    // 로드 실패 경고로 전달된 오류 객체 = getGuest 가 던진 오류 — 헤더·URL 모두 가려져 있다.
    const loadWarn = warn.mock.calls.find((c) => c[0] === '[EmbeddedEditor] Session load failed:')
    expect(loadWarn).toBeDefined()
    const logged = loadWarn![4] as AxiosError
    expect(logged).toBe(thrown)
    expect(logged.config?.headers['x-guest-token']).toBe('[redacted]')
    expect(logged.config?.url).not.toContain(REC_TOKEN)
    expect(logged.config?.url).not.toContain(encodeURIComponent(REC_TOKEN))
    expect(JSON.stringify(logged.toJSON())).not.toContain(REC_TOKEN)
    expect(JSON.stringify(logged.toJSON())).not.toContain(encodeURIComponent(REC_TOKEN))
    // 5xx 는 토큰 무효의 근거가 아니므로 기록은 유지
    expect(sessionStorage.getItem(RECORD_KEY)).not.toBeNull()
  })

  it('E6 getGuest 타임아웃 → 폴백 없이 NETWORK_ERROR(TIMEOUT 문구), get 미호출', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(
      new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', guestRequestConfig(REC_TOKEN)),
    )
    renderEmbed({ sessionId: SESSION_ID })

    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'NETWORK_ERROR',
      message: '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
    })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('E6b getGuest 응답 없는 연결 실패(ERR_NETWORK) → get 폴백 → editor.ready, 기록 유지', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK', guestRequestConfig(REC_TOKEN)))
    api.get.mockResolvedValue(guestSession())
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RECORD_KEY)).not.toBeNull()
  })

  it('E6b getGuest ERR_NETWORK → get 도 ERR_NETWORK → NETWORK_ERROR 1회', async () => {
    seedRecord(REC_TOKEN, FUTURE)
    api.getGuest.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK', guestRequestConfig(REC_TOKEN)))
    api.get.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderEmbed({ sessionId: SESSION_ID })

    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()
    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('E7 get 경로로 게스트 세션 로드 → 기록(expiresAt 포함)', async () => {
    api.get.mockResolvedValue(guestSession({ guestToken: 'loaded-token', guestExpiresAt: FUTURE }))
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(JSON.parse(sessionStorage.getItem(RECORD_KEY) as string)).toEqual({
      guestToken: 'loaded-token',
      expiresAt: FUTURE,
    })
  })

  it('E7 createGuest 폴백으로 생성된 게스트 세션 → 기록', async () => {
    api.findByOrder.mockResolvedValue({ sessions: [] })
    api.create.mockRejectedValue(axiosHttpError(400))
    api.createGuest.mockResolvedValue(
      guestSession({ id: 'sess-guest-new', guestToken: 'new-token', guestExpiresAt: FUTURE }),
    )
    renderEmbed({ orderSeqno: 1234567890123, mode: 'both' })

    await waitFor(() => expect(api.createGuest).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(sessionStorage.getItem('storige_embed_guest_v1:sess-guest-new')).not.toBeNull(),
    )
    expect(JSON.parse(sessionStorage.getItem('storige_embed_guest_v1:sess-guest-new') as string)).toEqual({
      guestToken: 'new-token',
      expiresAt: FUTURE,
    })
  })

  it('E7 회원 세션(guestToken null)·guestToken 없는 응답 → 미기록', async () => {
    api.get.mockResolvedValue(guestSession({ guestToken: null, guestExpiresAt: null, memberSeqno: 123 }))
    const first = renderEmbed({ sessionId: SESSION_ID })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(sessionStorage.length).toBe(0)
    first.unmount()

    parentPost.mockReset()
    const operatorView: Record<string, unknown> = guestSession()
    delete operatorView.guestToken
    delete operatorView.guestExpiresAt
    api.get.mockResolvedValue(operatorView)
    renderEmbed({ sessionId: SESSION_ID })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(sessionStorage.length).toBe(0)
  })

  it('E8 만료 기록 → getGuest 미호출, get 경로, 기록 삭제', async () => {
    seedRecord(REC_TOKEN, PAST)
    api.get.mockResolvedValue(guestSession({ guestToken: null, guestExpiresAt: null, memberSeqno: 123 }))
    renderEmbed({ sessionId: SESSION_ID })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(api.getGuest).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledWith(SESSION_ID)
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
  })
})
