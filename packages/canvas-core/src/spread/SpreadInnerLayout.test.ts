import { describe, it, expect } from 'vitest'
import { computeInnerSpreadLayout } from './SpreadLayoutEngine'
import type { SpreadInnerSpec } from '@storige/types'

// 포토북 펼침면 내지(2-up) 레이아웃 (O-2)
const mmToPx = (mm: number, dpi: number) => (mm / 25.4) * dpi

const spec: SpreadInnerSpec = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  gutterMm: 10,
  cutSizeMm: 3,
  safeSizeMm: 5,
  dpi: 150,
}

describe('computeInnerSpreadLayout', () => {
  it('trim 치수 = pageWidth*2 × pageHeight (bleed 제외)', () => {
    const L = computeInnerSpreadLayout(spec)
    expect(L.totalWidthMm).toBe(420)
    expect(L.totalHeightMm).toBe(297)
    expect(L.totalWidthPx).toBeCloseTo(mmToPx(420, 150), 3)
    expect(L.totalHeightPx).toBeCloseTo(mmToPx(297, 150), 3)
  })

  it('좌면/우면 2영역: 폭 동일, 우면 x = pageWidthPx (인접)', () => {
    const L = computeInnerSpreadLayout(spec)
    expect(L.regions).toHaveLength(2)
    const [left, right] = L.regions
    const pageWpx = mmToPx(210, 150)
    expect(left.position).toBe('left-page')
    expect(left.x).toBe(0)
    expect(left.width).toBeCloseTo(pageWpx, 3)
    expect(right.position).toBe('right-page')
    expect(right.x).toBeCloseTo(pageWpx, 3)
    expect(right.width).toBeCloseTo(pageWpx, 3)
    // 우면 우단 = 전체 폭
    expect(right.x + right.width).toBeCloseTo(L.totalWidthPx, 3)
  })

  it('거터 가이드 = 중앙(제본 경계, x=pageWidthPx) + 세로 전체', () => {
    const L = computeInnerSpreadLayout(spec)
    expect(L.gutterGuide.x).toBeCloseTo(mmToPx(210, 150), 3)
    expect(L.gutterGuide.y1).toBe(0)
    expect(L.gutterGuide.y2).toBeCloseTo(L.totalHeightPx, 3)
    expect(L.gutterGuide.type).toBe('region-border')
  })

  it('거터 안전 밴드 px = mmToPx(gutterMm)', () => {
    const L = computeInnerSpreadLayout(spec)
    expect(L.gutterBandPx).toBeCloseTo(mmToPx(10, 150), 3)
  })

  it('gutterMm=0 이면 밴드 0(가이드는 유지)', () => {
    const L = computeInnerSpreadLayout({ ...spec, gutterMm: 0 })
    expect(L.gutterBandPx).toBe(0)
    expect(L.gutterGuide.x).toBeCloseTo(mmToPx(210, 150), 3)
  })

  it('정사각/다른 판형도 좌우 대칭', () => {
    const L = computeInnerSpreadLayout({ ...spec, pageWidthMm: 150, pageHeightMm: 150 })
    expect(L.totalWidthMm).toBe(300)
    expect(L.regions[0].width).toBeCloseTo(L.regions[1].width, 6)
  })
})
