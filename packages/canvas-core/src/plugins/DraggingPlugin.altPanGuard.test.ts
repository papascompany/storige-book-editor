// DraggingPlugin — alt+드래그 팬 가드 (C5 / E2 W2)
//
// C5 로 "객체 위 alt+드래그 = 복제(CopyPlugin)"가 생기므로, 그 시작을 팬으로 삼키지
// 않도록 DraggingPlugin 이 양보해야 한다. 증명 대상:
//  ① 플래그 on + alt + 객체 위(target 존재) → 팬 시작 안 함(isDragging=false) — 복제 양보
//  ② 플래그 on + alt + 빈 곳(target 없음) → 팬 시작(isDragging=true) — 기존 거동 불변
//  ③ 플래그 off + alt + 객체 위 → 팬 시작(isDragging=true) — 종전 거동 복원(롤백 안전)
//  ④ dragMode(스페이스) → target 무관 팬(불변)
// fabric 은 리스너를 this=canvas 로 호출한다(Observable.fire) → mock fire 도 .call(canvas).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))

const { hotkeysMock } = vi.hoisted(() => {
  const fn: unknown = vi.fn()
  ;(fn as { unbind: unknown }).unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))
vi.mock('../contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = vi.fn()
    dispose = vi.fn()
  },
}))

import DraggingPlugin from './DraggingPlugin'

function makeMockCanvas() {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  const canvas: Record<string, unknown> = {
    __eventListeners,
    isDragging: false,
    selection: true,
    skipTargetFind: false,
    defaultCursor: 'default',
    lastPosX: 0,
    lastPosY: 0,
    viewportTransform: [1, 0, 0, 1, 0, 0],
    on(name: string, h: (e: unknown) => void) {
      if (!__eventListeners[name]) __eventListeners[name] = []
      __eventListeners[name].push(h)
    },
    off(name: string, h: (e: unknown) => void) {
      const l = __eventListeners[name]
      if (!l) return
      const i = l.indexOf(h)
      if (i >= 0) l.splice(i, 1)
    },
    fire(name: string, e?: unknown) {
      // fabric 시맨틱: 리스너는 this=canvas 로 호출된다
      ;(__eventListeners[name] || []).slice().forEach((h) => h.call(canvas, e))
    },
    offHistory: vi.fn(),
    onHistory: vi.fn(),
    setViewportTransform: vi.fn(),
    requestRenderAll: vi.fn(),
    renderAll: vi.fn(),
  }
  return canvas
}

function setup(options: Record<string, unknown> = {}) {
  const canvas = makeMockCanvas()
  const editor = { emit: vi.fn() }
  const plugin = new (DraggingPlugin as unknown as new (
    c: unknown,
    e: unknown,
    o?: unknown
  ) => unknown)(canvas, editor, options)
  return { canvas, plugin }
}

function mouseDown(
  canvas: ReturnType<typeof makeMockCanvas>,
  altKey: boolean,
  target: unknown
) {
  ;(canvas.fire as (n: string, e: unknown) => void)('mouse:down', {
    e: { clientX: 200, clientY: 200, altKey },
    target,
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DraggingPlugin — alt+드래그 팬 가드 (C5)', () => {
  it('① 플래그 on + alt + 객체 위 → 팬 시작 안 함(복제 양보)', () => {
    const { canvas } = setup({ altDragClone: true })
    mouseDown(canvas, true, { id: 'obj' })
    expect(canvas.isDragging).toBe(false)
    expect(canvas.offHistory).not.toHaveBeenCalled()
  })

  it('② 플래그 on + alt + 빈 곳(target 없음) → 팬 시작(불변)', () => {
    const { canvas } = setup({ altDragClone: true })
    mouseDown(canvas, true, undefined)
    expect(canvas.isDragging).toBe(true)
  })

  it('③ 플래그 off + alt + 객체 위 → 팬 시작(종전 거동 복원)', () => {
    const { canvas } = setup({ altDragClone: false })
    mouseDown(canvas, true, { id: 'obj' })
    expect(canvas.isDragging).toBe(true)
  })

  it('④ 옵션 미주입(기본 on) + alt + 객체 위 → 팬 시작 안 함', () => {
    const { canvas } = setup() // 옵션 없음 → 기본 on
    mouseDown(canvas, true, { id: 'obj' })
    expect(canvas.isDragging).toBe(false)
  })

  it('dragMode(스페이스) 활성 시엔 target 있어도 팬(불변)', () => {
    const { canvas, plugin } = setup({ altDragClone: true })
    ;(plugin as { dragMode: boolean }).dragMode = true
    mouseDown(canvas, false, { id: 'obj' }) // alt 없음이지만 dragMode
    expect(canvas.isDragging).toBe(true)
  })
})
