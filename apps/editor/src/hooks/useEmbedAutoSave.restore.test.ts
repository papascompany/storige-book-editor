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
  appState: {
    canvas: null as any,
    allCanvas: [] as any[],
    allEditors: [] as any[],
    // R4 복원 교정: 부족분 증설 경로(spreadConfig 존재 시)가 호출 — 테스트별로 구현 주입.
    addInnerPage: (async () => {}) as () => Promise<void>,
    // 전량 복원 성공 시 첫 페이지 복귀(setPage(0)) 호출 — no-op 목.
    setPage: ((_i: number) => {}) as (i: number) => void,
  },
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
import { useSettingsStore } from '@/stores/useSettingsStore'

const LOCAL_BACKUP_KEY = 'storige_embed_session_backup'
const SESSION_ID = 'sess-restore'

/** 가짜 fabric 캔버스 — toJSON + on/off(이벤트 리스너 등록 가드용) */
function fakeCanvas(id: string) {
  // 복원 경로가 호출하는 fabric 메서드 스텁: rebindFrameInteractivity / applyObjectPermissions
  // (Part B·프레임픽스, 2026-06-16) 가 canvas.getObjects()·requestRenderAll() 를 호출하므로
  // 실 fabric 캔버스와 동일하게 제공해야 복원이 throw 없이 완주한다(목 staleness 수정).
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
    loadFromJSON.mockImplementation(async () => {})
    useSaveStore.getState().reset()
    useSettingsStore.setState({ spreadConfig: null } as any)
    appState.addInnerPage = async () => {}
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

    it('백업 페이지수 > 캔버스수 + 증설 불가(spreadConfig 없음) → 부분 복원: false + 백업 보존 + dirty 없음', async () => {
      const c0 = fakeCanvas('c0')
      setCanvases([c0])
      writeBackup([{ p: 0 }, { p: 1 }, { p: 2 }])

      const { result } = renderRestoreHook()
      let ok = true
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      // 존재하는 페이지는 복원 시도됨(부분 복원)
      expect(loadFromJSON).toHaveBeenCalledTimes(1)
      expect(loadFromJSON).toHaveBeenCalledWith(c0, { p: 0 })
      // R4: 부분 복원은 성공이 아니다 — 부분본이 자동저장으로 서버 canvasData 를
      // 절단 덮어쓰지 않게 dirty 마킹 없음 + 백업 보존(재시도 가능)
      expect(ok).toBe(false)
      expect(useSaveStore.getState().isDirty).toBe(false)
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).not.toBeNull()
    })

    it('부분 복원의 상세 결과 — restoreFromLocalDetailed 가 partial/restored/requested 노출', async () => {
      setCanvases([fakeCanvas('c0')])
      writeBackup([{ p: 0 }, { p: 1 }, { p: 2 }])

      const { result } = renderRestoreHook()
      let outcome: Awaited<ReturnType<typeof result.current.restoreFromLocalDetailed>> | null = null
      await act(async () => {
        outcome = await result.current.restoreFromLocalDetailed()
      })
      expect(outcome).toEqual({ ok: false, requested: 3, restored: 1, partial: true })
    })

    it('spreadConfig 존재 + addInnerPage 증설 성공 → 부족분 증설 후 전량 복원(true, 백업 삭제)', async () => {
      const c0 = fakeCanvas('c0')
      setCanvases([c0])
      useSettingsStore.setState({ spreadConfig: {} } as any)
      const addInnerPage = vi.fn(async () => {
        appState.allCanvas = [...appState.allCanvas, fakeCanvas(`grown-${appState.allCanvas.length}`)]
      })
      appState.addInnerPage = addInnerPage
      const saved = [{ p: 0 }, { p: 1 }, { p: 2 }]
      writeBackup(saved)

      const { result } = renderRestoreHook()
      let ok = false
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      expect(ok).toBe(true)
      expect(addInnerPage).toHaveBeenCalledTimes(2) // 1 → 3 페이지 증설
      expect(loadFromJSON).toHaveBeenCalledTimes(3)
      expect(loadFromJSON).toHaveBeenNthCalledWith(1, c0, saved[0])
      expect(loadFromJSON).toHaveBeenNthCalledWith(2, appState.allCanvas[1], saved[1])
      expect(loadFromJSON).toHaveBeenNthCalledWith(3, appState.allCanvas[2], saved[2])
      // 전량 복원 성공 시에만 기존 후처리: dirty 마킹 + 백업 삭제
      expect(useSaveStore.getState().isDirty).toBe(true)
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
    })

    it('spreadConfig 존재하나 증설이 무진전이면 무한루프 없이 부분 복원 처리 + 백업 보존', async () => {
      setCanvases([fakeCanvas('c0')])
      useSettingsStore.setState({ spreadConfig: {} } as any)
      const addInnerPage = vi.fn(async () => {}) // 증설 실패(페이지 수 불변)
      appState.addInnerPage = addInnerPage
      writeBackup([{ p: 0 }, { p: 1 }, { p: 2 }])

      const { result } = renderRestoreHook()
      let outcome: Awaited<ReturnType<typeof result.current.restoreFromLocalDetailed>> | null = null
      await act(async () => {
        outcome = await result.current.restoreFromLocalDetailed()
      })
      expect(addInnerPage).toHaveBeenCalledTimes(1) // 무진전 즉시 중단
      expect(outcome).toEqual({ ok: false, requested: 3, restored: 1, partial: true })
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).not.toBeNull()
      expect(useSaveStore.getState().isDirty).toBe(false)
    })

    it('캔버스 0장 + 배열 백업 → 복원 0건: false + 백업 보존 (종전 "성공 처리 후 백업 삭제" 체감 no-op 수정)', async () => {
      setCanvases([])
      writeBackup([{ p: 0 }, { p: 1 }])

      const { result } = renderRestoreHook()
      let ok = true
      await act(async () => {
        ok = await result.current.restoreFromLocal()
      })
      expect(ok).toBe(false)
      expect(loadFromJSON).not.toHaveBeenCalled()
      // 백업 보존 + dirty 불변 — 배너가 닫히기만 하고 데이터가 사라지는 일 방지
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).not.toBeNull()
      expect(useSaveStore.getState().isDirty).toBe(false)
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

  describe('언마운트 백업 — 무편집 억제 (R4)', () => {
    it('실제 사용자 편집 0건이면 dirty 여도 언마운트 백업을 쓰지 않는다', () => {
      setCanvases([fakeCanvas('c0')])
      const { unmount } = renderRestoreHook()

      // 시스템 발 dirty (복원/프로그램적 변경 등) — 사용자 편집 아님
      act(() => {
        useSaveStore.getState().markDirty()
      })
      unmount()
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()
    })

    it('실제 사용자 편집(캔버스 이벤트)이 있으면 언마운트 백업을 쓴다 (현행 유지)', () => {
      const c0 = fakeCanvas('c0')
      setCanvases([c0])
      const { unmount } = renderRestoreHook()

      const call = (c0.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'object:modified',
      )
      expect(call).toBeTruthy()
      act(() => {
        ;(call?.[1] as () => void)()
      })
      unmount()

      const raw = localStorage.getItem(LOCAL_BACKUP_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).sessionId).toBe(SESSION_ID)
    })

    it('복원 성공본은 서버 미반영 사용자 콘텐츠 — 언마운트 백업이 재작성되어 보호된다', async () => {
      const c0 = fakeCanvas('c0')
      setCanvases([c0])
      writeBackup({ single: true })
      const { result, unmount } = renderRestoreHook()

      const call = (c0.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'object:added',
      )
      expect(call).toBeTruthy()
      // 실제 fabric 처럼 loadFromJSON 이 object:added 를 발화하는 상황 재현.
      // isRestoringRef 가드로 이 이벤트 자체는 편집으로 집계되지 않지만, 복원 성공 경로가
      // userEditedRef 를 명시적으로 켠다 — 복원본이 서버 저장 전에 이탈하면 언마운트 백업이
      // 유일본이기 때문(억제하면 복원 콘텐츠 유실 창이 생긴다).
      loadFromJSON.mockImplementationOnce(async () => {
        ;(call?.[1] as () => void)()
      })

      await act(async () => {
        await result.current.restoreFromLocal()
      })
      // 복원 성공: 기존 백업 삭제 + dirty
      expect(useSaveStore.getState().isDirty).toBe(true)
      expect(localStorage.getItem(LOCAL_BACKUP_KEY)).toBeNull()

      unmount()
      // 서버 미반영 상태로 이탈 → 복원본을 담은 언마운트 백업이 재작성되어야 한다
      const raw = localStorage.getItem(LOCAL_BACKUP_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).sessionId).toBe(SESSION_ID)
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
