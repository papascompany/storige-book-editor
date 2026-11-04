import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// canvas-core 스텁 — 실제 모듈은 paper.js 2D 컨텍스트를 요구해 happy-dom 에서 로드 불가.
// (useEmbedAutoSave.saveGuard.test.ts 와 동일 패턴)
const { loadFromJSON } = vi.hoisted(() => ({ loadFromJSON: vi.fn(async () => {}) }))
vi.mock('@storige/canvas-core', () => {
  class Stub {}
  return {
    default: Stub,
    core: { loadFromJSON, extendFabricOption: ['id', 'name'] },
    PluginBase: Stub,
    PointerShiftGuardPlugin: Stub,
    WorkspacePlugin: Stub,
    RenderOptimizer: Stub,
    SelectionType: {},
    createFabricCanvas: vi.fn(),
    configureFabricDefaults: vi.fn(),
  }
})

const { appState } = vi.hoisted(() => ({
  appState: {
    canvas: null as any,
    allCanvas: [] as any[],
    allEditors: [] as any[],
    addInnerPage: (async () => {}) as () => Promise<void>,
  },
}))
vi.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: (s: typeof appState) => unknown) => selector(appState)
  ;(useAppStore as any).getState = () => appState
  ;(useAppStore as any).setState = (patch: Partial<typeof appState>) =>
    Object.assign(appState, patch)
  return { useAppStore }
})

const { updateMock, updateGuestMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  updateGuestMock: vi.fn(),
}))
vi.mock('@/api/edit-sessions', () => ({
  editSessionsApi: { update: updateMock, updateGuest: updateGuestMock },
}))

vi.mock('@/lib/sentry', () => ({
  Sentry: { captureMessage: vi.fn() },
  initSentry: () => false,
}))

import { useEmbedAutoSave } from './useEmbedAutoSave'
import { useSaveStore } from '@/stores/useSaveStore'

const SESSION_ID = 'sess-complete-guard'

/** 가짜 fabric 캔버스 — on/off 로 등록된 최신 핸들러를 emit 으로 발화한다. */
function fakeCanvas(id: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    id,
    toJSON: () => ({ id, objects: [] }),
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    },
    off: (event: string) => {
      handlers.delete(event)
    },
    emit: (event: string) => {
      handlers.get(event)?.({})
    },
    getObjects: () => [],
    requestRenderAll: vi.fn(),
  } as any
}

function setCanvases(list: any[]) {
  appState.allCanvas = list
  appState.canvas = list[list.length - 1] ?? null
}

function renderGuardHook() {
  return renderHook(() =>
    useEmbedAutoSave({ sessionId: SESSION_ID, currentSession: null, initializedRef: { current: true } }),
  )
}

/** 사용자 입력 1회(캔버스 바깥 포함 — window capture 리스너가 받는다) */
function userPointerDown() {
  window.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

describe('useEmbedAutoSave — 편집 완료 뒤 시스템 이벤트 가드(markCompleted)', () => {
  let canvas: ReturnType<typeof fakeCanvas>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    updateMock.mockReset()
    updateMock.mockResolvedValue({ id: SESSION_ID, updatedAt: new Date().toISOString() })
    updateGuestMock.mockReset()
    useSaveStore.getState().reset()
    canvas = fakeCanvas('c0')
    setCanvases([canvas])
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('완료 직후 복원 이벤트(object:added/modified/removed)만 → 서버 PATCH 0회, dirty 아님', async () => {
    const { result, unmount } = renderGuardHook()

    act(() => {
      result.current.markCompleted()
    })
    // PDF 생성 뒤 복원·재배치가 내는 시스템 이벤트 — 사용자 입력 없음
    await act(async () => {
      canvas.emit('object:added')
      canvas.emit('object:modified')
      canvas.emit('object:removed')
      canvas.emit('object:modified')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(updateMock).not.toHaveBeenCalled()
    expect(updateGuestMock).not.toHaveBeenCalled()
    expect(useSaveStore.getState().isDirty).toBe(false)
    unmount()
  })

  it("완료 뒤 사용자 편집(입력 1회 + 캔버스 변경) → PATCH status 'editing' 1회", async () => {
    const { result, unmount } = renderGuardHook()

    act(() => {
      result.current.markCompleted()
    })
    // 가드 중 시스템 이벤트 — 저장 대상 아님
    await act(async () => {
      canvas.emit('object:modified')
    })
    // 실제 사용자 입력 → 가드 해제. 이어진 캔버스 변경은 종전대로 dirty + debounce 저장.
    await act(async () => {
      userPointerDown()
      canvas.emit('object:modified')
    })
    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0]).toBe(SESSION_ID)
    expect(updateMock.mock.calls[0][1]).toMatchObject({ status: 'editing' })
    unmount()
  })

  it('대조: markCompleted 없이 같은 캔버스 이벤트는 종전대로 PATCH 한다', async () => {
    const { unmount } = renderGuardHook()

    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][1]).toMatchObject({ status: 'editing' })
    unmount()
  })

  it('markCompleted 는 대기 중인 debounce 저장을 취소하고 clean 으로 만든다', async () => {
    const { result, unmount } = renderGuardHook()

    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      canvas.emit('object:modified')
    })
    expect(useSaveStore.getState().isDirty).toBe(true)

    act(() => {
      result.current.markCompleted()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(updateMock).not.toHaveBeenCalled()
    expect(useSaveStore.getState().isDirty).toBe(false)
    unmount()
  })
})
