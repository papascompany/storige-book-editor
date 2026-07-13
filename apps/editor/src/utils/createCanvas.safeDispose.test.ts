import { describe, it, expect, vi } from 'vitest'
import { safeDisposeCanvas, CanvasInitCancelledError } from './createCanvas'
import type { fabric } from 'fabric'

// StrictMode 이중 마운트 정리 경로(dev 초기화 레이스) 방어 계약:
// - dispose 가 DOM 분리 상태에서 removeChild(NotFoundError)로 던져도 삼켜진다
// - 잔여 wrapper 엘리먼트가 DOM 에서 제거된다(고아 캔버스 방지)
// - 취소 신호는 전용 에러 클래스로 식별된다(뷰가 오류 로그 대신 정상 중단 처리)

type MockCanvas = {
  off: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  wrapperEl?: HTMLElement
  disposed?: boolean
}

const makeCanvas = (overrides: Partial<MockCanvas> = {}): MockCanvas => ({
  off: vi.fn(),
  dispose: vi.fn(),
  ...overrides,
})

const asFabric = (c: MockCanvas): fabric.Canvas => c as unknown as fabric.Canvas

describe('safeDisposeCanvas', () => {
  it('정상 캔버스는 off → dispose 순으로 호출하고 disposed 플래그를 세운다', () => {
    const c = makeCanvas()
    safeDisposeCanvas(asFabric(c))
    expect(c.off).toHaveBeenCalledTimes(1)
    expect(c.dispose).toHaveBeenCalledTimes(1)
    expect(c.disposed).toBe(true)
  })

  it('dispose 가 removeChild NotFoundError 를 던져도 예외가 밖으로 새지 않는다', () => {
    const c = makeCanvas({
      dispose: vi.fn(() => {
        // 실 브라우저에서는 DOMException(NotFoundError) — 계약은 "무엇이 던져져도 삼킨다"
        throw Object.assign(
          new Error(
            "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
          ),
          { name: 'NotFoundError' }
        )
      }),
    })
    expect(() => safeDisposeCanvas(asFabric(c))).not.toThrow()
    expect(c.disposed).toBe(true)
  })

  it('wrapperEl 이 DOM 에 남아 있으면 제거한다(고아 캔버스 방지)', () => {
    const parent = document.createElement('div')
    const wrapper = document.createElement('div')
    parent.appendChild(wrapper)
    const c = makeCanvas({ wrapperEl: wrapper })
    safeDisposeCanvas(asFabric(c))
    expect(parent.contains(wrapper)).toBe(false)
  })

  it('off 가 던져도 dispose 와 wrapper 제거는 계속 진행된다', () => {
    const parent = document.createElement('div')
    const wrapper = document.createElement('div')
    parent.appendChild(wrapper)
    const c = makeCanvas({
      off: vi.fn(() => {
        throw new TypeError('clearRect of null')
      }),
      wrapperEl: wrapper,
    })
    expect(() => safeDisposeCanvas(asFabric(c))).not.toThrow()
    expect(c.dispose).toHaveBeenCalledTimes(1)
    expect(parent.contains(wrapper)).toBe(false)
  })
})

describe('CanvasInitCancelledError', () => {
  it('Error 하위 타입이며 name/message 로 식별 가능하다', () => {
    const err = new CanvasInitCancelledError('init-123')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CanvasInitCancelledError')
    expect(err.message).toContain('init-123')
  })
})
