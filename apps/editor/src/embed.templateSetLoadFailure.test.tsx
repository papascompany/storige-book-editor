/**
 * 템플릿셋 조회·로드 실패(샘플 폴백이 없는 설정 = 프로덕션 기본).
 *
 * 잠그는 것:
 *   T1 거절(404·400·403·410·422)·형식 오류 → TEMPLATE_SET_NOT_FOUND {templateSetId, fatal} + 고정 문구(식별자·원문 없음)
 *   T2 일시 오류(5xx·408·429·연결·타임아웃) → NETWORK_ERROR(고정 문구, templateSetId 키 없음)
 *   T3 401 → editor.error 없이 인증 만료 화면(AUTH_EXPIRED 는 리스너 담당)
 *   T4 에디터 로드 단계도 같은 분류
 *   T5 초기화 취소는 editor.error 없이 조용히 끝난다
 *   T6 실패 로그는 단계·templateSetId 를 담는다
 *   T7 샘플 폴백이 허용된 설정(DEV)에서는 샘플 템플릿셋으로 열린다
 *
 * 하네스는 embed.orderEntryFailure.test.tsx 와 같다(주문별 세션 목록 비어 있음 → 회원 세션 생성 성공).
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

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
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
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: { getTemplateSetWithTemplates: (...a: unknown[]) => api.getTemplateSetWithTemplates(...(a as [])) },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ success: true, data: { role: 'customer' } })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { useAuthStore } from './stores/useAuthStore'
import { CanvasInitCancelledError } from './utils/createCanvas'

const PARENT_ORIGIN = 'https://host.example'
const TEMPLATE_SET_ID = 'ts-test'
const SAMPLE_TEMPLATE_SET_ID = 'sample-8x8-book-24p'

const C = '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.'
const S = '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
const T = '이 상품의 편집 정보를 찾을 수 없습니다. 이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요.'
const A = '인증이 만료되었습니다. 페이지를 새로고침해주세요.'

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

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function renderEmbed(callbacks: { onError?: (e: unknown) => void } = {}) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId={TEMPLATE_SET_ID}
      orderSeqno={1234567890123}
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

async function expectFailedWith(payload: Record<string, unknown>) {
  expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
  await flushInit()
  expect(posted('editor.error')).toEqual([payload])
  expect(posted('editor.ready')).toHaveLength(0)
  expect(screen.getByText(String(payload.message))).toBeInTheDocument()
}

describe('EmbeddedEditor — 템플릿셋 조회·로드 실패', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    vi.stubEnv('DEV', false)
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
    api.create.mockResolvedValue({ id: 'sess-new', status: 'editing', canvasData: null, metadata: {} })
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: TEMPLATE_SET_ID, name: 'TS', width: 210, height: 297 })
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
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

  it.each([404, 400, 403, 410, 422])(
    'T1 템플릿셋 조회 %s 거절은 TEMPLATE_SET_NOT_FOUND(고정 문구 + templateSetId)',
    async (status) => {
      api.getTemplateSetWithTemplates.mockRejectedValue(axiosHttpError(status, { message: 'server raw' }))
      renderEmbed()
      await expectFailedWith({ code: 'TEMPLATE_SET_NOT_FOUND', message: T, templateSetId: TEMPLATE_SET_ID, fatal: true })
      const text = JSON.stringify(posted('editor.error')[0].message)
      expect(text).not.toContain(TEMPLATE_SET_ID)
      expect(text).not.toContain('Request failed')
      expect(text).not.toContain('server raw')
      expect(contents.loadTemplateSetEditor).not.toHaveBeenCalled()
    },
  )

  it('T1 응답에 템플릿셋 id 가 없으면 TEMPLATE_SET_NOT_FOUND(고정 문구)', async () => {
    api.getTemplateSetWithTemplates.mockResolvedValue({ templateSet: { name: 'no id' } })
    renderEmbed()
    await expectFailedWith({ code: 'TEMPLATE_SET_NOT_FOUND', message: T, templateSetId: TEMPLATE_SET_ID, fatal: true })
  })

  it.each([500, 502, 503, 504, 408, 429])(
    'T2 템플릿셋 조회 %s 서버 오류는 NETWORK_ERROR(서버 문구, templateSetId 없음)',
    async (status) => {
      api.getTemplateSetWithTemplates.mockRejectedValue(axiosHttpError(status))
      renderEmbed()
      await expectFailedWith({ code: 'NETWORK_ERROR', message: S, fatal: true })
    },
  )

  it.each([
    ['연결 실패', () => new AxiosError('Network Error', 'ERR_NETWORK')],
    ['타임아웃', () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED')],
  ] as const)('T2 템플릿셋 조회 %s는 NETWORK_ERROR(연결 문구)', async (_label, makeErr) => {
    api.getTemplateSetWithTemplates.mockRejectedValue(makeErr())
    renderEmbed()
    await expectFailedWith({ code: 'NETWORK_ERROR', message: C, fatal: true })
  })

  it('T3 템플릿셋 조회 401이면 editor.error 없이 인증 만료 화면', async () => {
    api.getTemplateSetWithTemplates.mockRejectedValue(axiosHttpError(401))
    const onError = vi.fn()
    renderEmbed({ onError })
    expect(await screen.findByText(A)).toBeInTheDocument()
    await flushInit()
    expect(posted('editor.error')).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expect(posted('editor.ready')).toHaveLength(0)
  })

  it('T4 에디터 로드 503은 NETWORK_ERROR, HTTP 가 아닌 로드 실패는 TEMPLATE_SET_NOT_FOUND(원문 미포함)', async () => {
    contents.loadTemplateSetEditor.mockRejectedValue(axiosHttpError(503))
    const first = renderEmbed()
    await expectFailedWith({ code: 'NETWORK_ERROR', message: S, fatal: true })
    first.unmount()
    resetEditorStores()

    parentPost.mockReset()
    contents.loadTemplateSetEditor.mockReset().mockRejectedValue(new Error('SpreadSpec 구성에 실패했습니다.'))
    renderEmbed()
    await expectFailedWith({ code: 'TEMPLATE_SET_NOT_FOUND', message: T, templateSetId: TEMPLATE_SET_ID, fatal: true })
    expect(JSON.stringify(posted('editor.error'))).not.toContain('SpreadSpec')
  })

  it('T5 에디터 로드 중 초기화가 취소되면 editor.error 없이 조용히 끝난다', async () => {
    contents.loadTemplateSetEditor.mockRejectedValue(new CanvasInitCancelledError('init-1'))
    const onError = vi.fn()
    renderEmbed({ onError })
    await waitFor(() => expect(contents.loadTemplateSetEditor).toHaveBeenCalled())
    await flushInit()
    expect(posted('editor.error')).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByText('에디터 초기화 실패')).toBeNull()
  })

  it('T6 템플릿셋 실패 로그는 단계와 templateSetId 를 담는다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.getTemplateSetWithTemplates.mockRejectedValue(axiosHttpError(404))
    renderEmbed()
    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    const line = errorSpy.mock.calls.find(([first]) => String(first).includes('Template set load failed'))
    expect(String(line?.[0])).toContain('fetch')
    expect(String(line?.[0])).toContain(`templateSetId=${TEMPLATE_SET_ID}`)
  })

  it('T7 샘플 폴백이 허용된 설정에서는 요청 템플릿셋 조회가 실패해도 샘플 템플릿셋으로 열린다', async () => {
    vi.stubEnv('DEV', true)
    api.getTemplateSetWithTemplates.mockImplementation(async (id: string) => {
      if (id === SAMPLE_TEMPLATE_SET_ID) return { id: SAMPLE_TEMPLATE_SET_ID, name: 'Sample', width: 200, height: 200 }
      throw axiosHttpError(503)
    })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderEmbed()
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(posted('editor.ready')[0]).toMatchObject({ fallback: true, effectiveTemplateSetId: SAMPLE_TEMPLATE_SET_ID })
    expect(posted('editor.error')).toHaveLength(0)
    alertSpy.mockRestore()
  })
})
