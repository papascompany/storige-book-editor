import { describe, it, expect } from 'vitest'
import { readAuthFragment, stripAuthFragment } from './adminEditUrl'
import { describeVersionReason } from './sessionVersions'

describe('readAuthFragment', () => {
  it('#token=..&refreshToken=.. 를 읽는다(URL 인코딩 해제)', () => {
    expect(readAuthFragment('#token=a.b%2Bc&refreshToken=r%3D1')).toEqual({
      token: 'a.b+c',
      refreshToken: 'r=1',
    })
  })

  it('snake_case refresh_token 도 받는다', () => {
    expect(readAuthFragment('#token=t1&refresh_token=r1')).toEqual({ token: 't1', refreshToken: 'r1' })
  })

  it("선행 '#' 없이도 동작한다", () => {
    expect(readAuthFragment('token=t1')).toEqual({ token: 't1' })
  })

  it('토큰이 없거나 빈 값이면 빈 객체', () => {
    expect(readAuthFragment('')).toEqual({})
    expect(readAuthFragment(null)).toEqual({})
    expect(readAuthFragment(undefined)).toEqual({})
    expect(readAuthFragment('#')).toEqual({})
    expect(readAuthFragment('#section=2')).toEqual({})
    expect(readAuthFragment('#token=&refreshToken=')).toEqual({})
  })
})

describe('stripAuthFragment', () => {
  const query = 'https://editor.example.com/embed?sessionId=s-1&adminEdit=session&apiBaseUrl=https%3A%2F%2Fapi.example.com%2Fapi'

  it('토큰 키를 지우고 쿼리는 유지하며 빈 # 는 제거한다', () => {
    const out = stripAuthFragment(`${query}#token=abc&refreshToken=def`)
    expect(out).toBe(query)
    const url = new URL(out)
    expect(url.searchParams.get('sessionId')).toBe('s-1')
    expect(url.searchParams.get('adminEdit')).toBe('session')
    expect(url.searchParams.get('apiBaseUrl')).toBe('https://api.example.com/api')
    expect(url.hash).toBe('')
    expect(out).not.toContain('abc')
    expect(out).not.toContain('def')
  })

  it('다른 fragment 키는 남긴다(snake_case 토큰 키도 제거)', () => {
    const out = stripAuthFragment(`${query}#token=abc&view=2&refresh_token=def`)
    expect(out).toBe(`${query}#view=2`)
  })

  it('토큰이 없는 URL 은 그대로 돌려준다', () => {
    expect(stripAuthFragment(query)).toBe(query)
    expect(stripAuthFragment(`${query}#view=2`)).toBe(`${query}#view=2`)
    expect(stripAuthFragment('/embed?sessionId=s-1')).toBe('/embed?sessionId=s-1')
  })

  it('쿼리의 token 은 건드리지 않는다(fragment 만 대상)', () => {
    const partner = 'https://editor.example.com/embed?sessionId=s-1&token=partner'
    expect(stripAuthFragment(partner)).toBe(partner)
  })
})

describe("버전 사유 'staff-baseline' 표시", () => {
  it('관리자 편집 직전 · info 톤', () => {
    expect(describeVersionReason('staff-baseline')).toEqual({ label: '관리자 편집 직전', tone: 'info' })
    // 기존 사유 표시는 불변
    expect(describeVersionReason('restore')).toEqual({ label: '복원 직전', tone: 'info' })
    expect(describeVersionReason('autosave')).toEqual({ label: '자동 저장', tone: 'neutral' })
  })
})
