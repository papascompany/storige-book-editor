/**
 * 2026-09-29 (T1) — 명시 sessionId 조회 실패 시 SESSION_NOT_FOUND 로 중단(폴백 금지).
 *
 * 잠그는 것:
 *   ⓐ 404/410 → reason 'not_found', 403 → 'forbidden', 400/422 → 'invalid_id' 로
 *      editor.error SESSION_NOT_FOUND {sessionId, reason, fatal:true} 를 정확히 1회 발신하고 멈춘다.
 *      findByOrder / create / createGuest 로 폴백하지 않으며 editor.ready 도 없다.
 *   ⓑ 중단 화면: '편집 작업을 불러올 수 없습니다' + '돌아가기'(editor.cancel reason session_not_found).
 *      '다시 시도'(새로고침)는 렌더하지 않는다.
 *   ⓒ 네트워크 끊김·5xx 는 NETWORK_ERROR 1회(INVALID_DATA 아님, fatal:true — T4), 401 은 이 경로에서 발신 0회.
 *   ⓓ 치명 초기화 실패 후 instance.save 는 PATCH 없이 reject.
 *   ⓔ 회귀: 게스트 세션 재오픈(GET 성공)과 sessionId 없는 orderSeqno+mode 최초 편집은 불변.
 *
 * 하네스는 embed.sessionVersionRestore.test.tsx 를 준용하되, 초기화 effect 가 실제로 돌도록
 * store.ready=false 로 시작한다. editSessionsApi.get 은 raw axios 호출이므로 실제 AxiosError 로 reject 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, waitFor, fireEvent } from '@testing-library/react'
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
const SESSION_ID = 'sess-missing'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function axiosHttpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config,
  })
}

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function renderEmbed(
  props: Partial<{ sessionId: string; orderSeqno: number; mode: 'cover' | 'content' | 'both' | 'template' }> = {},
  callbacks: { onCancel?: () => void; onError?: (e: unknown) => void; onReady?: () => void } = {},
) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  const utils = render(
    <EmbeddedEditor
      templateSetId="ts-test"
      parentOrigin={PARENT_ORIGIN}
      instanceRef={instanceRef}
      {...props}
      {...callbacks}
    />,
  )
  return { ...utils, instanceRef }
}

/** 초기화 비동기 체인을 흘려보낸다 */
async function flushInit() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

function expectNoFallback() {
  expect(api.findByOrder).not.toHaveBeenCalled()
  expect(api.create).not.toHaveBeenCalled()
  expect(api.createGuest).not.toHaveBeenCalled()
}

