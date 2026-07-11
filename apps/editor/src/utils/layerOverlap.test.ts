import { describe, it, expect } from 'vitest'
import {
  rectsIntersect,
  unionRect,
  overlappingIdSet,
  getAbsoluteAABB,
  type AABB,
} from './layerOverlap'

const rect = (left: number, top: number, width: number, height: number): AABB => ({
  left,
  top,
  width,
  height,
})

describe('rectsIntersect — AABB 교차 판정 (L5-①)', () => {
  it('부분 겹침은 true', () => {
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true)
  })

  it('완전 포함(안쪽 박스)도 true', () => {
    expect(rectsIntersect(rect(0, 0, 100, 100), rect(20, 20, 10, 10))).toBe(true)
    expect(rectsIntersect(rect(20, 20, 10, 10), rect(0, 0, 100, 100))).toBe(true)
  })

  it('완전 분리는 false', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(100, 100, 10, 10))).toBe(false)
  })

  it('경계가 정확히 맞닿기만 하면 false (strict overlap)', () => {
    // 오른쪽 변 접촉
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false)
    // 아래 변 접촉
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 10, 10, 10))).toBe(false)
    // 모서리 점 접촉
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 10, 10, 10))).toBe(false)
  })

  it('축 하나만 겹치면 false (x 겹침 + y 분리)', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 50, 10, 10))).toBe(false)
  })

  it('교환법칙 — 인자 순서 무관', () => {
    const a = rect(0, 0, 30, 30)
    const b = rect(25, 25, 30, 30)
    expect(rectsIntersect(a, b)).toBe(rectsIntersect(b, a))
  })
})

describe('unionRect — 합집합 박스', () => {
  it('빈 목록은 null', () => {
    expect(unionRect([])).toBeNull()
  })

  it('단일 박스는 그대로', () => {
    expect(unionRect([rect(5, 6, 7, 8)])).toEqual(rect(5, 6, 7, 8))
  })

  it('분리된 박스 2개의 외접 박스', () => {
    expect(unionRect([rect(0, 0, 10, 10), rect(90, 40, 10, 10)])).toEqual(rect(0, 0, 100, 50))
  })
})

describe('overlappingIdSet — 겹침 필터 (다중선택=합집합 박스)', () => {
  it('선택 박스와 교차하는 행만 포함', () => {
    const result = overlappingIdSet(
      [rect(0, 0, 100, 100)],
      new Set(['sel']),
      [
        { id: 'sel', rect: rect(0, 0, 100, 100) },
        { id: 'overlap', rect: rect(50, 50, 100, 100) },
        { id: 'far', rect: rect(500, 500, 10, 10) },
      ]
    )
    expect(result).toEqual(new Set(['sel', 'overlap']))
  })

  it('선택된 행은 rect 가 없어도 항상 포함', () => {
    const result = overlappingIdSet([rect(0, 0, 10, 10)], new Set(['sel']), [
      { id: 'sel', rect: null },
    ])
    expect(result.has('sel')).toBe(true)
  })

  it('rect 를 구할 수 없는 비선택 행은 제외(과다 표시 방지)', () => {
    const result = overlappingIdSet([rect(0, 0, 10, 10)], new Set(['sel']), [
      { id: 'sel', rect: rect(0, 0, 10, 10) },
      { id: 'unknown', rect: null },
    ])
    expect(result.has('unknown')).toBe(false)
  })

  it('다중선택은 합집합 박스 기준 — 두 선택 사이 공백 위 요소도 포함', () => {
    // 선택 2개가 좌상/우하로 떨어져 있고, 그 사이(각각과는 비교차)에 요소가 있는 경우
    const between = { id: 'between', rect: rect(40, 40, 20, 20) }
    const result = overlappingIdSet(
      [rect(0, 0, 10, 10), rect(90, 90, 10, 10)],
      new Set(['a', 'b']),
      [
        { id: 'a', rect: rect(0, 0, 10, 10) },
        { id: 'b', rect: rect(90, 90, 10, 10) },
        between,
        { id: 'outside', rect: rect(200, 0, 10, 10) },
      ]
    )
    expect(result).toEqual(new Set(['a', 'b', 'between']))
  })

  it('선택 rect 가 전부 null 이면 선택 행만 남는다', () => {
    const result = overlappingIdSet([], new Set(['sel']), [
      { id: 'sel', rect: rect(0, 0, 10, 10) },
      { id: 'other', rect: rect(0, 0, 10, 10) },
    ])
    expect(result).toEqual(new Set(['sel']))
  })
})

describe('getAbsoluteAABB — fabric getBoundingRect 안전 래퍼', () => {
  it('정상 rect 반환', () => {
    const obj = { getBoundingRect: () => rect(1, 2, 3, 4) }
    expect(getAbsoluteAABB(obj)).toEqual(rect(1, 2, 3, 4))
  })

  it('getBoundingRect(true, true) 로 호출(절대좌표+재계산)', () => {
    let args: unknown[] = []
    const obj = {
      getBoundingRect: (...a: unknown[]) => {
        args = a
        return rect(0, 0, 1, 1)
      },
    }
    getAbsoluteAABB(obj)
    expect(args).toEqual([true, true])
  })

  it('예외·비유한값·미보유는 null', () => {
    expect(
      getAbsoluteAABB({
        getBoundingRect: () => {
          throw new Error('boom')
        },
      })
    ).toBeNull()
    expect(getAbsoluteAABB({ getBoundingRect: () => rect(NaN, 0, 1, 1) })).toBeNull()
    expect(getAbsoluteAABB({})).toBeNull()
    expect(getAbsoluteAABB(null)).toBeNull()
  })
})
