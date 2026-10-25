/**
 * instance.save / instance.complete 실패 → editor.error SAVE_FAILED(fatal:false) 고정 한국어 문구.
 * code·fatal·거부값(원래 오류)은 그대로이고 message 만 분류별 고정 문구다.
 *
 * 하네스는 embed.sessionVersionRestore.test.tsx 를 준용한다(store.ready=true 로 초기화 생략).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
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
vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({ loadEmptyEditor: vi.fn(), loadTemplateSetEditor: vi.fn() }),
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

const api = vi.hoisted(() => ({
  update: vi.fn(),
  complete: vi.fn(),
  listVersions: vi.fn(async () => []),
  listGuestVersions: vi.fn(async () => []),
}))
vi.mock('./api', () => ({
  editSessionsApi: {
    update: (...a: unknown[]) => api.update(...(a as [])),
    complete: (...a: unknown[]) => api.complete(...(a as [])),
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: {},
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ success: true, data: { role: 'customer' } })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'
import { SAVE_FAILURE_MESSAGES } from './utils/embedFailurePolicy'
import { __resetAutosaveSuspendForTest, runWithAutosaveSuspended } from './utils/autosaveSuspend'

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

function renderEmbed(onError?: (e: unknown) => void) {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  render(
    <EmbeddedEditor
      templateSetId="ts-test"
      sessionId="sess-1"
      parentOrigin="https://host.example"
      instanceRef={instanceRef}
      onError={onError}
    />,
  )
  return instanceRef
}

describe('EmbeddedEditor — 저장·완료 실패 SAVE_FAILED 문구', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
    api.update.mockReset()
    api.complete.mockReset()
    localStorage.setItem('auth_token', 'test-token')
    act(() => {
      useAppStore.setState({ ready: true, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    localStorage.removeItem('auth_token')
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
    })
  })

  it.each([
    ['연결 실패', () => new AxiosError('Network Error', 'ERR_NETWORK'), SAVE_FAILURE_MESSAGES.save.connectivity],
    ['503', () => axiosHttpError(503), SAVE_FAILURE_MESSAGES.save.server],
    ['401', () => axiosHttpError(401), SAVE_FAILURE_MESSAGES.save.auth],
    ['403 거절', () => axiosHttpError(403, { code: 'GUEST_SESSION_EXPIRED' }), SAVE_FAILURE_MESSAGES.save.rejected],
    ['413', () => axiosHttpError(413), SAVE_FAILURE_MESSAGES.save.tooLarge],
  ] as const)('instance.save %s → SAVE_FAILED(고정 문구), 원래 오류로 거부', async (_label, makeErr, message) => {
    const thrown = makeErr()
    api.update.mockRejectedValue(thrown)
    const onError = vi.fn()
    const instanceRef = renderEmbed(onError)
    expect(instanceRef.current).not.toBeNull()

    await expect(instanceRef.current!.save()).rejects.toBe(thrown)
    expect(posted('editor.error')).toEqual([{ code: 'SAVE_FAILED', message, fatal: false }])
    expect(onError).toHaveBeenCalledWith({ code: 'SAVE_FAILED', message, fatal: false })
  })

  it.each([
    ['update 503', 'update', () => axiosHttpError(503), SAVE_FAILURE_MESSAGES.complete.server],
    ['complete 401', 'complete', () => axiosHttpError(401), SAVE_FAILURE_MESSAGES.complete.auth],
    ['complete 400 거절', 'complete', () => axiosHttpError(400, { code: 'PDF_ATTACHED_EXCLUSIVE' }), SAVE_FAILURE_MESSAGES.complete.rejected],
  ] as const)('instance.complete %s → SAVE_FAILED(고정 문구), 원래 오류로 거부', async (_label, step, makeErr, message) => {
    const thrown = makeErr()
    if (step === 'update') {
      api.update.mockRejectedValue(thrown)
    } else {
      api.update.mockResolvedValue({ id: 'sess-1' })
      api.complete.mockRejectedValue(thrown)
    }
    const instanceRef = renderEmbed()

    await expect(instanceRef.current!.complete()).rejects.toBe(thrown)
    expect(posted('editor.error')).toEqual([{ code: 'SAVE_FAILED', message, fatal: false }])
    expect(posted('editor.complete')).toHaveLength(0)
  })

  describe('자동저장 보류 중(디자인 적용·PDF 생성)', () => {
    /** 보류 창을 열어 둔 채 fn 을 실행하고 닫는다 */
    async function whileSuspended(fn: () => Promise<void>): Promise<void> {
      let release: () => void = () => undefined
      const pending = runWithAutosaveSuspended(() => new Promise<void>((r) => { release = r }))
      try {
        await fn()
      } finally {
        release()
        await pending
        __resetAutosaveSuspendForTest()
      }
    }

    it('instance.save → SAVE_FAILED(고정 문구) 로 거부하고 서버 update 를 부르지 않는다', async () => {
      api.update.mockResolvedValue({ id: 'sess-1', updatedAt: 'now' })
      const onError = vi.fn()
      const instanceRef = renderEmbed(onError)
      await whileSuspended(async () => {
        await expect(instanceRef.current!.save()).rejects.toBeInstanceOf(Error)
      })
      const payload = { code: 'SAVE_FAILED', message: SAVE_FAILURE_MESSAGES.save.other, fatal: false }
      expect(posted('editor.error')).toEqual([payload])
      expect(onError).toHaveBeenCalledWith(payload)
      expect(posted('editor.save')).toHaveLength(0)
      expect(api.update).not.toHaveBeenCalled()
    })

    it('instance.complete → SAVE_FAILED(고정 문구) 로 거부하고 서버 update·complete 를 부르지 않는다', async () => {
      api.update.mockResolvedValue({ id: 'sess-1' })
      api.complete.mockResolvedValue({ id: 'sess-1', orderSeqno: '1' })
      const instanceRef = renderEmbed()
      await whileSuspended(async () => {
        await expect(instanceRef.current!.complete()).rejects.toBeInstanceOf(Error)
      })
      expect(posted('editor.error')).toEqual([{ code: 'SAVE_FAILED', message: SAVE_FAILURE_MESSAGES.complete.other, fatal: false }])
      expect(posted('editor.complete')).toHaveLength(0)
      expect(api.update).not.toHaveBeenCalled()
      expect(api.complete).not.toHaveBeenCalled()
    })
  })
})
