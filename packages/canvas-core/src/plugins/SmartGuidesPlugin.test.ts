// SmartGuidesPlugin — 정렬 가이드/스냅 + 회전 각도 스냅 테스트 (E1 §5-1)
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock
// (AccessoryPlugin.leak.test.ts / history.meta.test.ts 와 동일 패턴).
// 증명 대상:
//  ① 스냅 좌표 정확성 (moving 핸들러가 객체 중심을 후보 정렬선으로 이동)
//  ② 가이드가 toJSON(extendFabricOption) 에 미포함 (excludeFromExport 필터 + 왕복 동일)
//  ③ 히스토리 무오염 (_historyNext 스냅샷 미포함 + undo(_loadHistory) 후 상태 정상)
//  ④ 회전 각도 스냅 라운딩 (Shift 해제 포함)
//  ⑤ 핸들러 마이크로벤치 (후보 200객체 캐시 상태 moving 1회 < 16ms — 60fps 예산)
//  ⑥ RulerPlugin 중앙 양보 / dispose 완전 정리
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
      util: {
        enlivenObjects: (objects: unknown[], callback: (o: unknown[]) => void) => callback(objects),
      },
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
// history.ts 가 참조하는 core — 저장 화이트리스트 최소 mock
vi.mock('../utils/canvas', () => ({
  core: {
    extendFabricOption: ['id', 'extensionType', 'selectable'],
    ensureImageCrossOrigin: (objects: unknown[]) => objects,
  },
}))

import { fabric } from 'fabric'
import '../utils/history' // fabric.Canvas.prototype 에 _historyNext/_loadHistory 부착
import SmartGuidesPlugin from './SmartGuidesPlugin'

interface FakeObjectInit {
  id?: string
  type?: string
  left: number
  top: number
  width: number
  height: number
  angle?: number
  visible?: boolean
  extensionType?: string
  excludeFromExport?: boolean
}

