/**
 * P1-4 (2026-08-22) — 서버 버전 스냅샷 "여기로 복원" 임베드 배선.
 *
 * 잠그는 것:
 *   ① 헤더에 sessionVersions 소스가 주입된다(세션 id 기반 list = 회원 API).
 *   ② restore 순서: dirty 면 saveNow 플러시 → 자동저장 차단(debounce cancel + markClean) →
 *      서버 restore → 로컬 백업 폐기 + R2 기준선 갱신(markServerSynced(복원 길이)) → in-place 재초기화.
 *   ③ 플러시 실패 시 서버 restore 를 호출하지 않는다(미저장 편집 유실 금지).
 *   ④ 서버 restore 실패 시 throw(패널이 토스트) + 부수효과 없음.
 *   ⑤ 재초기화는 복원 응답 세션을 주입해 세션 재조회(GET :id)/재생성 경로를 타지 않는다.
 *
 * EmbeddedEditor 의 무거운 초기화는 store.ready=true 선세팅으로 스킵된다(hostCommand 테스트 준용).
 * 재초기화(⑤)는 templatesApi 를 실패시켜 세션 단계만 통과시킨 뒤 오류 화면으로 종료시킨다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, waitFor } from '@testing-library/react'

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
vi.mock('./components/editor/FeatureSidebar', () => ({ default: () => null }))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({ WorkspaceModal: () => null }))
vi.mock('./components/RestoreBackupBanner', () => ({ RestoreBackupBanner: () => null }))
vi.mock('./components/editor/ObjectDeleteConfirm', () => ({ default: () => null }))
vi.mock('./components/editor/EditorWorkflowControls', () => ({ EditorWorkflowControls: () => null }))

const spies = vi.hoisted(() => ({
  saveNow: vi.fn(async () => true),
  deleteLocalBackup: vi.fn(),
  markClean: vi.fn(),
  markServerSynced: vi.fn(),
  cancel: vi.fn(),
  order: [] as string[],
}))

vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({ loadEmptyEditor: vi.fn(), loadTemplateSetEditor: vi.fn() }),
}))
vi.mock('./hooks/useEmbedAutoSave', () => ({
  useEmbedAutoSave: () => ({
    saveNow: (...a: unknown[]) => {
      spies.order.push('saveNow')
      return spies.saveNow(...(a as []))
    },
    restoreFromLocal: vi.fn(),
    evaluateRestore: () => ({ offer: false, confident: false }),
    deleteLocalBackup: () => {
      spies.order.push('deleteLocalBackup')
      spies.deleteLocalBackup()
    },
    markClean: () => {
      spies.order.push('markClean')
      spies.markClean()
    },
    markServerSynced: (n: number) => {
      spies.order.push(`markServerSynced:${n}`)
      spies.markServerSynced(n)
    },
    triggerSave: Object.assign(() => {}, {
      cancel: () => {
        spies.order.push('cancel')
        spies.cancel()
      },
    }),
  }),
}))
vi.mock('./hooks/useEmbedBackGuard', () => ({ useEmbedBackGuard: () => undefined }))
vi.mock('./hooks/useCanvasContainerSizeSync', () => ({ useCanvasContainerSizeSync: () => undefined }))
vi.mock('./hooks/useResolvedPageNavPosition', () => ({ useResolvedPageNavPosition: () => 'bottom' as const }))

const api = vi.hoisted(() => ({
  get: vi.fn(),
  createGuest: vi.fn(),
  create: vi.fn(),
  findByOrder: vi.fn(),
  restoreVersion: vi.fn(),
  restoreGuestVersion: vi.fn(),
  listVersions: vi.fn(async () => []),
  listGuestVersions: vi.fn(async () => []),
  getTemplateSetWithTemplates: vi.fn(async () => {
    throw new Error('TEMPLATE_FETCH_STUB')
  }),
}))
vi.mock('./api', () => ({
  editSessionsApi: {
    get: (...a: unknown[]) => {
      spies.order.push('api.get')
      return api.get(...(a as []))
    },
    createGuest: (...a: unknown[]) => api.createGuest(...(a as [])),
    create: (...a: unknown[]) => api.create(...(a as [])),
    findByOrder: (...a: unknown[]) => api.findByOrder(...(a as [])),
    restoreVersion: (...a: unknown[]) => {
      spies.order.push('api.restoreVersion')
      return api.restoreVersion(...(a as []))
    },
    restoreGuestVersion: (...a: unknown[]) => api.restoreGuestVersion(...(a as [])),
    listVersions: (...a: unknown[]) => api.listVersions(...(a as [])),
    listGuestVersions: (...a: unknown[]) => api.listGuestVersions(...(a as [])),
  },
  templatesApi: { getTemplateSetWithTemplates: (...a: unknown[]) => api.getTemplateSetWithTemplates(...(a as [])) },
  filesApi: {},
  apiClient: { setBaseUrl: vi.fn(), onAuthExpired: vi.fn(() => () => {}), setToken: vi.fn() },
  authApi: { getMe: vi.fn(async () => ({ role: "customer" })) },
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'
import { useSaveStore } from './stores/useSaveStore'

function renderEmbed() {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(
    <EmbeddedEditor templateSetId="ts-test" sessionId="sess-1" parentOrigin="https://host.example" instanceRef={instanceRef} />,
  )
}

const RESTORED = {
  id: 'sess-1',
  status: 'editing',
  canvasData: [{ p: 1 }, { p: 2 }, { p: 3 }],
  guestToken: null,
}

describe('EmbeddedEditor — 서버 버전 복원 배선 (P1-4)', () => {
  beforeEach(() => {
    captured.sessionVersions = null
    spies.order.length = 0
    spies.saveNow.mockReset().mockResolvedValue(true)
    spies.deleteLocalBackup.mockReset()
    spies.markClean.mockReset()
    spies.markServerSynced.mockReset()
    spies.cancel.mockReset()
    api.get.mockReset()
    api.createGuest.mockReset()
    api.restoreVersion.mockReset().mockResolvedValue(RESTORED)
    api.getTemplateSetWithTemplates.mockClear()
    api.listVersions.mockClear()
    api.listGuestVersions.mockClear()
    localStorage.setItem('auth_token', 'test-token')
    act(() => {
      useAppStore.setState({ ready: true, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  afterEach(() => {
    localStorage.removeItem('auth_token')
    act(() => {
      useAppStore.setState({ ready: false, canvas: null, activeSelection: [] } as never)
      useSaveStore.setState({ isDirty: false } as never)
    })
  })

  it('① ready 후 헤더에 세션 버전 소스가 주입되고 list 는 회원 API 를 탄다', async () => {
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    await captured.sessionVersions!.list()
    expect(api.listVersions).toHaveBeenCalledWith('sess-1')
    expect(api.listGuestVersions).not.toHaveBeenCalled()
  })

  it('② clean 상태 복원: 플러시 없이 cancel→restore→markClean→markServerSynced(3) 순서(로컬 백업 보존), 재초기화는 세션 주입(GET 미호출)·완료까지 대기', async () => {
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    const source = captured.sessionVersions!
    // 하네스: 최초 init effect 는 ready=true 로 조기 반환해 cleanup(reset)이 등록되지 않는다.
    // 프로덕션은 최초 init 이 완주하며 cleanup 이 reset 을 수행한다 — 여기서는 그 효과를 직접 흉내낸다.
    act(() => {
      useAppStore.setState({ ready: false } as never)
    })

    // restore 는 재초기화 완료까지 기다린다 — 하네스의 템플릿 스텁이 실패하므로 reject 로 귀결(실패 전파 검증).
    // ⚠️ act 안에서 await 하면 setReinitNonce 렌더가 act 종료까지 미뤄져 교착 → act 밖에서 호출하고 flush 만 act 로.
    let restoreErr: Error | null = null
    const pending = source.restore('v-1').catch((e: Error) => {
      restoreErr = e
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await pending
    expect(String(restoreErr?.message)).toContain('TEMPLATE_FETCH_STUB')

    // markClean 은 서버 복원 성공 뒤(실패 시 stale-clean 방지). 로컬 백업은 보존(deleteLocalBackup 미호출).
    expect(spies.order).toEqual(['cancel', 'api.restoreVersion', 'markClean', 'markServerSynced:3'])
    expect(spies.deleteLocalBackup).not.toHaveBeenCalled()
    expect(api.restoreVersion).toHaveBeenCalledWith('sess-1', 'v-1')

    // 재초기화: cleanup(reset) 뒤 init 재실행 — 세션 단계는 주입된 복원 세션을 써서 GET/재생성이 없고,
    // 템플릿 단계(스텁 실패)에서 오류 화면으로 종료된다.
    expect(await screen.findByText('에디터 초기화 실패')).toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(api.getTemplateSetWithTemplates).toHaveBeenCalled()
  })

  it('② dirty 상태 복원: saveNow 플러시가 restore 보다 먼저', async () => {
    act(() => {
      useSaveStore.setState({ isDirty: true } as never)
    })
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    const source = captured.sessionVersions!
    act(() => {
      useAppStore.setState({ ready: false } as never)
    })
    const pending = source.restore('v-1').catch(() => {})
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await pending
    expect(spies.order.indexOf('saveNow')).toBe(0)
    expect(spies.order.indexOf('api.restoreVersion')).toBeGreaterThan(spies.order.indexOf('saveNow'))
  })

  it('③ 플러시 실패(false) 시 서버 restore 를 호출하지 않고 throw 한다', async () => {
    act(() => {
      useSaveStore.setState({ isDirty: true } as never)
    })
    spies.saveNow.mockResolvedValue(false)
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    await expect(captured.sessionVersions!.restore('v-1')).rejects.toThrow(/먼저 저장하지 못했습니다/)
    expect(api.restoreVersion).not.toHaveBeenCalled()
    expect(spies.deleteLocalBackup).not.toHaveBeenCalled()
  })

  it('③-b 서버 저장 진행 중(status=saving)이면 복원을 거부한다', async () => {
    act(() => {
      useSaveStore.setState({ status: 'saving' } as never)
    })
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    await expect(captured.sessionVersions!.restore('v-1')).rejects.toThrow(/저장이 진행 중/)
    expect(api.restoreVersion).not.toHaveBeenCalled()
    act(() => {
      useSaveStore.setState({ status: 'saved' } as never)
    })
  })

  it('④-b 네트워크/5xx 실패는 "서버에는 적용됐을 수 있음" 안내를 덧붙인다', async () => {
    api.restoreVersion.mockRejectedValue(Object.assign(new Error('Network Error'), { response: undefined }))
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    await expect(captured.sessionVersions!.restore('v-x')).rejects.toThrow(/서버에는 적용됐을 수 있습니다/)
    // 4xx 는 원문 그대로
    api.restoreVersion.mockRejectedValue(Object.assign(new Error('404 스냅샷 없음'), { response: { status: 404 } }))
    await expect(captured.sessionVersions!.restore('v-x')).rejects.toThrow('404 스냅샷 없음')
  })

  it('④ 서버 restore 실패 시 throw + 로컬 백업/기준선 무접촉', async () => {
    api.restoreVersion.mockRejectedValue(new Error('404 스냅샷 없음'))
    renderEmbed()
    await waitFor(() => expect(captured.sessionVersions).not.toBeNull())
    await expect(captured.sessionVersions!.restore('v-x')).rejects.toThrow('404 스냅샷 없음')
    expect(spies.deleteLocalBackup).not.toHaveBeenCalled()
    expect(spies.markServerSynced).not.toHaveBeenCalled()
    expect(spies.markClean).not.toHaveBeenCalled()
    // 재초기화 없음
    expect(api.getTemplateSetWithTemplates).not.toHaveBeenCalled()
  })
})
