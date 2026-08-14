import { describe, it, expect } from 'vitest'
import {
  boxesOverlapX,
  classifyPdfPageKind,
  innerBleedOverlapMm,
  naiveWorkHalfCentersMm,
  neededInnerCanvases,
  pdfSizeMmFromRaster,
  spreadPdfIndices,
  spreadSeatSlots,
  sheetSeatSlots,
  trimSlotCentersMm,
  uniformMmScale,
  workBoxOnTrimSpread,
  workspacePoint,
} from './contentPdfSeatLayout'

describe('classifyPdfPageKind', () => {
  it('210×210 + bleed 3 → trim / 216×216 → work', () => {
    expect(classifyPdfPageKind(210, 210, 210, 210, 3)).toBe('trim')
    expect(classifyPdfPageKind(216, 216, 210, 210, 3)).toBe('work')
    expect(classifyPdfPageKind(200, 200, 210, 210, 3)).toBe('other')
  })
})

describe('펼침면 블리드 중첩', () => {
  const W = 210
  const H = 297
  const B = 3

  it('작업사이즈 박스는 접힘선에서 안쪽 블리드가 2B 겹친다', () => {
    const left = workBoxOnTrimSpread('left', W, H, B)
    const right = workBoxOnTrimSpread('right', W, H, B)
    expect(left).toEqual({ x: -3, y: -3, width: 216, height: 303 })
    expect(right).toEqual({ x: 207, y: -3, width: 216, height: 303 })
    expect(boxesOverlapX(left, right)).toBe(6)
    expect(boxesOverlapX(left, right)).toBe(innerBleedOverlapMm(B))
    // 재단 오른쪽 끝 = 접힘선
    expect(left.x + left.width - B).toBe(W)
    expect(right.x + B).toBe(W)
  })

  it('재단본 중심은 trim 칸 — 2(W+2B) 반쪽 중심보다 접힘선 쪽으로 B', () => {
    const trim = trimSlotCentersMm(W)
    const naive = naiveWorkHalfCentersMm(W, B)
    expect(trim.left).toBe(105)
    expect(trim.right).toBe(315)
    expect(naive.left).toBe(108)
    expect(naive.right).toBe(324)
    expect(naive.left - trim.left).toBe(B)
    // 왼쪽 작업칸(W+2B)이 통째로 들어가 오른쪽 반쪽 원점이 2B 밀림 → 우측 오차 3B
    expect(naive.right - trim.right).toBe(B * 3)
    const slots = spreadSeatSlots(W, H)
    expect(slots[0].centerFracX * (W * 2)).toBe(trim.left)
    expect(slots[1].centerFracX * (W * 2)).toBe(trim.right)
  })
})

describe('neededInnerCanvases / spreadPdfIndices', () => {
  it('펼침면은 PDF 2장 = 캔버스 1장', () => {
    expect(neededInnerCanvases(50, true)).toBe(25)
    expect(neededInnerCanvases(49, true)).toBe(25)
    expect(neededInnerCanvases(1, true)).toBe(1)
    expect(neededInnerCanvases(8, false)).toBe(8)
  })

  it('펼침면 1 = PDF 1·2 (0-index 0·1)', () => {
    expect(spreadPdfIndices(0)).toEqual({ left: 0, right: 1 })
    expect(spreadPdfIndices(1)).toEqual({ left: 2, right: 3 })
    expect(spreadPdfIndices(0, [4, 5, 0, 1])).toEqual({ left: 4, right: 5 })
  })
})

describe('uniformMmScale', () => {
  it('축 독립 늘리기를 하지 않는다 — 가로는 원본 mm', () => {
    // 110dpi 210mm ≈ 909px, 150dpi 워크스페이스 210mm ≈ 1240px → 150/110
    const imgW = (210 / 25.4) * 110
    const wsW = (210 / 25.4) * 150
    const s = uniformMmScale(imgW, 210, wsW, 210)
    expect(s).toBeCloseTo(150 / 110, 6)
  })

  it('216mm 작업본을 210mm 재단 워크스페이스에 올려도 배율은 동일(실제 mm 유지)', () => {
    const imgW = (216 / 25.4) * 110
    const wsW = (210 / 25.4) * 150
    expect(uniformMmScale(imgW, 216, wsW, 210)).toBeCloseTo(150 / 110, 6)
  })
})

describe('sheetSeatSlots / workspacePoint / raster mm', () => {
  it('단면 슬롯은 정중앙', () => {
    expect(sheetSeatSlots(210, 210)[0]).toMatchObject({
      side: 'full',
      centerFracX: 0.5,
      centerFracY: 0.5,
    })
  })

  it('origin center 워크스페이스의 좌면 중심', () => {
    const pt = workspacePoint(
      { left: 0, top: 0, width: 400, height: 200, originX: 'center', originY: 'center' },
      0.25,
      0.5,
    )
    expect(pt.x).toBe(-100)
    expect(pt.y).toBe(0)
  })

  it('110dpi 래스터에서 mm 복원', () => {
    const size = pdfSizeMmFromRaster((210 / 25.4) * 110, (297 / 25.4) * 110, 110)
    expect(size.width).toBeCloseTo(210, 5)
    expect(size.height).toBeCloseTo(297, 5)
  })
})
