import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  rememberEmbedGuestToken,
  recallEmbedGuestToken,
  forgetEmbedGuestToken,
  recallEmbedGuestDraft,
  forgetEmbedGuestDraft,
  hasExpiredEmbedGuestToken,
  sameEmbedGuestDraftKey,
  readGuestTokenFragment,
  stripGuestTokenFragment,
} from './embedGuestTokenStore'
import { ADMIN_EDIT_FLAG } from './authTokenStorage'

const KEY = (id: string) => `storige_embed_guest_v1:${id}`
const NOW = new Date('2026-09-30T00:00:00.000Z')
const FUTURE = '2026-10-01T00:00:00.000Z'
const PAST = '2026-09-29T00:00:00.000Z'

describe('embedGuestTokenStore — 탭 단위 게스트 토큰 기억', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('remember → recall 왕복, sessionStorage 에 JSON 레코드로 저장(localStorage 미사용)', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE)
    expect(recallEmbedGuestToken('s1', NOW)).toBe('tok-1')
    expect(JSON.parse(sessionStorage.getItem(KEY('s1')) as string)).toEqual({ guestToken: 'tok-1', expiresAt: FUTURE })
    expect(localStorage.length).toBe(0)
  })

  it('expiresAt 이 null 이면 만료 판정 없이 recall', () => {
    rememberEmbedGuestToken('s1', 'tok-1', null)
    expect(recallEmbedGuestToken('s1', NOW)).toBe('tok-1')
  })

  it('sessionId 별로 격리된다', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE)
    rememberEmbedGuestToken('s2', 'tok-2', FUTURE)
    expect(recallEmbedGuestToken('s1', NOW)).toBe('tok-1')
    expect(recallEmbedGuestToken('s2', NOW)).toBe('tok-2')
    expect(recallEmbedGuestToken('s3', NOW)).toBeNull()
  })

  it('만료(expiresAt <= now) 레코드는 recall 시 삭제되고 null', () => {
    rememberEmbedGuestToken('s1', 'tok-1', PAST)
    expect(recallEmbedGuestToken('s1', NOW)).toBeNull()
    expect(sessionStorage.getItem(KEY('s1'))).toBeNull()

    rememberEmbedGuestToken('s2', 'tok-2', NOW.toISOString())
    expect(recallEmbedGuestToken('s2', NOW)).toBeNull()
    expect(sessionStorage.getItem(KEY('s2'))).toBeNull()
  })

  it('만료로 지운 세션은 hasExpiredEmbedGuestToken 이 true, 다시 기억하면 false', () => {
    expect(hasExpiredEmbedGuestToken('exp-1')).toBe(false)
    rememberEmbedGuestToken('exp-1', 'tok-1', PAST)
    expect(recallEmbedGuestToken('exp-1', NOW)).toBeNull()
    expect(hasExpiredEmbedGuestToken('exp-1')).toBe(true)
    expect(hasExpiredEmbedGuestToken('exp-other')).toBe(false)
    // 만료 표시에는 토큰 값이 없다
    expect(sessionStorage.getItem('storige_embed_guest_expired_v1:exp-1')).toBe('1')

    rememberEmbedGuestToken('exp-1', 'tok-2', FUTURE)
    expect(hasExpiredEmbedGuestToken('exp-1')).toBe(false)
    expect(recallEmbedGuestToken('exp-1', NOW)).toBe('tok-2')
  })

  it('형식 불일치·해석 불가 expiresAt·forget 으로 지운 기록은 만료로 표시하지 않는다', () => {
    sessionStorage.setItem(KEY('exp-bad'), JSON.stringify({ guestToken: 'tok', expiresAt: 'not-a-date' }))
    expect(recallEmbedGuestToken('exp-bad', NOW)).toBeNull()
    expect(hasExpiredEmbedGuestToken('exp-bad')).toBe(false)

    rememberEmbedGuestToken('exp-forget', 'tok', FUTURE)
    forgetEmbedGuestToken('exp-forget')
    expect(recallEmbedGuestToken('exp-forget', NOW)).toBeNull()
    expect(hasExpiredEmbedGuestToken('exp-forget')).toBe(false)
    expect(hasExpiredEmbedGuestToken('')).toBe(false)
  })

  it('파싱 실패·형식 불일치·해석 불가 expiresAt 레코드는 null 이고 삭제된다', () => {
    sessionStorage.setItem(KEY('bad-json'), '{not json')
    sessionStorage.setItem(KEY('no-token'), JSON.stringify({ expiresAt: FUTURE }))
    sessionStorage.setItem(KEY('bad-exp'), JSON.stringify({ guestToken: 'tok', expiresAt: 'not-a-date' }))
    sessionStorage.setItem(KEY('num-exp'), JSON.stringify({ guestToken: 'tok', expiresAt: 123 }))
    for (const id of ['bad-json', 'no-token', 'bad-exp', 'num-exp']) {
      expect(recallEmbedGuestToken(id, NOW)).toBeNull()
      expect(sessionStorage.getItem(KEY(id))).toBeNull()
    }
  })

  it('forget 후 recall 은 null', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE)
    forgetEmbedGuestToken('s1')
    expect(recallEmbedGuestToken('s1', NOW)).toBeNull()
  })

  it('빈 sessionId·빈 토큰은 기록하지 않는다', () => {
    rememberEmbedGuestToken('', 'tok-1', FUTURE)
    rememberEmbedGuestToken('s1', '', FUTURE)
    expect(sessionStorage.length).toBe(0)
    expect(recallEmbedGuestToken('', NOW)).toBeNull()
  })

  it('관리자 편집 탭에서는 recall null, remember 미기록', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE)
    sessionStorage.setItem(ADMIN_EDIT_FLAG, '1')
    expect(recallEmbedGuestToken('s1', NOW)).toBeNull()

    rememberEmbedGuestToken('s2', 'tok-2', FUTURE)
    expect(sessionStorage.getItem(KEY('s2'))).toBeNull()
  })

  it('sessionStorage 접근 예외는 삼킨다(throw 없음, recall null)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    vi.stubGlobal('sessionStorage', throwing)
    expect(() => rememberEmbedGuestToken('s1', 'tok-1', FUTURE)).not.toThrow()
    expect(() => forgetEmbedGuestToken('s1')).not.toThrow()
    expect(recallEmbedGuestToken('s1', NOW)).toBeNull()
  })

  it('sessionStorage 가 없으면 무동작(throw 없음)', () => {
    vi.stubGlobal('sessionStorage', undefined)
    expect(() => rememberEmbedGuestToken('s1', 'tok-1', FUTURE)).not.toThrow()
    expect(recallEmbedGuestToken('s1', NOW)).toBeNull()
  })
})

