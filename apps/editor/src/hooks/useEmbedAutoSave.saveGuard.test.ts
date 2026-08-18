import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// canvas-core 스텁 — 실제 모듈은 paper.js 2D 컨텍스트를 요구해 happy-dom 에서 로드 불가.
// (useEmbedAutoSave.restore.test.ts 와 동일 패턴)
const { loadFromJSON } = vi.hoisted(() => ({ loadFromJSON: vi.fn(async () => {}) }))
vi.mock('@storige/canvas-core', () => {
  class Stub {}
  return {
    default: Stub, // Editor
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

// useAppStore 셀렉터 스텁 (restore.test 와 동일 패턴 — 주석 참조)
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

// 서버 저장 API 스텁 — R2 덮어쓰기 가드는 저장을 차단하지 않고 표면화만 해야 한다.
const { updateMock, updateGuestMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  updateGuestMock: vi.fn(),
}))
vi.mock('@/api/edit-sessions', () => ({
  editSessionsApi: { update: updateMock, updateGuest: updateGuestMock },
}))

// Sentry 스텁 — captureMessage 발화 검증용
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('@/lib/sentry', () => ({
  Sentry: { captureMessage },
  initSentry: () => false,
}))

import { useEmbedAutoSave } from './useEmbedAutoSave'
import { useSaveStore } from '@/stores/useSaveStore'

const SESSION_ID = 'sess-guard'
const LOCAL_BACKUP_KEY = 'storige_embed_session_backup'

function fakeCanvas(id: string) {
  return {
    id,
    toJSON: () => ({ id, objects: [] }),
    on: vi.fn(),
    off: vi.fn(),
    getObjects: () => [],
    requestRenderAll: vi.fn(),
  } as any
}

function setCanvases(list: any[]) {
  appState.allCanvas = list
  appState.canvas = list[list.length - 1] ?? null
}

function renderGuardHook(currentSession: any = null) {
  return renderHook(() =>
    useEmbedAutoSave({
      sessionId: SESSION_ID,
      currentSession,
    }),
  )
}

describe('useEmbedAutoSave — R2 canvasData 축소 저장 가드 (경고 표면화, 차단 아님)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    loadFromJSON.mockClear()
    updateMock.mockReset()
    updateMock.mockResolvedValue({ id: SESSION_ID, updatedAt: new Date().toISOString() })
    updateGuestMock.mockReset()
    captureMessage.mockClear()
    useSaveStore.getState().reset()
    setCanvases([])
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const shrinkWarnCalls = () =>
    warnSpy.mock.calls.filter((c) => String(c[0]).includes('페이지 수 감소 감지'))

  it('세션 로드 기준선(canvasData 배열)보다 짧게 저장하면 — 삭제 액션 없이 — 경고 + Sentry, 저장은 수행', async () => {
    // R2 실사고 시그니처: 서버 canvas_data 17장 → 재진입 시드 반감으로 9장 직렬화.
    // 여기서는 3장 기준선 → 2장 저장으로 축소 재현. allCanvas 는 한 번도 줄지 않는다
    // (절단은 직렬화 길이만 짧아진다) → 사용자 삭제 관찰 플래그가 서지 않아 경고 대상.
    setCanvases([fakeCanvas('c0'), fakeCanvas('c1')])
    const { result } = renderGuardHook({
      id: SESSION_ID,
      canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }], // 서버 기준선 3장
    })

    let ok = false
    await act(async () => {
      ok = await result.current.saveNow()
    })

    // 보수적 가드: 저장 자체는 수행된다 (2장 배열)
    expect(ok).toBe(true)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0][1]
    expect(Array.isArray(payload.canvasData)).toBe(true)
    expect(payload.canvasData).toHaveLength(2)

    // 표면화: console.warn + Sentry.captureMessage
    expect(shrinkWarnCalls()).toHaveLength(1)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage.mock.calls[0][0]).toContain('shrink')
    expect(captureMessage.mock.calls[0][1]).toMatchObject({
      level: 'warning',
      extra: { sessionId: SESSION_ID, prevLen: 3, nextLen: 2 },
    })
  })

  it('저장 성공이 기준선을 갱신한다 — 같은 길이 재저장은 경고 없음', async () => {
    setCanvases([fakeCanvas('c0'), fakeCanvas('c1')])
    const { result } = renderGuardHook({
      id: SESSION_ID,
      canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }],
    })

    await act(async () => {
      await result.current.saveNow() // 3 → 2: 경고 1회 + 기준선 2로 갱신
    })
    await act(async () => {
      await result.current.saveNow() // 2 → 2: 경고 없음
    })

    expect(updateMock).toHaveBeenCalledTimes(2)
    expect(shrinkWarnCalls()).toHaveLength(1)
    expect(captureMessage).toHaveBeenCalledTimes(1)
  })

  it('사용자 페이지 삭제(allCanvas 축소 관찰) 후의 축소 저장은 경고하지 않는다', async () => {
    const c0 = fakeCanvas('c0')
    const c1 = fakeCanvas('c1')
    const c2 = fakeCanvas('c2')
    setCanvases([c0, c1, c2])
    const { result, rerender } = renderGuardHook(null)

    await act(async () => {
      await result.current.saveNow() // 기준선 3 확립 (경고 없음 — 종전 기준선 부재)
    })
    expect(shrinkWarnCalls()).toHaveLength(0)

    // 사용자 페이지 삭제 시뮬레이션: allCanvas 3 → 2 (초기화 이후 구조 축소 관찰)
    setCanvases([c0, c1])
    rerender()

    await act(async () => {
      await result.current.saveNow() // 3 → 2 이지만 삭제 관찰됨 → 경고 없음
    })
    expect(updateMock).toHaveBeenCalledTimes(2)
    expect(shrinkWarnCalls()).toHaveLength(0)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('기준선이 없으면(세션 canvasData 비배열/부재) 경고하지 않는다', async () => {
    setCanvases([fakeCanvas('c0'), fakeCanvas('c1')])
    const { result } = renderGuardHook({ id: SESSION_ID, canvasData: null })

    await act(async () => {
      await result.current.saveNow()
    })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(shrinkWarnCalls()).toHaveLength(0)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('저장 성공 시 로컬 백업이 삭제된다 (기존 동작 회귀 가드)', async () => {
    setCanvases([fakeCanvas('c0'), fakeCanvas('c1')])
    localStorage.setItem(
      LOCAL_BACKUP_KEY,
      JSON.stringify({ sessionId: SESSION_ID, canvasData: [{}], savedAt: new Date().toISOString() }),
    )
    const { result } = renderGuardHook(null)

    await act(async () => {
      await result.current.saveNow()
    })
    expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
  })
})
