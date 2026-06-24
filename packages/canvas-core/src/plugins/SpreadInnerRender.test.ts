// SpreadPlugin 내지(inner) 2-up 펼침면 렌더 단위 테스트 (O-2, 2026-06-24).
//
// 검증 대상: regionScope:'inner' + innerSpec 으로 생성된 SpreadPlugin 의 init() →
//   initInner() 경로가
//     (1) 중앙 거터 제본선(id='spread-gutter-guide', 파란 점선)
//     (2) bleed 경계(id='spread-bleed-border', 빨강 '#e11d48')
//     (3) 거터 안전 밴드(id='spread-gutter-band', gutterMm>0 일 때)
//     (4) 좌/우 면 치수 라벨 2개(meta.system='dimensionLabel')
//   를 캔버스에 추가하고, getContentOrigin/getInnerLayout 이 펼침면 trim 중앙원점/2-region 을
//   반환하며, resizeSpine 이 내지에서 no-op(throw 없음)임을 고정한다.
//
// R1 가드(byte-identical): cover 경로(regionScope 미지정)는 거터를 그리지 않음을 회귀로 고정.
//
// fabric 은 node 환경에서 native canvas 바인딩을 요구해 로드 불가 → 최소 mock.
// (reposition 테스트는 Point 만 mock 했으나, 본 테스트는 add/remove 캡처 + Line/Rect/Text 를 추가한다.)
import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { computeInnerSpreadLayout } from '../spread/SpreadLayoutEngine'
import type { SpreadSpec, SpreadInnerSpec } from '@storige/types'

vi.mock('fabric', () => {
  class Point {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  }
  // Line: 첫 인자 points, 둘째 인자 opts 를 this 에 보존
  class Line {
    points: number[]
    meta: any
    constructor(points: number[], opts: Record<string, any> = {}) {
      this.points = points
      Object.assign(this, opts)
    }
    set(k: string, v: any) {
      ;(this as any)[k] = v
    }
  }
  class Rect {
    meta: any
    constructor(opts: Record<string, any> = {}) {
      Object.assign(this, opts)
    }
    set(k: string, v: any) {
      ;(this as any)[k] = v
    }
  }
  class Text {
    meta: any
    constructor(_text: string, opts: Record<string, any> = {}) {
      ;(this as any).text = _text
      Object.assign(this, opts)
    }
    set(k: string, v: any) {
      ;(this as any)[k] = v
    }
  }
  return { fabric: { Point, Line, Rect, Text } }
})

// Editor 는 DOM 의존(hotkeys/contextMenu)이 있어 mock — initInner 는 emit 만 사용
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import SpreadPlugin from './SpreadPlugin'

// ============================================================================
// Test Helpers
// ============================================================================

const innerSpec: SpreadInnerSpec = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  gutterMm: 10,
  cutSizeMm: 3,
  safeSizeMm: 5,
  dpi: 150,
}

// inner 모드에서도 호출측은 placeholder 표지 spec 을 넘긴다(currentSpec 비-null 불변 계약).
const placeholderSpec: SpreadSpec = {
  coverWidthMm: 420,
  coverHeightMm: 297,
  spineWidthMm: 0,
  wingEnabled: false,
  wingWidthMm: 0,
  dpi: 150,
  cutSizeMm: 3,
  safeSizeMm: 5,
}

// cover 회귀용 — 책등 있는 일반 표지 spec
const coverSpec: SpreadSpec = {
  coverWidthMm: 210,
  coverHeightMm: 297,
  spineWidthMm: 10,
  wingEnabled: false,
  wingWidthMm: 0,
  dpi: 150,
  cutSizeMm: 3,
  safeSizeMm: 3,
}

/** add/remove 를 캡처하는 mock 캔버스 + emit no-op 에디터 */
function makeCanvasAndEditor() {
  const added: any[] = []
  const canvas: any = {
    add: (o: any) => added.push(o),
    remove: (o: any) => {
      const i = added.indexOf(o)
      if (i >= 0) added.splice(i, 1)
    },
    getObjects: () => added,
  }
  const editor: any = { emit: () => {} }
  return { added, canvas, editor }
}

