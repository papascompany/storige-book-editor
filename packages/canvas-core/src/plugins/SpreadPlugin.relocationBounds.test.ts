// SpreadPlugin 객체 자동 재배치 경계(relocationBounds) 단위 테스트.
//
// - 'content'(기본): 콘텐츠(재단) 영역 밖으로 나간 쪽만큼 안쪽으로 이동.
// - 'workspace'    : 표지 범위에서 콘텐츠 ± cutSizeMm/2(워크스페이스 외곽)까지 허용.
//
// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → 최소 mock
// (SpreadPlugin.reposition.test.ts 와 같은 패턴).
import { describe, it, expect, vi } from 'vitest'
import type { fabric as FabricNS } from 'fabric'
import { computeLayout } from '../spread/SpreadLayoutEngine'
import type { SpreadSpec, SpreadLayout, SpreadInnerSpec } from '@storige/types'
import type Editor from '../Editor'

vi.mock('fabric', () => ({
  fabric: {
    Point: class Point {
      x: number
      y: number
      constructor(x: number, y: number) {
        this.x = x
        this.y = y
      }
    },
  },
}))

vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import SpreadPlugin, { type SpreadRelocationBounds } from './SpreadPlugin'

// ============================================================================
// Test Helpers
// ============================================================================

const wrapSpec: SpreadSpec = {
  coverWidthMm: 218,
  coverHeightMm: 305,
  spineWidthMm: 8,
  wingEnabled: false,
  wingWidthMm: 0,
  dpi: 150,
  cutSizeMm: 40,
  safeSizeMm: 3,
}

const mmToPx = (mm: number, dpi: number) => (mm / 25.4) * dpi

interface MockObj {
  meta: Record<string, unknown>
  left: number
  top: number
  width: number
  height: number
  getBoundingRect(absolute?: boolean, calculate?: boolean): {
    left: number
    top: number
    width: number
    height: number
  }
  set(props: { left?: number; top?: number }): void
  setCoords(): void
}

/** left/top 원점 사각형 mock — getBoundingRect = scene bbox. */
function makeObj(left: number, top: number, width: number, height: number): MockObj {
  return {
    meta: {},
    left,
    top,
    width,
    height,
    getBoundingRect() {
      return { left: this.left, top: this.top, width: this.width, height: this.height }
    },
    set(props) {
      if (props.left !== undefined) this.left = props.left
      if (props.top !== undefined) this.top = props.top
    },
    setCoords() {},
  }
}

interface PluginInternals {
  currentLayout: SpreadLayout | null
  checkObjectsOutOfBounds(layout: SpreadLayout, autoRelocate?: boolean): void
  init(spec?: SpreadSpec): void
  initInner(): void
}

function makePlugin(
  objects: MockObj[],
  spec: SpreadSpec,
  relocationBounds?: SpreadRelocationBounds
): { plugin: SpreadPlugin; internals: PluginInternals; layout: SpreadLayout; emit: ReturnType<typeof vi.fn> } {
  const canvas = { getObjects: () => objects, requestRenderAll: () => {} }
  const emit = vi.fn()
  const editor = { emit }
  const plugin = new SpreadPlugin(
    canvas as unknown as FabricNS.Canvas,
    editor as unknown as Editor,
    relocationBounds ? { spec, relocationBounds } : { spec }
  )
  const internals = plugin as unknown as PluginInternals
  const layout = computeLayout(spec)
  internals.currentLayout = layout
  return { plugin, internals, layout, emit }
}

/** 콘텐츠 원점(scene) — 워크스페이스 중앙원점 기준 콘텐츠 좌상단 */
const originOf = (layout: SpreadLayout) => ({ x: -layout.totalWidthPx / 2, y: -layout.totalHeightPx / 2 })

/** 뒤표지 아트를 왼쪽으로만 extendMm 만큼 연장한 객체(세로는 콘텐츠 높이 안). */
function leftExtendedArt(layout: SpreadLayout, extendMm: number, dpi: number): MockObj {
  const o = originOf(layout)
  const ext = mmToPx(extendMm, dpi)
  return makeObj(o.x - ext, o.y + 10, layout.totalWidthPx / 2, layout.totalHeightPx - 20)
}

// ============================================================================
// Tests
// ============================================================================

