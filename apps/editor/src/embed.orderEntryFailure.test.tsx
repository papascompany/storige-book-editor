/**
 * orderSeqno 진입(sessionId 없음)의 실패 처리 — 주문별 세션 조회·회원/비회원 세션 생성 실패를 같은 분류로 알린다.
 *
 * 잠그는 것:
 *   F 주문별 세션 목록 조회: 연결 실패·타임아웃·5xx·408·429 → 새 세션 없이 NETWORK_ERROR(고정 문구) 1회,
 *     401 → AUTH_EXPIRED 1회(리스너)만, 그 밖의 4xx → 새 세션 생성
 *   C 회원 세션 생성: 400(MEMBER_REQUIRED·code 없음)·403 PERMISSION_DENIED → 비회원 세션, 일시 오류 → NETWORK_ERROR,
 *     401 → AUTH_EXPIRED 1회, 그 밖의 거절 → INVALID_DATA(고정 문구)
 *   G 비회원 세션 생성 실패 → 같은 분류(고정 문구)
 *   A 초기화 중 getMe·주문 조회가 함께 401 이어도 AUTH_EXPIRED 는 1건
 *   L 초기화 후반 런타임 오류 → INVALID_DATA(고정 문구)
 *
 * 하네스는 embed.guestDraftResume.test.tsx 와 같고, apiClient.onAuthExpired 가 리스너를 모은다.
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
const seat = vi.hoisted(() => ({ ensure: vi.fn(async () => undefined) }))
vi.mock('./utils/contentPdfGuide', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/contentPdfGuide')>()
  return { ...actual, ensureSeatExistingContentPdf: (...a: unknown[]) => seat.ensure(...(a as [])) }
})

const auth = vi.hoisted(() => ({
  listeners: [] as Array<() => void>,
  getMe: vi.fn(async (): Promise<unknown> => ({ success: true, data: { role: 'customer' } })),
}))

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
  apiClient: {
    setBaseUrl: vi.fn(),
    setToken: vi.fn(),
    onAuthExpired: vi.fn((listener: () => void) => {
      auth.listeners.push(listener)
      return () => {
        auth.listeners = auth.listeners.filter((l) => l !== listener)
      }
    }),
  },
  authApi: { getMe: (...a: unknown[]) => auth.getMe(...(a as [])) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { useAuthStore } from './stores/useAuthStore'

const PARENT_ORIGIN = 'https://host.example'
const ORDER_SEQNO = 1234567890123
const NEW_SESSION_ID = 'sess-new-1'

const C = '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.'
const S = '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
const R = '편집 작업을 시작할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.'
const A = '인증이 만료되었습니다. 페이지를 새로고침해주세요.'
const GENERIC = '초기화 중 오류가 발생했습니다.'
const RAW_FRAGMENTS = ['Request failed', 'Network Error', 'timeout of']

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function axiosHttpError(status: number, data: Record<string, unknown> = {}): AxiosError {
  const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: cfg,
  })
}
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')
const timeoutError = () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED')

/** 인터셉터가 최종 401 에서 하는 일(리스너 호출) 뒤 401 로 거부 */
function rejectWithAuthExpired(): Promise<never> {
  auth.listeners.forEach((l) => l())
  return Promise.reject(axiosHttpError(401))
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: NEW_SESSION_ID,
    status: 'editing',
    orderSeqno: String(ORDER_SEQNO),
    mode: 'both',
    templateSetId: 'ts-test',
    canvasData: null,
    metadata: {},
    guestToken: null,
    guestExpiresAt: null,
    ...overrides,
  }
}

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function renderEmbed(callbacks: { onError?: (e: unknown) => void } = {}) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId="ts-test"
      orderSeqno={ORDER_SEQNO}
      mode="both"
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
    useSaveStore.setState({ isDirty: false } as never)
  })
}

async function expectStoppedWith(code: string, message: string) {
  expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
  await flushInit()
  expect(posted('editor.error')).toEqual([{ code, message, fatal: true }])
  expect(posted('editor.ready')).toHaveLength(0)
  expect(screen.getByText(message)).toBeInTheDocument()
}

