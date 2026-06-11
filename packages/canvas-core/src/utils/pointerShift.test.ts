// pointerShift 회귀 테스트 — P1-3 "패널 열림 × 더블클릭 편집 레이스 → 객체 텔레포트"
//
// 라이브 실측 (e4eb328, /embed spread 템플릿, 4/4 재현):
//  - 속성 패널(ControlBar 280px)이 닫힌 상태에서 textbox 더블클릭 → 패널 마운트로
//    캔버스 요소 페이지 오프셋이 +280px 이동, 그 시프트가 2번째 클릭의
//    mousedown~mousemove 사이에 떨어짐.
//  - fabric dragHandler(newLeft = scenePointer - offsetX)가 매핑 점프를 드래그로
//    오해석 → 객체 scene 좌표 -280px/zoom 수평 이동:
//      zoom 0.339 → -826.7px (×3회) / zoom 0.4 → -700px (×1회)
//
// 본 테스트는 (1) 점프량 계산이 실측과 일치하는지, (2) 보정 적용 시 fabric drag
// 불변식(객체 불이동)이 성립하는지, (3) 플러그인 이벤트 배선이 fabric 5.5 순서
// (mouse:down → mouse:move:before → _transformObject) 에 맞게 동작하는지 고정한다.
import { describe, it, expect, vi } from 'vitest'
import {
  capturePointerMapping,
  compensateTransformAnchors,
  computePointerSceneJump,
  pointerMappingsEqual,
  type PointerMappingSnapshot,
  type TransformAnchors,
} from './pointerShift'

// fabric 은 node 환경에서 native canvas 바인딩을 요구 → 플러그인 테스트용 mock
// (PointerShiftGuardPlugin 은 fabric 을 타입으로만 사용)
vi.mock('fabric', () => ({ fabric: {} }))
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import PointerShiftGuardPlugin from '../plugins/PointerShiftGuardPlugin'

// ============================================================================
// Helpers
// ============================================================================

const mapping = (over: Partial<PointerMappingSnapshot> = {}): PointerMappingSnapshot => ({
  offsetLeft: 100,
  offsetTop: 50,
  zoomX: 0.4,
  zoomY: 0.4,
  panX: 30,
  panY: 20,
  ...over,
})

/** fabric getPointer 좌표식 — scene = (raw - offset - pan) / zoom */
const toScene = (m: PointerMappingSnapshot, rawX: number, rawY: number) => ({
  x: (rawX - m.offsetLeft - m.panX) / m.zoomX,
  y: (rawY - m.offsetTop - m.panY) / m.zoomY,
})

/** fabric controlsUtils.dragHandler 핵심식 (5.5.2 dist 기준) */
const dragNewLeftTop = (anchors: TransformAnchors, scenePointer: { x: number; y: number }) => ({
  left: scenePointer.x - anchors.offsetX,
  top: scenePointer.y - anchors.offsetY,
})

/** _setupCurrentTransform 의 기준 좌표 생성 (5.5.2 dist 기준) */
const setupAnchors = (
  sceneDown: { x: number; y: number },
  target: { left: number; top: number }
): TransformAnchors => ({
  offsetX: sceneDown.x - target.left,
  offsetY: sceneDown.y - target.top,
  ex: sceneDown.x,
  ey: sceneDown.y,
  lastX: sceneDown.x,
  lastY: sceneDown.y,
})

// ============================================================================
// 1. 점프량 계산 — 라이브 실측 수치 고정
// ============================================================================

