import { describe, it, expect } from 'vitest'
import type { SpreadInnerSpec, SpreadSpec } from '@storige/types'
import { computeSpreadOutputDimensions, SPREAD_CONFIG_VERSION } from '@storige/types'
import {
  buildInnerSpreadSpec,
  buildInnerSpreadConfig,
  spreadCountFromPageCount,
  pageCountFromSpreads,
  deriveSpreadPairs,
  formatPairLabel,
  innerSpecToPlaceholderSpec,
  computeInnerContentSizeMm,
  computeCoverOutputSizeMm,
  computeLivePageCount,
  resolveTemplateSetCoverMeta,
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
    // Track 1 (2026-07-06): SpreadConfig.version 1→2 (caseBind/출력 사이즈 세대)
    expect(cfg.version).toBe(2)
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

// ────────────────────────────────────────────────────────────────────────────
// Track 1 (2026-07-06) — 출력 계약 헬퍼 (D-1 · D-4 · D-3)
// ────────────────────────────────────────────────────────────────────────────

const innerSpec190: SpreadInnerSpec = {
  pageWidthMm: 190,
  pageHeightMm: 190,
  gutterMm: 10,
  cutSizeMm: 3,
  safeSizeMm: 5,
  dpi: 150,
}

const coverSpec: SpreadSpec = {
  coverWidthMm: 210,
  coverHeightMm: 297,
  spineWidthMm: 10,
  wingEnabled: false,
  wingWidthMm: 0,
  cutSizeMm: 3,
  safeSizeMm: 3,
  dpi: 150,
}

describe('computeInnerContentSizeMm (D-1 1단계)', () => {
  it("regionScope='inner' + innerSpec → 2-up trim(pageW×2 × pageH) — content.pdf 1페이지=1펼침면", () => {
    const size = computeInnerContentSizeMm({ regionScope: 'inner', innerSpec: innerSpec190 })
    expect(size).toEqual({ widthMm: 380, heightMm: 190 })
  })

  it('비-inner(cover/미지정) → null (BOOK/LEAFLET 기존 경로 byte-parity)', () => {
    expect(computeInnerContentSizeMm({ regionScope: 'cover', spec: coverSpec })).toBeNull()
    expect(computeInnerContentSizeMm({ spec: coverSpec })).toBeNull()
    expect(computeInnerContentSizeMm(null)).toBeNull()
    expect(computeInnerContentSizeMm(undefined)).toBeNull()
  })

  it('inner 인데 innerSpec 누락/비유효 → null (폴백 체인 유지)', () => {
    expect(computeInnerContentSizeMm({ regionScope: 'inner' })).toBeNull()
    expect(
      computeInnerContentSizeMm({
        regionScope: 'inner',
        innerSpec: { ...innerSpec190, pageWidthMm: NaN },
      }),
    ).toBeNull()
    expect(
      computeInnerContentSizeMm({
        regionScope: 'inner',
        innerSpec: { ...innerSpec190, pageHeightMm: 0 },
      }),
    ).toBeNull()
  })
})

describe('computeSpreadOutputDimensions (D-4, @storige/types)', () => {
  it('caseBind 無 → computeSpreadDimensions 와 동일값(기존 출력 byte-parity)', () => {
    expect(computeSpreadOutputDimensions(coverSpec)).toEqual({
      totalWidthMm: 430,
      totalHeightMm: 297,
    })
  })

  it('caseBind 有 → 폭 = trim + board×2 + (turnIn+wrap)×2, 높이 = trim + (turnIn+wrap)×2', () => {
    const dims = computeSpreadOutputDimensions({
      ...coverSpec,
      caseBind: { boardThicknessMm: 2.5, turnInMm: 15, wrapMarginMm: 5 },
    })
    expect(dims.totalWidthMm).toBe(430 + 5 + 40) // 475
    expect(dims.totalHeightMm).toBe(297 + 40) // 337
  })

  it('caseBind 비유효(음수/NaN) → 기존값(미설정 간주)', () => {
    expect(
      computeSpreadOutputDimensions({
        ...coverSpec,
        caseBind: { boardThicknessMm: -1, turnInMm: 15, wrapMarginMm: 5 },
      }),
    ).toEqual({ totalWidthMm: 430, totalHeightMm: 297 })
  })
})

describe('computeCoverOutputSizeMm (D-4 편집기측)', () => {
  const caseBind = { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 5 }

  it('caseBind 有 cover config → wrap 포함 출력 사이즈', () => {
    const size = computeCoverOutputSizeMm({
      regionScope: 'cover',
      spec: { ...coverSpec, caseBind },
    })
    expect(size).toEqual({ widthMm: 474, heightMm: 337 })
  })

  it('regionScope 미지정(레거시 cover)도 caseBind 있으면 동일 적용', () => {
    expect(computeCoverOutputSizeMm({ spec: { ...coverSpec, caseBind } })).toEqual({
      widthMm: 474,
      heightMm: 337,
    })
  })

  it('caseBind 無/config null/inner → null (기존 totalWidthMm 출력 byte-parity)', () => {
    expect(computeCoverOutputSizeMm({ spec: coverSpec })).toBeNull()
    expect(computeCoverOutputSizeMm(null)).toBeNull()
    expect(computeCoverOutputSizeMm(undefined)).toBeNull()
    expect(
      computeCoverOutputSizeMm({
        regionScope: 'inner',
        innerSpec: innerSpec190,
        spec: { ...coverSpec, caseBind },
      }),
    ).toBeNull()
  })

  it('비정상 spec(NaN) → null (throw 하지 않고 기존 동작 계속)', () => {
    expect(
      computeCoverOutputSizeMm({ spec: { ...coverSpec, coverWidthMm: NaN, caseBind } }),
    ).toBeNull()
  })
})

describe('resolveTemplateSetCoverMeta (D-4 templateSet optional 읽기)', () => {
  it('coverType + coverConfig.caseBind 를 옵셔널 체이닝으로 읽는다', () => {
    const meta = resolveTemplateSetCoverMeta({
      id: 'ts-1',
      coverType: 'hardcover_wrap',
      coverConfig: { caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 5 } },
    })
    expect(meta).toEqual({
      coverType: 'hardcover_wrap',
      coverConfig: { caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 5 } },
    })
  })

  it('coverType 은 자유 문자열 코드(고정 enum 아님) — 신규 코드도 그대로 통과', () => {
    expect(resolveTemplateSetCoverMeta({ coverType: 'leather_premium' })).toEqual({
      coverType: 'leather_premium',
    })
  })

  it('미설정/비유효 caseBind → null 또는 caseBind 생략(기존 동작)', () => {
    expect(resolveTemplateSetCoverMeta({})).toBeNull()
    expect(resolveTemplateSetCoverMeta(null)).toBeNull()
    expect(resolveTemplateSetCoverMeta(undefined)).toBeNull()
    expect(
      resolveTemplateSetCoverMeta({
        coverType: 'ready_made',
        coverConfig: { caseBind: { boardThicknessMm: NaN, turnInMm: 1, wrapMarginMm: 1 } },
      }),
    ).toEqual({ coverType: 'ready_made' })
  })
})

describe('computeLivePageCount (D-3 단일 진실원)', () => {
  it('inner 펼침면: 캔버스 12 → 물리 24페이지 (×2)', () => {
    expect(computeLivePageCount(12, true, 1)).toBe(24)
  })

  it('비-inner(BOOK 등): 캔버스 수 그대로', () => {
    expect(computeLivePageCount(25, false, 1)).toBe(25)
  })

  it('캔버스 0 → fallbackPages 폴백(기존 두 완료 경로 동작과 동일)', () => {
    expect(computeLivePageCount(0, true, 8)).toBe(8)
    expect(computeLivePageCount(0, false, 0)).toBe(1) // fallback 비유효 시 최소 1
  })
})

describe('SPREAD_CONFIG_VERSION 정합', () => {
  it('buildInnerSpreadConfig 는 현재 버전 상수를 쓴다', () => {
    expect(buildInnerSpreadConfig(innerSpec190).version).toBe(SPREAD_CONFIG_VERSION)
  })
})
