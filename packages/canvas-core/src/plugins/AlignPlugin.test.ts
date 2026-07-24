// AlignPlugin — 균등 분배(distributeH/V) 테스트 (E1 §5-4 + E2 §3-2a)
//
// ControlBar 트랙 T 구현을 공개 API 로 이관한 회귀 스펙:
//  ① 첫/끝 고정 + 중간 center-to-center 균등 재배치 (가로/세로)
//  ② offHistory/onHistory 쌍 (히스토리 일시 중단 규약 — 쌍 불일치 = undo/redo 파손)
//  ③ 3개 미만 no-op / ActiveSelection 재생성 + object:modified 발화
//  ④ 선택 순서 무관 — 공간 좌표 기준 정렬로 첫/끝 판정
//  ⑤ 보호객체 제외 가드 (E2 §3-2a) — movable=false·lockMovementX/Y 는 이동 대상·기준점
//     후보에서 제외, 잔여 이동가능 < 3 이면 no-op, editMode(관리자)는 제외 면제.
//     ActiveSelection 재생성에는 보호객체 포함 선택 전체 유지(제외는 이동만).
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock (SmartGuidesPlugin.test 패턴).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => {
  class MockPoint {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  }
  class MockActiveSelection {
    objects: unknown[]
    canvas: unknown
    type = 'activeSelection'
    constructor(objects: unknown[], options: { canvas: unknown }) {
      this.objects = objects
      this.canvas = options.canvas
    }
    setCoords(): void {}
    getObjects(): unknown[] {
      return this.objects
    }
  }
  return {
    fabric: {
      Canvas: class MockCanvas {},
      Point: MockPoint,
      ActiveSelection: MockActiveSelection,
    },
  }
})

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

import AlignPlugin from './AlignPlugin'

interface FakeObjectInit {
  id: string
  left: number
  top: number
  width: number
  height: number
  /** E2 §3-2a 보호 플래그 — 관리자 위치고정 */
  movable?: boolean
  /** E2 §3-2a 보호 플래그 — fabric 이동잠금 */
  lockMovementX?: boolean
  lockMovementY?: boolean
}

/** fabric.Object 의 distribute 사용 표면만 흉내낸 fake */
function makeObj(init: FakeObjectInit) {
  const obj: Record<string, unknown> = {
    ...init,
    getBoundingRect(_absolute?: boolean) {
      return {
        left: obj.left as number,
        top: obj.top as number,
        width: obj.width as number,
        height: obj.height as number,
      }
    },
    getCenterPoint() {
      return {
        x: (obj.left as number) + (obj.width as number) / 2,
        y: (obj.top as number) + (obj.height as number) / 2,
      }
    },
    setPositionByOrigin(point: { x: number; y: number }) {
      obj.left = point.x - (obj.width as number) / 2
      obj.top = point.y - (obj.height as number) / 2
    },
    setCoords: vi.fn(),
  }
  return obj
}

function centerX(obj: Record<string, unknown>): number {
  return (obj.getCenterPoint as () => { x: number; y: number })().x
}
function centerY(obj: Record<string, unknown>): number {
  return (obj.getCenterPoint as () => { x: number; y: number })().y
}

function makeMockCanvas(activeObjects: Array<Record<string, unknown>>) {
  const fired: Array<{ event: string; payload: unknown }> = []
  const calls: string[] = []
  const canvas = {
    __fired: fired,
    __calls: calls,
    getActiveObjects: () => activeObjects,
    offHistory: vi.fn(() => calls.push('offHistory')),
    onHistory: vi.fn(() => calls.push('onHistory')),
    discardActiveObject: vi.fn(() => calls.push('discardActiveObject')),
    setActiveObject: vi.fn(() => calls.push('setActiveObject')),
    requestRenderAll: vi.fn(),
    fire: vi.fn((event: string, payload: unknown) => fired.push({ event, payload })),
    getObjects: () => [] as unknown[],
  }
  return canvas
}

function setup(
  activeObjects: Array<Record<string, unknown>>,
  options?: Record<string, unknown>
) {
  const canvas = makeMockCanvas(activeObjects)
  const plugin = options
    ? new AlignPlugin(canvas as never, {} as never, options)
    : new AlignPlugin(canvas as never, {} as never)
  return { canvas, plugin }
}

