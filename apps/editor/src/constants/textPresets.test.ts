// textPresets 데이터 무결성 — S-E3
import { describe, it, expect } from 'vitest'
import {
  TEXT_STYLE_PRESETS,
  CURVE_TEXT_PRESETS,
  presetFontSize,
} from './textPresets'

describe('TEXT_STYLE_PRESETS', () => {
  it('제목/부제목/본문 3종, id 유일', () => {
    expect(TEXT_STYLE_PRESETS).toHaveLength(3)
    const ids = TEXT_STYLE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['title', 'subtitle', 'body'])
  })

  it('sizeRatio 는 (0, 0.5] 범위 · 제목 > 부제목 > 본문', () => {
    for (const p of TEXT_STYLE_PRESETS) {
      expect(p.sizeRatio).toBeGreaterThan(0)
      expect(p.sizeRatio).toBeLessThanOrEqual(0.5)
      expect(p.sampleText.length).toBeGreaterThan(0)
    }
    const [title, subtitle, body] = TEXT_STYLE_PRESETS
    expect(title.sizeRatio).toBeGreaterThan(subtitle.sizeRatio)
    expect(subtitle.sizeRatio).toBeGreaterThan(body.sizeRatio)
  })
})

describe('CURVE_TEXT_PRESETS', () => {
  it('곡선 프리셋 4종: 위 아치/아래 아치/웨이브/원형', () => {
    expect(CURVE_TEXT_PRESETS.map((p) => p.id)).toEqual([
      'arc-up',
      'arc-down',
      'wave',
      'circle',
    ])
  })

  it('arc 프리셋은 arcDeg 보유, wave 는 불필요', () => {
    for (const p of CURVE_TEXT_PRESETS) {
      if (p.pathType === 'arc') {
        expect(p.arcDeg).toBeGreaterThanOrEqual(30)
        expect(p.arcDeg).toBeLessThanOrEqual(340)
      }
      expect(p.sizeRatio).toBeGreaterThan(0)
      expect(p.sampleText.length).toBeGreaterThan(0)
    }
    // 원형은 반원보다 큰 각도(원 둘레를 감싼다)
    const circle = CURVE_TEXT_PRESETS.find((p) => p.id === 'circle')!
    expect(circle.arcDeg).toBeGreaterThan(180)
  })
})

describe('presetFontSize', () => {
  it('짧은 변 × 비율 (AppText 기본 텍스트 규약)', () => {
    expect(presetFontSize(1000, 600, 0.1)).toBe(60)
    expect(presetFontSize(600, 1000, 0.1)).toBe(60)
  })

  it('최소 12px 클램프', () => {
    expect(presetFontSize(100, 100, 0.04)).toBe(12)
    expect(presetFontSize(10, 10, 0.04)).toBe(12)
  })
})
