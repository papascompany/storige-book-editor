// HistoryPlugin undo/redo 가시성 가드 테스트 (ED-1)
//
// 배경: hotkeys-js 는 전역 싱글톤이라 멀티페이지 환경에서 모든 페이지의
// HistoryPlugin 이 ctrl+z 에 바인딩된다 → 단축키 한 번에 "모든" 페이지가
// 동시에 undo 되는 버그. DraggingPlugin.isCanvasVisible() 과 동일한 가드를
// undo()/redo() 진입부에 두어 화면에 보이는(활성) 페이지만 동작하게 한다.
//
// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock.
// (HistoryPlugin 은 모듈 레벨에서 fabric 값을 사용하지 않음 — _recreateMoldIconFor
//  내부에서만 사용하며 본 테스트 경로에서는 도달하지 않는다)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))
// utils/history 는 fabric.Canvas.prototype 확장 side-effect 모듈 — node 에서 불필요
vi.mock('../utils/history', () => ({}))
// Editor 는 hotkeys/contextMenu 등 DOM 의존이 있어 mock
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import HistoryPlugin from './HistoryPlugin'

// ============================================================================
// Test Helpers
// ============================================================================

interface MockCanvasOptions {
  /** false 면 offsetParent === null (display:none 조상 등 — 숨겨진 페이지) */
  visible?: boolean
  /** getComputedStyle(el).display 반환값 */
  display?: string
  /** false 면 wrapperEl 미존재 (getElement().parentElement 폴백 경로) */
  hasWrapperEl?: boolean
  /** false 면 parentElement 도 없음 (가드가 안전하게 false 반환해야 함) */
  hasParentElement?: boolean
}

function makeMockCanvas(opts: MockCanvasOptions = {}): any {
  const visible = opts.visible !== false
  const el = {
    offsetParent: visible ? ({} as any) : null,
    __display: opts.display ?? 'block'
  }
  const canvas: any = {
    on: vi.fn(),
    off: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    historyUndo: [],
    historyRedo: []
  }
  if (opts.hasWrapperEl !== false) {
    canvas.wrapperEl = el
  }
  canvas.getElement = () => ({
    parentElement: opts.hasParentElement === false ? null : el
  })
  return canvas
}

function makeMockEditor(): any {
  return {
    emit: vi.fn(),
    getPlugin: vi.fn(() => undefined)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('HistoryPlugin — undo/redo 가시성 가드', () => {
  beforeEach(() => {
    // node 환경: HistoryPlugin.init() 의 window.addEventListener 와
    // isCanvasVisible() 의 getComputedStyle 을 위해 전역 stub
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('getComputedStyle', (el: any) => ({ display: el?.__display ?? 'block' }))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('보이는 캔버스에서는 undo 가 canvas.undo 를 호출한다', () => {
    const canvas = makeMockCanvas({ visible: true })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.undo()

    expect(canvas.undo).toHaveBeenCalledTimes(1)
  })

  it('보이는 캔버스에서는 redo 가 canvas.redo 를 호출한다', () => {
    const canvas = makeMockCanvas({ visible: true })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.redo()

    expect(canvas.redo).toHaveBeenCalledTimes(1)
  })

  it('숨겨진 캔버스(offsetParent === null)에서는 undo 가 차단된다', () => {
    const canvas = makeMockCanvas({ visible: false })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.undo()

    expect(canvas.undo).not.toHaveBeenCalled()
  })

  it('숨겨진 캔버스(offsetParent === null)에서는 redo 가 차단된다', () => {
    const canvas = makeMockCanvas({ visible: false })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.redo()

    expect(canvas.redo).not.toHaveBeenCalled()
  })

  it('display:none 캔버스에서는 undo/redo 가 차단된다', () => {
    const canvas = makeMockCanvas({ visible: true, display: 'none' })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.undo()
    plugin.redo()

    expect(canvas.undo).not.toHaveBeenCalled()
    expect(canvas.redo).not.toHaveBeenCalled()
  })

  it('wrapperEl 이 없으면 getElement().parentElement 폴백으로 판정한다', () => {
    const canvas = makeMockCanvas({ visible: true, hasWrapperEl: false })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    plugin.undo()

    expect(canvas.undo).toHaveBeenCalledTimes(1)
  })

  it('wrapperEl/parentElement 모두 없으면 throw 없이 차단된다', () => {
    const canvas = makeMockCanvas({ hasWrapperEl: false, hasParentElement: false })
    const plugin = new (HistoryPlugin as any)(canvas, makeMockEditor())

    expect(() => plugin.undo()).not.toThrow()
    expect(() => plugin.redo()).not.toThrow()
    expect(canvas.undo).not.toHaveBeenCalled()
    expect(canvas.redo).not.toHaveBeenCalled()
  })

  it('멀티페이지: 전역 단축키가 모든 플러그인을 두드려도 보이는 페이지만 undo 된다', () => {
    // 페이지 0 = 숨김, 페이지 1 = 표시 (storige 는 페이지별 컨테이너 display 토글)
    const hiddenCanvas = makeMockCanvas({ visible: false })
    const visibleCanvas = makeMockCanvas({ visible: true })
    const hiddenPlugin = new (HistoryPlugin as any)(hiddenCanvas, makeMockEditor())
    const visiblePlugin = new (HistoryPlugin as any)(visibleCanvas, makeMockEditor())

    // hotkeys-js 전역 ctrl+z 1회 = 등록된 모든 핸들러 실행 시뮬레이션
    hiddenPlugin.undo()
    visiblePlugin.undo()

    expect(hiddenCanvas.undo).not.toHaveBeenCalled()
    expect(visibleCanvas.undo).toHaveBeenCalledTimes(1)
  })
})
