import { describe, it, expect, vi, beforeEach } from 'vitest'

// makeFrameInteractive 스파이만 필요 — useImageStore 전체를 가벼운 스텁으로 대체.
const { makeFrameInteractive } = vi.hoisted(() => ({ makeFrameInteractive: vi.fn() }))
vi.mock('@/stores/useImageStore', () => ({
  useImageStore: { getState: () => ({ makeFrameInteractive }) },
}))

import { rebindFrameInteractivity } from './frameInteractive'

const makeEditor = (plugin: unknown) => ({ getPlugin: vi.fn(() => plugin) }) as any
const makeCanvas = (objects: unknown[]) => ({ getObjects: () => objects }) as any

describe('rebindFrameInteractivity', () => {
  beforeEach(() => makeFrameInteractive.mockClear())

  it("extensionType==='frame' 객체마다 makeFrameInteractive 를 호출한다 (비프레임 제외)", () => {
    const plugin = {}
    const f1 = { extensionType: 'frame' }
    const f2 = { extensionType: 'frame' }
    const fill = { extensionType: 'fillImage' }
    const canvas = makeCanvas([f1, fill, f2])
    rebindFrameInteractivity(makeEditor(plugin), canvas)
    expect(makeFrameInteractive).toHaveBeenCalledTimes(2)
    expect(makeFrameInteractive).toHaveBeenCalledWith(canvas, f1, plugin)
    expect(makeFrameInteractive).toHaveBeenCalledWith(canvas, f2, plugin)
  })

  it('editor/canvas 가 없으면 no-op (방어)', () => {
    rebindFrameInteractivity(null, makeCanvas([{ extensionType: 'frame' }]))
    rebindFrameInteractivity(makeEditor({}), null)
    expect(makeFrameInteractive).not.toHaveBeenCalled()
  })

  it('ImageProcessingPlugin 이 없으면 no-op', () => {
    rebindFrameInteractivity(makeEditor(undefined), makeCanvas([{ extensionType: 'frame' }]))
    expect(makeFrameInteractive).not.toHaveBeenCalled()
  })

  it('프레임 객체가 없으면 makeFrameInteractive 미호출', () => {
    rebindFrameInteractivity(makeEditor({}), makeCanvas([{ extensionType: 'image' }, {}]))
    expect(makeFrameInteractive).not.toHaveBeenCalled()
  })
})