describe('AlignPlugin.distributeH — 첫/끝 고정 + 중간 균등', () => {
  it('센터 100/150/400 → 중간 객체 센터가 250 으로 이동, 양끝 불변', () => {
    // width 40 → left = center - 20
    const a = makeObj({ id: 'a', left: 80, top: 0, width: 40, height: 40 }) // cx 100
    const b = makeObj({ id: 'b', left: 130, top: 100, width: 40, height: 40 }) // cx 150
    const c = makeObj({ id: 'c', left: 380, top: 200, width: 40, height: 40 }) // cx 400
    const { canvas, plugin } = setup([a, b, c])

    plugin.distributeH()

    expect(centerX(a)).toBe(100) // 첫 고정
    expect(centerX(c)).toBe(400) // 끝 고정
    expect(centerX(b)).toBe(250) // (100+400)/2
    expect(centerY(b)).toBe(120) // y 축 무변경 (top 100 + h/2)
    expect(canvas.requestRenderAll).toHaveBeenCalled()
  })

  it('4개 분배: 중간 2개가 균등 간격(step)으로 재배치된다', () => {
    const objs = [0, 30, 60, 300].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 10, top: 0, width: 20, height: 20 })
    )
    const { plugin } = setup(objs)

    plugin.distributeH()

    // start 0, end 300, step 100 → 중간 센터 100, 200
    expect(objs.map((o) => centerX(o))).toEqual([0, 100, 200, 300])
  })

  it('선택 순서가 뒤섞여도 공간 좌표 기준으로 첫/끝을 판정한다', () => {
    const a = makeObj({ id: 'a', left: 80, top: 0, width: 40, height: 40 }) // cx 100
    const b = makeObj({ id: 'b', left: 130, top: 0, width: 40, height: 40 }) // cx 150
    const c = makeObj({ id: 'c', left: 380, top: 0, width: 40, height: 40 }) // cx 400
    // 선택 순서: [중간, 끝, 첫]
    const { plugin } = setup([b, c, a])

    plugin.distributeH()

    expect(centerX(a)).toBe(100)
    expect(centerX(c)).toBe(400)
    expect(centerX(b)).toBe(250)
  })
})

describe('AlignPlugin.distributeV — 세로 축', () => {
  it('센터 50/80/350 → 중간 객체 센터가 200 으로 이동, x 축 무변경', () => {
    const a = makeObj({ id: 'a', left: 0, top: 30, width: 40, height: 40 }) // cy 50
    const b = makeObj({ id: 'b', left: 100, top: 60, width: 40, height: 40 }) // cy 80
    const c = makeObj({ id: 'c', left: 200, top: 330, width: 40, height: 40 }) // cy 350
    const { plugin } = setup([a, b, c])

    plugin.distributeV()

    expect(centerY(a)).toBe(50)
    expect(centerY(c)).toBe(350)
    expect(centerY(b)).toBe(200)
    expect(centerX(b)).toBe(120) // x 불변
  })
})

