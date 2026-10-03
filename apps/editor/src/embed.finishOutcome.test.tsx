/**
 * 헤더 '편집완료'(onFinish) 결과값과 호스트 이벤트.
 *   - 회원 세션: 'completed' + editor.complete 1회
 *   - 비회원 세션: 'needsAuth' + editor.complete(needsAuth) → editor.needAuth 순서 유지
 *   - 세션 없음: 'skipped', 저장·완료 호출·이벤트 없음
 *   - 실패: SAVE_FAILED(고정 문구, fatal:false) + 원래 오류로 거부
 *
 * 하네스는 embed.guestReopen.test.tsx 를 준용한다(비회원 세션은 전체 초기화, 나머지는 store.ready=true 로 초기화 생략).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import type { FinishOutcome } from './utils/finishOutcome'

const captured = vi.hoisted(() => ({
  onFinish: null as null | (() => Promise<FinishOutcome | void>),
}))

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

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { SAVE_FAILURE_MESSAGES } from './utils/embedFailurePolicy'

const PARENT_ORIGIN = 'https://host.example'

interface Envelope {
  event: string
  payload: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload)
}

function postedEvents(): string[] {
  return parentPost.mock.calls.map(([m]) => m.event)
}

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

function renderEmbed(props: Partial<{ sessionId: string }> = {}, onError?: (e: unknown) => void) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor
      templateSetId="ts-test"
      parentOrigin={PARENT_ORIGIN}
      instanceRef={instanceRef}
      onError={onError}
      {...props}
    />,
  )
}

function setReady(ready: boolean) {
  act(() => {
    useAppStore.setState({ ready, canvas: null, activeSelection: [] } as never)
    useSaveStore.setState({ isDirty: false } as never)
  })
}

const COMPLETED_SESSION = {
  id: 'sess-1',
  orderSeqno: 1234567890123,
  status: 'completed',
  coverFileId: null,
  contentFileId: null,
  coverFile: null,
  completedAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
}

describe('EmbeddedEditor — 편집완료 결과(FinishOutcome)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    captured.onFinish = null
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
    localStorage.setItem('auth_token', 'test-token')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    sessionStorage.clear()
    setReady(false)
  })

  it('E1 회원 세션 편집완료는 completed 를 돌려주고 editor.complete 1회', async () => {
    setReady(true)
    api.update.mockResolvedValue({ id: 'sess-1' })
    api.complete.mockResolvedValue(COMPLETED_SESSION)
    renderEmbed({ sessionId: 'sess-1' })
    expect(captured.onFinish).not.toBeNull()

    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      outcome = await captured.onFinish!()
    })
    expect(outcome).toBe('completed')
    expect(api.complete).toHaveBeenCalledWith('sess-1')
    expect(posted('editor.complete')).toHaveLength(1)
    expect(posted('editor.complete')[0]).toMatchObject({ sessionId: 'sess-1' })
    expect(posted('editor.error')).toHaveLength(0)
  })

  it('E2 비회원 세션 편집완료는 needsAuth 를 돌려주고 editor.complete(needsAuth) 뒤 editor.needAuth 를 보낸다', async () => {
    setReady(false)
    api.get.mockResolvedValue({
      id: 'sess-guest-1',
      status: 'editing',
      templateSetId: 'ts-test',
      canvasData: null,
      metadata: {},
      guestToken: 'gt-1',
      guestExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    api.updateGuest.mockResolvedValue({ id: 'sess-guest-1' })
    renderEmbed({ sessionId: 'sess-guest-1' })
    await waitFor(() => expect(posted('editor.ready')).toHaveLength(1))
    parentPost.mockClear()

    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      outcome = await captured.onFinish!()
    })
    expect(outcome).toBe('needsAuth')
    expect(api.updateGuest).toHaveBeenCalledWith('sess-guest-1', 'gt-1', { canvasData: null })
    expect(api.update).not.toHaveBeenCalled()
    expect(api.complete).not.toHaveBeenCalled()
    expect(postedEvents()).toEqual(['editor.complete', 'editor.needAuth'])
    expect(posted('editor.complete')[0]).toMatchObject({ needsAuth: true, guestToken: 'gt-1', files: {} })
  })

  it('E3 세션 없이 연 편집기의 편집완료는 skipped 이고 저장·완료 호출과 이벤트가 없다', async () => {
    setReady(true)
    renderEmbed()

    let outcome: FinishOutcome | void = undefined
    await act(async () => {
      outcome = await captured.onFinish!()
    })
    expect(outcome).toBe('skipped')
    expect(api.update).not.toHaveBeenCalled()
    expect(api.updateGuest).not.toHaveBeenCalled()
    expect(api.complete).not.toHaveBeenCalled()
    expect(postedEvents()).toEqual([])
  })

  it.each([
    ['서버 오류', () => axiosHttpError(503), SAVE_FAILURE_MESSAGES.complete.server],
    ['용량 초과', () => axiosHttpError(413), SAVE_FAILURE_MESSAGES.complete.tooLarge],
    ['거절', () => axiosHttpError(403, { code: 'GUEST_SESSION_EXPIRED' }), SAVE_FAILURE_MESSAGES.complete.rejected],
  ] as const)('E4 편집완료 저장 실패(%s) → SAVE_FAILED(고정 문구), 원래 오류로 거부', async (_label, makeErr, message) => {
    setReady(true)
    const thrown = makeErr()
    api.update.mockRejectedValue(thrown)
    const onError = vi.fn()
    renderEmbed({ sessionId: 'sess-1' }, onError)

    let rejected: unknown = null
    await act(async () => {
      try {
        await captured.onFinish!()
      } catch (e) {
        rejected = e
      }
    })
    expect(rejected).toBe(thrown)
    expect(posted('editor.error')).toEqual([{ code: 'SAVE_FAILED', message, fatal: false }])
    expect(onError).toHaveBeenCalledWith({ code: 'SAVE_FAILED', message, fatal: false })
    expect(posted('editor.complete')).toHaveLength(0)
  })

  it('E5 편집완료 실패 로그는 요약 문자열이고 인증 헤더 원문이 없다', async () => {
    setReady(true)
    const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    cfg.headers.set('Authorization', 'Bearer member-jwt-secret')
    const thrown = new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', cfg, undefined, {
      status: 503,
      data: { message: 'server raw' },
      statusText: '',
      headers: {},
      config: cfg,
    })
    api.update.mockRejectedValue(thrown)
    renderEmbed({ sessionId: 'sess-1' })

    await act(async () => {
      await captured.onFinish!().catch(() => undefined)
    })
    const errorSpy = vi.mocked(console.error)
    const line = errorSpy.mock.calls.find(([first]) => first === '[EmbeddedEditor] Complete failed:')
    expect(line).toBeDefined()
    expect(typeof line![1]).toBe('string')
    expect(line![1]).toContain('status=503')
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(arg).not.toBeInstanceOf(AxiosError)
        expect(String(arg)).not.toContain('member-jwt-secret')
      }
    }
  })
})