describe('computePointerSceneJump — 라이브 실측 재현', () => {
  it('캔버스 요소 +280px 시프트, zoom 0.4 → scene 점프 -700px (실측 1회)', () => {
    const prev = mapping({ zoomX: 0.4, zoomY: 0.4 })
    const next = mapping({ zoomX: 0.4, zoomY: 0.4, offsetLeft: prev.offsetLeft + 280 })

    // 마우스는 같은 물리 위치 — raw 좌표 고정
    const raw = { x: 700, y: 400 }
    const sceneNew = toScene(next, raw.x, raw.y)

    const jump = computePointerSceneJump(prev, next, sceneNew)
    expect(jump.x).toBeCloseTo(-280 / 0.4, 6) // = -700
    expect(jump.x).toBeCloseTo(-700, 6)
    expect(jump.y).toBeCloseTo(0, 6)
  })

  it('캔버스 요소 +280px 시프트, zoom 0.339 → scene 점프 ≈ -826px (실측 3회)', () => {
    const prev = mapping({ zoomX: 0.339, zoomY: 0.339 })
    const next = mapping({ zoomX: 0.339, zoomY: 0.339, offsetLeft: prev.offsetLeft + 280 })

    const raw = { x: 700, y: 400 }
    const sceneNew = toScene(next, raw.x, raw.y)

    const jump = computePointerSceneJump(prev, next, sceneNew)
    expect(jump.x).toBeCloseTo(-280 / 0.339, 6) // ≈ -825.96 (실측 -826.7 은 zoom 반올림 오차)
    expect(Math.abs(jump.x + 826)).toBeLessThan(1.5)
  })

  it('vpt 패닝 +280 (요소 불이동) 도 같은 점프 — 결함 클래스 동일 (EditorView recenter 경로)', () => {
    const prev = mapping()
    const next = mapping({ panX: prev.panX + 280 })

    const raw = { x: 700, y: 400 }
    const sceneNew = toScene(next, raw.x, raw.y)

    const jump = computePointerSceneJump(prev, next, sceneNew)
    expect(jump.x).toBeCloseTo(-280 / prev.zoomX, 6)
    expect(jump.y).toBeCloseTo(0, 6)
  })

  it('요소 시프트 + recenter 패닝 합성 (offset +280, pan -140) → 순 점프 -140/zoom', () => {
    const prev = mapping()
    const next = mapping({ offsetLeft: prev.offsetLeft + 280, panX: prev.panX - 140 })

    const raw = { x: 700, y: 400 }
    const sceneNew = toScene(next, raw.x, raw.y)

    const jump = computePointerSceneJump(prev, next, sceneNew)
    expect(jump.x).toBeCloseTo(-140 / prev.zoomX, 6)
  })

  it('매핑 불변이면 점프 0', () => {
    const m = mapping()
    const sceneNew = toScene(m, 700, 400)
    const jump = computePointerSceneJump(m, { ...m }, sceneNew)
    expect(jump.x).toBeCloseTo(0, 9)
    expect(jump.y).toBeCloseTo(0, 9)
  })

  it('줌 0 방어 — 무효 매핑은 점프 0 처리', () => {
    const prev = mapping({ zoomX: 0, zoomY: 0 })
    const next = mapping()
    const jump = computePointerSceneJump(prev, next, { x: 10, y: 10 })
    expect(jump).toEqual({ x: 0, y: 0 })
  })
})

// ============================================================================
// 2. 보정 적용 — fabric drag 불변식 (객체 불이동)
// ============================================================================