describe('embedGuestTokenStore — 주문 초안 매핑(주문번호·mode·templateSetId → sessionId)', () => {
  const DRAFT = { orderSeqno: 1234567890123, mode: 'both', templateSetId: 'ts-1' }

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  function draftEntries(): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) as string
      if (k.startsWith('storige_embed_guest_draft_v1:')) out.push([k, sessionStorage.getItem(k) as string])
    }
    return out
  }

  it('토큰 기억과 함께 매핑을 기억하고 recall 은 sessionId 와 토큰을 돌려준다(매핑 값에 토큰 없음)', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toEqual({ sessionId: 's1', guestToken: 'tok-1' })
    const entries = draftEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0][1]).toBe('s1')
    expect(entries[0].join('')).not.toContain('tok-1')
    expect(localStorage.length).toBe(0)
  })

  it('주문번호는 문자열·숫자를 같은 키로 보고, templateSetId 없음·빈 값·null 은 같은 키다', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, { orderSeqno: '1234567890123', mode: 'both', templateSetId: 'ts-1' })
    expect(recallEmbedGuestDraft(DRAFT, NOW)?.sessionId).toBe('s1')

    rememberEmbedGuestToken('s2', 'tok-2', FUTURE, { orderSeqno: 77, mode: 'cover', templateSetId: null })
    expect(recallEmbedGuestDraft({ orderSeqno: 77, mode: 'cover', templateSetId: '' }, NOW)?.sessionId).toBe('s2')
    expect(recallEmbedGuestDraft({ orderSeqno: 77, mode: 'cover' }, NOW)?.sessionId).toBe('s2')
  })

  it('주문번호·mode·templateSetId 가 하나라도 다르면 매핑 없음', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    expect(recallEmbedGuestDraft({ ...DRAFT, orderSeqno: 1234567890124 }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...DRAFT, mode: 'cover' }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...DRAFT, templateSetId: 'ts-2' }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...DRAFT, templateSetId: null }, NOW)).toBeNull()
  })

  it('호스트 범위(부모 출처·사이트 id)가 다르면 매핑 없음, 같으면 매핑을 돌려준다', () => {
    const scoped = { ...DRAFT, hostOrigin: 'https://shop-a.example', siteId: 'site-a' }
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, scoped)
    expect(recallEmbedGuestDraft(scoped, NOW)?.sessionId).toBe('s1')
    expect(recallEmbedGuestDraft({ ...scoped, hostOrigin: 'https://shop-b.example' }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...scoped, siteId: 'site-b' }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...scoped, hostOrigin: null }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft({ ...scoped, siteId: null }, NOW)).toBeNull()
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()
    // 다른 범위의 조회는 기록을 지우지 않는다
    expect(recallEmbedGuestDraft(scoped, NOW)?.sessionId).toBe('s1')
  })

  it('sameEmbedGuestDraftKey 는 매핑 키 기준으로 비교하고 매핑 불가 키는 false', () => {
    expect(sameEmbedGuestDraftKey({ ...DRAFT, orderSeqno: '1234567890123', siteId: '' }, { ...DRAFT, siteId: null })).toBe(
      true,
    )
    expect(sameEmbedGuestDraftKey(DRAFT, { ...DRAFT, mode: 'cover' })).toBe(false)
    expect(sameEmbedGuestDraftKey(DRAFT, { ...DRAFT, hostOrigin: 'https://shop-a.example' })).toBe(false)
    expect(sameEmbedGuestDraftKey({ ...DRAFT, orderSeqno: 0 }, { ...DRAFT, orderSeqno: 0 })).toBe(false)
  })

  it('주문번호 0·빈 값·mode 없음·draftKey 미전달이면 매핑하지 않는다(토큰 기록은 한다)', () => {
    rememberEmbedGuestToken('s0', 'tok-0', FUTURE, { orderSeqno: 0, mode: 'both', templateSetId: 'ts-1' })
    rememberEmbedGuestToken('s0b', 'tok-0b', FUTURE, { orderSeqno: '0', mode: 'both', templateSetId: 'ts-1' })
    rememberEmbedGuestToken('sn', 'tok-n', FUTURE, { orderSeqno: null, mode: 'both', templateSetId: 'ts-1' })
    rememberEmbedGuestToken('sm', 'tok-m', FUTURE, { orderSeqno: 5, mode: '', templateSetId: 'ts-1' })
    rememberEmbedGuestToken('sx', 'tok-x', FUTURE)
    expect(draftEntries()).toHaveLength(0)
    expect(recallEmbedGuestToken('s0', NOW)).toBe('tok-0')
    expect(recallEmbedGuestDraft({ orderSeqno: 0, mode: 'both', templateSetId: 'ts-1' }, NOW)).toBeNull()
  })

  it('같은 키로 다시 기억하면 마지막 세션으로 바뀐다', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    rememberEmbedGuestToken('s2', 'tok-2', FUTURE, DRAFT)
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toEqual({ sessionId: 's2', guestToken: 'tok-2' })
  })

  it('토큰 기록이 만료됐으면 매핑과 토큰 기록을 지우고 null', () => {
    rememberEmbedGuestToken('s1', 'tok-1', PAST, DRAFT)
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()
    expect(draftEntries()).toHaveLength(0)
    expect(sessionStorage.getItem(KEY('s1'))).toBeNull()
    expect(hasExpiredEmbedGuestToken('s1')).toBe(true)
  })

  it('토큰 기록이 지워졌으면 매핑도 지우고 null', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    forgetEmbedGuestToken('s1')
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()
    expect(draftEntries()).toHaveLength(0)
  })

  it('forgetEmbedGuestDraft 는 매핑만 지우고 토큰 기록은 유지한다', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    forgetEmbedGuestDraft(DRAFT)
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()
    expect(recallEmbedGuestToken('s1', NOW)).toBe('tok-1')
  })

  it('관리자 편집 탭에서는 매핑을 기록·조회하지 않는다', () => {
    rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)
    sessionStorage.setItem(ADMIN_EDIT_FLAG, '1')
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()

    sessionStorage.clear()
    sessionStorage.setItem(ADMIN_EDIT_FLAG, '1')
    rememberEmbedGuestToken('s2', 'tok-2', FUTURE, DRAFT)
    expect(draftEntries()).toHaveLength(0)
  })

  it('sessionStorage 접근 예외·부재는 삼킨다(throw 없음, recall null)', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(() => rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)).not.toThrow()
    expect(() => forgetEmbedGuestDraft(DRAFT)).not.toThrow()
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()

    vi.stubGlobal('sessionStorage', undefined)
    expect(() => rememberEmbedGuestToken('s1', 'tok-1', FUTURE, DRAFT)).not.toThrow()
    expect(recallEmbedGuestDraft(DRAFT, NOW)).toBeNull()
  })
})

