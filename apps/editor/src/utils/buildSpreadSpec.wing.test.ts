/**
 * 표지 날개(wing) 주문 옵션 오버라이드 규칙 (2026-08-03).
 *
 * 배경: 날개는 종전까지 spread 템플릿의 `spreadConfig.spec` 에만 존재하는 **정적 값**이라,
 * 같은 표지 템플릿을 쓰면서 상품별로 날개 유무를 가르는 운영이 불가능했다.
 * (embed 파라미터·주문 옵션·TemplateSet 어디에도 날개가 없었고, `options.coverWing` 은
 *  선언만 있고 소비처가 0건인 죽은 필드였다.)
 *
 * 이 스펙은 "주문 옵션 > 템플릿" 우선순위와, **폭 없이 켜지 않는다**는 안전 규칙을 잠근다.
 * 폭 0 으로 켜면 computeLayout 이 폭 ≤0 영역을 skip 해 "켰는데 안 보이는" 상태가 된다.
 */
import { describe, it, expect } from 'vitest'
import { resolveWingOverride } from './buildSpreadSpec'

const base = { wingEnabled: false, wingWidthMm: 0 }
const baseOn = { wingEnabled: true, wingWidthMm: 60 }

describe('resolveWingOverride — 주문 옵션 날개 오버라이드', () => {
  it('오버라이드 미전달 → 템플릿 값 그대로 (기존 동작 불변)', () => {
    expect(resolveWingOverride(base, {})).toEqual({ wingEnabled: false, wingWidthMm: 0 })
    expect(resolveWingOverride(baseOn, {})).toEqual({ wingEnabled: true, wingWidthMm: 60 })
  })

  it('날개 없는 템플릿 + 상품이 날개 사용 → 폭이 함께 오면 켜진다', () => {
    expect(resolveWingOverride(base, { wingEnabled: true, wingWidthMm: 80 })).toEqual({
      wingEnabled: true,
      wingWidthMm: 80,
    })
  })

  it('폭 없이 켜기는 거부한다 — 폭 0 영역은 렌더에서 skip 되어 무성의한 상태가 된다', () => {
    expect(resolveWingOverride(base, { wingEnabled: true })).toEqual({
      wingEnabled: false,
      wingWidthMm: 0,
    })
    expect(resolveWingOverride(base, { wingEnabled: true, wingWidthMm: 0 })).toEqual({
      wingEnabled: false,
      wingWidthMm: 0,
    })
  })

  it('날개 있는 템플릿 + 상품이 날개 미사용 → 끈다', () => {
    expect(resolveWingOverride(baseOn, { wingEnabled: false })).toEqual({
      wingEnabled: false,
      wingWidthMm: 60,
    })
  })

  it('폭만 전달 → 템플릿의 사용여부는 유지하고 폭만 교체', () => {
    expect(resolveWingOverride(baseOn, { wingWidthMm: 100 })).toEqual({
      wingEnabled: true,
      wingWidthMm: 100,
    })
    // 템플릿이 꺼져 있으면 폭만 와도 켜지지 않는다(의도치 않은 총폭 변경 방지)
    expect(resolveWingOverride(base, { wingWidthMm: 100 })).toEqual({
      wingEnabled: false,
      wingWidthMm: 100,
    })
  })

  it('유효하지 않은 폭(음수/NaN)은 무시하고 템플릿 폭을 유지한다', () => {
    expect(resolveWingOverride(baseOn, { wingWidthMm: -5 })).toEqual({
      wingEnabled: true,
      wingWidthMm: 60,
    })
    expect(resolveWingOverride(baseOn, { wingWidthMm: Number.NaN })).toEqual({
      wingEnabled: true,
      wingWidthMm: 60,
    })
  })
})