describe('compensateTransformAnchors — dragHandler 불변식', () => {
  it('보정 없으면 객체가 -280/zoom 텔레포트, 보정하면 제자리 (라이브 시나리오)', () => {
    const zoom = 0.339
    const prev = mapping({ zoomX: zoom, zoomY: zoom })
    const target = { left: 1200, top: 800 }

    // 2번째 클릭 mousedown: "이동 전" 매핑으로 변환 기준점 기록
    const rawDown = { x: 640, y: 420 }
    const sceneDown = toScene(prev, rawDown.x, rawDown.y)
    const anchors = setupAnchors(sceneDown, target)

    // mousedown~mousemove 사이 패널 마운트 → 캔버스 요소 +280px
    const next = mapping({ zoomX: zoom, zoomY: zoom, offsetLeft: prev.offsetLeft + 280 })

    // mousemove: 마우스 물리 위치 동일(raw 고정), 새 매핑으로 scene 재계산
    const sceneMove = toScene(next, rawDown.x, rawDown.y)

    // 보정 전: 결함 재현 — 객체가 -280/zoom 이동
    const buggy = dragNewLeftTop(anchors, sceneMove)
    expect(buggy.left - target.left).toBeCloseTo(-280 / zoom, 6)

    // 보정 후: 객체 불이동
    const jump = computePointerSceneJump(prev, next, sceneMove)
    compensateTransformAnchors(anchors, jump)
    const fixed = dragNewLeftTop(anchors, sceneMove)
    expect(fixed.left).toBeCloseTo(target.left, 6)
    expect(fixed.top).toBeCloseTo(target.top, 6)
  })

  it('줌 변경(setZoomAuto)이 끼어도 객체 불이동 — 줌 비대칭 일반식 검증', () => {
    const prev = mapping({ zoomX: 0.4, zoomY: 0.4, panX: 100, panY: 50, offsetLeft: 300, offsetTop: 80 })
    const next = mapping({ zoomX: 0.3, zoomY: 0.3, panX: 150, panY: 60, offsetLeft: 20, offsetTop: 80 })
    const target = { left: 900, top: 600 }

    const rawDown = { x: 800, y: 500 }
    const sceneDown = toScene(prev, rawDown.x, rawDown.y)
    const anchors = setupAnchors(sceneDown, target)

    const sceneMove = toScene(next, rawDown.x, rawDown.y)
    const jump = computePointerSceneJump(prev, next, sceneMove)
    compensateTransformAnchors(anchors, jump)

    const fixed = dragNewLeftTop(anchors, sceneMove)
    expect(fixed.left).toBeCloseTo(target.left, 6)
    expect(fixed.top).toBeCloseTo(target.top, 6)
  })

  it('보정 후에도 실제 마우스 이동은 1:1 로 반영 (UX 불변)', () => {
    const zoom = 0.4
    const prev = mapping({ zoomX: zoom, zoomY: zoom })
    const next = mapping({ zoomX: zoom, zoomY: zoom, offsetLeft: prev.offsetLeft + 280 })
    const target = { left: 500, top: 300 }

    const rawDown = { x: 640, y: 420 }
    const anchors = setupAnchors(toScene(prev, rawDown.x, rawDown.y), target)

    const sceneAtShift = toScene(next, rawDown.x, rawDown.y)
    compensateTransformAnchors(anchors, computePointerSceneJump(prev, next, sceneAtShift))

    // 이후 사용자가 마우스를 +40px(화면) 이동 → 객체는 +40/zoom(scene) 이동해야 함
    const sceneAfterMove = toScene(next, rawDown.x + 40, rawDown.y)
    const moved = dragNewLeftTop(anchors, sceneAfterMove)
    expect(moved.left - target.left).toBeCloseTo(40 / zoom, 6)
    expect(moved.top).toBeCloseTo(target.top, 6)
  })
})

// ============================================================================
// 3. 스냅샷 유틸
// ============================================================================

describe('capturePointerMapping / pointerMappingsEqual', () => {
  it('fabric 캔버스 형태에서 스냅샷 추출', () => {
    const snap = capturePointerMapping({
      viewportTransform: [0.4, 0, 0, 0.4, 30, 20],
      _offset: { left: 100, top: 50 },
    })
    expect(snap).toEqual(mapping())
  })

  it('vpt/_offset 미존재 시 null', () => {
    expect(capturePointerMapping({})).toBeNull()
    expect(capturePointerMapping({ viewportTransform: [1, 0, 0, 1, 0, 0] })).toBeNull()
    expect(capturePointerMapping({ _offset: { left: 0, top: 0 } })).toBeNull()
  })

  it('동일/상이 매핑 판별 (서브픽셀 잡음 허용)', () => {
    const a = mapping()
    expect(pointerMappingsEqual(a, { ...a })).toBe(true)
    expect(pointerMappingsEqual(a, { ...a, offsetLeft: a.offsetLeft + 1e-9 })).toBe(true)
    expect(pointerMappingsEqual(a, { ...a, offsetLeft: a.offsetLeft + 280 })).toBe(false)
    expect(pointerMappingsEqual(a, { ...a, panX: a.panX + 280 })).toBe(false)
    expect(pointerMappingsEqual(a, { ...a, zoomX: a.zoomX * 0.9 })).toBe(false)
  })
})

// ============================================================================
// 4. 플러그인 이벤트 배선 — fabric 5.5 이벤트 순서 시뮬레이션
// ============================================================================

