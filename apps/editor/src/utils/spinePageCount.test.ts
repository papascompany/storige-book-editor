import { describe, it, expect } from 'vitest'
import { innerPrintPageCount } from './spineCalculator'

describe('innerPrintPageCount', () => {
  it('표지+내지낱장: 표지 제외 1캔버스=1p', () => {
    expect(
      innerPrintPageCount({ pageListLength: 9, canvasCount: 9, pagesPerCanvas: 1, hasCoverSlot: true }),
    ).toBe(8)
  })

  it('표지+내지펼침면: 표지 제외 1캔버스=2p', () => {
    expect(
      innerPrintPageCount({ pageListLength: 5, canvasCount: 5, pagesPerCanvas: 2, hasCoverSlot: true }),
    ).toBe(8)
  })

  it('표지 없음+내지펼침면: 전 캔버스가 내지', () => {
    expect(
      innerPrintPageCount({ pageListLength: 4, canvasCount: 4, pagesPerCanvas: 2, hasCoverSlot: false }),
    ).toBe(8)
  })
})
