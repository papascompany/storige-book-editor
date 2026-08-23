import { describe, it, expect } from 'vitest'
import { TemplateType } from '@storige/types'
import { buildPageMeta } from './BookNavigation'

/**
 * buildPageMeta — 펼침면 내지 세트의 SPREAD 분류 (2026-08-23 수정).
 * 종전엔 모든 SPREAD 가 표지로 분류돼 내지 펼침면 8장이 "표지(펼침면)" 표지 그룹이 되었고,
 * 텍스트 패널 "다른 영역으로 이동" 이 내지 8장을 표지 영역으로 나열했다(8/22·8/23 실기 관찰).
 */
const d = (id: string, type: TemplateType) => ({ id, type })

describe('buildPageMeta — SPREAD 분류', () => {
  it('표지 SPREAD + 내지 SPREAD×3: 첫 SPREAD 만 표지, 나머지는 "펼침면 n"(isCover=false)', () => {
    const meta = buildPageMeta([
      d('cover', TemplateType.SPREAD),
      d('p#1', TemplateType.SPREAD),
      d('p#2', TemplateType.SPREAD),
      d('p#3', TemplateType.SPREAD),
    ])
    expect(meta.map((m) => [m.label, m.isCover])).toEqual([
      ['표지(펼침면)', true],
      ['펼침면 1', false],
      ['펼침면 2', false],
      ['펼침면 3', false],
    ])
  })

  it('hasCoverSlot=false(내지 전용 세트): 모든 SPREAD 가 내지 펼침면', () => {
    const meta = buildPageMeta(
      [d('s#1', TemplateType.SPREAD), d('s#2', TemplateType.SPREAD)],
      { hasCoverSlot: false },
    )
    expect(meta.map((m) => [m.label, m.isCover])).toEqual([
      ['펼침면 1', false],
      ['펼침면 2', false],
    ])
  })

  it('표지 SPREAD + 낱장 PAGE 내지: 기존 라벨 불변', () => {
    const meta = buildPageMeta([
      d('cover', TemplateType.SPREAD),
      d('p#1', TemplateType.PAGE),
      d('p#2', TemplateType.PAGE),
    ])
    expect(meta.map((m) => [m.label, m.isCover])).toEqual([
      ['표지(펼침면)', true],
      ['1쪽', false],
      ['2쪽', false],
    ])
  })

  it('분리형 표지(COVER/SPINE/COVER)+내지: 기존 위치 라벨 불변 (회귀 가드)', () => {
    const meta = buildPageMeta([
      d('c1', TemplateType.COVER),
      d('sp', TemplateType.SPINE),
      d('c2', TemplateType.COVER),
      d('p1', TemplateType.PAGE),
    ])
    expect(meta.map((m) => m.label)).toEqual(['뒷표지', '책등', '앞표지', '1쪽'])
    expect(meta.slice(0, 3).every((m) => m.isCover)).toBe(true)
    expect(meta[0].coverPosition).toBe('back-cover')
  })
})
