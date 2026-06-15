import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// canvas-core 전체를 가벼운 스텁으로 대체 — 실제 모듈은 paper.js 2D 컨텍스트를 요구해
// happy-dom 에서 로드 불가. 복원 라우팅(멀티페이지 배열 vs 단일)만 검증하면 되므로
// core.loadFromJSON 스파이 + useAppStore 가 구조분해하는 심볼들만 스텁으로 제공한다.
// vi.hoisted: vi.mock 팩토리는 파일 최상단으로 호이스트되므로 스파이도 호이스트가 필요.
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

// useAppStore 를 가벼운 셀렉터 스텁으로 대체 — 실제 스토어는 debounce/스크린샷/spine 재계산 등
// 무거운 모듈 초기화 부작용을 동반해 renderHook 의 act 큐와 충돌한다(Should not already be
// working). 이 테스트는 복원 라우팅만 검증하므로 canvas/allCanvas 셀렉터만 노출하면 충분.
const { appState } = vi.hoisted(() => ({
  appState: { canvas: null as any, allCanvas: [] as any[], allEditors: [] as any[] },
}))
vi.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: (s: typeof appState) => unknown) => selector(appState)
  ;(useAppStore as any).getState = () => appState
  ;(useAppStore as any).setState = (patch: Partial<typeof appState>) =>
    Object.assign(appState, patch)
  return { useAppStore }
})

import { useEmbedAutoSave } from './useEmbedAutoSave'
import { useSaveStore } from '@/stores/useSaveStore'

const LOCAL_BACKUP_KEY = 'storige_embed_session_backup'
const SESSION_ID = 'sess-restore'

/** 가짜 fabric 캔버스 — toJSON + on/off(이벤트 리스너 등록 가드용) */
function fakeCanvas(id: string) {
  return { id, toJSON: () => ({ id, objects: [] }), on: vi.fn(), off: vi.fn() } as any
}

function setCanvases(list: any[]) {
  appState.allCanvas = list
  appState.canvas = list[list.length - 1] ?? null
}

function writeBackup(canvasData: unknown, savedAt = new Date().toISOString()) {
  localStorage.setItem(
    LOCAL_BACKUP_KEY,
    JSON.stringify({ sessionId: SESSION_ID, canvasData, savedAt }),
  )
}

function renderRestoreHook() {
  return renderHook(() =>
    useEmbedAutoSave({
      sessionId: SESSION_ID,
      currentSession: null,
    }),
  )
}

describe('useEmbedAutoSave — restore (복원 동작)', () => {
  beforeEach(() => {
    localStorage.clear()
    loadFromJSON.mockClear()
    useSaveStore.getState().reset()
    setCanvases([])
  })

  describe('restoreFromLocal', () => {
    it('멀티페이지 배열 백업 → 각 캔버스에 순서대로 loadFromJSON', async () => {
      const c0 = fakeCanvas('c0')
      const c1 = fakeCanvas('c1')
      const c2 = fakeCanvas('c2')
      setCanvases([c0, c1, c2])
      const saved = [{ p: 0 }, { p: 1 }, { p: 2 }]
      writeBackup(saved)

      const { result } = renderRestoreHook()
      let ok = false
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })

      expect(ok).toBe(true)
      expect(loadFromJSON).toHaveBeenCalledTimes(3)
      expect(loadFromJSON).toHaveBeenNthCalledWith(1, c0, saved[0])
      expect(loadFromJSON).toHaveBeenNthCalledWith(2, c1, saved[1])
      expect(loadFromJSON).toHaveBeenNthCalledWith(3, c2, saved[2])
      // 복원 후 dirty 마킹 + 백업 삭제
      expect(useSaveStore.getState().isDirty).toBe(true)
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
    })

    it('백업 페이지수 > 캔버스수 → min 으로 안전 절단(초과 페이지 무시)', async () => {
      const c0 = fakeCanvas('c0')
      setCanvases([c0])
      writeBackup([{ p: 0 }, { p: 1 }, { p: 2 }])

      const { result } = renderRestoreHook()
      await act(async () => {
        await result.current.restoreFromLocal()
      })
      expect(loadFromJSON).toHaveBeenCalledTimes(1)
      expect(loadFromJSON).toHaveBeenCalledWith(c0, { p: 0 })
    })

    it('단일(객체) 백업 → 활성 canvas 에 loadFromJSON', async () => {
      const c0 = fakeCanvas('only')
      setCanvases([c0])
      const saved = { single: true }
      writeBackup(saved)

      const { result } = renderRestoreHook()
      let ok = false
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      expect(ok).toBe(true)
      expect(loadFromJSON).toHaveBeenCalledTimes(1)
      expect(loadFromJSON).toHaveBeenCalledWith(c0, saved)
      expect(useSaveStore.getState().isDirty).toBe(true)
    })

    it('백업 없으면 무동작(false, loadFromJSON 미호출, dirty 불변)', async () => {
      setCanvases([fakeCanvas('c0')])
      const { result } = renderRestoreHook()
      let ok = true
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      expect(ok).toBe(false)
      expect(loadFromJSON).not.toHaveBeenCalled()
      expect(useSaveStore.getState().isDirty).toBe(false)
    })

    it('복원 실패(loadFromJSON throw) → false + 백업 보존(삭제 안 함)', async () => {
      setCanvases([fakeCanvas('c0')])
      writeBackup({ single: true })
      loadFromJSON.mockRejectedValueOnce(new Error('boom'))

      const { result } = renderRestoreHook()
      let ok = true
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      expect(ok).toBe(false)
      // footgun 방어: 실패 시 백업 유지 → 데이터 유실 없음
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).not.toBeNull()
    })
  })

  describe('deleteLocalBackup (무시)', () => {
    it('백업 삭제 + hasLocalBackup 플래그 클리어', () => {
      writeBackup({ single: true })
      useSaveStore.getState().setLocalBackup(true, new Date())

      const { result } = renderRestoreHook()
      act(() => {
        result.current.deleteLocalBackup()
      })
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
      expect(useSaveStore.getState().hasLocalBackup).toBe(false)
    })
  })

  describe('evaluateRestore', () => {
    it('백업이 세션보다 최신이면 offer:true/confident:true', () => {
      writeBackup({ single: true }, '2026-06-13T10:00:00.000Z')
      const { result } = renderRestoreHook()
      const decision = result.current.evaluateRestore({
        id: SESSION_ID,
        updatedAt: '2026-06-13T09:00:00.000Z',
      })
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(true)
    })

    it('백업 없으면 offer:false', () => {
      const { result } = renderRestoreHook()
      const decision = result.current.evaluateRestore({
        id: SESSION_ID,
        updatedAt: '2026-06-13T09:00:00.000Z',
      })
      expect(decision.offer).toBe(false)
    })
  })
})
