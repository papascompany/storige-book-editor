// TransformFeedbackPlugin — 실시간 치수/각도/좌표 피드백 테스트 (E1 §5-2)
//
// 증명 대상:
//  ① mm 변환 정확성 (150dpi 표시 규약 — getUnitSize 0.1mm 반올림)
//  ② 표시 중 객체 속성 무변경 (순수 read)
//  ③ dispose 시 DOM 노드 제거 + 리스너 완전 해제
//  ④ 숨김 시맨틱 (mouse:up / object:modified / selection:cleared)
//  ⑤ pointer:coarse 폰트 확대
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock. DOM 은 wrapperEl/
// ownerDocument 를 duck-typing 한 fake 로 검증한다(플러그인이 필요로 하는 표면만).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({
  fabric: {
    Canvas: class MockCanvas {},
    util: {},
  },
}))

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

import TransformFeedbackPlugin, {
  formatAngleLabel,
  formatMoveLabel,
  formatSizeLabel,
} from './TransformFeedbackPlugin'

interface FakeStyle {
  [key: string]: string
}

interface FakeElement {
  style: FakeStyle
  textContent: string
  parentNode: unknown
  remove: () => void
}

function makeFakeDom(coarse = false) {
  const createdElements: FakeElement[] = []
  const doc = {
    defaultView: {
      matchMedia: (query: string) => ({
        matches: coarse && query.includes('coarse'),
      }),
    },
    createElement: (_tag: string): FakeElement => {
      const el: FakeElement = {
        style: {},
        textContent: '',
        parentNode: null,
        remove: vi.fn(function (this: FakeElement) {
          this.parentNode = null
        }),
      }
      createdElements.push(el)
      return el
    },
  }
  const wrapper = {
    ownerDocument: doc,
    clientWidth: 800,
    clientHeight: 600,
    appendChild: vi.fn((el: FakeElement) => {
      el.parentNode = wrapper
    }),
  }
  return { doc, wrapper, createdElements }
}

interface FakeTargetInit {
  id?: string
  type?: string
  left: number
  top: number
  width: number
  height: number
  scaleX?: number
  scaleY?: number
  angle?: number
  extensionType?: string
  excludeFromExport?: boolean
}

/** 순수 read 검증을 위해 모든 조회를 getter 로 두고 set 류 호출을 감시하는 fake */
function makeTarget(init: FakeTargetInit) {
  const scaleX = init.scaleX ?? 1
  const scaleY = init.scaleY ?? 1
  const target = {
    type: 'rect',
    angle: 0,
    ...init,
    getBoundingRect(_abs?: boolean, _calc?: boolean) {
      return { left: init.left, top: init.top, width: init.width, height: init.height }
    },
    getScaledWidth: () => init.width * scaleX,
    getScaledHeight: () => init.height * scaleY,
    // 순수 read 계약 감시 — 호출되면 안 되는 mutator 들
    set: vi.fn(),
    setCoords: vi.fn(),
    setPositionByOrigin: vi.fn(),
  }
  return target
}

function makeMockCanvas(objects: Array<Record<string, unknown>>, wrapper: unknown) {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  return {
    __eventListeners,
    wrapperEl: wrapper,
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
  }
}

function setup(coarse = false, objects: Array<Record<string, unknown>> = []) {
  const { wrapper, createdElements } = makeFakeDom(coarse)
  const canvas = makeMockCanvas(objects, wrapper)
  const plugin = new TransformFeedbackPlugin(canvas as never, {} as never, {})
  return { canvas, plugin, wrapper, createdElements }
}

// 150dpi 표시 규약: 1mm = 150/25.4 ≈ 5.90551px
const MM = 150 / 25.4

describe('TransformFeedback — ① mm 변환 정확성 (getUnitSize 0.1mm 반올림)', () => {
  it('formatMoveLabel: px → mm 좌표', () => {
    expect(formatMoveLabel(10 * MM, 25 * MM)).toBe('X 10 · Y 25 mm')
    expect(formatMoveLabel(10.04 * MM, 0)).toBe('X 10 · Y 0 mm') // 0.1mm 반올림
    expect(formatMoveLabel(-3.25 * MM, 3.26 * MM)).toBe('X -3.2 · Y 3.3 mm')
  })

  it('formatSizeLabel: 스케일 반영 px → mm 치수', () => {
    expect(formatSizeLabel(90 * MM, 50 * MM)).toBe('90 × 50 mm')
    expect(formatSizeLabel(21.55 * MM, 29.7 * MM)).toBe('21.6 × 29.7 mm')
  })

  it('formatAngleLabel: 0~360 정규화 + 0.1° 반올림', () => {
    expect(formatAngleLabel(45)).toBe('45°')
    expect(formatAngleLabel(-15)).toBe('345°')
    expect(formatAngleLabel(374.96)).toBe('15°')
    expect(formatAngleLabel(0)).toBe('0°')
  })
})

