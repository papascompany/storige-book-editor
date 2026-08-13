import { describe, it, expect } from 'vitest'
import {
  classifyPrintTemplate,
  assemblePrintTemplates,
  validatePrintTemplateAssembly,
  expandPrintSeeds,
  filterSwapCandidates,
} from '@storige/types'

const coverSplit = {
  id: 'c1',
  type: 'spread',
  width: 430,
  height: 297,
  spreadConfig: { conversionMode: 'full', spec: { coverWidthMm: 210, coverHeightMm: 297 } },
}
const coverFixed = {
  id: 'c2',
  type: 'spread',
  width: 430,
  height: 297,
  spreadConfig: { conversionMode: 'flat-spread', spec: { coverWidthMm: 210, coverHeightMm: 297 } },
}
const page1 = { id: 'p1', type: 'page', width: 210, height: 297 }
const page2 = { id: 'p2', type: 'page', width: 210, height: 297 }
const innerSpread = {
  id: 'i1',
  type: 'spread',
  spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm: 210, pageHeightMm: 297 } },
}

describe('classifyPrintTemplate', () => {
  it('표지3분할 / 표지펼침면 / 내지낱장 / 내지펼침면', () => {
    expect(classifyPrintTemplate(coverSplit)).toBe('cover-split')
    expect(classifyPrintTemplate(coverFixed)).toBe('cover-fixed')
    expect(classifyPrintTemplate(page1)).toBe('inner-sheet')
    expect(classifyPrintTemplate(innerSpread)).toBe('inner-spread')
  })
})

describe('assemblePrintTemplates', () => {
  it('첫 표지가 기본, 나머지 표지는 풀, 내지는 순서대로 시드', () => {
    const a = assemblePrintTemplates([coverSplit, coverFixed, page1, page2])
    expect(a.coverDefault).toEqual(coverSplit)
    expect(a.coverPool).toHaveLength(2)
    expect(a.innerUnit).toBe('sheet')
    expect(a.innerSeeds).toEqual([page1, page2])
  })

  it('표지 + 내지펼침면을 한 세트로 조립한다', () => {
    const a = assemblePrintTemplates([coverFixed, innerSpread])
    expect(a.coverDefault).toEqual(coverFixed)
    expect(a.innerUnit).toBe('spread')
    expect(a.innerSeeds).toEqual([innerSpread])
  })
})

describe('validatePrintTemplateAssembly', () => {
  it('표지펼침면+표지3분할 혼입은 거부', () => {
    expect(validatePrintTemplateAssembly([coverSplit, coverFixed, page1])).toMatch(/섞을 수 없습니다/)
  })

  it('내지낱장+내지펼침면 혼입은 거부', () => {
    expect(validatePrintTemplateAssembly([coverSplit, page1, innerSpread])).toMatch(/내지낱장과 내지펼침면/)
  })

  it('표지펼침면 + 내지펼침면 n + 표지 교체본은 허용', () => {
    const coverAlt = { ...coverFixed, id: 'c3' }
    expect(validatePrintTemplateAssembly([coverFixed, coverAlt, innerSpread])).toBeNull()
  })

  it('내지펼침면만 있어도 허용 (형식 PAGE 불필요)', () => {
    expect(validatePrintTemplateAssembly([innerSpread])).toBeNull()
  })
})

describe('expandPrintSeeds', () => {
  it('last 는 마지막을 복제', () => {
    expect(expandPrintSeeds([page1, page2], 5, 'last').map((p) => p.id)).toEqual([
      'p1', 'p2', 'p2', 'p2', 'p2',
    ])
  })

  it('cycle 은 시드를 순환', () => {
    expect(expandPrintSeeds([page1, page2], 5, 'cycle').map((p) => p.id)).toEqual([
      'p1', 'p2', 'p1', 'p2', 'p1',
    ])
  })
})

describe('filterSwapCandidates', () => {
  it('연결된 같은 유형·판형만 남긴다', () => {
    const linked = new Set(['c1', 'c2', 'p1'])
    const out = filterSwapCandidates([coverSplit, coverFixed, page1], coverSplit, linked)
    expect(out.map((t) => t.id)).toEqual(['c1'])
  })

  it('내지펼침면은 innerSpec 판형만', () => {
    const otherInner = {
      id: 'i2',
      type: 'spread',
      spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm: 148, pageHeightMm: 210 } },
    }
    const linked = new Set(['i1', 'i2'])
    const out = filterSwapCandidates([innerSpread, otherInner], innerSpread, linked)
    expect(out.map((t) => t.id)).toEqual(['i1'])
  })
})
