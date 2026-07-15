// SmartGuides ↔ FrameInteraction 바인딩 순서 계약 테스트 (적대 리뷰 P0, 2026-07-15)
//
// 사실관계: fabric 이벤트 핸들러는 등록(=생성자 바인딩) 순서대로 발화한다.
// SmartGuidesPlugin(스냅)과 FrameInteractionPlugin(사진틀 fillImage/clipPath 동기화)은
// 둘 다 생성자에서 object:moving/rotating 을 바인딩하므로, SmartGuides 가 **먼저**
// 생성되어야 "스냅 → 프레임 동기화" 순서가 성립한다. 반대로 생성하면 프레임 동기화가
// 스냅 전 raw 좌표/각도로 실행되어 사진·마스크가 어긋난 채 저장된다(이동 최대
// 8/zoom px·회전 3° — FrameInteractionPlugin._onTransformEnd 는 재동기화하지 않음).
//
// 증명 대상:
//  ① 리스너 순서 — createCanvas 생성 순서(SG → FI)로 인스턴스화하면
//     __eventListeners['object:moving'/'object:rotating'] 에서 SG 핸들러가 FI 보다 앞
//  ② 통합(회전) — FI 핸들러가 받는 시점에 target.angle 이 이미 스냅되어 있다
//  ③ 통합(이동) — FI 핸들러가 받는 시점에 target 좌표가 이미 스냅되어 있다
//  ④ 역순 대조 — FI 를 먼저 생성하면 FI 가 raw 값을 받는다(이 테스트가 실제로
//     순서 회귀를 검출함을 실증하는 negative control)
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock
// (SmartGuidesPlugin.test.ts 와 동일 패턴).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('fabric', () => {
  class MockPoint {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  }
  class MockLine {
    [key: string]: unknown
    points: number[]
    visible = false
    constructor(points: number[], options: Record<string, unknown>) {
      this.points = points
      Object.assign(this, options)
    }
    set(props: Record<string, unknown> | string, value?: unknown): void {
      if (typeof props === 'string') {
        this[props] = value
      } else {
        Object.assign(this, props)
      }
    }
    setCoords(): void {}
    bringToFront(): void {}
  }
  return {
    fabric: {
      Canvas: class MockCanvas {},
      Point: MockPoint,
      Line: MockLine,
      util: {},
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

import SmartGuidesPlugin from './SmartGuidesPlugin'
import FrameInteractionPlugin from './FrameInteractionPlugin'

interface FakeObjectInit {
  id?: string
  left: number
  top: number
  width: number
  height: number
  angle?: number
  extensionType?: string
  excludeFromExport?: boolean
}

/** fabric.Object 의 두 플러그인 사용 표면만 흉내낸 fake */
function makeObj(init: FakeObjectInit) {
  const obj: Record<string, unknown> = {
    type: 'rect',
    visible: true,
    angle: 0,
    ...init,
    getBoundingRect() {
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
    set(props: Record<string, unknown> | string, value?: unknown) {
      if (typeof props === 'string') obj[props] = value
      else Object.assign(obj, props)
    },
  }
  return obj
}

/** fabric Observable on/off/fire 표면 mock 캔버스 — 등록 순서대로 발화(fabric 시맨틱) */
function makeMockCanvas(objects: Array<Record<string, unknown>>) {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  const canvas: Record<string, unknown> = {
    __eventListeners,
    on(eventName: string, handler: (e: unknown) => void) {
      ;(__eventListeners[eventName] ||= []).push(handler)
    },
    off(eventName: string, handler: (e: unknown) => void) {
      const listeners = __eventListeners[eventName]
      if (!listeners) return
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    fire(eventName: string, e?: unknown) {
      ;(__eventListeners[eventName] || []).slice().forEach((h) => h(e))
    },
    getObjects: () => objects,
    getActiveObjects: () => [] as unknown[],
    getZoom: () => 1,
    calcViewportBoundaries: () => ({ tl: { x: -5000, y: -5000 }, br: { x: 5000, y: 5000 } }),
    add(...objs: Array<Record<string, unknown>>) {
      objects.push(...objs)
    },
    remove(...objs: Array<Record<string, unknown>>) {
      objs.forEach((o) => {
        const idx = objects.indexOf(o)
        if (idx >= 0) objects.splice(idx, 1)
      })
    },
    requestRenderAll: vi.fn(),
  }
  return canvas
}

const fire = (canvas: Record<string, unknown>, name: string, e: unknown) =>
  (canvas.fire as (n: string, e: unknown) => void)(name, e)

/** FrameInteractionPlugin._onTransform 을 관측 스파이로 치환 — 호출 시점의 target 상태 기록 */
function spyFrameTransform() {
  const seen: Array<{ angle: number; left: number }> = []
  const proto = FrameInteractionPlugin.prototype as unknown as {
    _onTransform: (e: { target?: Record<string, unknown> }) => void
  }
  // 생성자에서 this._onTransform.bind(this) 로 바인딩되므로, 인스턴스화 **전에**
  // prototype 을 스파이하면 바인딩된 핸들러가 이 구현을 호출한다.
  const spy = vi.spyOn(proto, '_onTransform').mockImplementation((e) => {
    seen.push({
      angle: (e.target?.angle as number) ?? Number.NaN,
      left: (e.target?.left as number) ?? Number.NaN,
    })
  })
  return { seen, spy }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SmartGuides → FrameInteraction 바인딩 순서 계약 (① 리스너 순서)', () => {
  it('createCanvas 생성 순서(SG 먼저)로 인스턴스화하면 SG 핸들러가 두 이벤트 모두에서 FI 보다 앞이다', () => {
    const objects: Array<Record<string, unknown>> = [
      makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 }),
    ]
    const canvas = makeMockCanvas(objects)
    const listeners = (canvas as { __eventListeners: Record<string, unknown[]> }).__eventListeners

    const sg = new SmartGuidesPlugin(canvas as never, {} as never, {})
    const sgMovingHandler = listeners['object:moving'][0]
    const sgRotatingHandler = listeners['object:rotating'][0]

    const fi = new FrameInteractionPlugin(canvas as never, {} as never, {})

    expect(listeners['object:moving']).toHaveLength(2)
    expect(listeners['object:moving'].indexOf(sgMovingHandler)).toBe(0) // SG 가 먼저 발화
    expect(listeners['object:rotating']).toHaveLength(2)
    expect(listeners['object:rotating'].indexOf(sgRotatingHandler)).toBe(0)

    sg.dispose()
    fi.dispose()
  })
})

describe('SmartGuides → FrameInteraction 바인딩 순서 계약 (② ③ 통합 스파이)', () => {
  it('② 회전: FI 가 받는 시점에 target.angle 이 이미 스냅(43.4° → 45°)되어 있다', () => {
    const { seen } = spyFrameTransform()
    const objects: Array<Record<string, unknown>> = [
      makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 }),
    ]
    const target = makeObj({ id: 'frame-1', left: 100, top: 100, width: 50, height: 50, angle: 43.4 })
    objects.push(target)
    const canvas = makeMockCanvas(objects)

    new SmartGuidesPlugin(canvas as never, {} as never, {})
    new FrameInteractionPlugin(canvas as never, {} as never, {})

    fire(canvas, 'object:rotating', { target })

    expect(target.angle).toBe(45) // SG 스냅 적용
    expect(seen).toHaveLength(1)
    expect(seen[0].angle).toBe(45) // FI 는 스냅된 각으로 동기화한다
  })

  it('③ 이동: FI 가 받는 시점에 target 좌표가 이미 스냅(left 105 → 100)되어 있다', () => {
    const { seen } = spyFrameTransform()
    const objects: Array<Record<string, unknown>> = [
      makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 }),
      makeObj({ id: 'candidate', left: 100, top: 100, width: 80, height: 80 }),
    ]
    const target = makeObj({ id: 'frame-1', left: 105, top: 500, width: 50, height: 50 })
    objects.push(target)
    const canvas = makeMockCanvas(objects)

    new SmartGuidesPlugin(canvas as never, {} as never, {})
    new FrameInteractionPlugin(canvas as never, {} as never, {})

    fire(canvas, 'object:moving', { target })

    expect(target.left).toBe(100) // SG 스냅 적용
    expect(seen).toHaveLength(1)
    expect(seen[0].left).toBe(100) // FI 는 스냅된 좌표로 동기화한다
  })

  it('④ 역순 대조(negative control): FI 를 먼저 생성하면 FI 가 스냅 전 raw 각(43.4°)을 받는다', () => {
    const { seen } = spyFrameTransform()
    const objects: Array<Record<string, unknown>> = [
      makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 }),
    ]
    const target = makeObj({ id: 'frame-1', left: 100, top: 100, width: 50, height: 50, angle: 43.4 })
    objects.push(target)
    const canvas = makeMockCanvas(objects)

    // 결함이었던 순서 — FrameInteraction 먼저(= createCanvas 수정 전 순서)
    new FrameInteractionPlugin(canvas as never, {} as never, {})
    new SmartGuidesPlugin(canvas as never, {} as never, {})

    fire(canvas, 'object:rotating', { target })

    expect(target.angle).toBe(45) // 최종 각은 스냅되지만
    expect(seen[0].angle).toBeCloseTo(43.4) // FI 는 raw 각으로 이미 동기화해 버렸다 (P0 결함 재현)
  })
})