describe('EmbeddedEditor — orderSeqno 진입 실패 처리', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
    sessionStorage.clear()
    auth.listeners = []
    auth.getMe.mockReset().mockResolvedValue({ success: true, data: { role: 'customer' } })
    for (const fn of Object.values(api)) fn.mockReset()
    api.listVersions.mockResolvedValue([])
    api.listGuestVersions.mockResolvedValue([])
    api.findByOrder.mockResolvedValue({ sessions: [], total: 0 })
    api.create.mockResolvedValue(session())
    api.createGuest.mockResolvedValue(session({ guestToken: 'gt-new', guestExpiresAt: '2099-01-01T00:00:00.000Z' }))
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 210, height: 297 })
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    seat.ensure.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
    resetEditorStores()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    act(() => {
      useAuthStore.setState({ token: '', me: null } as never)
    })
    resetEditorStores()
  })

  describe('F 주문별 세션 목록 조회', () => {
    it.each([
      ['연결 실패', networkError, C],
      ['타임아웃', timeoutError, C],
    ] as const)('F1 %s면 새 세션 없이 NETWORK_ERROR(연결 문구) 1회', async (_label, makeErr, message) => {
      api.findByOrder.mockRejectedValue(makeErr())
      renderEmbed()
      await expectStoppedWith('NETWORK_ERROR', message)
      expect(api.create).not.toHaveBeenCalled()
      expect(api.createGuest).not.toHaveBeenCalled()
      expect(api.getGuest).not.toHaveBeenCalled()
    })

    it.each([500, 502, 503, 504, 408, 429])(
      'F2 %s 서버 오류면 새 세션 없이 NETWORK_ERROR(서버 문구) 1회',
      async (status) => {
        api.findByOrder.mockRejectedValue(axiosHttpError(status))
        renderEmbed()
        await expectStoppedWith('NETWORK_ERROR', S)
        expect(api.create).not.toHaveBeenCalled()
        expect(api.createGuest).not.toHaveBeenCalled()
      },
    )

    it('F3 401이면 AUTH_EXPIRED 1회만 알리고 새 세션 없이 인증 만료 화면', async () => {
      api.findByOrder.mockImplementation(rejectWithAuthExpired)
      const onError = vi.fn()
      renderEmbed({ onError })
      expect(await screen.findByText(A)).toBeInTheDocument()
      await flushInit()
      expect(posted('editor.error')).toEqual([{ code: 'AUTH_EXPIRED', message: A, fatal: true }])
      expect(onError).toHaveBeenCalledTimes(1)
      expect(api.create).not.toHaveBeenCalled()
      expect(api.createGuest).not.toHaveBeenCalled()
      expect(posted('editor.ready')).toHaveLength(0)
    })

    it.each([400, 403, 404])('F4 %s로 거절되면 새 세션을 만든다', async (status) => {
      api.findByOrder.mockRejectedValue(axiosHttpError(status))
      renderEmbed()
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(posted('editor.ready')[0]).toMatchObject({ sessionId: NEW_SESSION_ID })
      expect(posted('editor.error')).toHaveLength(0)
    })
  })

  describe('C 회원 세션 생성', () => {
    it.each([
      [400, { code: 'MEMBER_REQUIRED' }],
      [400, {}],
      [403, { code: 'PERMISSION_DENIED' }],
    ] as const)('C1 %s %o 로 거절되면 비회원 세션으로 연다', async (status, data) => {
      api.create.mockRejectedValue(axiosHttpError(status, data))
      renderEmbed()
      await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
      expect(api.createGuest).toHaveBeenCalledTimes(1)
      expect(posted('editor.ready')[0]).toMatchObject({ sessionId: NEW_SESSION_ID })
      expect(posted('editor.error')).toHaveLength(0)
    })

    it.each([
      ['ERR_NETWORK', networkError, C],
      ['ECONNABORTED', timeoutError, C],
      ['503', () => axiosHttpError(503), S],
      ['408', () => axiosHttpError(408), S],
      ['429', () => axiosHttpError(429), S],
    ] as const)('C2 %s 일시 오류면 비회원 세션 없이 NETWORK_ERROR', async (_label, makeErr, message) => {
      api.create.mockRejectedValue(makeErr())
      renderEmbed()
      await expectStoppedWith('NETWORK_ERROR', message)
      expect(api.createGuest).not.toHaveBeenCalled()
    })

    it('C3 401이면 AUTH_EXPIRED 1회만, 비회원 세션 없음', async () => {
      api.create.mockImplementation(rejectWithAuthExpired)
      renderEmbed()
      expect(await screen.findByText(A)).toBeInTheDocument()
      await flushInit()
      expect(posted('editor.error')).toEqual([{ code: 'AUTH_EXPIRED', message: A, fatal: true }])
      expect(api.createGuest).not.toHaveBeenCalled()
      expect(posted('editor.ready')).toHaveLength(0)
    })

    it.each([
      [403, { code: 'ORDER_NOT_ALLOWED' }],
      [404, {}],
      [413, {}],
      [400, { code: 'OTHER' }],
    ] as const)('C4 %s %o 거절은 INVALID_DATA(고정 문구), 비회원 세션 없음', async (status, data) => {
      api.create.mockRejectedValue(axiosHttpError(status, data))
      renderEmbed()
      await expectStoppedWith('INVALID_DATA', R)
      expect(api.createGuest).not.toHaveBeenCalled()
    })
  })

  describe('G 비회원 세션 생성(폴백 뒤)', () => {
    beforeEach(() => {
      api.create.mockRejectedValue(axiosHttpError(400, { code: 'MEMBER_REQUIRED' }))
    })

    it.each([
      ['503', () => axiosHttpError(503), S],
      ['ERR_NETWORK', networkError, C],
      ['ECONNABORTED', timeoutError, C],
    ] as const)('G1 %s 일시 오류는 NETWORK_ERROR(고정 문구)', async (_label, makeErr, message) => {
      api.createGuest.mockRejectedValue(makeErr())
      renderEmbed()
      await expectStoppedWith('NETWORK_ERROR', message)
      for (const fragment of RAW_FRAGMENTS) expect(JSON.stringify(posted('editor.error'))).not.toContain(fragment)
    })

    it.each([
      [403, { code: 'ORDER_NOT_ALLOWED' }],
      [403, { code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED' }],
      [400, {}],
    ] as const)('G2 %s %o 거절은 INVALID_DATA(고정 문구)', async (status, data) => {
      api.createGuest.mockRejectedValue(axiosHttpError(status, data))
      renderEmbed()
      await expectStoppedWith('INVALID_DATA', R)
    })
  })

  it('A1 초기화 중 getMe·주문 조회가 함께 401 이면 AUTH_EXPIRED 는 정확히 1건', async () => {
    auth.getMe.mockImplementation(async () => {
      auth.listeners.forEach((l) => l())
      return { success: false, error: { code: '401', message: 'Unauthorized' } }
    })
    api.findByOrder.mockImplementation(rejectWithAuthExpired)
    const onError = vi.fn()
    renderEmbed({ onError })
    expect(await screen.findByText(A)).toBeInTheDocument()
    await flushInit()
    expect(auth.getMe).toHaveBeenCalled()
    expect(posted('editor.error')).toEqual([{ code: 'AUTH_EXPIRED', message: A, fatal: true }])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(api.create).not.toHaveBeenCalled()
  })

  it('L1 초기화 후반 런타임 오류는 INVALID_DATA(고정 문구)로 알린다', async () => {
    seat.ensure.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'pages')"))
    const onError = vi.fn()
    renderEmbed({ onError })
    await expectStoppedWith('INVALID_DATA', GENERIC)
    expect(onError).toHaveBeenCalledWith({ code: 'INVALID_DATA', message: GENERIC, fatal: true })
  })

  it('L2 편집기가 직접 던진 안내 오류는 그 문구로 INVALID_DATA', async () => {
    localStorage.removeItem('auth_token')
    renderEmbed()
    await expectStoppedWith('INVALID_DATA', '접근 권한이 없습니다. 로그인 후 다시 시도해주세요.')
    expect(api.findByOrder).not.toHaveBeenCalled()
  })
})
