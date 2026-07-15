// SafeZoneWarningPlugin — 재단/안전영역 침범 실시간 경고 테스트 (E1 §5-5)
//
// 증명 대상:
//  ① 침범/복귀 전이 — enter 에서만 safeZoneViolation 1회 발행(디바운스), 복귀 시 오버레이 숨김
//  ② 경계 좌표 재사용 — safe-zone-border/cut-border 객체 rect 기준 (스프레드 오프셋 정합)
//  ③ 오버레이 계약 — id 미부여 + excludeFromExport + extensionType 'guideline' (풀링)
//  ④ 제외 — 시스템/배경/보호객체 target, 경계 부재 시 inert, 지면 밖 파킹 무경고
//  ⑤ mouse:up 리셋 / beforeSave 숨김 / dispose 완전 정리
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock (SmartGuidesPlugin.test 패턴).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => {
  class MockRect {
    [key: string]: unknown
    visible = false
    constructor(options: Record<string, unknown>) {
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
      Rect: MockRect,
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

import SafeZoneWarningPlugin, { rectsIntersect, rectContains } from './SafeZoneWarningPlugin'

interface FakeObjectInit {
  id?: string
  type?: string
  left: number
  top: number
  width: number
  height: number
  extensionType?: string
  excludeFromExport?: boolean
  movable?: boolean
  meta?: { system?: boolean }
}

function makeObj(init: FakeObjectInit) {
  const obj: Record<string, unknown> = {
    type: 'rect',
    ...init,
    getBoundingRect(_absolute?: boolean, _calculate?: boolean) {
      return {
        left: obj.left as number,
        top: obj.top as number,
        width: obj.width as number,
        height: obj.height as number,
      }
    },
  }
  return obj
}

function makeMockCanvas(objects: Array<Record<string, unknown>>) {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  return {
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
}

/** 표준 지면: 재단선(0,0,1000,700) 안쪽 20px 이 안전영역 */
function makeBorders(offsetX = 0, offsetY = 0) {
  const cut = makeObj({
    id: 'cut-border',
    left: offsetX,
    top: offsetY,
    width: 1000,
    height: 700,
    extensionType: 'printguide',
    excludeFromExport: true,
  })
  const safe = makeObj({
    id: 'safe-zone-border',
    left: offsetX + 20,
    top: offsetY + 20,
    width: 960,
    height: 660,
    extensionType: 'printguide',
    excludeFromExport: true,
  })
  return { cut, safe }
}

function setup(objects: Array<Record<string, unknown>>) {
  const canvas = makeMockCanvas(objects)
  const editor = { emit: vi.fn() }
  const plugin = new SafeZoneWarningPlugin(canvas as never, editor as never, {})
  return { canvas, editor, plugin }
}

function fireMoving(canvas: ReturnType<typeof makeMockCanvas>, target: Record<string, unknown>) {
  canvas.fire('object:moving', { target })
}
function fireScaling(canvas: ReturnType<typeof makeMockCanvas>, target: Record<string, unknown>) {
  canvas.fire('object:scaling', { target })
}

const overlayOf = (objects: Array<Record<string, unknown>>) =>
  objects.find((o) => o.extensionType === 'guideline' && o.stroke === '#ff7a00')

describe('SafeZoneWarningPlugin — ① 침범/복귀 전이 + 디바운스', () => {
  it('안전영역 밖 침범 진입 시 오버레이 표시 + safeZoneViolation 1회 발행', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 }) // safe(20~) 밖
    const objects = [cut, safe, target]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, target)

    const overlay = overlayOf(objects)
    expect(overlay).toBeDefined()
    expect(overlay!.visible).toBe(true)
    // 오버레이는 안전영역 경계 rect 에 그려진다 (경계 좌표 재사용)
    expect(overlay!.left).toBe(20)
    expect(overlay!.top).toBe(20)
    expect(overlay!.width).toBe(960)
    expect(overlay!.height).toBe(660)
    expect(editor.emit).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('safeZoneViolation', {
      objectId: 'obj-1',
      boundary: 'safe',
    })
  })

  it('침범 유지 중 반복 moving 은 재발행하지 않는다 (전이 기반 디바운스)', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const { canvas, editor } = setup([cut, safe, target])

    fireMoving(canvas, target)
    target.left = 6
    fireMoving(canvas, target)
    target.left = 7
    fireMoving(canvas, target)

    expect(editor.emit).toHaveBeenCalledTimes(1)
  })

  it('복귀 전이 시 오버레이 숨김·무발행, 재침범 시 다시 1회 발행', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, target) // 침범
    target.left = 400 // 안전영역 안으로 복귀
    fireMoving(canvas, target)

    const overlay = overlayOf(objects)
    expect(overlay!.visible).toBe(false)
    expect(editor.emit).toHaveBeenCalledTimes(1)

    target.left = 5 // 재침범
    fireMoving(canvas, target)
    expect(overlay!.visible).toBe(true)
    expect(editor.emit).toHaveBeenCalledTimes(2)
  })

  it('object:scaling 도 동일 경고 경로를 탄다', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 400, top: 100, width: 700, height: 50 }) // 우측 침범
    const { canvas, editor } = setup([cut, safe, target])

    fireScaling(canvas, target)
    expect(editor.emit).toHaveBeenCalledTimes(1)
  })

  it('mouse:up 리셋 후 다음 침범에서 다시 발행된다', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, target)
    canvas.fire('mouse:up', {})
    expect(overlayOf(objects)!.visible).toBe(false)

    fireMoving(canvas, target)
    expect(editor.emit).toHaveBeenCalledTimes(2)
  })
})

