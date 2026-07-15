import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ObjectActionBar, { clampBarPosition } from './ObjectActionBar'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

/**
 * ObjectActionBar (E1 §5-3) 스펙:
 *  ① 보호 매트릭스 — 잠금 4단계(user/designer/admin/system) × 보호 플래그 × 버튼 노출
 *  ② 변형 중 숨김(moving/scaling/rotating) → object:modified/mouse:up 재표시
 *  ③ clamp 계산 — 캔버스(컨테이너) 밖 이탈 금지 (임베드 소형 뷰포트 포함)
 *  ④ 액션 배선 — 복제=CopyPlugin.clone() / 삭제=requestDeleteSelection() 기존 경로 재사용
 */

// -- 테스트 더블 ---------------------------------------------------------------

interface FakeObj {
  id?: string
  type?: string
  extensionType?: string
  excludeFromExport?: boolean
  deleteable?: boolean
  movable?: boolean
  contentEditable?: boolean
  lockInfo?: { isLocked: boolean; lockLevel: string }
  getBoundingRect: () => { left: number; top: number; width: number; height: number }
}

function makeObj(overrides: Partial<FakeObj> = {}): FakeObj {
  return {
    id: overrides.id ?? 'obj-1',
    type: 'rect',
    getBoundingRect: () => ({ left: 100, top: 100, width: 50, height: 50 }),
    ...overrides,
  }
}

function makeFakeCanvas(selection: FakeObj[]) {
  const listeners: Record<string, Array<(e?: unknown) => void>> = {}
  return {
    __listeners: listeners,
    on(ev: string, handler: (e?: unknown) => void) {
      ;(listeners[ev] ||= []).push(handler)
    },
    off(ev: string, handler: (e?: unknown) => void) {
      const arr = listeners[ev]
      if (!arr) return
      const idx = arr.indexOf(handler)
      if (idx >= 0) arr.splice(idx, 1)
    },
    fire(ev: string, e?: unknown) {
      ;(listeners[ev] || []).slice().forEach((h) => h(e))
    },
    getActiveObjects: () => selection,
    getActiveObject: () => (selection.length === 1 ? selection[0] : selection[0] ?? null),
    // happy-dom rect 는 0 — 위치 검증은 clampBarPosition 순수 함수로 별도 수행
    upperCanvasEl: undefined,
  }
}

// CopyPlugin.isCloneProtected 실물 판정 규칙과 동일 (canvas-core CopyPlugin.ts 참조)
const fakeCopyPlugin = {
  isCloneProtected: (o: FakeObj) =>
    o.movable === false ||
    o.deleteable === false ||
    o.contentEditable === false ||
    (o.lockInfo?.isLocked === true && o.lockInfo.lockLevel !== 'user'),
  clone: vi.fn(),
}

const fakeLockPlugin = {
  getLockInfo: (o: FakeObj) => o.lockInfo ?? { isLocked: false, lockLevel: 'user' },
}

const requestDeleteSelection = vi.fn()

function wire(selection: FakeObj[], editMode = false) {
  const canvas = makeFakeCanvas(selection)
  useAppStore.setState({
    canvas,
    ready: true,
    requestDeleteSelection,
    getPlugin: (name: string) => {
      if (name === 'CopyPlugin') return fakeCopyPlugin
      if (name === 'LockPlugin') return fakeLockPlugin
      return undefined
    },
  } as never)
  useSettingsStore.setState((s) => ({
    currentSettings: { ...s.currentSettings, editMode },
  }))
  return canvas
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    useAppStore.setState({ canvas: null, ready: false } as never)
    useSettingsStore.setState((s) => ({
      currentSettings: { ...s.currentSettings, editMode: false },
    }))
  })
})

const barQuery = () => screen.queryByTestId('object-action-bar')

// -- ① 보호 매트릭스 -------------------------------------------------------------

