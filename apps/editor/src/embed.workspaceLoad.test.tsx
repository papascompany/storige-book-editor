/**
 * 편집기 안 '저장된 작업 불러오기'(WorkspaceModal onLoad → handleLoadSession) 실패 알림.
 *
 * 잠그는 것:
 *   - 불러오기 처리 중 예외(Error·Error 가 아닌 값 모두)는 onError 와 정식 editor.error 를 각 1회 보내고,
 *     payload 는 { code:'INVALID_DATA', message:'작업을 불러오는데 실패했습니다.', fatal:false } 로 같다.
 *   - message 는 고정 한국어 문구다(예외 원문을 싣지 않는다). 레거시 storige:error 는 EmbedView 가
 *     onError 의 message 를 그대로 보내므로 같은 문구다.
 *
 * 하네스는 embed.sessionVersionRestore.test.tsx 를 준용한다(store.ready=true 선세팅으로 초기화 생략).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import type { EditSessionResponse } from './api'

const captured = vi.hoisted(() => ({
  onLoad: null as null | ((session: EditSessionResponse) => void),
}))

vi.mock('./components/editor/EditorHeader', () => ({ default: () => null }))
vi.mock('./components/editor/ToolBar', () => ({ default: () => null }))
vi.mock('./components/editor/ObjectActionBar', () => ({ default: () => null }))
vi.mock('./components/editor/FeatureSidebar', () => ({ default: () => null }))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({
  WorkspaceModal: (props: { onLoad: (session: EditSessionResponse) => void }) => {
    captured.onLoad = props.onLoad
    return null
  },
}))
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

vi.mock('./api', () => ({
  editSessionsApi: {
    get: vi.fn(),
    getGuest: vi.fn(),
    createGuest: vi.fn(),
    create: vi.fn(),
    findByOrder: vi.fn(),
    listVersions: vi.fn(async () => []),
    listGuestVersions: vi.fn(async () => []),
  },
  templatesApi: { getTemplateSetWithTemplates: vi.fn() },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ role: 'customer' })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'

const PARENT_ORIGIN = 'https://host.example'
const FIXED_PAYLOAD = { code: 'INVALID_DATA', message: '작업을 불러오는데 실패했습니다.', fatal: false }

interface Envelope {
  event?: string
  payload?: Record<string, unknown>
}

const parentPost = vi.fn<(msg: Envelope, origin: string) => void>()

function posted(event: string): Record<string, unknown>[] {
  return parentPost.mock.calls.filter(([m]) => m.event === event).map(([m]) => m.payload ?? {})
}

/** id 를 읽을 때 thrown 을 던지는 세션 항목 */
function sessionThrowingOnId(thrown: unknown): EditSessionResponse {
  const session = {}
  Object.defineProperty(session, 'id', {
    get() {
      throw thrown
    },
  })
  return session as EditSessionResponse
}

describe('EmbeddedEditor — 저장된 작업 불러오기 실패 알림', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')

  beforeEach(() => {
    captured.onLoad = null
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => {
      useAppStore.setState({ ready: true, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
    vi.restoreAllMocks()
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  it.each([
    ['Error', new Error('raw boom')],
    ['Error 가 아닌 값', 'raw string'],
  ] as const)('W 불러오기 처리 중 %s 예외 → onError·editor.error 각 1회, 고정 문구 INVALID_DATA(fatal:false)', async (_label, thrown) => {
    const onError = vi.fn()
    const instanceRef = { current: null as EditorInstanceMethods | null }
    render(
      <EmbeddedEditor
        templateSetId="ts-test"
        sessionId="sess-1"
        parentOrigin={PARENT_ORIGIN}
        instanceRef={instanceRef}
        onError={onError}
      />,
    )
    await waitFor(() => expect(captured.onLoad).not.toBeNull())
    parentPost.mockClear()

    act(() => {
      captured.onLoad?.(sessionThrowingOnId(thrown))
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(FIXED_PAYLOAD)
    const errors = posted('editor.error')
    expect(errors).toEqual([FIXED_PAYLOAD])
    const formalCall = parentPost.mock.calls.find(([m]) => m.event === 'editor.error')
    expect(formalCall?.[1]).toBe(PARENT_ORIGIN)
    expect(JSON.stringify(parentPost.mock.calls)).not.toContain('raw')
    expect(JSON.stringify(onError.mock.calls)).not.toContain('raw')
  })
})