describe('AlignPlugin.distribute — 히스토리 쌍/이벤트/가드', () => {
  it('offHistory → (재배치) → onHistory 쌍이 정확히 1회씩, off 가 먼저다', () => {
    const objs = [100, 150, 400].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 20, top: 0, width: 40, height: 40 })
    )
    const { canvas, plugin } = setup(objs)

    plugin.distributeH()

    expect(canvas.offHistory).toHaveBeenCalledTimes(1)
    expect(canvas.onHistory).toHaveBeenCalledTimes(1)
    expect(canvas.__calls.indexOf('offHistory')).toBeLessThan(canvas.__calls.indexOf('onHistory'))
  })

  it('ActiveSelection 재생성 + object:modified 발화 (setV/setH 다중 정렬과 동일 시맨틱)', () => {
    const objs = [100, 150, 400].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 20, top: 0, width: 40, height: 40 })
    )
    const { canvas, plugin } = setup(objs)

    plugin.distributeH()

    expect(canvas.discardActiveObject).toHaveBeenCalledTimes(1)
    expect(canvas.setActiveObject).toHaveBeenCalledTimes(1)
    expect(canvas.fire).toHaveBeenCalledTimes(1)
    const { event, payload } = canvas.__fired[0]
    expect(event).toBe('object:modified')
    const target = (payload as { target: { type: string; getObjects: () => unknown[] } }).target
    expect(target.type).toBe('activeSelection')
    expect(target.getObjects()).toHaveLength(3)
  })

  it('3개 미만 선택은 no-op — 히스토리 중단도 발생하지 않는다', () => {
    const a = makeObj({ id: 'a', left: 80, top: 0, width: 40, height: 40 })
    const b = makeObj({ id: 'b', left: 380, top: 0, width: 40, height: 40 })
    const { canvas, plugin } = setup([a, b])

    plugin.distributeH()
    plugin.distributeV()

    expect(canvas.offHistory).not.toHaveBeenCalled()
    expect(canvas.onHistory).not.toHaveBeenCalled()
    expect(centerX(a)).toBe(100)
    expect(centerX(b)).toBe(400)
  })

  it('재배치 중 예외가 나도 onHistory 는 반드시 복원된다 (finally 규약)', () => {
    const a = makeObj({ id: 'a', left: 80, top: 0, width: 40, height: 40 })
    const b = makeObj({ id: 'b', left: 130, top: 0, width: 40, height: 40 })
    const c = makeObj({ id: 'c', left: 380, top: 0, width: 40, height: 40 })
    // 중간 객체 이동에서 강제 예외
    b.setPositionByOrigin = () => {
      throw new Error('boom')
    }
    const { canvas, plugin } = setup([a, b, c])

    expect(() => plugin.distributeH()).toThrow('boom')
    expect(canvas.onHistory).toHaveBeenCalledTimes(1)
  })
})

describe('AlignPlugin.distribute — 보호객체 제외 가드 (E2 §3-2a)', () => {
  it('movable=false 객체는 위치 불변, 잔여 4개만 균등 분배 — 기준점 후보에서도 제외', () => {
    // 이동가능 센터 0/30/60/300 → 분배 후 0/100/200/300 (기존 4개 케이스와 동일 수치).
    // 보호객체(cx 500)가 공간상 최우측이지만 기준점(끝) 후보로도 쓰이지 않아야 한다.
    const movables = [0, 30, 60, 300].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 10, top: 0, width: 20, height: 20 })
    )
    const fixed = makeObj({
      id: 'fixed', left: 490, top: 50, width: 20, height: 20, movable: false
    }) // cx 500
    const { canvas, plugin } = setup([fixed, ...movables])

    plugin.distributeH()

    expect(movables.map((o) => centerX(o))).toEqual([0, 100, 200, 300])
    expect(centerX(fixed)).toBe(500) // 보호객체 위치 불변
    expect(centerY(fixed)).toBe(60)
    // ActiveSelection 재생성에는 선택 전체(보호객체 포함 5개) 유지 — 제외는 이동만
    const target = (canvas.__fired[0].payload as {
      target: { getObjects: () => unknown[] }
    }).target
    expect(target.getObjects()).toHaveLength(5)
  })

  it('lockMovementX/Y 이동잠금 객체도 동일하게 제외된다', () => {
    const movables = [0, 30, 60, 300].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 10, top: 0, width: 20, height: 20 })
    )
    const lockedX = makeObj({
      id: 'lx', left: 140, top: 0, width: 20, height: 20, lockMovementX: true
    }) // cx 150
    const lockedY = makeObj({
      id: 'ly', left: 190, top: 0, width: 20, height: 20, lockMovementY: true
    }) // cx 200
    const { plugin } = setup([...movables, lockedX, lockedY])

    plugin.distributeH()

    expect(movables.map((o) => centerX(o))).toEqual([0, 100, 200, 300])
    expect(centerX(lockedX)).toBe(150)
    expect(centerX(lockedY)).toBe(200)
  })

  it('제외 후 잔여 이동가능 객체 < 3 → no-op (히스토리 중단도 발생하지 않는다)', () => {
    const a = makeObj({ id: 'a', left: 80, top: 0, width: 40, height: 40 }) // cx 100
    const b = makeObj({ id: 'b', left: 130, top: 0, width: 40, height: 40 }) // cx 150
    const fixed = makeObj({
      id: 'fixed', left: 380, top: 0, width: 40, height: 40, movable: false
    }) // cx 400
    const { canvas, plugin } = setup([a, b, fixed])

    plugin.distributeH()
    plugin.distributeV()

    expect(canvas.offHistory).not.toHaveBeenCalled()
    expect(canvas.onHistory).not.toHaveBeenCalled()
    expect(centerX(a)).toBe(100)
    expect(centerX(b)).toBe(150)
    expect(centerX(fixed)).toBe(400)
  })

  it('editMode(관리자)는 제외 없이 현행 유지 — 보호객체도 분배에 참여한다', () => {
    // 센터 0/30/60/90(movable=false)/300 → editMode 면 5개 전부: step 75 → 0/75/150/225/300
    const movables = [0, 30, 60].map((cx, i) =>
      makeObj({ id: `o${i}`, left: cx - 10, top: 0, width: 20, height: 20 })
    )
    const fixed = makeObj({
      id: 'fixed', left: 80, top: 0, width: 20, height: 20, movable: false
    }) // cx 90
    const end = makeObj({ id: 'end', left: 290, top: 0, width: 20, height: 20 }) // cx 300
    const { plugin } = setup([...movables, fixed, end], { editMode: true })

    plugin.distributeH()

    expect(movables.map((o) => centerX(o))).toEqual([0, 75, 150])
    expect(centerX(fixed)).toBe(225) // 관리자 모드에서는 보호객체도 재배치
    expect(centerX(end)).toBe(300)
  })
})