/** 최소 fabric 캔버스 mock — on/off + calcOffset/getPointer + 변환 상태 */
function makeMockCanvas(initial: {
  offset: { left: number; top: number }
  vpt: number[]
}) {
  const handlers: Record<string, Array<(opt: any) => void>> = {}
  const state = {
    domOffset: { ...initial.offset }, // "실제" DOM 오프셋 (calcOffset 이 읽음)
    _offset: { ...initial.offset }, // fabric 캐시
    viewportTransform: [...initial.vpt],
    _currentTransform: null as any,
  }
  const canvas = {
    get _offset() {
      return state._offset
    },
    get viewportTransform() {
      return state.viewportTransform
    },
    get _currentTransform() {
      return state._currentTransform
    },
    set _currentTransform(t: any) {
      state._currentTransform = t
    },
    on: (ev: string, fn: (opt: any) => void) => {
      ;(handlers[ev] ||= []).push(fn)
    },
    off: (ev: string, fn: (opt: any) => void) => {
      handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn)
    },
    fire: (ev: string, opt: any = {}) => {
      ;(handlers[ev] || []).forEach((f) => f(opt))
    },
    handlerCount: (ev: string) => (handlers[ev] || []).length,
    calcOffset: () => {
      state._offset = { ...state.domOffset }
    },
    // fabric getPointer 좌표식 재현 — 실제 fabric 5.5 처럼 매 호출 calcOffset 수행
    // (retina/cssScale 은 상쇄 가정)
    getPointer: (e: { clientX: number; clientY: number }) => {
      canvas.calcOffset()
      const vpt = state.viewportTransform
      return {
        x: (e.clientX - state._offset.left - vpt[4]) / vpt[0],
        y: (e.clientY - state._offset.top - vpt[5]) / vpt[3],
      }
    },
    /** 테스트 제어용 — DOM 레이아웃 시프트 시뮬레이션 */
    __shiftDom: (dx: number, dy: number) => {
      state.domOffset = { left: state.domOffset.left + dx, top: state.domOffset.top + dy }
    },
    __state: state,
  }
  return canvas
}