/** fabric.Object 의 플러그인 사용 표면만 흉내낸 fake */
function makeObj(init: FakeObjectInit) {
  const obj: Record<string, unknown> = {
    type: 'rect',
    visible: true,
    angle: 0,
    ...init,
    getBoundingRect(_absolute?: boolean, _calculate?: boolean) {
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

/** fabric Observable on/off + 플러그인/히스토리 사용 표면을 갖춘 mock 캔버스 */
function makeMockCanvas(objects: Array<Record<string, unknown>>, zoom = 1) {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  const canvas: Record<string, unknown> = {
    __eventListeners,
    _guideElements: [] as string[],
    _svgElements: {} as Record<string, unknown>,
    historyProcessing: false,
    on(eventName: string, handler: (e: unknown) => void) {
      if (!__eventListeners[eventName]) __eventListeners[eventName] = []
      __eventListeners[eventName].push(handler)
    },
    off(eventName: string, handler: (e: unknown) => void) {
      const listeners = __eventListeners[eventName]
      if (!listeners) return
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    fire(eventName: string, e?: unknown) {
      ;(__eventListeners[eventName] || []).forEach((h) => h(e))
    },
    getObjects: () => objects,
    getActiveObjects: () => [] as unknown[],
    getZoom: () => zoom,
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
    renderAll: vi.fn(),
  }
  return canvas
}

function fireMoving(canvas: Record<string, unknown>, target: Record<string, unknown>) {
  ;(canvas.fire as (n: string, e: unknown) => void)('object:moving', { target })
}
function fireRotating(
  canvas: Record<string, unknown>,
  target: Record<string, unknown>,
  domEvent?: { shiftKey?: boolean }
) {
  ;(canvas.fire as (n: string, e: unknown) => void)('object:rotating', { target, e: domEvent })
}
function fireMouseUp(canvas: Record<string, unknown>) {
  ;(canvas.fire as (n: string, e: unknown) => void)('mouse:up', {})
}

function setup(objects: Array<Record<string, unknown>>, zoom = 1) {
  const canvas = makeMockCanvas(objects, zoom)
  const plugin = new SmartGuidesPlugin(canvas as never, {} as never, {})
  return { canvas, plugin }
}

/**
 * fabric.Canvas#toObject 의 excludeFromExport 필터 + extendFabricOption 화이트리스트를
 * 재현한 저장 시뮬레이션 (node 환경에서 native fabric 직렬화 불가 — 시맨틱 등가 재현).
 */
function simulateToJSON(objects: Array<Record<string, unknown>>) {
  const extendFabricOption = ['id', 'extensionType', 'selectable']
  const baseProps = ['type', 'left', 'top', 'width', 'height', 'angle', 'visible']
  return {
    version: '5.5.2',
    objects: objects
      .filter((o) => o.excludeFromExport !== true) // fabric _toObjects 시맨틱
      .map((o) => {
        const out: Record<string, unknown> = {}
        for (const k of [...baseProps, ...extendFabricOption]) {
          if (o[k] !== undefined) out[k] = o[k]
        }
        return out
      }),
  }
}

describe('SmartGuidesPlugin — ① 스냅 좌표 정확성', () => {
  it('이동 객체 left 가 후보 left 8px 이내면 좌표가 스냅된다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const { canvas } = setup([workspace, candidate, moving])

    fireMoving(canvas, moving)

    expect(moving.left).toBe(100) // 105 → 100 스냅
    expect(moving.top).toBe(500) // y 축 무변경
    expect(moving.setCoords).toHaveBeenCalled()
  })

  it('스냅 시 마젠타 가이드라인이 후보 정렬선 좌표에 표시된다 (id 미부여)', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const objects = [workspace, candidate, moving]
    const { canvas } = setup(objects)

    fireMoving(canvas, moving)

    const guides = objects.filter((o) => o.extensionType === 'guideline')
    expect(guides.length).toBe(2) // V/H 풀
    const visibleGuides = guides.filter((o) => o.visible === true)
    expect(visibleGuides.length).toBe(1) // 수직선만
    expect(visibleGuides[0].left).toBe(100)
    expect(visibleGuides[0].stroke).toBe('#ff00ff')
    // 계약: id 미부여 + excludeFromExport
    guides.forEach((g) => {
      expect(g.id).toBeUndefined()
      expect(g.excludeFromExport).toBe(true)
    })
    // mouse:up 에서 숨김 + 캐시 무효화
    fireMouseUp(canvas)
    expect(guides.every((g) => g.visible === false)).toBe(true)
  })

  it('표시(15px)만 되는 거리(8~15px)에서는 스냅하지 않고 가이드만 보인다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    // 최근접 조합 = left 110 ↔ 후보 left 100 (10px) — 폭 300 으로 교차 매치 배제
    const moving = makeObj({ id: 'm1', left: 110, top: 500, width: 300, height: 50 })
    const objects = [workspace, candidate, moving]
    const { canvas } = setup(objects)

    fireMoving(canvas, moving)

    expect(moving.left).toBe(110) // 스냅 없음
    const visibleGuides = objects.filter((o) => o.extensionType === 'guideline' && o.visible)
    expect(visibleGuides.length).toBe(1)
    expect(visibleGuides[0].left).toBe(100)
  })

  it('zoom 반영: zoom 2 에서 화면 8px = canvas 4px — canvas 5px 거리는 스냅 안 됨', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const { canvas } = setup([workspace, candidate, moving], 2)

    fireMoving(canvas, moving)

    expect(moving.left).toBe(105)
  })

  it('시스템 객체(printguide/guideline/excludeFromExport/workspace)는 후보에서 제외된다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const printGuide = makeObj({
      id: 'cut-border',
      left: 103,
      top: 500,
      width: 50,
      height: 50,
      extensionType: 'printguide',
    })
    const overlay = makeObj({
      left: 103,
      top: 500,
      width: 50,
      height: 50,
      excludeFromExport: true,
    })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const { canvas } = setup([workspace, printGuide, overlay, moving])

    fireMoving(canvas, moving)

    expect(moving.left).toBe(105) // 스냅 후보 없음 → 무변경
  })
})

