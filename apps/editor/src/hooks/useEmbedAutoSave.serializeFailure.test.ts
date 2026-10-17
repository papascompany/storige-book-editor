// 자동저장 수집기 — 캔버스 직렬화 실패 시 누락 저장 금지 (2026-10-17)
//
// 배경: collectCanvasData 가 toJSON 예외 캔버스를 filter 로 버려 26캔버스 세션이 24장으로 서버에
// 저장됐다(styles 없는 텍스트 객체). 짧은 배열이 저장되면 쪽 순서까지 밀리므로, 한 장이라도
// 실패하면 그 저장을 통째로 실패시키고(더티 유지·재시도) 어느 캔버스인지 로그·Sentry 로 남긴다.
//
// 고정하는 계약:
//  (1) N장 중 1장 toJSON 예외 → PATCH 없음, saveNow() false, console.error 에 캔버스 번호, Sentry 보고(캔버스 번호 포함)
//  (2) 실패 저장은 더티 상태를 지우지 않는다(isDirty 유지) — 다음 저장에서 재시도
//  (3) 전부 성공하면 종전과 같이 N장 배열이 그대로 PATCH 된다(회귀 가드)
//  (4) 로컬 백업도 실패 캔버스를 빼고 쓰지 않는다(백업 미기록 + 오류 로그)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

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
  ;(useAppStore as any).setState = (patch: Partial<typeof appState>) => Object.assign(appState, patch)
  return { useAppStore }
})

const { updateMock, updateGuestMock } = vi.hoisted(() => ({ updateMock: vi.fn(), updateGuestMock: vi.fn() }))
vi.mock('@/api/edit-sessions', () => ({ editSessionsApi: { update: updateMock, updateGuest: updateGuestMock } }))

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('@/lib/sentry', () => ({ Sentry: { captureMessage }, initSentry: () => false }))

import { useEmbedAutoSave } from './useEmbedAutoSave'
import { useSaveStore } from '@/stores/useSaveStore'

const SESSION_ID = 'sess-serialize'
const LOCAL_BACKUP_KEY = 'storige_embed_session_backup'

function fakeCanvas(id: string, toJSON?: () => unknown) {
  return {
    id,
    toJSON: toJSON ?? (() => ({ id, objects: [] })),
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

function renderAutoSave() {
  return renderHook(() => useEmbedAutoSave({ sessionId: SESSION_ID, currentSession: null }))
}

describe('useEmbedAutoSave — 캔버스 직렬화 실패 시 누락 저장 금지', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    updateMock.mockReset()
    updateGuestMock.mockReset()
    captureMessage.mockReset()
    updateMock.mockResolvedValue({ id: SESSION_ID })
    localStorage.removeItem(LOCAL_BACKUP_KEY)
    useSaveStore.getState().markDirty()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setCanvases([])
  })

  it('(1)(2) 3장 중 2번째 toJSON 예외 → PATCH 없음·false·오류 로그에 캔버스 번호·Sentry 보고·더티 유지', async () => {
    setCanvases([
      fakeCanvas('c1'),
      fakeCanvas('c2', () => { throw new TypeError("Cannot read properties of undefined (reading 'styles')") }),
      fakeCanvas('c3'),
    ])
    const { result } = renderAutoSave()
    let ok = true
    await act(async () => {
      ok = await result.current.saveNow()
    })
    expect(ok).toBe(false)
    expect(updateMock).not.toHaveBeenCalled()
    expect(updateGuestMock).not.toHaveBeenCalled()
    const serializeLog = errorSpy.mock.calls.find((c) => String(c[0]).includes('캔버스 2/3 직렬화 실패'))
    expect(serializeLog).toBeDefined()
    // 수집기의 Sentry 보고(어느 캔버스인지) — saveNow 는 로컬 백업·서버 저장 두 경로가 각각 수집하므로 1회 이상
    const serializeReports = captureMessage.mock.calls.filter((c) => String(c[0]).includes('canvas toJSON failed'))
    expect(serializeReports.length).toBeGreaterThanOrEqual(1)
    expect(serializeReports[0][1]).toEqual(
      expect.objectContaining({ level: 'error', extra: expect.objectContaining({ canvasIndex: 1, canvasCount: 3 }) }),
    )
    expect(useSaveStore.getState().isDirty).toBe(true)
  })

  it('(3) 전부 성공하면 3장 배열이 그대로 PATCH 된다(회귀 가드)', async () => {
    setCanvases([fakeCanvas('c1'), fakeCanvas('c2'), fakeCanvas('c3')])
    const { result } = renderAutoSave()
    let ok = false
    await act(async () => {
      ok = await result.current.saveNow()
    })
    expect(ok).toBe(true)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const body = updateMock.mock.calls[0][1]
    expect(Array.isArray(body.canvasData)).toBe(true)
    expect(body.canvasData).toHaveLength(3)
    expect(body.canvasData.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('(4) 로컬 백업도 실패 캔버스를 빼고 쓰지 않는다 — 백업 미기록 + 오류 로그', () => {
    setCanvases([fakeCanvas('c1'), fakeCanvas('c2', () => { throw new Error('boom') })])
    const { result } = renderAutoSave()
    act(() => {
      result.current.saveToLocal()
    })
    expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('로컬 백업 실패'))).toBe(true)
  })
})
