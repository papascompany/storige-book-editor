import { describe, it, expect } from 'vitest'
import { computeEmbedPageState, type EmbedPageStateInput } from './embedPageState'
import { computeLivePageCount } from './photobookSpread'

function input(overrides: Partial<EmbedPageStateInput>): EmbedPageStateInput {
  return {
    canvasCount: 1,
    currentCanvasIndex: 0,
    isSpreadMode: false,
    regionScope: undefined,
    pagesPerCanvas: 1,
    fallbackPages: 1,
    ...overrides,
  }
}

const FIXTURES: ReadonlyArray<readonly [string, EmbedPageStateInput, { pageCount: number; currentPage: number | null }]> = [
  ['U1 낱장(spread 아님) 캔버스 5·3번째', input({ canvasCount: 5, currentCanvasIndex: 2 }), { pageCount: 5, currentPage: 3 }],
  [
    'U2 내지 전용 펼침면 캔버스 10·1번째',
    input({ canvasCount: 10, currentCanvasIndex: 0, isSpreadMode: true, regionScope: 'inner' }),
    { pageCount: 20, currentPage: 1 },
  ],
  [
    'U3 표지+펼침면 내지(pagesPerCanvas 2) 캔버스 11·표지',
    input({ canvasCount: 11, currentCanvasIndex: 0, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 2 }),
    { pageCount: 20, currentPage: 1 },
  ],
  [
    'U4 표지+낱장 내지 spread(pagesPerCanvas 1) 캔버스 21·6번째',
    input({ canvasCount: 21, currentCanvasIndex: 5, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 1 }),
    { pageCount: 20, currentPage: 6 },
  ],
  [
    'U5 표지 단독 spread(pagesPerCanvas 1) 캔버스 1',
    input({ canvasCount: 1, currentCanvasIndex: 0, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 1 }),
    { pageCount: 1, currentPage: 1 },
  ],
  [
    'U6 캔버스 0 → pageCount 는 주문 쪽수, currentPage 는 null',
    input({ canvasCount: 0, currentCanvasIndex: -1, fallbackPages: 24 }),
    { pageCount: 24, currentPage: null },
  ],
]

describe('computeEmbedPageState — getState 쪽수·현재 화면 순번', () => {
  it.each(FIXTURES)('%s', (_label, given, expected) => {
    expect(computeEmbedPageState(given)).toEqual(expected)
  })

  it('U5b 표지 단독 spread 에서 pagesPerCanvas 2 이면 pageCount 2', () => {
    expect(
      computeEmbedPageState(
        input({ canvasCount: 1, currentCanvasIndex: 0, isSpreadMode: true, regionScope: 'cover', pagesPerCanvas: 2 }),
      ),
    ).toEqual({ pageCount: 2, currentPage: 1 })
  })

  it('U7 regionScope inner 는 spread 모드와 무관하게 캔버스당 2쪽', () => {
    expect(computeEmbedPageState(input({ canvasCount: 3, isSpreadMode: false, regionScope: 'inner' })).pageCount).toBe(6)
  })

  it('U7b spread 가 아니면 pagesPerCanvas 를 쓰지 않는다', () => {
    expect(computeEmbedPageState(input({ canvasCount: 4, isSpreadMode: false, pagesPerCanvas: 2 })).pageCount).toBe(4)
  })

  it.each([
    ['-1', -1],
    ['범위 밖', 5],
    ['NaN', Number.NaN],
    ['소수', 1.5],
  ] as const)('U8 편집 대상 위치가 %s 이면 currentPage 는 null 이고 pageCount 는 그대로', (_label, idx) => {
    expect(computeEmbedPageState(input({ canvasCount: 5, currentCanvasIndex: idx }))).toEqual({
      pageCount: 5,
      currentPage: null,
    })
  })

  it('U9 캔버스 0 이면 fallbackPages(24 → 24, 0 → 1)', () => {
    expect(computeEmbedPageState(input({ canvasCount: 0, fallbackPages: 24 })).pageCount).toBe(24)
    expect(computeEmbedPageState(input({ canvasCount: 0, fallbackPages: 0 })).pageCount).toBe(1)
  })

  it.each(FIXTURES)('U10 %s — complete 경로 인자 식과 같은 pageCount', (_label, given) => {
    const count = given.canvasCount
    const expected = computeLivePageCount(
      count,
      given.regionScope === 'inner',
      given.fallbackPages || 1,
      given.isSpreadMode && given.regionScope !== 'inner' && count > 1 ? 1 : 0,
      given.isSpreadMode ? given.pagesPerCanvas : 1,
    )
    expect(computeEmbedPageState(given).pageCount).toBe(expected)
  })
})