describe('EmbeddedEditor — 명시 sessionId 조회 실패 = SESSION_NOT_FOUND 중단 (T1)', () => {
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
    api.getTemplateSetWithTemplates.mockRejectedValue(new Error('TEMPLATE_FETCH_STUB'))
    contents.loadTemplateSetEditor.mockReset().mockResolvedValue(undefined)
    localStorage.setItem('auth_token', 'test-token')
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  it('(a) 404 + orderSeqno/mode/templateSetId → SESSION_NOT_FOUND(not_found) 1회, 폴백·ready 없음, 돌아가기 화면', async () => {
    api.get.mockRejectedValue(axiosHttpError(404))
    const onCancel = vi.fn()
    const onError = vi.fn()
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' }, { onCancel, onError })

    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()

    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: '저장된 편집 작업을 찾을 수 없습니다. 삭제되었거나 보관 기간이 지난 작업일 수 있습니다.',
      sessionId: SESSION_ID,
      reason: 'not_found',
      fatal: true,
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith(SESSION_ID)
    expectNoFallback()
    expect(api.getTemplateSetWithTemplates).not.toHaveBeenCalled()
    expect(posted('editor.ready')).toHaveLength(0)

    expect(screen.getByText(/저장된 편집 작업을 찾을 수 없습니다/)).toBeInTheDocument()
    expect(screen.getByText('이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('다시 시도')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(posted('editor.cancel')).toEqual([{ sessionId: SESSION_ID, reason: 'session_not_found' }])
  })

  it('(b) 403 → reason forbidden + 계정/비회원 만료 안내 문구', async () => {
    api.get.mockRejectedValue(axiosHttpError(403))
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' })
    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()

    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'SESSION_NOT_FOUND',
      sessionId: SESSION_ID,
      reason: 'forbidden',
      fatal: true,
      message:
        '이 계정으로 열 수 없는 편집 작업입니다. 다른 계정으로 만든 작업이거나, 비회원으로 만든 작업은 24시간이 지나 만료되었을 수 있습니다.',
    })
    expectNoFallback()
  })

  it('(c) 400 → reason invalid_id', async () => {
    api.get.mockRejectedValue(axiosHttpError(400))
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' })
    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()

    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'SESSION_NOT_FOUND',
      sessionId: SESSION_ID,
      reason: 'invalid_id',
      fatal: true,
      message: '편집 작업 식별자가 올바르지 않습니다.',
    })
    expectNoFallback()
  })

  it('(d) 네트워크 끊김(ERR_NETWORK) → NETWORK_ERROR 1회(INVALID_DATA 아님), 폴백 없음', async () => {
    api.get.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' })
    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()

    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'NETWORK_ERROR',
      message: '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
    })
    // T4: 초기화 실패는 치명(fatal:true) — 이 iframe 에서 더 진행 불가
    expect(errors[0]).toMatchObject({ fatal: true })
    expectNoFallback()
    expect(posted('editor.ready')).toHaveLength(0)
  })

  it('(e) 503 → NETWORK_ERROR 1회, 폴백 없음', async () => {
    api.get.mockRejectedValue(axiosHttpError(503))
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' })
    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    await flushInit()

    const errors = posted('editor.error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'NETWORK_ERROR',
      fatal: true,
      // 서버 원문 대신 고정 한국어 고객 문구(호스트가 message 를 그대로 노출)
      message: '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
    })
    expectNoFallback()
  })

  it('(f) 401 → 이 경로의 editor.error 0회(AUTH_EXPIRED 는 리스너 담당), 폴백 없음, 오류 화면', async () => {
    api.get.mockRejectedValue(axiosHttpError(401))
    const onError = vi.fn()
    renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' }, { onError })
    expect(await screen.findByText('인증이 만료되었습니다. 다시 로그인해주세요.')).toBeInTheDocument()
    await flushInit()

    expect(posted('editor.error')).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expectNoFallback()
    expect(posted('editor.ready')).toHaveLength(0)
  })

  it('(g) SESSION_NOT_FOUND 이후 instance.save/complete 는 PATCH 없이 reject', async () => {
    api.get.mockRejectedValue(axiosHttpError(404))
    const { instanceRef } = renderEmbed({ sessionId: SESSION_ID, orderSeqno: 1234567890123, mode: 'both' })
    expect(await screen.findByText('편집 작업을 불러올 수 없습니다')).toBeInTheDocument()
    await flushInit()
    parentPost.mockClear()

    expect(instanceRef.current).not.toBeNull()
    await expect(instanceRef.current!.save()).rejects.toThrow('편집기를 초기화하지 못해 저장할 수 없습니다.')
    await expect(instanceRef.current!.complete()).rejects.toThrow('편집기를 초기화하지 못해 저장할 수 없습니다.')
    expect(api.update).not.toHaveBeenCalled()
    expect(api.updateGuest).not.toHaveBeenCalled()
    expect(posted('editor.error')).toHaveLength(0)
  })

  it('(h) 회귀: 게스트 세션 재오픈(GET 성공) → SESSION_NOT_FOUND 없이 editor.ready', async () => {
    api.get.mockResolvedValue({
      id: SESSION_ID,
      status: 'editing',
      templateSetId: 'ts-test',
      canvasData: null,
      metadata: {},
      guestToken: 'guest-token-1',
    })
    api.getTemplateSetWithTemplates.mockResolvedValue({ id: 'ts-test', name: 'TS', width: 210, height: 297 })
    const onReady = vi.fn()
    renderEmbed({ sessionId: SESSION_ID }, { onReady })

    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    expect(posted('editor.ready')[0]).toMatchObject({ sessionId: SESSION_ID })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(posted('editor.error').filter((p) => p.code === 'SESSION_NOT_FOUND')).toHaveLength(0)
    expect(screen.queryByText('편집 작업을 불러올 수 없습니다')).toBeNull()
    expectNoFallback()
  })

  it('(i) 회귀: sessionId 없이 orderSeqno+mode → findByOrder 후 create', async () => {
    api.findByOrder.mockResolvedValue({ sessions: [] })
    api.create.mockResolvedValue({ id: 'sess-new', status: 'draft', canvasData: null, metadata: {} })
    renderEmbed({ orderSeqno: 1234567890123, mode: 'both' })

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    expect(api.get).not.toHaveBeenCalled()
    expect(api.findByOrder).toHaveBeenCalledWith(1234567890123)
    expect(api.findByOrder.mock.invocationCallOrder[0]).toBeLessThan(api.create.mock.invocationCallOrder[0])
    expect(api.create.mock.calls[0][0]).toMatchObject({ orderSeqno: 1234567890123, mode: 'both', templateSetId: 'ts-test' })
    expect(api.createGuest).not.toHaveBeenCalled()
    await flushInit()
    expect(posted('editor.error').filter((p) => p.code === 'SESSION_NOT_FOUND')).toHaveLength(0)
  })
})
