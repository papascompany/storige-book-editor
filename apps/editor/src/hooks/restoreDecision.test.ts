import { describe, it, expect } from 'vitest'
import {
  shouldOfferRestore,
  type EmbedLocalBackup,
  type RestoreSessionInfo,
} from './restoreDecision'

/**
 * shouldOfferRestore — 자동저장 복원 제안 판정 순수 함수의 단위테스트.
 *
 * footgun 방어 핵심: 자동 복원 금지. 이 함수는 "사용자에게 물어볼지" 만 결정하며,
 * 서버보다 최신이 아니거나 모호하면 사용자가 판단할 수 있게 confident 플래그로 구분한다.
 */
describe('shouldOfferRestore', () => {
  const SESSION_ID = 'sess-123'

  const makeBackup = (over: Partial<EmbedLocalBackup> = {}): EmbedLocalBackup => ({
    sessionId: SESSION_ID,
    canvasData: { version: '5.3.0', objects: [{ type: 'rect' }] },
    savedAt: '2026-06-13T10:00:00.000Z',
    ...over,
  })

  const makeSession = (over: Partial<RestoreSessionInfo> = {}): RestoreSessionInfo => ({
    id: SESSION_ID,
    updatedAt: '2026-06-13T09:00:00.000Z', // 백업보다 1시간 과거 → 백업이 최신
    ...over,
  })

  describe('백업 없음/데이터 없음 → 무동작', () => {
    it('백업이 null 이면 offer:false', () => {
      expect(shouldOfferRestore(null, makeSession())).toEqual({ offer: false, confident: false })
    })

    it('백업이 undefined 이면 offer:false', () => {
      expect(shouldOfferRestore(undefined, makeSession())).toEqual({
        offer: false,
        confident: false,
      })
    })

    it('canvasData 가 null 이면 offer:false', () => {
      expect(shouldOfferRestore(makeBackup({ canvasData: null }), makeSession())).toEqual({
        offer: false,
        confident: false,
      })
    })

    it('멀티페이지 빈 배열이면 offer:false (데이터 없음 취급)', () => {
      expect(shouldOfferRestore(makeBackup({ canvasData: [] }), makeSession())).toEqual({
        offer: false,
        confident: false,
      })
    })
  })

  describe('세션 불일치 → 무동작', () => {
    it('백업 sessionId 가 현재 세션과 다르면 offer:false', () => {
      const backup = makeBackup({ sessionId: 'other-session' })
      expect(shouldOfferRestore(backup, makeSession())).toEqual({ offer: false, confident: false })
    })

    it('세션이 null 이면 offer:false', () => {
      expect(shouldOfferRestore(makeBackup(), null)).toEqual({ offer: false, confident: false })
    })

    it('세션 id 가 비면 offer:false', () => {
      expect(shouldOfferRestore(makeBackup(), { id: '', updatedAt: null })).toEqual({
        offer: false,
        confident: false,
      })
    })
  })

  describe('시각 비교 — 두 시각 모두 유효', () => {
    it('백업이 서버보다 최신이면 offer:true, confident:true', () => {
      const decision = shouldOfferRestore(makeBackup(), makeSession())
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(true)
      expect(decision.backupAt?.toISOString()).toBe('2026-06-13T10:00:00.000Z')
    })

    it('서버가 백업보다 최신이면 offer:false (후퇴 위험 차단)', () => {
      const session = makeSession({ updatedAt: '2026-06-13T11:00:00.000Z' })
      expect(shouldOfferRestore(makeBackup(), session)).toEqual({ offer: false, confident: false })
    })

    it('서버와 백업이 동시각이면 offer:false (서버가 이미 반영했다고 간주)', () => {
      const session = makeSession({ updatedAt: '2026-06-13T10:00:00.000Z' })
      expect(shouldOfferRestore(makeBackup(), session)).toEqual({ offer: false, confident: false })
    })

    it('멀티페이지 배열 백업도 동일 비교(최신이면 offer:true)', () => {
      const backup = makeBackup({
        canvasData: [{ objects: [] }, { objects: [{ type: 'textbox' }] }],
      })
      const decision = shouldOfferRestore(backup, makeSession())
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(true)
    })
  })

  describe('시각 모호/불가 → 안전측 노출 (confident:false)', () => {
    it('서버 updatedAt 이 없으면 offer:true, confident:false', () => {
      const decision = shouldOfferRestore(makeBackup(), makeSession({ updatedAt: null }))
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(false)
      expect(decision.backupAt?.toISOString()).toBe('2026-06-13T10:00:00.000Z')
    })

    it('서버 updatedAt 이 파싱 불가 문자열이면 offer:true, confident:false', () => {
      const decision = shouldOfferRestore(makeBackup(), makeSession({ updatedAt: 'not-a-date' }))
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(false)
    })

    it('백업 savedAt 이 파싱 불가면 offer:true, confident:false, backupAt 없음', () => {
      const decision = shouldOfferRestore(
        makeBackup({ savedAt: 'garbage' }),
        makeSession({ updatedAt: null }),
      )
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(false)
      expect(decision.backupAt).toBeUndefined()
    })

    it('백업 savedAt 파싱 불가 + 서버 유효해도 confident:false 안전 노출', () => {
      const decision = shouldOfferRestore(makeBackup({ savedAt: '' }), makeSession())
      expect(decision.offer).toBe(true)
      expect(decision.confident).toBe(false)
      expect(decision.backupAt).toBeUndefined()
    })
  })
})
