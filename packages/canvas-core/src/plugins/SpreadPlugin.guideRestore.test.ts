// SpreadPlugin — 세션 복원으로 캔버스가 통째로 바뀐 뒤 책등 가이드를 다시 그리는 판정.
//
// 복원 쪽이 내는 'restoreGuideElements' 이벤트에서, 레이아웃이 있고 그려 둔 가이드·라벨이
// 캔버스에 없을 때만 init() 으로 다시 그린다. 가이드가 그대로 있으면 건드리지 않는다.
//
// fabric 은 node 테스트 환경에서 로드할 수 없어 최소 mock(SpreadPlugin.reposition.test.ts 와 같은 방식).
import { describe, it, expect, vi } from 'vitest'
import { computeLayout } from '../spread/SpreadLayoutEngine'
import type { SpreadSpec } from '@storige/types'

vi.mock('fabric', () => ({ fabric: { Point: class Point {} } }))
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import SpreadPlugin from './SpreadPlugin'

const spec: SpreadSpec = {
  coverWidthMm: 210,
  coverHeightMm: 297,
  spineWidthMm: 10,
  wingEnabled: false,
  wingWidthMm: 0,
  dpi: 150,
  cutSizeMm: 3,
  safeSizeMm: 3,
}

function makePlugin(canvasObjects: unknown[]) {
  const handlers = new Map<string, () => void>()
  const canvas = { getObjects: () => canvasObjects, on: vi.fn(), off: vi.fn(), remove: vi.fn() }
  const editor = {
    emit: vi.fn(),
    on: (name: string, fn: () => void) => handlers.set(name, fn),
    off: (name: string) => handlers.delete(name),
  }
  const plugin: any = new (SpreadPlugin as any)(canvas, editor, { spec })
  plugin.init = vi.fn()
  return { plugin, handlers }
}

describe('SpreadPlugin — 가이드 복원', () => {
  it('mounted 가 가이드 복원 이벤트를 구독하고 destroyed 가 해제한다', async () => {
    const { plugin, handlers } = makePlugin([])
    await plugin.mounted()
    expect(handlers.has('restoreGuideElements')).toBe(true)
    await plugin.destroyed()
    expect(handlers.has('restoreGuideElements')).toBe(false)
  })

  it('레이아웃이 있고 가이드가 캔버스에서 사라졌으면 다시 그린다', async () => {
    const guide = { id: 'spread-guide-0' }
    const label = { text: '210.0mm' }
    const { plugin, handlers } = makePlugin([{ id: 'workspace' }]) // 복원 뒤: 가이드 없음
    await plugin.mounted()
    plugin.currentLayout = computeLayout(spec)
    plugin.guideLines = [guide]
    plugin.dimensionLabels = [label]

    handlers.get('restoreGuideElements')?.()

    expect(plugin.init).toHaveBeenCalledTimes(1)
  })

  it('가이드가 그대로 캔버스에 있으면 다시 그리지 않는다', async () => {
    const guide = { id: 'spread-guide-0' }
    const label = { text: '210.0mm' }
    const { plugin, handlers } = makePlugin([{ id: 'workspace' }, guide, label])
    await plugin.mounted()
    plugin.currentLayout = computeLayout(spec)
    plugin.guideLines = [guide]
    plugin.dimensionLabels = [label]

    handlers.get('restoreGuideElements')?.()

    expect(plugin.init).not.toHaveBeenCalled()
  })

  it('레이아웃이 없으면(펼침면이 아닌 편집) 아무것도 하지 않는다', async () => {
    const { plugin, handlers } = makePlugin([])
    await plugin.mounted()
    plugin.currentLayout = null
    plugin.currentInnerLayout = null

    handlers.get('restoreGuideElements')?.()

    expect(plugin.init).not.toHaveBeenCalled()
  })
})
