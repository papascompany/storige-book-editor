// touchContextMenu — 모바일 롱프레스 컨텍스트 메뉴 트리거 (C6 / E2 W3)
//
// node env + mock wrapperEl + fake timers 로 결정론적 검증(SmartGuides.test 패턴 계열).
// 증명 대상(설계 §5 T-1~T-6, 정찰 종합 §4 유닛 항목):
//  ① T-1: touch 단일 포인터 롱프레스(500ms) → showAt(start좌표,{touch:true}) 1회
//  ② pointerType!=='touch'(마우스) → 미발화(우클릭 경로 회귀 차단)
//  ③ T-1 취소: 두 번째 포인터(핀치) 도착 → 미발화
//  ④ T-2: 이동 임계(10px) 초과 → 미발화 / 이하 → 발화
//  ⑤ 임계 전 pointerup(단순 탭) → 미발화
//  ⑥ T-4: 발화 시 _currentTransform=undefined + discardActiveObject 미호출(활성객체 유지)
//  ⑦ haptic: showAt 이 실제 표시(true) 시만 vibrate, 미표시(false·빈 곳)면 무진동
//  ⑧ dispose: 리스너 4종 해제 + 대기 타이머 취소(발화 안 함), 멱등
//  ⑨ SSR/구형: window/PointerEvent 부재 시 no-op disposer
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachTouchContextMenu } from './touchContextMenu'

type Handler = (e: unknown) => void

function makeWrapper() {
  const listeners: Record<string, Handler[]> = {}
  return {
    listeners,
    addEventListener(type: string, h: Handler) {
      ;(listeners[type] ||= []).push(h)
    },
    removeEventListener(type: string, h: Handler) {
      const l = listeners[type]
      if (!l) return
      const i = l.indexOf(h)
      if (i >= 0) l.splice(i, 1)
    },
    fire(type: string, e: unknown) {
      ;(listeners[type] || []).slice().forEach((h) => h(e))
    },
    count(type: string) {
      return (listeners[type] || []).length
    },
  }
}

function makeCanvas(wrapper: ReturnType<typeof makeWrapper>) {
  return {
    wrapperEl: wrapper as unknown,
    _currentTransform: undefined as unknown,
    discardActiveObject: vi.fn(),
  }
}

function makeContextMenu(shownReturn = true) {
  return {
    shown: shownReturn,
    showAt: vi.fn(() => shownReturn),
    armTouchHideSuppress: vi.fn(),
  }
}

function pdown(id: number, x: number, y: number, type = 'touch') {
  return { pointerType: type, pointerId: id, clientX: x, clientY: y }
}

let vibrate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vibrate = vi.fn()
  vi.stubGlobal('window', { PointerEvent: class {} })
  vi.stubGlobal('navigator', { vibrate })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('touchContextMenu — 발화 조건', () => {
  it('① touch 단일 포인터 500ms 롱프레스 → showAt(시작좌표,{touch:true}) 1회', () => {
    const wrapper = makeWrapper()
    const canvas = makeCanvas(wrapper)
    const cm = makeContextMenu(true)
    attachTouchContextMenu(canvas as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 100, 200))
    expect(cm.showAt).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)

    expect(cm.showAt).toHaveBeenCalledTimes(1)
    expect(cm.showAt).toHaveBeenCalledWith(100, 200, { touch: true })
  })

  it('② pointerType 마우스는 롱프레스 미발화(우클릭 경로 보존)', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu()
    attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 100, 200, 'mouse'))
    vi.advanceTimersByTime(600)
    expect(cm.showAt).not.toHaveBeenCalled()
  })

  it('③ 두 번째 포인터(핀치) 도착 → 롱프레스 취소', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu()
    attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 100, 200))
    wrapper.fire('pointerdown', pdown(2, 150, 250)) // 2nd finger
    vi.advanceTimersByTime(600)
    expect(cm.showAt).not.toHaveBeenCalled()
  })

  it('④ 이동 10px 초과 → 취소, 10px 이하 → 발화', () => {
    // 초과
    const w1 = makeWrapper()
    const cm1 = makeContextMenu()
    attachTouchContextMenu(makeCanvas(w1) as never, cm1 as never)
    w1.fire('pointerdown', pdown(1, 100, 100))
    w1.fire('pointermove', pdown(1, 100, 120)) // 20px
    vi.advanceTimersByTime(500)
    expect(cm1.showAt).not.toHaveBeenCalled()

    // 이하
    const w2 = makeWrapper()
    const cm2 = makeContextMenu()
    attachTouchContextMenu(makeCanvas(w2) as never, cm2 as never)
    w2.fire('pointerdown', pdown(1, 100, 100))
    w2.fire('pointermove', pdown(1, 105, 103)) // ~5.8px
    vi.advanceTimersByTime(500)
    expect(cm2.showAt).toHaveBeenCalledTimes(1)
  })

  it('⑤ 임계 전 pointerup(단순 탭) → 미발화', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu()
    attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)
    wrapper.fire('pointerdown', pdown(1, 100, 100))
    vi.advanceTimersByTime(200)
    wrapper.fire('pointerup', pdown(1, 100, 100))
    vi.advanceTimersByTime(400)
    expect(cm.showAt).not.toHaveBeenCalled()
  })
})