describe('AlignPlugin — 분배 단축키 등록 (D-E2-1)', () => {
  it('hotkeys 2건: alt+shift+h/v · category:arrange · onlyForActiveObject · 함수형 hideContext', () => {
    const { plugin } = setup([])
    const keys = plugin.hotkeys

    expect(keys).toHaveLength(2)

    const h = keys.find((k) => k.input === 'alt+shift+h')
    const v = keys.find((k) => k.input === 'alt+shift+v')
    expect(h).toBeDefined()
    expect(v).toBeDefined()

    expect(h!.name).toBe('가로 균등 분포')
    expect(v!.name).toBe('세로 균등 분포')
    for (const k of [h!, v!]) {
      expect(k.onlyForActiveObject).toBe(true)
      // ★ category:'arrange' 누락 시 C9 도움말 모달이 '객체'로 오분류(폴백) — 회귀 방지 앵커
      expect(k.category).toBe('arrange')
      // hideContext 는 boolean 이 아닌 함수형이어야 선택 수에 반응해 은폐/노출한다
      expect(typeof k.hideContext).toBe('function')
    }
  })

  it('hideContext: 선택 3개 미만이면 true(은폐), 3개 이상이면 false(노출) — ControlBar ≥3 정합', () => {
    const two = [0, 1].map((i) =>
      makeObj({ id: `t${i}`, left: i * 50, top: 0, width: 20, height: 20 })
    )
    const { plugin: p2 } = setup(two)
    for (const k of p2.hotkeys) {
      expect((k.hideContext as () => boolean)()).toBe(true)
    }

    const three = [0, 1, 2].map((i) =>
      makeObj({ id: `x${i}`, left: i * 50, top: 0, width: 20, height: 20 })
    )
    const { plugin: p3 } = setup(three)
    for (const k of p3.hotkeys) {
      expect((k.hideContext as () => boolean)()).toBe(false)
    }
  })

  it('callback: 가로 키→distributeH · 세로 키→distributeV 를 각 1회 호출', () => {
    const { plugin } = setup([])
    const spyH = vi.spyOn(plugin, 'distributeH').mockImplementation(() => {})
    const spyV = vi.spyOn(plugin, 'distributeV').mockImplementation(() => {})

    const h = plugin.hotkeys.find((k) => k.input === 'alt+shift+h')!
    const v = plugin.hotkeys.find((k) => k.input === 'alt+shift+v')!
    h.callback()
    v.callback()

    expect(spyH).toHaveBeenCalledTimes(1)
    expect(spyV).toHaveBeenCalledTimes(1)
  })
})