describe('TransformFeedback — 이벤트별 표시', () => {
  it('object:moving 에서 workspace 좌상단 기준 mm 좌표를 표시한다', () => {
    const workspace = makeTarget({ id: 'workspace', left: 100, top: 200, width: 1000, height: 800 })
    const { canvas, createdElements } = setup(false, [workspace as never])
    const target = makeTarget({ id: 'o1', left: 100 + 10 * MM, top: 200 + 20 * MM, width: 50, height: 40 })

    canvas.fire('object:moving', { target })

    expect(createdElements).toHaveLength(1)
    const el = createdElements[0]
    expect(el.textContent).toBe('X 10 · Y 20 mm')
    expect(el.style.display).toBe('block')
    expect(el.style.pointerEvents).toBe('none')
  })

  it('object:scaling 에서 W×H mm(getScaledWidth/Height)를 표시한다', () => {
    const { canvas, createdElements } = setup()
    const target = makeTarget({
      id: 'o1',
      left: 300,
      top: 300,
      width: 45 * MM,
      height: 20 * MM,
      scaleX: 2,
      scaleY: 1.5,
    })

    canvas.fire('object:scaling', { target })

    expect(createdElements[0].textContent).toBe('90 × 30 mm')
  })

  it('object:rotating 에서 각도°를 표시한다', () => {
    const { canvas, createdElements } = setup()
    const target = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50, angle: 43.4 })

    canvas.fire('object:rotating', { target })

    expect(createdElements[0].textContent).toBe('43.4°')
  })

  it('④ mouse:up / object:modified / selection:cleared 에서 숨긴다', () => {
    const { canvas, createdElements } = setup()
    const target = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50 })

    for (const hideEvent of ['mouse:up', 'object:modified', 'selection:cleared']) {
      canvas.fire('object:moving', { target })
      expect(createdElements[0].style.display).toBe('block')
      canvas.fire(hideEvent, {})
      expect(createdElements[0].style.display).toBe('none')
    }
  })

  it('시스템 객체(workspace/guideline/excludeFromExport)에는 표시하지 않는다', () => {
    const { canvas, createdElements } = setup()
    canvas.fire('object:moving', {
      target: makeTarget({ id: 'workspace', left: 0, top: 0, width: 10, height: 10 }),
    })
    canvas.fire('object:moving', {
      target: makeTarget({ left: 0, top: 0, width: 10, height: 10, extensionType: 'guideline' }),
    })
    canvas.fire('object:scaling', {
      target: makeTarget({ left: 0, top: 0, width: 10, height: 10, excludeFromExport: true }),
    })
    expect(createdElements).toHaveLength(0) // 오버레이 생성조차 안 됨
  })
})

describe('TransformFeedback — ② 순수 read (표시 중 객체 속성 무변경)', () => {
  it('moving/scaling/rotating 표시가 객체 mutator 를 일절 호출하지 않는다', () => {
    const { canvas } = setup()
    const target = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50, angle: 30 })

    canvas.fire('object:moving', { target })
    canvas.fire('object:scaling', { target })
    canvas.fire('object:rotating', { target })

    expect(target.set).not.toHaveBeenCalled()
    expect(target.setCoords).not.toHaveBeenCalled()
    expect(target.setPositionByOrigin).not.toHaveBeenCalled()
    // 값 필드도 불변
    expect(target.left).toBe(300)
    expect(target.top).toBe(300)
    expect(target.angle).toBe(30)
  })
})

describe('TransformFeedback — ⑤ pointer:coarse 폰트 확대', () => {
  it('coarse 포인터에서 폰트가 확대된다', () => {
    const fine = setup(false)
    const fineTarget = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50 })
    fine.canvas.fire('object:moving', { target: fineTarget })
    expect(fine.createdElements[0].style.fontSize).toBe('12px')

    const coarse = setup(true)
    const coarseTarget = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50 })
    coarse.canvas.fire('object:moving', { target: coarseTarget })
    expect(coarse.createdElements[0].style.fontSize).toBe('15px')
  })
})

describe('TransformFeedback — ③ dispose 완전 정리', () => {
  it('DOM 노드 제거 + 전체 리스너 해제', () => {
    const { canvas, plugin, createdElements } = setup()
    const target = makeTarget({ id: 'o1', left: 300, top: 300, width: 50, height: 50 })
    canvas.fire('object:moving', { target })
    expect(createdElements).toHaveLength(1)
    expect(createdElements[0].parentNode).not.toBeNull()

    plugin.dispose()

    expect(createdElements[0].remove).toHaveBeenCalled()
    expect(createdElements[0].parentNode).toBeNull()
    const listeners = (canvas as { __eventListeners: Record<string, unknown[]> }).__eventListeners
    for (const eventName of [
      'object:moving',
      'object:scaling',
      'object:rotating',
      'mouse:up',
      'object:modified',
      'selection:cleared',
    ]) {
      expect(listeners[eventName]).toHaveLength(0)
    }
  })

  it('오버레이 미생성 상태(dispose 선행)에서도 안전하다', () => {
    const { plugin } = setup()
    expect(() => plugin.dispose()).not.toThrow()
  })
})