describe('ObjectActionBar — 보호 매트릭스 (잠금 레벨 × 버튼 노출)', () => {
  it('무보호 객체: 복제·삭제 모두 노출', () => {
    wire([makeObj()])
    render(<ObjectActionBar />)
    expect(barQuery()).toBeInTheDocument()
    expect(screen.getByLabelText('복제')).toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it('user 레벨 잠금(내 잠금): 복제·삭제 모두 노출 (L1④ mine 판정 정합)', () => {
    wire([makeObj({ lockInfo: { isLocked: true, lockLevel: 'user' } })])
    render(<ObjectActionBar />)
    expect(screen.getByLabelText('복제')).toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it.each(['designer', 'admin', 'system'])(
    '%s 레벨 잠금: 두 버튼 모두 차단 → 바 자체 미표시',
    (level) => {
      wire([makeObj({ lockInfo: { isLocked: true, lockLevel: level } })])
      render(<ObjectActionBar />)
      expect(barQuery()).not.toBeInTheDocument()
    }
  )

  it('삭제잠금(deleteable=false): 삭제 숨김 + 복제도 보호 판정 → 바 미표시', () => {
    wire([makeObj({ deleteable: false })])
    render(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()
  })

  it('위치고정(movable=false): 복제 숨김, 삭제만 노출', () => {
    wire([makeObj({ movable: false })])
    render(<ObjectActionBar />)
    expect(barQuery()).toBeInTheDocument()
    expect(screen.queryByLabelText('복제')).not.toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it('내용잠금(contentEditable=false): 복제 숨김, 삭제만 노출', () => {
    wire([makeObj({ contentEditable: false })])
    render(<ObjectActionBar />)
    expect(screen.queryByLabelText('복제')).not.toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it('editMode(관리자): 보호 플래그 무시 — 두 버튼 모두 노출 (SidePanel 규약 정합)', () => {
    wire([makeObj({ deleteable: false, movable: false })], true)
    render(<ObjectActionBar />)
    expect(screen.getByLabelText('복제')).toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it('멀티 선택: 한 멤버라도 보호되면 해당 버튼 숨김', () => {
    wire([makeObj({ id: 'a' }), makeObj({ id: 'b', movable: false })])
    render(<ObjectActionBar />)
    expect(screen.queryByLabelText('복제')).not.toBeInTheDocument()
    expect(screen.getByLabelText('삭제')).toBeInTheDocument()
  })

  it('시스템 객체(workspace/guideline/printguide/excludeFromExport) 선택에는 미표시', () => {
    wire([makeObj({ id: 'workspace' })])
    const { rerender } = render(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()

    // 마운트 상태에서 store 교체는 act 로 감싼다 (재구독 리렌더)
    act(() => {
      wire([makeObj({ extensionType: 'guideline' })])
    })
    rerender(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()

    act(() => {
      wire([makeObj({ extensionType: 'printguide' })])
    })
    rerender(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()

    act(() => {
      wire([makeObj({ excludeFromExport: true })])
    })
    rerender(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()
  })

  it('선택 없음: 미표시', () => {
    wire([])
    render(<ObjectActionBar />)
    expect(barQuery()).not.toBeInTheDocument()
  })
})

// -- ② 변형 중 숨김 --------------------------------------------------------------

describe('ObjectActionBar — 변형 중 숨김/재표시', () => {
  it.each(['object:moving', 'object:scaling', 'object:rotating'])(
    '%s 중 숨김 → object:modified 재표시',
    (transformEvent) => {
      const canvas = wire([makeObj()])
      render(<ObjectActionBar />)
      expect(barQuery()).toBeInTheDocument()

      act(() => canvas.fire(transformEvent))
      expect(barQuery()).not.toBeInTheDocument()

      act(() => canvas.fire('object:modified'))
      expect(barQuery()).toBeInTheDocument()
    }
  )

  it('변형 중 숨김 → mouse:up 재표시 (TransformFeedback 3이벤트 정합)', () => {
    const canvas = wire([makeObj()])
    render(<ObjectActionBar />)

    act(() => canvas.fire('object:moving'))
    expect(barQuery()).not.toBeInTheDocument()

    act(() => canvas.fire('mouse:up'))
    expect(barQuery()).toBeInTheDocument()
  })

  it('selection:cleared 후 미표시, selection:created 재표시', () => {
    const selection = [makeObj()]
    const canvas = wire(selection)
    render(<ObjectActionBar />)
    expect(barQuery()).toBeInTheDocument()

    act(() => {
      selection.length = 0
      canvas.fire('selection:cleared')
    })
    expect(barQuery()).not.toBeInTheDocument()

    act(() => {
      selection.push(makeObj())
      canvas.fire('selection:created')
    })
    expect(barQuery()).toBeInTheDocument()
  })
})

// -- ③ clamp 계산 ---------------------------------------------------------------

describe('clampBarPosition — 뷰포트 이탈 금지', () => {
  const BAR_W = 76
  const BAR_H = 40

  it('컨테이너 안쪽 좌표는 그대로 통과', () => {
    expect(clampBarPosition(400, 300, 800, 600, BAR_W, BAR_H)).toEqual({ x: 400, y: 300 })
  })

  it('좌/우 경계: 바 절반 폭 + 여백 안쪽으로 보정', () => {
    const left = clampBarPosition(0, 300, 800, 600, BAR_W, BAR_H)
    expect(left.x).toBe(4 + BAR_W / 2)
    const right = clampBarPosition(800, 300, 800, 600, BAR_W, BAR_H)
    expect(right.x).toBe(800 - 4 - BAR_W / 2)
  })

  it('상단 경계: 바가 위로 잘리지 않게 y ≥ 바 높이 + 여백 (앵커=하단)', () => {
    const top = clampBarPosition(400, -50, 800, 600, BAR_W, BAR_H)
    expect(top.y).toBe(4 + BAR_H)
  })

  it('하단 경계: y ≤ 컨테이너 높이 - 여백', () => {
    const bottom = clampBarPosition(400, 900, 800, 600, BAR_W, BAR_H)
    expect(bottom.y).toBe(600 - 4)
  })

  it('임베드 극소형 뷰포트(바보다 좁음): 중앙 고정 — NaN/역전 없음', () => {
    const tiny = clampBarPosition(10, 10, 60, 30, BAR_W, BAR_H)
    expect(tiny.x).toBe(30)
    expect(tiny.y).toBe(15)
  })

  it('컨테이너 치수 미측정(0): 원좌표 유지', () => {
    expect(clampBarPosition(123, 456, 0, 0, BAR_W, BAR_H)).toEqual({ x: 123, y: 456 })
  })
})

// -- ④ 액션 배선 ----------------------------------------------------------------

describe('ObjectActionBar — 액션은 기존 경로 재사용', () => {
  it('복제 클릭 → CopyPlugin.clone() (무인자 — 핫키/SidePanel 과 동일 경로)', () => {
    wire([makeObj()])
    render(<ObjectActionBar />)
    fireEvent.click(screen.getByLabelText('복제'))
    expect(fakeCopyPlugin.clone).toHaveBeenCalledTimes(1)
    expect(fakeCopyPlugin.clone).toHaveBeenCalledWith()
    expect(requestDeleteSelection).not.toHaveBeenCalled()
  })

  it('삭제 클릭 → requestDeleteSelection() (S2 확인 모달 공통 경로)', () => {
    wire([makeObj()])
    render(<ObjectActionBar />)
    fireEvent.click(screen.getByLabelText('삭제'))
    expect(requestDeleteSelection).toHaveBeenCalledTimes(1)
    expect(fakeCopyPlugin.clone).not.toHaveBeenCalled()
  })

  it('언마운트 시 캔버스 리스너 전량 해제', () => {
    const canvas = wire([makeObj()])
    const { unmount } = render(<ObjectActionBar />)
    unmount()
    const listeners = canvas.__listeners
    for (const ev of [
      'selection:created',
      'selection:updated',
      'selection:cleared',
      'object:moving',
      'object:scaling',
      'object:rotating',
      'object:modified',
      'mouse:up',
      'after:render',
    ]) {
      expect(listeners[ev] ?? []).toHaveLength(0)
    }
  })
})
