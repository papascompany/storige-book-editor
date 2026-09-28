import { describe, it, expect } from 'vitest'
import { shouldReemitPricing } from './pricingChangeReemit'

describe('shouldReemitPricing (S9 책등 확정값 재발신)', () => {
  it('직전 발신이 없으면 재발신하지 않는다', () => {
    expect(shouldReemitPricing(null, 12.3)).toBe(false)
  })

  it('이미 재발신한(armed=false) 상태면 재발신하지 않는다', () => {
    expect(shouldReemitPricing({ armed: false, spineWidthMm: 10 }, 12.3)).toBe(false)
  })

  it('현재 적용 책등 폭이 없으면 재발신하지 않는다', () => {
    expect(shouldReemitPricing({ armed: true, spineWidthMm: 10 }, undefined)).toBe(false)
  })

  it('직전 발신 값과 같으면 중복이므로 재발신하지 않는다', () => {
    expect(shouldReemitPricing({ armed: true, spineWidthMm: 12.3 }, 12.3)).toBe(false)
  })

  it('재계산으로 책등 폭이 바뀌었으면 재발신한다', () => {
    expect(shouldReemitPricing({ armed: true, spineWidthMm: 10 }, 12.3)).toBe(true)
  })

  it('직전 payload 에 책등 폭이 없었는데 재계산으로 생기면 재발신한다', () => {
    expect(shouldReemitPricing({ armed: true, spineWidthMm: undefined }, 8)).toBe(true)
  })

  it('0mm 도 유효값으로 비교한다', () => {
    expect(shouldReemitPricing({ armed: true, spineWidthMm: 0 }, 0)).toBe(false)
    expect(shouldReemitPricing({ armed: true, spineWidthMm: 1 }, 0)).toBe(true)
  })
})