const byId = (added: any[], id: string) => added.filter((o) => o.id === id)

// ============================================================================
// Tests
// ============================================================================

describe('SpreadPlugin inner(2-up) 렌더 — initInner', () => {
  it('(a) 중앙 거터 제본선(spread-gutter-guide): x 좌표 ≈ 0 (중앙)', () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const gutters = byId(added, 'spread-gutter-guide')
    expect(gutters.length).toBe(1)
    const gutter = gutters[0]
    // points = [x, y1, x, y2]; x = origin.x + gutterGuide.x = -totalW/2 + totalW/2 = 0
    expect(gutter.points[0]).toBeCloseTo(0, 6)
    expect(gutter.points[2]).toBeCloseTo(0, 6) // 수직선 — 두 x 동일
    expect(gutter.meta.system).toBe('spreadGuide')
  })

  it('(b) bleed 경계(spread-bleed-border): 존재 + stroke=#e11d48', () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const bleeds = byId(added, 'spread-bleed-border')
    expect(bleeds.length).toBe(1)
    expect(bleeds[0].stroke).toBe('#e11d48')
    expect(bleeds[0].meta.system).toBe('spreadGuide')
  })

  it('(c) 거터 안전 밴드(spread-gutter-band): gutterMm=10>0 이므로 존재', () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const bands = byId(added, 'spread-gutter-band')
    expect(bands.length).toBe(1)
    expect(bands[0].meta.system).toBe('spreadGuide')
  })

  it('(d) 좌/우 면 치수 라벨 2개(meta.system=dimensionLabel)', () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const labels = added.filter((o) => o.meta?.system === 'dimensionLabel')
    expect(labels.length).toBe(2)
    const positions = labels.map((l) => l.meta.regionPosition).sort()
    expect(positions).toEqual(['left-page', 'right-page'])
  })

  it('(e) getContentOrigin = { -totalWidthPx/2, -totalHeightPx/2 } (computeInnerSpreadLayout 기준)', () => {
    const { canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const expected = computeInnerSpreadLayout(innerSpec)
    expect(p.getContentOrigin()).toEqual({
      x: -expected.totalWidthPx / 2,
      y: -expected.totalHeightPx / 2,
    })
  })

  it('(f) getInnerLayout().regions.length === 2', () => {
    const { canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()

    const layout = p.getInnerLayout()
    expect(layout).not.toBeNull()
    expect(layout.regions.length).toBe(2)
    expect(layout.regions.map((r: any) => r.position)).toEqual(['left-page', 'right-page'])
  })

  it('(g) resizeSpine(5): 내지에서 throw 없이 no-op (added 불변 + 경고 로그)', async () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, {
      spec: placeholderSpec,
      regionScope: 'inner',
      innerSpec,
    })
    p.init()
    const beforeCount = added.length

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(p.resizeSpine(5)).resolves.toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }

    // canvas/workspace 접근 전 가드 → added 변화 없음 (mock canvas 라 접근 시 throw 됐을 것)
    expect(added.length).toBe(beforeCount)
    expect(p.getInnerLayout()).not.toBeNull()
  })

  it('(R1 회귀) cover 모드(regionScope 미지정): 거터를 그리지 않음 — 표지 경로 불변', () => {
    const { added, canvas, editor } = makeCanvasAndEditor()
    const p: any = new (SpreadPlugin as any)(canvas, editor, { spec: coverSpec })
    p.init()

    // cover 경로는 거터/안전밴드를 만들지 않는다
    expect(byId(added, 'spread-gutter-guide').length).toBe(0)
    expect(byId(added, 'spread-gutter-band').length).toBe(0)
    // 대신 표지 가이드/라벨/블리드는 그려진다(경로 살아있음 확인)
    expect(byId(added, 'spread-bleed-border').length).toBe(1)
    expect(p.getInnerLayout()).toBeNull()
    expect(p.getLayout()).not.toBeNull()
  })
})