describe('PointerShiftGuardPlugin — 이벤트 배선', () => {
  const ZOOM = 0.4

  function setup() {
    const canvas = makeMockCanvas({
      offset: { left: 100, top: 50 },
      vpt: [ZOOM, 0, 0, ZOOM, 30, 20],
    })
    const editor = {} as any
    const plugin = new PointerShiftGuardPlugin(canvas as any, editor)
    return { canvas, plugin }
  }

  /** fabric __onMouseDown 재현: getPointer(=calcOffset) → _setupCurrentTransform → fire('mouse:down') */
  function fabricMouseDown(canvas: ReturnType<typeof makeMockCanvas>, e: { clientX: number; clientY: number }, target: { left: number; top: number }) {
    canvas.calcOffset()
    const p = canvas.getPointer(e)
    canvas._currentTransform = {
      target,
      action: 'drag',
      offsetX: p.x - target.left,
      offsetY: p.y - target.top,
      ex: p.x,
      ey: p.y,
      lastX: p.x,
      lastY: p.y,
    }
    canvas.fire('mouse:down', { e })
  }

  /** fabric __onMouseMove 재현: fire('mouse:move:before') → getPointer → dragHandler */
  function fabricMouseMove(canvas: ReturnType<typeof makeMockCanvas>, e: { clientX: number; clientY: number }) {
    canvas.fire('mouse:move:before', { e })
    const t = canvas._currentTransform
    const p = canvas.getPointer(e) // _transformObject 의 getPointer (calcOffset 포함)
    t.target.left = p.x - t.offsetX
    t.target.top = p.y - t.offsetY
  }

  it('mousedown~mousemove 사이 +280px 레이아웃 시프트 → 객체 불이동 (라이브 시나리오)', () => {
    const { canvas } = setup()
    const target = { left: 1200, top: 800 }
    const e = { clientX: 640, clientY: 420 }

    fabricMouseDown(canvas, e, target)

    // 패널 마운트 → 캔버스 요소 +280px (마우스는 그대로)
    canvas.__shiftDom(280, 0)

    fabricMouseMove(canvas, e)
    expect(target.left).toBeCloseTo(1200, 6)
    expect(target.top).toBeCloseTo(800, 6)
  })

  it('가드 미적용 시 같은 시나리오는 -280/zoom 텔레포트 (결함 재현 대조군)', () => {
    const canvas = makeMockCanvas({
      offset: { left: 100, top: 50 },
      vpt: [ZOOM, 0, 0, ZOOM, 30, 20],
    })
    const target = { left: 1200, top: 800 }
    const e = { clientX: 640, clientY: 420 }

    fabricMouseDown(canvas, e, target)
    canvas.__shiftDom(280, 0)
    fabricMouseMove(canvas, e)

    expect(target.left).toBeCloseTo(1200 - 280 / ZOOM, 6) // -700
  })

  it('변환 중 vpt 패닝(프로그램적) → 객체 불이동', () => {
    const { canvas } = setup()
    const target = { left: 1200, top: 800 }
    const e = { clientX: 640, clientY: 420 }

    fabricMouseDown(canvas, e, target)
    canvas.__state.viewportTransform[4] += 280 // setCenterPointOf 류 패닝
    fabricMouseMove(canvas, e)

    expect(target.left).toBeCloseTo(1200, 6)
  })

  it('매핑 불변 + 실제 마우스 이동 → 정상 드래그 (오보정 없음)', () => {
    const { canvas } = setup()
    const target = { left: 1200, top: 800 }

    fabricMouseDown(canvas, { clientX: 640, clientY: 420 }, target)
    fabricMouseMove(canvas, { clientX: 680, clientY: 420 }) // +40px 화면 이동

    expect(target.left).toBeCloseTo(1200 + 40 / ZOOM, 6)
  })

  it('시프트 후 이어지는 마우스 이동도 1:1 반영 (스냅샷 갱신 확인)', () => {
    const { canvas } = setup()
    const target = { left: 1200, top: 800 }
    const e0 = { clientX: 640, clientY: 420 }

    fabricMouseDown(canvas, e0, target)
    canvas.__shiftDom(280, 0)
    fabricMouseMove(canvas, e0) // 시프트 보정
    fabricMouseMove(canvas, { clientX: 690, clientY: 420 }) // +50px 실이동

    expect(target.left).toBeCloseTo(1200 + 50 / ZOOM, 6)
  })

  it('mouse:up 후의 매핑 변화는 추적하지 않음 (스냅샷 해제)', () => {
    const { canvas } = setup()
    const target = { left: 1200, top: 800 }
    const e = { clientX: 640, clientY: 420 }

    fabricMouseDown(canvas, e, target)
    canvas.fire('mouse:up', {})
    canvas._currentTransform = null

    // up 이후 시프트 — 가드는 아무것도 하지 않아야 함 (다음 down 에서 새 스냅샷)
    canvas.__shiftDom(280, 0)
    canvas.fire('mouse:move:before', { e })
    expect(target.left).toBe(1200)
  })

  it('변환 없는 mousedown(빈 영역) 은 추적하지 않음', () => {
    const { canvas } = setup()
    canvas._currentTransform = null
    canvas.fire('mouse:down', { e: { clientX: 0, clientY: 0 } })
    canvas.__shiftDom(280, 0)
    // _currentTransform 없으므로 move:before 가 아무 일도 안 해야 함 (throw 없음)
    expect(() => canvas.fire('mouse:move:before', { e: { clientX: 0, clientY: 0 } })).not.toThrow()
  })

  it('dispose 가 모든 핸들러를 해제', () => {
    const { canvas, plugin } = setup()
    expect(canvas.handlerCount('mouse:down')).toBe(1)
    expect(canvas.handlerCount('mouse:move:before')).toBe(1)
    expect(canvas.handlerCount('mouse:up')).toBe(1)

    plugin.dispose()
    expect(canvas.handlerCount('mouse:down')).toBe(0)
    expect(canvas.handlerCount('mouse:move:before')).toBe(0)
    expect(canvas.handlerCount('mouse:up')).toBe(0)
  })
})
