import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rememberEmbedGuestToken, recallEmbedGuestToken, forgetEmbedGuestToken } from './embedGuestTokenStore'
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
