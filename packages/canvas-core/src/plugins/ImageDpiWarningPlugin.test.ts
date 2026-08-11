// ImageDpiWarningPlugin — 배치 이미지 유효 DPI 실시간 경고 테스트 (R8)
//
// 증명 대상:
//  ① computeEffectiveDpi 순수 함수 — 150dpi 표시 규약 환산·최악 축·무효 입력 null
//  ② 저해상 진입/회복 전이 — enter 에서만 imageLowDpi 1회 발행(객체별 디바운스),
//     회복 후 재진입이면 다시 1회
//  ③ 임계값 옵션(minDpi) — 기본 150, 커스텀 반영
//  ④ 대상 필터 — 비이미지/시스템/가이드/장식(frame·overlay·clipping·guideline)/
//     excludeFromExport 제외, **배경(background)은 포함**
//  ⑤ 엘리먼트 미로드 보류 — 상태 오염 없이 로드 후 재판정 가능
//  ⑥ dispose — 리스너 전량 해제
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock (SafeZoneWarningPlugin.test 패턴).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => {
  return {
    fabric: {
      Canvas: class MockCanvas {},
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

import ImageDpiWarningPlugin, { computeEffectiveDpi } from './ImageDpiWarningPlugin'

interface FakeImageInit {
  id?: string
  type?: string
  naturalWidth?: number
  naturalHeight?: number
  /** 원본 엘리먼트 없음(미로드) 시뮬레이션 */
  noElement?: boolean
  scaleX?: number
  scaleY?: number
  extensionType?: string
  excludeFromExport?: boolean
  meta?: { system?: boolean }
}

/**
 * fabric.Image 최소 모형 — width/height 는 원본 px(비크롭 규약), 표시 크기는
 * getScaledWidth/Height(= width×scale, 캔버스 150dpi 표시 규약 px).
 */
function makeImage(init: FakeImageInit) {
  const naturalWidth = init.naturalWidth ?? 1500
  const naturalHeight = init.naturalHeight ?? 1500
  const obj: Record<string, unknown> = {
    type: 'image',
    width: naturalWidth,
    height: naturalHeight,
    scaleX: 1,
    scaleY: 1,
    ...init,
    _originalElement: init.noElement ? undefined : { naturalWidth, naturalHeight },
    getScaledWidth() {
      return (obj.width as number) * (obj.scaleX as number)
    },
    getScaledHeight() {
      return (obj.height as number) * (obj.scaleY as number)
    },
  }
  return obj
}

function makeMockCanvas() {
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
    getObjects: () => [] as Array<Record<string, unknown>>,
    requestRenderAll: vi.fn(),
  }
}

function setup(options: { minDpi?: number } = {}) {
  const canvas = makeMockCanvas()
  const editor = { emit: vi.fn() }
  const plugin = new ImageDpiWarningPlugin(canvas as never, editor as never, options)
  return { canvas, editor, plugin }
}

function fireAdded(canvas: ReturnType<typeof makeMockCanvas>, target: Record<string, unknown>) {
  canvas.fire('object:added', { target })
}
function fireModified(canvas: ReturnType<typeof makeMockCanvas>, target: Record<string, unknown>) {
  canvas.fire('object:modified', { target })
}

describe('computeEffectiveDpi — ① 순수 함수 (150dpi 표시 규약)', () => {
  it('원본 px 그대로 표시(스케일 1)면 정확히 150DPI', () => {
    // 1500px 원본을 표시 1500px 에 — mm=254, inch=10 → 1500/10 = 150
    expect(computeEffectiveDpi(1500, 1500, 1500, 1500)).toBe(150)
  })

  it('2배 확대면 75DPI, 절반 축소면 300DPI', () => {
    expect(computeEffectiveDpi(1500, 1500, 3000, 3000)).toBe(75)
    expect(computeEffectiveDpi(1500, 1500, 750, 750)).toBe(300)
  })

  it('가로/세로 중 최악(작은) 축을 반환한다', () => {
    // 가로만 2배 확대 — dpiX=75, dpiY=150 → 75
    expect(computeEffectiveDpi(1500, 1500, 3000, 1500)).toBe(75)
  })

  it('무효 입력(원본/표시 0 이하)은 null (판정 보류)', () => {
    expect(computeEffectiveDpi(0, 1500, 1500, 1500)).toBeNull()
    expect(computeEffectiveDpi(1500, 0, 1500, 1500)).toBeNull()
    expect(computeEffectiveDpi(1500, 1500, 0, 1500)).toBeNull()
    expect(computeEffectiveDpi(1500, 1500, 1500, -10)).toBeNull()
  })
})

describe('ImageDpiWarningPlugin — ② 저해상 진입/회복 전이 + 디바운스', () => {
  it('저해상(150 미만) 진입 시 imageLowDpi 1회 발행 (dpi·objectId payload)', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 }) // 유효 75DPI

    fireAdded(canvas, img)

    expect(editor.emit).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('imageLowDpi', { dpi: 75, objectId: 'img-1' })
  })

  it('저해상 유지 중 반복 modified 는 재발행하지 않는다 (전이 기반 디바운스)', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 })

    fireAdded(canvas, img)
    img.scaleX = 2.5
    img.scaleY = 2.5
    fireModified(canvas, img)
    fireModified(canvas, img)

    expect(editor.emit).toHaveBeenCalledTimes(1)
  })

  it('회복(축소) 전이는 무발행, 재진입이면 다시 1회 발행', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 })

    fireAdded(canvas, img) // 진입 — 1회
    img.scaleX = 1
    img.scaleY = 1
    fireModified(canvas, img) // 회복(150DPI) — 무발행
    expect(editor.emit).toHaveBeenCalledTimes(1)

    img.scaleX = 3
    img.scaleY = 3
    fireModified(canvas, img) // 재진입(50DPI) — 다시 1회
    expect(editor.emit).toHaveBeenCalledTimes(2)
    expect(editor.emit).toHaveBeenLastCalledWith('imageLowDpi', { dpi: 50, objectId: 'img-1' })
  })

  it('경계값: 정확히 150DPI 는 발행하지 않는다 (미만 판정)', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 1, scaleY: 1 }) // 정확히 150

    fireAdded(canvas, img)
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('객체별 독립 추적 — 한 객체 저해상 유지가 다른 객체 발행을 막지 않는다', () => {
    const { canvas, editor } = setup()
    const a = makeImage({ id: 'a', scaleX: 2, scaleY: 2 })
    const b = makeImage({ id: 'b', scaleX: 2, scaleY: 2 })

    fireAdded(canvas, a)
    fireAdded(canvas, b)

    expect(editor.emit).toHaveBeenCalledTimes(2)
  })
})

