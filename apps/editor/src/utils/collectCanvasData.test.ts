import { describe, it, expect, vi } from 'vitest'
import type { fabric } from 'fabric'

// canvas-core 실모듈(fabric) 로드 없이 기본 props 경로만 검증.
vi.mock('@storige/canvas-core', () => ({
  core: { extendFabricOption: ['id', 'name'] },
}))

import { collectCanvasData } from './collectCanvasData'

interface FakeCanvas {
  toJSON: ReturnType<typeof vi.fn>
}

function fakeCanvas(id: string): FakeCanvas & fabric.Canvas {
  return { toJSON: vi.fn((props: string[]) => ({ id, props })) } as unknown as FakeCanvas & fabric.Canvas
}

describe('collectCanvasData (세션 canvasData 직렬화 단일 진실원)', () => {
  it('allCanvas 0장 + 현재 캔버스 있음 → 단일 객체 (IIFE/레거시 경로 종전과 동일)', () => {
    const canvas = fakeCanvas('cur')
    const out = collectCanvasData([], canvas)
    expect(out).toEqual({ id: 'cur', props: ['id', 'name'] })
    expect(canvas.toJSON).toHaveBeenCalledTimes(1)
  })

  it('allCanvas 1장 → 현재 캔버스 단일 객체 (allCanvas 쪽 toJSON 은 호출하지 않음)', () => {
    const one = fakeCanvas('c0')
    const canvas = fakeCanvas('cur')
    const out = collectCanvasData([one], canvas)
    expect(out).toEqual({ id: 'cur', props: ['id', 'name'] })
    expect(one.toJSON).not.toHaveBeenCalled()
  })

  it('allCanvas 2장 → 순서대로 직렬화한 배열 (현재 캔버스는 사용하지 않음)', () => {
    const a = fakeCanvas('c0')
    const b = fakeCanvas('c1')
    const canvas = fakeCanvas('cur')
    const out = collectCanvasData([a, b], canvas)
    expect(out).toEqual([
      { id: 'c0', props: ['id', 'name'] },
      { id: 'c1', props: ['id', 'name'] },
    ])
    expect(canvas.toJSON).not.toHaveBeenCalled()
  })

  it('canvas null/undefined + allCanvas 0·1장 → null', () => {
    expect(collectCanvasData([], null)).toBeNull()
    expect(collectCanvasData([fakeCanvas('c0')], undefined)).toBeNull()
  })

  it('toJSON 이 falsy 를 반환하면 null (종전 `|| null` 과 동일)', () => {
    const canvas = { toJSON: vi.fn(() => undefined) } as unknown as fabric.Canvas
    expect(collectCanvasData([], canvas)).toBeNull()
  })

  it('props 를 명시하면 단일·배열 모두 그 props 로 toJSON 호출', () => {
    const a = fakeCanvas('c0')
    const b = fakeCanvas('c1')
    const canvas = fakeCanvas('cur')
    collectCanvasData([a, b], canvas, ['x'])
    expect(a.toJSON).toHaveBeenCalledWith(['x'])
    expect(b.toJSON).toHaveBeenCalledWith(['x'])
    collectCanvasData([], canvas, ['y'])
    expect(canvas.toJSON).toHaveBeenCalledWith(['y'])
  })
})
