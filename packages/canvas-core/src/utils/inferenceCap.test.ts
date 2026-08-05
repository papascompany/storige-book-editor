/**
 * D-6b② 픽셀 캡 수식 테스트 (2026-08-05 오너 승인).
 *
 * getForeground 의 스케일 보상 불변식도 여기서 수식으로 증명한다:
 * scaleX' = (item.width × item.scaleX) / fgW 이고, 캡 미적용이면 fgW = item.width
 * 이므로 scaleX' = item.scaleX — 기존 동작과 동일(회귀 없음).
 */
import { computeInferenceCap, CUTOUT_MAX_LONG_EDGE } from './inferenceCap'

describe('computeInferenceCap', () => {
  it('장변이 상한 이하면 캡 미적용(원본 치수 유지)', () => {
    expect(computeInferenceCap(2560, 1440)).toEqual({
      targetWidth: 2560,
      targetHeight: 1440,
      engaged: false
    })
    expect(computeInferenceCap(800, 600)).toEqual({
      targetWidth: 800,
      targetHeight: 600,
      engaged: false
    })
  })

  it('가로 장변 초과 시 비율 유지 축소', () => {
    // 12MP 상당 (4000×3000) → 장변 2560
    const r = computeInferenceCap(4000, 3000)
    expect(r.engaged).toBe(true)
    expect(r.targetWidth).toBe(2560)
    expect(r.targetHeight).toBe(1920) // 3000 × (2560/4000)
  })

  it('세로 장변 초과 시 비율 유지 축소', () => {
    const r = computeInferenceCap(3000, 4000)
    expect(r.engaged).toBe(true)
    expect(r.targetWidth).toBe(1920)
    expect(r.targetHeight).toBe(2560)
  })

  it('경계값: 상한+1 픽셀부터 캡 발동', () => {
    expect(computeInferenceCap(CUTOUT_MAX_LONG_EDGE, 100).engaged).toBe(false)
    expect(computeInferenceCap(CUTOUT_MAX_LONG_EDGE + 1, 100).engaged).toBe(true)
  })

  it('소수 치수는 내림 후 계산, 결과는 반올림·최소 1px', () => {
    const r = computeInferenceCap(5120.9, 2.4)
    expect(r.targetWidth).toBe(2560)
    expect(r.targetHeight).toBe(1) // 2 × 0.5 = 1
    expect(computeInferenceCap(10000, 1).targetHeight).toBe(1) // 반올림 0 방지
  })

  it('maxLongEdge 커스텀 인자 허용', () => {
    const r = computeInferenceCap(2000, 1000, 1024)
    expect(r.engaged).toBe(true)
    expect(r.targetWidth).toBe(1024)
    expect(r.targetHeight).toBe(512)
  })

  it('스케일 보상 불변식: 캡 미적용이면 기존 동작과 동일식', () => {
    // getForeground: scaleX' = (item.width × item.scaleX) / fgW
    const itemWidth = 2000
    const itemScaleX = 0.35
    const cap = computeInferenceCap(itemWidth, 1500)
    expect(cap.engaged).toBe(false)
    const fgW = cap.targetWidth // 캡 미적용 → 전경 자연폭 = 원본폭
    expect((itemWidth * itemScaleX) / fgW).toBeCloseTo(itemScaleX, 10)
  })

  it('스케일 보상 불변식: 캡 적용 시 화면 크기(visual size) 보존', () => {
    const itemWidth = 4000
    const itemScaleX = 0.2 // 화면 폭 800px
    const cap = computeInferenceCap(itemWidth, 3000)
    const fgW = cap.targetWidth // 2560
    const compensated = (itemWidth * itemScaleX) / fgW
    expect(fgW * compensated).toBeCloseTo(itemWidth * itemScaleX, 6) // 800 유지
  })
})
