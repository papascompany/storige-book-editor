// ObjectPlugin 화살표 이동(nudge) 단일화 회귀 테스트 (C9/E2 W4 §6-1)
//
// ControlsPlugin 의 중복 window keydown 핸들러를 제거하고 ObjectPlugin.hotkeys 로 일원화한 뒤:
//  ① 1px 이동(left/right/up/down) + setCoords + object:modified(undo 1엔트리) + 렌더
//  ② Shift 10px(shift+left 등) — 별도 hotkey 엔트리
//  ③ 잠금 가드: lockMovementX/Y 축은 이동 안 함(Shift 포함) — 기존 ControlsPlugin 우회 결함 해소
//  ④ active 객체 없으면 no-op
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))
vi.mock('../utils/render', () => ({ RenderOptimizer: { queueRender: vi.fn() } }))

import ObjectPlugin from './ObjectPlugin'

interface ObjInit {
  left?: number
  top?: number
  lockMovementX?: boolean
  lockMovementY?: boolean
}
function makeObj(init: ObjInit = {}) {
  const o: Record<string, unknown> = {
    left: 100,
    top: 100,
    ...init,
    set(k: string, v: unknown) {
      o[k] = v
    },
    setCoords: vi.fn(),
  }
  return o
}

function makeCanvas(activeObject: Record<string, unknown> | null) {
  const fired: Array<{ ev: string; payload: unknown }> = []
  return {
    __fired: fired,
    on: vi.fn(),
    getActiveObject: () => activeObject,
    fire: vi.fn((ev: string, payload: unknown) => fired.push({ ev, payload })),
    requestRenderAll: vi.fn(),
  }
}

function setup(activeObject: Record<string, unknown> | null) {
  const canvas = makeCanvas(activeObject)
  const plugin = new (ObjectPlugin as unknown as new (c: unknown, e: unknown, o: unknown) => {
    hotkeys: Array<{ input: string; callback: () => void; name: string }>
  })(canvas, {}, {})
  const hk = (input: string) => plugin.hotkeys.find((h) => h.input === input)!
  return { canvas, plugin, hk }
}

describe('ObjectPlugin nudge — 1px/10px 이동', () => {
  it('① left/right/up/down 1px + setCoords + object:modified 1회', () => {
    const obj = makeObj({ left: 100, top: 100 })
    const { canvas, hk } = setup(obj)

    hk('left').callback()
    expect(obj.left).toBe(99)
    hk('right').callback()
    expect(obj.left).toBe(100)
    hk('up').callback()
    expect(obj.top).toBe(99)
    hk('down').callback()
    expect(obj.top).toBe(100)

    expect(obj.setCoords).toHaveBeenCalledTimes(4)
    const modified = canvas.__fired.filter((f) => f.ev === 'object:modified')
    expect(modified).toHaveLength(4) // 키당 히스토리 1엔트리
    expect(canvas.requestRenderAll).toHaveBeenCalledTimes(4)
  })

  it('② Shift 변형은 10px 이동', () => {
    const obj = makeObj({ left: 100, top: 100 })
    const { hk } = setup(obj)

    hk('shift+left').callback()
    expect(obj.left).toBe(90)
    hk('shift+right').callback()
    expect(obj.left).toBe(100)
    hk('shift+up').callback()
    expect(obj.top).toBe(90)
    hk('shift+down').callback()
    expect(obj.top).toBe(100)
  })
})

describe('ObjectPlugin nudge — 잠금 가드(보호 우회 결함 해소)', () => {
  it('③ lockMovementX 는 좌우 이동 차단(Shift 포함)', () => {
    const obj = makeObj({ left: 100, top: 100, lockMovementX: true })
    const { canvas, hk } = setup(obj)

    hk('left').callback()
    hk('shift+right').callback()
    expect(obj.left).toBe(100) // 불변 — 기존 ControlsPlugin Shift 우회 결함 해소
    expect(canvas.__fired.filter((f) => f.ev === 'object:modified')).toHaveLength(0)

    // Y축은 정상 이동
    hk('up').callback()
    expect(obj.top).toBe(99)
  })

  it('lockMovementY 는 상하 이동 차단', () => {
    const obj = makeObj({ left: 100, top: 100, lockMovementY: true })
    const { hk } = setup(obj)
    hk('up').callback()
    hk('shift+down').callback()
    expect(obj.top).toBe(100)
    hk('left').callback()
    expect(obj.left).toBe(99) // X축은 정상
  })

  it('④ active 객체 없으면 no-op', () => {
    const { canvas, hk } = setup(null)
    hk('left').callback()
    expect(canvas.fire).not.toHaveBeenCalled()
  })
})