describe('touchContextMenu — 발화 부수효과', () => {
  it('⑥ T-4: _currentTransform=undefined + discardActiveObject 미호출', () => {
    const wrapper = makeWrapper()
    const canvas = makeCanvas(wrapper)
    canvas._currentTransform = { some: 'transform' }
    const cm = makeContextMenu(true)
    attachTouchContextMenu(canvas as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 100, 200))
    vi.advanceTimersByTime(500)

    expect(canvas._currentTransform).toBeUndefined()
    expect(canvas.discardActiveObject).not.toHaveBeenCalled() // 활성객체 유지(T-6)
  })

  it('⑥-b T-4: 서브임계 지터로 밀린 객체를 original 위치로 복원(무-undo 오염 방지, 적대 리뷰 MAJOR)', () => {
    const wrapper = makeWrapper()
    const canvas = makeCanvas(wrapper)
    const target: Record<string, unknown> = {
      left: 106,
      top: 103, // 대기 중 fabric 이 6px/3px 밀어놓음
      set(o: { left: number; top: number }) {
        target.left = o.left
        target.top = o.top
      },
      setCoords: vi.fn(),
    }
    canvas._currentTransform = { target, original: { left: 100, top: 100 } }
    const cm = makeContextMenu(true)
    attachTouchContextMenu(canvas as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 200, 200))
    vi.advanceTimersByTime(500)

    expect(target.left).toBe(100) // press 이전으로 복원
    expect(target.top).toBe(100)
    expect(target.setCoords).toHaveBeenCalled()
    expect(canvas._currentTransform).toBeUndefined()
  })

  it('⑥-c release 시 armTouchHideSuppress 재-arm(T-5 늦은 손뗌 방어)', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu(true)
    attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)

    wrapper.fire('pointerdown', pdown(1, 100, 100))
    vi.advanceTimersByTime(500) // 발화
    expect(cm.armTouchHideSuppress).not.toHaveBeenCalled()

    wrapper.fire('pointerup', pdown(1, 100, 100)) // 손 뗌
    expect(cm.armTouchHideSuppress).toHaveBeenCalledTimes(1)

    // 발화 안 한 제스처(단순 탭)는 재-arm 안 함
    cm.armTouchHideSuppress.mockClear()
    wrapper.fire('pointerdown', pdown(2, 100, 100))
    wrapper.fire('pointerup', pdown(2, 100, 100))
    expect(cm.armTouchHideSuppress).not.toHaveBeenCalled()
  })

  it('⑦ haptic: 표시(true) 시 vibrate, 미표시(false=빈 곳)면 무진동', () => {
    // 표시됨
    const w1 = makeWrapper()
    const cm1 = makeContextMenu(true)
    attachTouchContextMenu(makeCanvas(w1) as never, cm1 as never, { haptic: true })
    w1.fire('pointerdown', pdown(1, 10, 10))
    vi.advanceTimersByTime(500)
    expect(vibrate).toHaveBeenCalledWith(10)

    vibrate.mockClear()

    // 미표시(빈 곳 available 0 → showAt false)
    const w2 = makeWrapper()
    const cm2 = makeContextMenu(false)
    attachTouchContextMenu(makeCanvas(w2) as never, cm2 as never, { haptic: true })
    w2.fire('pointerdown', pdown(1, 10, 10))
    vi.advanceTimersByTime(500)
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('haptic:false 옵션이면 표시돼도 무진동', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu(true)
    attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never, { haptic: false })
    wrapper.fire('pointerdown', pdown(1, 10, 10))
    vi.advanceTimersByTime(500)
    expect(cm.showAt).toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('touchContextMenu — dispose / 환경 가드', () => {
  it('⑧ dispose 후 리스너 4종 해제 + 대기 타이머 취소(발화 안 함), 멱등', () => {
    const wrapper = makeWrapper()
    const cm = makeContextMenu()
    const dispose = attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)

    expect(wrapper.count('pointerdown')).toBe(1)
    expect(wrapper.count('pointermove')).toBe(1)
    expect(wrapper.count('pointerup')).toBe(1)
    expect(wrapper.count('pointercancel')).toBe(1)

    // 타이머 대기 중 dispose → 발화 안 함
    wrapper.fire('pointerdown', pdown(1, 100, 100))
    dispose()
    vi.advanceTimersByTime(600)
    expect(cm.showAt).not.toHaveBeenCalled()

    expect(wrapper.count('pointerdown')).toBe(0)
    expect(wrapper.count('pointermove')).toBe(0)
    expect(wrapper.count('pointerup')).toBe(0)
    expect(wrapper.count('pointercancel')).toBe(0)

    // 멱등: 2회 호출 안전
    expect(() => dispose()).not.toThrow()
  })

  it('⑨ window/PointerEvent 부재(SSR/구형) → no-op disposer', () => {
    vi.stubGlobal('window', undefined)
    const wrapper = makeWrapper()
    const cm = makeContextMenu()
    const dispose = attachTouchContextMenu(makeCanvas(wrapper) as never, cm as never)
    // 리스너 미등록
    expect(wrapper.count('pointerdown')).toBe(0)
    wrapper.fire('pointerdown', pdown(1, 100, 100))
    vi.advanceTimersByTime(600)
    expect(cm.showAt).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })
})
