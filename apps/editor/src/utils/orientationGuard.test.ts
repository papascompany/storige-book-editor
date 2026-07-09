import { describe, it, expect } from 'vitest'
import { classifyOrientation, detectOrientationMismatch } from './orientationGuard'

describe('classifyOrientation', () => {
  it('width>height → landscape, height>width → portrait', () => {
    expect(classifyOrientation(297, 210)).toBe('landscape')
    expect(classifyOrientation(210, 297)).toBe('portrait')
  })

  it('|w-h| ≤ tolerance → square (판형 오차 흡수)', () => {
    expect(classifyOrientation(200, 200)).toBe('square')
    expect(classifyOrientation(200, 200.5)).toBe('square') // 기본 tol=1
    expect(classifyOrientation(200, 202)).not.toBe('square')
  })

  it('무효 입력(비수치/음수/0/NaN) → null', () => {
    expect(classifyOrientation(undefined, 297)).toBeNull()
    expect(classifyOrientation(210, null)).toBeNull()
    expect(classifyOrientation(0, 297)).toBeNull()
    expect(classifyOrientation(-1, 297)).toBeNull()
    expect(classifyOrientation(NaN, 297)).toBeNull()
  })
})

describe('detectOrientationMismatch', () => {
  it('가로 주문 + 세로 templateSet(가로셋 미배선 폴백) → 불일치 감지', () => {
    // 고객이 가로 선택 → 297×210 전달, 그러나 세로 templateSet 210×297 로드
    const m = detectOrientationMismatch({ width: 297, height: 210 }, { width: 210, height: 297 })
    expect(m).not.toBeNull()
    expect(m?.requested).toBe('landscape')
    expect(m?.template).toBe('portrait')
    expect(m?.requestedSize).toEqual({ width: 297, height: 210 })
    expect(m?.templateSize).toEqual({ width: 210, height: 297 })
  })

  it('하드커버(210 주문 vs 214 templateSet)도 방향만 보므로 정합 시 불일치 아님', () => {
    // 가로 주문 297×210, 가로 하드커버 templateSet 301×214 — 둘 다 landscape
    expect(detectOrientationMismatch({ width: 297, height: 210 }, { width: 301, height: 214 })).toBeNull()
  })

  it('방향 일치(세로+세로, 가로+가로) → null', () => {
    expect(detectOrientationMismatch({ width: 210, height: 297 }, { width: 210, height: 297 })).toBeNull()
    expect(detectOrientationMismatch({ width: 297, height: 210 }, { width: 297, height: 210 })).toBeNull()
  })

  it('size 미전달(호스트가 width/height 안 보냄) → null (오탐 방지)', () => {
    expect(detectOrientationMismatch(undefined, { width: 210, height: 297 })).toBeNull()
    expect(detectOrientationMismatch({}, { width: 210, height: 297 })).toBeNull()
    expect(detectOrientationMismatch({ width: 210, height: 297 }, undefined)).toBeNull()
  })

  it('정사각 판형(방향 모호) → null (오탐 방지)', () => {
    // 8×8 포토북 등 — 주문 정사각이면 방향 신호 없음
    expect(detectOrientationMismatch({ width: 200, height: 200 }, { width: 210, height: 297 })).toBeNull()
    expect(detectOrientationMismatch({ width: 297, height: 210 }, { width: 200, height: 200 })).toBeNull()
  })
})
