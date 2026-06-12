// parseColorValue 방어 회귀 테스트 (A1 적대 리뷰 MINOR-6).
// fabric Gradient 객체(colorStops 만 보유, r/g/b 없음)가 들어오면 종전엔
// { r: undefined, ... } 를 통과시켜 호출처에서 "rgba(undefined,...)" fill 오염을 만들었다.
// r/g/b 비숫자 시 null 을 반환해야 한다.
import { describe, it, expect } from 'vitest'
import { parseColorValue } from './colors'

describe('parseColorValue', () => {
  it('정상 RGB/RGBA 객체는 그대로 통과', () => {
    expect(parseColorValue({ r: 10, g: 20, b: 30 })).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColorValue({ r: 10, g: 20, b: 30, a: 0.5 })).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
  })

  it('r/g/b 가 비숫자인 객체(fabric Gradient 등)는 null — rgba(undefined,...) 오염 방어', () => {
    const gradientLike = {
      type: 'linear',
      coords: { x1: 0, y1: 0, x2: 100, y2: 0 },
      colorStops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    }
    expect(parseColorValue(gradientLike as never)).toBeNull()
    expect(parseColorValue({ r: NaN, g: 0, b: 0 } as never)).toBeNull()
    expect(parseColorValue({ r: '10', g: 20, b: 30 } as never)).toBeNull()
  })

  it('문자열 파싱은 기존 동작 유지(hex/rgb/rgba)', () => {
    expect(parseColorValue('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColorValue('rgba(1,2,3,0.4)')).toEqual({ r: 1, g: 2, b: 3, a: 0.4 })
    expect(parseColorValue('')).toBeNull()
  })
})
