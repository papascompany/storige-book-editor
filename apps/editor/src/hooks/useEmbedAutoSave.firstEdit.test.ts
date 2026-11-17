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

const SESSION_ID = 'sess-first-edit'

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

function setCanvases(list: any[], active?: any) {
  appState.allCanvas = list
  appState.canvas = active ?? list[list.length - 1] ?? null
}

function renderAutoSave() {
  return renderHook(() =>
    useEmbedAutoSave({ sessionId: SESSION_ID, currentSession: null, initializedRef: { current: true } }),
  )
}

/**
 * 저장된 상태에서의 편집 1회가 2초 뒤 자동저장되는지.
 *
 * 종전에는 debounce 함수가 isDirty 에 묶여 다시 만들어졌다. 깨끗한 상태에서 첫 편집이 오면
 * 방금 건 저장 예약이 (isDirty 변화 → 재렌더 → effect cleanup 으로) 취소돼, 두 번째 편집이나
 * 30초 주기 저장이 올 때까지 서버에 저장되지 않았다. 헤더에는 그동안 '저장되지 않음'이 남는다.
 */
describe('useEmbedAutoSave — 편집 1회의 자동저장', () => {
  let canvas: ReturnType<typeof fakeCanvas>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    updateMock.mockReset()
    updateMock.mockResolvedValue({ id: SESSION_ID, updatedAt: new Date().toISOString() })
    updateGuestMock.mockReset()
    useSaveStore.getState().reset()
    // 30초 주기 저장이 결과를 가리지 않도록 끈다 — 이 테스트는 debounce 저장만 본다
    useSaveStore.getState().setAutoSaveEnabled(false)
    canvas = fakeCanvas('c0')
    setCanvases([canvas])
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('저장된 상태에서 편집 1회 → 2초 뒤 PATCH 1회, 상태는 저장됨', async () => {
    const { unmount } = renderAutoSave()

    await act(async () => {
      canvas.emit('object:modified')
    })
    expect(useSaveStore.getState().status).toBe('unsaved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(useSaveStore.getState().status).toBe('saved')
    expect(useSaveStore.getState().isDirty).toBe(false)
    unmount()
  })

  it('저장 뒤 다시 편집 1회 → 또 2초 뒤 PATCH(누적 2회)', async () => {
    const { unmount } = renderAutoSave()

    await act(async () => {
      canvas.emit('object:added')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    await act(async () => {
      canvas.emit('object:removed')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(updateMock).toHaveBeenCalledTimes(2)
    expect(useSaveStore.getState().status).toBe('saved')
    unmount()
  })

  it('편집 직후 다른 쪽으로 넘어가도(활성 캔버스 변경) 예약된 저장은 취소되지 않는다', async () => {
    const second = fakeCanvas('c1')
    setCanvases([canvas, second], canvas)
    const { rerender, unmount } = renderAutoSave()

    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      setCanvases([canvas, second], second)
      rerender()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('저장 요청이 가는 동안 온 편집은 저장됨으로 지워지지 않고, 2초 뒤 다시 저장된다', async () => {
    let release: (value: unknown) => void = () => undefined
    updateMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const { unmount } = renderAutoSave()

    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(useSaveStore.getState().status).toBe('saving')

    // 첫 저장의 응답을 기다리는 동안 한 번 더 편집
    await act(async () => {
      canvas.emit('object:modified')
    })
    await act(async () => {
      release({ id: SESSION_ID, updatedAt: new Date().toISOString() })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(useSaveStore.getState().isDirty).toBe(true)
    expect(useSaveStore.getState().status).toBe('unsaved')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })
    expect(updateMock).toHaveBeenCalledTimes(2)
    expect(useSaveStore.getState().status).toBe('saved')
    expect(useSaveStore.getState().isDirty).toBe(false)
    unmount()
  })

  it('언마운트하면 예약된 저장은 취소된다', async () => {
    const { unmount } = renderAutoSave()

    await act(async () => {
      canvas.emit('object:modified')
    })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(updateMock).not.toHaveBeenCalled()
  })
})