describe('SafeZoneWarningPlugin — ② 경계 좌표 재사용 (스프레드 오프셋 정합)', () => {
  it('경계가 오프셋 좌표(스프레드 배치)에 있어도 그 rect 기준으로 판정한다', () => {
    // 펼침면 우측 페이지처럼 경계가 (2000, 500) 에 배치된 경우
    const { cut, safe } = makeBorders(2000, 500)
    // 원점 기준이면 '밖'이지만 오프셋 안전영역 안쪽인 객체 — 무경고여야 한다
    const inside = makeObj({ id: 'in', left: 2400, top: 800, width: 100, height: 100 })
    const objects = [cut, safe, inside]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, inside)
    expect(editor.emit).not.toHaveBeenCalled()

    // 오프셋 안전영역 좌측 경계(x=2020)를 걸치는 객체 — 경고
    const crossing = makeObj({ id: 'cross', left: 2005, top: 800, width: 100, height: 100 })
    objects.push(crossing)
    fireMoving(canvas, crossing)
    expect(editor.emit).toHaveBeenCalledTimes(1)
    const overlay = overlayOf(objects)
    expect(overlay!.left).toBe(2020)
    expect(overlay!.top).toBe(520)
  })

  it('safe-zone-border 부재 시 cut-border 를 경계로 사용하고 boundary=cut 을 발행한다', () => {
    const { cut } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: -30, top: 100, width: 50, height: 50 }) // 재단선 밖 걸침
    const { canvas, editor } = setup([cut, target])

    fireMoving(canvas, target)
    expect(editor.emit).toHaveBeenCalledWith('safeZoneViolation', {
      objectId: 'obj-1',
      boundary: 'cut',
    })
  })
})

describe('SafeZoneWarningPlugin — ④ 제외/inert', () => {
  it('경계 객체가 둘 다 없으면 완전 inert (발행·오버레이 0)', () => {
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [target]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, target)
    expect(editor.emit).not.toHaveBeenCalled()
    expect(overlayOf(objects)).toBeUndefined()
  })

  it('시스템/배경/보호객체 target 은 무시된다', () => {
    const { cut, safe } = makeBorders()
    const bg = makeObj({ id: 'bg', left: -50, top: -50, width: 1100, height: 800, extensionType: 'background' })
    const protectedObj = makeObj({ id: 'p1', left: 5, top: 100, width: 50, height: 50, movable: false })
    const sysMeta = makeObj({ id: 's1', left: 5, top: 100, width: 50, height: 50, meta: { system: true } })
    const excluded = makeObj({ left: 5, top: 100, width: 50, height: 50, excludeFromExport: true })
    const { canvas, editor } = setup([cut, safe, bg, protectedObj, sysMeta, excluded])

    fireMoving(canvas, bg)
    fireMoving(canvas, protectedObj)
    fireMoving(canvas, sysMeta)
    fireMoving(canvas, excluded)
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('지면(재단선) 밖에 통째로 파킹된 객체는 경고하지 않는다', () => {
    const { cut, safe } = makeBorders()
    const parked = makeObj({ id: 'park', left: 1500, top: 100, width: 50, height: 50 })
    const { canvas, editor } = setup([cut, safe, parked])

    fireMoving(canvas, parked)
    expect(editor.emit).not.toHaveBeenCalled()
  })
})

describe('SafeZoneWarningPlugin — ③ 오버레이 계약 + ⑤ 정리', () => {
  it('오버레이는 id 미부여 + excludeFromExport + guideline (저장/히스토리 원천 제외)', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas } = setup(objects)

    fireMoving(canvas, target)

    const overlay = overlayOf(objects)!
    expect(overlay.id).toBeUndefined()
    expect(overlay.excludeFromExport).toBe(true)
    expect(overlay.extensionType).toBe('guideline')
    expect(overlay.selectable).toBe(false)
    expect(overlay.evented).toBe(false)
  })

  it('오버레이는 풀링된다 — 반복 침범에도 1개만 존재', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas } = setup(objects)

    fireMoving(canvas, target)
    target.left = 400
    fireMoving(canvas, target)
    target.left = 5
    fireMoving(canvas, target)

    expect(objects.filter((o) => o.extensionType === 'guideline').length).toBe(1)
  })

  it('beforeSave 는 오버레이를 숨긴다 (썸네일 캡처류 방어)', async () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas, plugin } = setup(objects)

    fireMoving(canvas, target)
    expect(overlayOf(objects)!.visible).toBe(true)

    await plugin.beforeSave()
    expect(overlayOf(objects)!.visible).toBe(false)
  })

  it('dispose — 리스너 전량 해제 + 오버레이 제거', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas, plugin } = setup(objects)
    fireMoving(canvas, target) // 오버레이 생성

    plugin.dispose()

    const listeners = canvas.__eventListeners
    for (const ev of ['object:moving', 'object:scaling', 'mouse:up', 'object:modified', 'selection:cleared']) {
      expect(listeners[ev] ?? []).toHaveLength(0)
    }
    expect(overlayOf(objects)).toBeUndefined()
  })
})