describe('SmartGuidesPlugin — ⑥ RulerPlugin 중앙 양보', () => {
  it('이동 객체 중심이 workspace 중앙 8px 이내인 축은 스냅/가이드를 양보한다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    // workspace 중앙 = (500,500). 이동 객체 중심 x=505 (양보 반경 내), y=200 (밖)
    const candidate = makeObj({ id: 'c1', left: 503, top: 700, width: 80, height: 80 }) // left=503, 거리 23... x 후보 centerX=543
    // 후보 left=503 vs moving left=480: 거리 23 — 스냅 대상 아님. 센터 정렬로 유도:
    // moving centerX=505, 후보 centerX=543 → 거리 38. 대신 moving left=480 vs 후보 left=503 → 23.
    // 양보 검증엔 "양보 없었으면 스냅됐을" 배치가 필요 — 후보를 재배치한다.
    const nearCandidate = makeObj({ id: 'c2', left: 508, top: 700, width: 44, height: 80 })
    // nearCandidate centerX = 530 — moving centerX 505 와 25. left 508 vs moving left 480 → 28.
    // moving right 530 vs 후보 left 508 → 22... 좀 더 명확히: moving 중심을 505 로 두고
    // 후보 centerX 를 502 로 → 거리 3 (스냅 범위) — 양보로 스킵되어야 함.
    const yieldCandidate = makeObj({ id: 'c3', left: 462, top: 700, width: 80, height: 80 }) // centerX=502
    const moving = makeObj({ id: 'm1', left: 480, top: 175, width: 50, height: 50 }) // center=(505,200)
    const objects = [workspace, candidate, nearCandidate, yieldCandidate, moving]
    const { canvas } = setup(objects)

    fireMoving(canvas, moving)

    // x 축: centerX 505 → 502 스냅 가능(거리 3)이지만 workspace 중앙(500) 8px 이내 → 양보
    expect((moving.getCenterPoint as () => { x: number })().x).toBe(505)
    const visibleV = objects.filter(
      (o) => o.extensionType === 'guideline' && o.visible && o.points && (o.points as number[])[1] !== 0
    )
    expect(visibleV.length).toBe(0)
  })
})

describe('SmartGuidesPlugin — ② toJSON 미포함 + canvasData 왕복', () => {
  it('가이드 활성 상태에서 저장 → 로드 → 재저장이 동일하고 guideline 이 유입되지 않는다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const objects = [workspace, candidate, moving]
    const { canvas } = setup(objects)

    fireMoving(canvas, moving) // 가이드 2개 추가 + 1개 표시(활성) 상태

    expect(objects.length).toBe(5) // 캔버스에는 가이드 실존

    const save1 = simulateToJSON(objects)
    // 로드 시뮬레이션: 저장본으로 캔버스 재구성 (가이드는 저장본에 없음)
    const loaded = save1.objects.map((o) => makeObj(o as unknown as FakeObjectInit))
    const save2 = simulateToJSON(loaded)

    expect(save1.objects).toHaveLength(3)
    expect(JSON.stringify(save2)).toBe(JSON.stringify(save1)) // 왕복 동일
    const types = save1.objects.map((o) => o.extensionType)
    expect(types).not.toContain('guideline')
  })
})

describe('SmartGuidesPlugin — ③ 히스토리 무오염', () => {
  it('가이드 표시 상태의 _historyNext 스냅샷에 guideline 이 없고, undo(_loadHistory) 후 사용자 객체가 정상이다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const objects = [workspace, candidate, moving]
    const { canvas } = setup(objects)

    fireMoving(canvas, moving) // 가이드 추가+표시 상태에서 스냅샷

    const proto = fabric.Canvas.prototype as unknown as {
      _historyNext: () => string
      _loadHistory: (h: string, e: string, cb?: () => void) => void
    }
    const snapshot = proto._historyNext.call(canvas)
    const state = JSON.parse(snapshot) as { objects: Array<{ id?: string; extensionType?: string }> }

    // 스냅샷: workspace(제외)·가이드(제외) 없이 사용자 객체 2건만
    expect(state.objects.map((o) => o.id).sort()).toEqual(['c1', 'm1'])
    expect(state.objects.some((o) => o.extensionType === 'guideline')).toBe(false)

    // undo 재생: 스냅샷 기준 _loadHistory — 가이드(무 id·excludeFromExport)는 삭제 판정
    // 자체에 진입하지 않고(id 없음), 사용자 객체는 생존해야 한다
    proto._loadHistory.call(canvas, snapshot, 'history:undo')
    const ids = objects.map((o) => o.id)
    expect(ids).toContain('c1')
    expect(ids).toContain('m1')
    expect(objects.filter((o) => o.extensionType === 'guideline').length).toBe(2) // 가이드 생존(화면 전용)
    expect((canvas as { historyProcessing?: boolean }).historyProcessing).toBe(false)
  })
})

