import { describe, it, expect } from 'vitest'
import type { SpreadInnerSpec } from '@storige/types'
import {
  buildInnerSpreadSpec,
  buildInnerSpreadConfig,
  spreadCountFromPageCount,
  pageCountFromSpreads,
  deriveSpreadPairs,
  formatPairLabel,
  innerSpecToPlaceholderSpec,
} from './photobookSpread'

// ────────────────────────────────────────────────────────────────────────────
// buildInnerSpreadSpec
// ────────────────────────────────────────────────────────────────────────────

describe('buildInnerSpreadSpec', () => {
  it('치수만 주면 나머지를 기본값(gutter0/cut3/safe5/dpi150)으로 채운다', () => {
    const spec = buildInnerSpreadSpec({ pageWidthMm: 210, pageHeightMm: 297 })
    expect(spec).toEqual({
      pageWidthMm: 210,
      pageHeightMm: 297,
      gutterMm: 0,
      cutSizeMm: 3,
      safeSizeMm: 5,
      dpi: 150,
    })
  })

  it('명시값이 기본값보다 우선한다', () => {
    const spec = buildInnerSpreadSpec({
      pageWidthMm: 200,
      pageHeightMm: 200,
      gutterMm: 8,
      cutSizeMm: 5,
      safeSizeMm: 7,
      dpi: 300,
    })
    expect(spec).toEqual({
      pageWidthMm: 200,
      pageHeightMm: 200,
      gutterMm: 8,
      cutSizeMm: 5,
      safeSizeMm: 7,
      dpi: 300,
    })
  })

  it('pageWidthMm ≤ 0 이면 throw', () => {
    expect(() => buildInnerSpreadSpec({ pageWidthMm: 0, pageHeightMm: 297 })).toThrow(
      'buildInnerSpreadSpec: pageWidthMm/pageHeightMm 는 양수여야 합니다',
    )
    expect(() => buildInnerSpreadSpec({ pageWidthMm: -10, pageHeightMm: 297 })).toThrow()
  })

  it('dpi ≤ 0 이면 throw', () => {
    expect(() => buildInnerSpreadSpec({ pageWidthMm: 210, pageHeightMm: 297, dpi: 0 })).toThrow(
      'buildInnerSpreadSpec: dpi 는 양수여야 합니다',
    )
    expect(() =>
      buildInnerSpreadSpec({ pageWidthMm: 210, pageHeightMm: 297, dpi: -150 }),
    ).toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// buildInnerSpreadConfig
// ────────────────────────────────────────────────────────────────────────────

describe('buildInnerSpreadConfig', () => {
  const spec: SpreadInnerSpec = {
    pageWidthMm: 210,
    pageHeightMm: 297,
    gutterMm: 0,
    cutSizeMm: 3,
    safeSizeMm: 5,
    dpi: 150,
  }

  it('regionScope=inner, spec 생략, innerSpec 동일참조, totals/regions 정합', () => {
    const cfg = buildInnerSpreadConfig(spec)
    expect(cfg.version).toBe(1)
    expect(cfg.regionScope).toBe('inner')
    expect(cfg.spec).toBeUndefined()
    expect(cfg.innerSpec).toBe(spec) // 동일 참조
    expect(cfg.totalWidthMm).toBe(spec.pageWidthMm * 2)
    expect(cfg.totalHeightMm).toBe(spec.pageHeightMm)
    expect(cfg.regions).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// spreadCountFromPageCount / pageCountFromSpreads
// ────────────────────────────────────────────────────────────────────────────

describe('spreadCountFromPageCount', () => {
  it('24 → 12', () => expect(spreadCountFromPageCount(24)).toBe(12))
  it('1 → 1 (홀수 올림)', () => expect(spreadCountFromPageCount(1)).toBe(1))
  it('0 → 0', () => expect(spreadCountFromPageCount(0)).toBe(0))
  it('-3 → 0', () => expect(spreadCountFromPageCount(-3)).toBe(0))
  it('7 → 4 (홀수 올림)', () => expect(spreadCountFromPageCount(7)).toBe(4))
})

describe('pageCountFromSpreads', () => {
  it('12 → 24', () => expect(pageCountFromSpreads(12)).toBe(24))
  it('0 → 0', () => expect(pageCountFromSpreads(0)).toBe(0))
})

// ────────────────────────────────────────────────────────────────────────────
// deriveSpreadPairs
// ────────────────────────────────────────────────────────────────────────────

describe('deriveSpreadPairs', () => {
  it('count=3 → 좌면 우선 페어 3개', () => {
    expect(deriveSpreadPairs(3)).toEqual([
      { pairId: 'spread-1', leftPageNo: 1, rightPageNo: 2 },
      { pairId: 'spread-2', leftPageNo: 3, rightPageNo: 4 },
      { pairId: 'spread-3', leftPageNo: 5, rightPageNo: 6 },
    ])
  })

  it('startPageNo=3 → 첫 페어 {3,4}', () => {
    const pairs = deriveSpreadPairs(2, { startPageNo: 3 })
    expect(pairs[0]).toEqual({ pairId: 'spread-1', leftPageNo: 3, rightPageNo: 4 })
    expect(pairs[1]).toEqual({ pairId: 'spread-2', leftPageNo: 5, rightPageNo: 6 })
  })

  it('count=0 → []', () => expect(deriveSpreadPairs(0)).toEqual([]))

  it('라운드트립 일관성: pages→spreads→pairs 페어 수 = spreadCount', () => {
    const pageCount = 24
    const spreadCount = spreadCountFromPageCount(pageCount)
    const pairs = deriveSpreadPairs(spreadCount)
    expect(pairs).toHaveLength(spreadCount)
    // 마지막 우면 = 총 페이지 수와 정합
    expect(pairs[pairs.length - 1].rightPageNo).toBe(pageCount)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// formatPairLabel
// ────────────────────────────────────────────────────────────────────────────

describe('formatPairLabel', () => {
  it("{1,2} → 'p.1–2' (en-dash)", () => {
    expect(formatPairLabel({ pairId: 'spread-1', leftPageNo: 1, rightPageNo: 2 })).toBe('p.1–2')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// innerSpecToPlaceholderSpec
// ────────────────────────────────────────────────────────────────────────────

describe('innerSpecToPlaceholderSpec', () => {
  const spec: SpreadInnerSpec = {
    pageWidthMm: 210,
    pageHeightMm: 297,
    gutterMm: 10,
    cutSizeMm: 3,
    safeSizeMm: 5,
    dpi: 150,
  }

  it('펼침면 trim(폭=한 면×2, 높이=한 면)·책등0·날개없음으로 합성', () => {
    const ph = innerSpecToPlaceholderSpec(spec)
    expect(ph.coverWidthMm).toBe(420)
    expect(ph.coverHeightMm).toBe(297)
    expect(ph.spineWidthMm).toBe(0)
    expect(ph.wingEnabled).toBe(false)
    expect(ph.wingWidthMm).toBe(0)
  })

  it('dpi/cut/safe 는 innerSpec 값을 그대로 전달', () => {
    const ph = innerSpecToPlaceholderSpec(spec)
    expect(ph.dpi).toBe(150)
    expect(ph.cutSizeMm).toBe(3)
    expect(ph.safeSizeMm).toBe(5)
  })
})