describe('SafeZoneWarningPlugin — ⑥ clear()/loadFromJSON 유령 참조 복원 (적대 리뷰 P1)', () => {
  it('오버레이 생성 → clear 시뮬레이션 → 다음 침범에서 오버레이가 재추가되고 visible 동작한다', () => {
    const { cut, safe } = makeBorders()
    const target = makeObj({ id: 'obj-1', left: 5, top: 100, width: 50, height: 50 })
    const objects = [cut, safe, target]
    const { canvas, editor } = setup(objects)

    fireMoving(canvas, target) // 오버레이 생성 + 표시
    canvas.fire('mouse:up', {}) // 리셋(복귀)
    expect(overlayOf(objects)).toBeDefined()

    // canvas.clear()/loadFromJSON 시뮬레이션 — 객체 목록 전체 교체(플러그인 풀 참조는
    // non-null 로 남지만 캔버스 미소속 유령이 된다) + 경계/사용자 객체 재적재
    objects.length = 0
    const { cut: cut2, safe: safe2 } = makeBorders()
    const target2 = makeObj({ id: 'obj-2', left: 5, top: 100, width: 50, height: 50 })
    objects.push(cut2, safe2, target2)

    fireMoving(canvas, target2)

    // 유령 참조로 시각층이 영구 사망하지 않는다 — 오버레이가 재생성·재추가된다
    const overlay = overlayOf(objects)
    expect(overlay).toBeDefined()
    expect(overlay!.visible).toBe(true)
    expect(overlay!.left).toBe(20) // 안전영역 경계 rect 재사용도 그대로
    expect(editor.emit).toHaveBeenCalledTimes(2) // 침범 전이마다 1회 (디바운스 유지)

    // 반복 침범에도 오버레이는 1개만 존재 (풀링 유지)
    canvas.fire('mouse:up', {})
    fireMoving(canvas, target2)
    expect(objects.filter((o) => o.extensionType === 'guideline').length).toBe(1)
  })
})

describe('rect 헬퍼 — 판정 기하', () => {
  it('rectsIntersect: 교차/비교차', () => {
    const a = { left: 0, top: 0, width: 100, height: 100 }
    expect(rectsIntersect(a, { left: 50, top: 50, width: 100, height: 100 })).toBe(true)
    expect(rectsIntersect(a, { left: 200, top: 0, width: 50, height: 50 })).toBe(false)
  })

  it('rectContains: 포함/이탈 + 0.5px 경계 여유', () => {
    const outer = { left: 0, top: 0, width: 100, height: 100 }
    expect(rectContains(outer, { left: 10, top: 10, width: 50, height: 50 })).toBe(true)
    expect(rectContains(outer, { left: -10, top: 10, width: 50, height: 50 })).toBe(false)
    // 정확히 경계에 붙은 객체는 부동소수 여유로 포함 판정 (오경고 방지)
    expect(rectContains(outer, { left: 0.4, top: 0, width: 99.9, height: 100 })).toBe(true)
  })
})