describe('readGuestTokenFragment — fragment 게스트 토큰 판독', () => {
  it('guestToken·guest_token 키를 인식하고 값은 디코딩해 돌려준다', () => {
    expect(readGuestTokenFragment('#guestToken=G1')).toBe('G1')
    expect(readGuestTokenFragment('#guest_token=G2')).toBe('G2')
    expect(readGuestTokenFragment('guestToken=G3')).toBe('G3')
    expect(readGuestTokenFragment('#token=A&guestToken=a%2Bb%2Fc%3D')).toBe('a+b/c=')
  })

  it('camelCase 가 snake_case 보다 우선한다', () => {
    expect(readGuestTokenFragment('#guest_token=S&guestToken=C')).toBe('C')
  })

  it("빈 값·'#'만·키 없음·null 은 null", () => {
    expect(readGuestTokenFragment('#guestToken=')).toBeNull()
    expect(readGuestTokenFragment('#')).toBeNull()
    expect(readGuestTokenFragment('')).toBeNull()
    expect(readGuestTokenFragment('#token=A')).toBeNull()
    expect(readGuestTokenFragment(null)).toBeNull()
    expect(readGuestTokenFragment(undefined)).toBeNull()
  })
})

describe('stripGuestTokenFragment — fragment 게스트 토큰 키 제거', () => {
  const BASE = 'https://editor.example/embed?sessionId=s1&token=T'

  it('게스트 토큰 키만 지우고 쿼리와 다른 fragment 키는 보존한다', () => {
    expect(stripGuestTokenFragment(`${BASE}#token=A&guestToken=G`)).toBe(`${BASE}#token=A`)
    expect(stripGuestTokenFragment(`${BASE}#guest_token=G&x=1`)).toBe(`${BASE}#x=1`)
  })

  it("남는 키가 없으면 '#' 도 지운다", () => {
    expect(stripGuestTokenFragment(`${BASE}#guestToken=G`)).toBe(BASE)
    expect(stripGuestTokenFragment(`${BASE}#guestToken=G&guest_token=H`)).toBe(BASE)
  })

  it('해당 키가 없으면 입력을 그대로 돌려준다', () => {
    expect(stripGuestTokenFragment(BASE)).toBe(BASE)
    expect(stripGuestTokenFragment(`${BASE}#token=A`)).toBe(`${BASE}#token=A`)
    expect(stripGuestTokenFragment(`${BASE}#`)).toBe(`${BASE}#`)
  })
})