describe('ImageDpiWarningPlugin — ③ 임계값 옵션', () => {
  it('minDpi 커스텀(300) — 기본 150 이상이어도 300 미만이면 발행', () => {
    const { canvas, editor } = setup({ minDpi: 300 })
    const img = makeImage({ id: 'img-1', scaleX: 1, scaleY: 1 }) // 유효 150DPI

    fireAdded(canvas, img)
    expect(editor.emit).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('imageLowDpi', { dpi: 150, objectId: 'img-1' })
  })

  it('minDpi 완화(72) — 75DPI 는 발행하지 않는다', () => {
    const { canvas, editor } = setup({ minDpi: 72 })
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 }) // 유효 75DPI

    fireAdded(canvas, img)
    expect(editor.emit).not.toHaveBeenCalled()
  })
})

describe('ImageDpiWarningPlugin — ④ 대상 필터', () => {
  it('비이미지 객체는 무시된다', () => {
    const { canvas, editor } = setup()
    const text = makeImage({ id: 't1', type: 'textbox', scaleX: 5, scaleY: 5 })

    fireAdded(canvas, text)
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('시스템/가이드/장식(frame·overlay·clipping·guideline)/excludeFromExport 는 무시된다', () => {
    const { canvas, editor } = setup()
    const targets = [
      makeImage({ id: 'workspace', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'cutline-template', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'f1', extensionType: 'frame', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'o1', extensionType: 'overlay', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'c1', extensionType: 'clipping', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'g1', extensionType: 'guideline', scaleX: 2, scaleY: 2 }),
      makeImage({ id: 'x1', excludeFromExport: true, scaleX: 2, scaleY: 2 }),
      makeImage({ id: 's1', meta: { system: true }, scaleX: 2, scaleY: 2 }),
    ]

    targets.forEach((t) => fireAdded(canvas, t))
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('배경(extensionType background)은 인쇄되므로 경고 대상에 **포함**된다', () => {
    const { canvas, editor } = setup()
    const bg = makeImage({ id: 'bg-1', extensionType: 'background', scaleX: 2, scaleY: 2 })

    fireAdded(canvas, bg)
    expect(editor.emit).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('imageLowDpi', { dpi: 75, objectId: 'bg-1' })
  })

  it('사진틀 채움 사진(fillImage)은 사용자 이미지 — 경고 대상에 포함된다', () => {
    const { canvas, editor } = setup()
    const fill = makeImage({ id: 'fill-1', extensionType: 'fillImage', scaleX: 2, scaleY: 2 })

    fireAdded(canvas, fill)
    expect(editor.emit).toHaveBeenCalledTimes(1)
  })
})

describe('ImageDpiWarningPlugin — ⑤ 엘리먼트 미로드 보류 + ⑥ dispose', () => {
  it('원본 엘리먼트 미로드면 판정 보류 — 로드 후 재판정 시 정상 발행 (상태 오염 없음)', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2, noElement: true })

    fireAdded(canvas, img) // 미로드 — 보류
    expect(editor.emit).not.toHaveBeenCalled()

    img._originalElement = { naturalWidth: 1500, naturalHeight: 1500 }
    fireModified(canvas, img) // 로드 후 재판정 — 진입 전이로 발행
    expect(editor.emit).toHaveBeenCalledTimes(1)
  })

  it('natural 0(로딩 중 엘리먼트)도 보류된다', () => {
    const { canvas, editor } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 })
    img._originalElement = { naturalWidth: 0, naturalHeight: 0 }

    fireAdded(canvas, img)
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('dispose — 리스너 전량 해제 + 이후 이벤트 무반응', () => {
    const { canvas, editor, plugin } = setup()
    const img = makeImage({ id: 'img-1', scaleX: 2, scaleY: 2 })

    plugin.dispose()

    const listeners = canvas.__eventListeners
    for (const ev of ['object:added', 'object:modified']) {
      expect(listeners[ev] ?? []).toHaveLength(0)
    }
    fireAdded(canvas, img)
    expect(editor.emit).not.toHaveBeenCalled()
  })
})