describe('SmartGuidesPlugin — ④ 회전 각도 스냅', () => {
  it('15° 배수 ±3° 이내에서 angle 이 라운딩된다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const target = makeObj({ id: 'm1', left: 100, top: 100, width: 50, height: 50, angle: 43.4 })
    const { canvas } = setup([workspace, target])

    fireRotating(canvas, target)
    expect(target.angle).toBe(45)

    target.angle = 22.5 // 허용 오차 밖
    fireRotating(canvas, target)
    expect(target.angle).toBe(22.5)
  })

  it('Shift 홀드 시 스냅이 해제된다', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const target = makeObj({ id: 'm1', left: 100, top: 100, width: 50, height: 50, angle: 43.4 })
    const { canvas } = setup([workspace, target])

    fireRotating(canvas, target, { shiftKey: true })
    expect(target.angle).toBe(43.4)

    fireRotating(canvas, target, { shiftKey: false })
    expect(target.angle).toBe(45)
  })
})

describe('SmartGuidesPlugin — ⑤ 성능 마이크로벤치', () => {
  it('후보 200객체 캐시 상태에서 moving 핸들러 1회 < 16ms (60fps 예산)', () => {
    const objects: Array<Record<string, unknown>> = [
      makeObj({ id: 'workspace', left: 0, top: 0, width: 4000, height: 4000 }),
    ]
    for (let i = 0; i < 200; i++) {
      objects.push(
        makeObj({
          id: `obj-${i}`,
          left: (i % 20) * 190 + 13,
          top: Math.floor(i / 20) * 350 + 17,
          width: 120,
          height: 90,
        })
      )
    }
    const moving = makeObj({ id: 'moving', left: 2003, top: 2001, width: 60, height: 40 })
    objects.push(moving)
    const { canvas } = setup(objects)

    fireMoving(canvas, moving) // 1회차: 후보 캐시 구축 (측정 제외 — 계약은 캐시 상태)

    const t0 = process.hrtime.bigint()
    fireMoving(canvas, moving) // 캐시 상태 핸들러 1회
    const t1 = process.hrtime.bigint()
    const elapsedMs = Number(t1 - t0) / 1e6

    // 성능 증거를 테스트 출력으로 남긴다
    console.log(
      `[bench] SmartGuides moving handler (200 candidates cached): ${elapsedMs.toFixed(3)}ms`
    )
    expect(elapsedMs).toBeLessThan(16)
  })
})

describe('SmartGuidesPlugin — dispose 완전 정리', () => {
  it('리스너 전량 해제 + 가이드 객체 제거', () => {
    const workspace = makeObj({ id: 'workspace', left: 0, top: 0, width: 1000, height: 1000 })
    const candidate = makeObj({ id: 'c1', left: 100, top: 100, width: 80, height: 80 })
    const moving = makeObj({ id: 'm1', left: 105, top: 500, width: 50, height: 50 })
    const objects = [workspace, candidate, moving]
    const { canvas, plugin } = setup(objects)
    fireMoving(canvas, moving) // 가이드 생성

    expect(objects.filter((o) => o.extensionType === 'guideline').length).toBe(2)

    plugin.dispose()

    const listeners = (canvas as { __eventListeners: Record<string, unknown[]> }).__eventListeners
    expect(listeners['object:moving']).toHaveLength(0)
    expect(listeners['object:rotating']).toHaveLength(0)
    expect(listeners['mouse:up']).toHaveLength(0)
    expect(objects.filter((o) => o.extensionType === 'guideline').length).toBe(0)
  })
})
