import { describe, it, expect } from 'vitest'
import { formatOriginList, parseOriginList } from './originList'

describe('parseOriginList', () => {
  it('줄바꿈과 콤마를 나눈다', () => {
    expect(parseOriginList('https://www.printy.kr\nhttps://printy.kr')).toEqual([
      'https://www.printy.kr',
      'https://printy.kr',
    ])
    expect(parseOriginList('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  it('입력 중인 한 줄(아직 두 번째 origin 없음)을 유지한다', () => {
    expect(parseOriginList('https://www.printy.kr\n')).toEqual(['https://www.printy.kr'])
  })

  it('빈 값과 배열을 처리한다', () => {
    expect(parseOriginList(null)).toEqual([])
    expect(parseOriginList('')).toEqual([])
    expect(parseOriginList([' https://a.com ', ''])).toEqual(['https://a.com'])
  })
})

describe('formatOriginList', () => {
  it('저장값을 줄바꿈 텍스트로 되돌린다', () => {
    expect(formatOriginList(['https://www.printy.kr', 'https://printy.kr'])).toBe(
      'https://www.printy.kr\nhttps://printy.kr',
    )
    expect(formatOriginList(null)).toBe('')
    expect(formatOriginList([])).toBe('')
  })
})