describe('SpreadPlugin relocationBounds — 객체 자동 재배치 경계', () => {
  it("기본값은 'content'", () => {
    const { plugin } = makePlugin([], wrapSpec)
    expect(plugin.getRelocationBounds()).toBe('content')
  })

  it("'workspace' + cutSize 40: 왼쪽으로 20mm 연장한 아트는 이동하지 않는다", () => {
    const { layout } = makePlugin([], wrapSpec)
    const art = leftExtendedArt(layout, 20, wrapSpec.dpi)
    const before = { left: art.left, top: art.top }
    const { internals, emit } = makePlugin([art], wrapSpec, 'workspace')
    internals.checkObjectsOutOfBounds(layout)
    expect({ left: art.left, top: art.top }).toEqual(before)
    expect(emit).not.toHaveBeenCalled()
  })

  it("'content'(기본): 같은 아트는 콘텐츠 왼쪽 가장자리로 20mm 이동한다", () => {
    const { layout } = makePlugin([], wrapSpec)
    const art = leftExtendedArt(layout, 20, wrapSpec.dpi)
    const before = art.left
    const { internals, emit } = makePlugin([art], wrapSpec)
    internals.checkObjectsOutOfBounds(layout)
    expect(art.left - before).toBeCloseTo(mmToPx(20, wrapSpec.dpi), 6)
    expect(art.left).toBeCloseTo(originOf(layout).x, 6)
    expect(emit).toHaveBeenCalledWith(
      'spreadObjectsOutOfBounds',
      expect.objectContaining({ count: 1, autoRelocated: true })
    )
  })

  it('사방으로 20mm 연장한 대칭 배경은 두 모드 모두 이동하지 않는다', () => {
    const { layout } = makePlugin([], wrapSpec)
    const ext = mmToPx(20, wrapSpec.dpi)
    const o = originOf(layout)
    for (const mode of ['content', 'workspace'] as const) {
      const bg = makeObj(o.x - ext, o.y - ext, layout.totalWidthPx + ext * 2, layout.totalHeightPx + ext * 2)
      const before = { left: bg.left, top: bg.top }
      const { internals } = makePlugin([bg], wrapSpec, mode)
      internals.checkObjectsOutOfBounds(layout)
      expect(bg.left).toBeCloseTo(before.left, 6)
      expect(bg.top).toBeCloseTo(before.top, 6)
    }
  })

  it("'workspace': 왼쪽으로 30mm 넘친 아트는 워크스페이스 왼쪽 가장자리로 이동한다", () => {
    const { layout } = makePlugin([], wrapSpec)
    const art = leftExtendedArt(layout, 30, wrapSpec.dpi)
    const before = art.left
    const { internals } = makePlugin([art], wrapSpec, 'workspace')
    internals.checkObjectsOutOfBounds(layout)
    expect(art.left - before).toBeCloseTo(mmToPx(10, wrapSpec.dpi), 6)
    expect(art.left).toBeCloseTo(originOf(layout).x - mmToPx(20, wrapSpec.dpi), 6)
  })

  it("cutSize 0 이면 'workspace' 도 'content' 와 같은 경계를 쓴다", () => {
    const spec: SpreadSpec = { ...wrapSpec, cutSizeMm: 0 }
    const { layout } = makePlugin([], spec)
    const art = leftExtendedArt(layout, 20, spec.dpi)
    const { internals } = makePlugin([art], spec, 'workspace')
    internals.checkObjectsOutOfBounds(layout)
    expect(art.left).toBeCloseTo(originOf(layout).x, 6)
  })

  it('setRelocationBounds: null/undefined 는 content', () => {
    const { plugin } = makePlugin([], wrapSpec, 'workspace')
    expect(plugin.getRelocationBounds()).toBe('workspace')
    plugin.setRelocationBounds(null)
    expect(plugin.getRelocationBounds()).toBe('content')
    plugin.setRelocationBounds('workspace')
    expect(plugin.getRelocationBounds()).toBe('workspace')
    plugin.setRelocationBounds(undefined)
    expect(plugin.getRelocationBounds()).toBe('content')
  })

  it("adoptCoverSpec: opts 가 없으면 'content', opts.relocationBounds 가 있으면 그 값", () => {
    const { plugin, internals } = makePlugin([], wrapSpec, 'workspace')
    internals.init = vi.fn()
    plugin.adoptCoverSpec(wrapSpec, 'flat-spread')
    expect(plugin.getRelocationBounds()).toBe('content')
    plugin.adoptCoverSpec(wrapSpec, 'flat-spread', { relocationBounds: 'workspace' })
    expect(plugin.getRelocationBounds()).toBe('workspace')
    plugin.adoptCoverSpec(wrapSpec, null, {})
    expect(plugin.getRelocationBounds()).toBe('content')
    expect(internals.init).toHaveBeenCalledTimes(3)
  })

  it("adoptInnerSpec: 'content' 로 리셋", () => {
    const { plugin, internals } = makePlugin([], wrapSpec, 'workspace')
    internals.initInner = vi.fn()
    const innerSpec = {} as unknown as SpreadInnerSpec
    plugin.adoptInnerSpec(innerSpec)
    expect(plugin.getRelocationBounds()).toBe('content')
    expect(internals.initInner).toHaveBeenCalledTimes(1)
  })
})
