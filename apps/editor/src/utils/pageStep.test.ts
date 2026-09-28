import { describe, it, expect } from 'vitest'
import {
  normalizePageStep,
  pageAddCanvasCount,
  pageDeleteCanvasCount,
  getPageStepViolation,
  pageStepViolationMessage,
  livePhysicalPageCount,
  pageStepMetric,
  adjacentDeleteIndices,
} from './pageStep'

describe('pageStep 순수 헬퍼 (S8)', () => {
  it('normalizePageStep: >=2 정수만 유효, 나머지는 null(제약 없음)', () => {
    expect(normalizePageStep(2)).toBe(2)
    expect(normalizePageStep('4')).toBe(4)
    expect(normalizePageStep(1)).toBeNull()
    expect(normalizePageStep(0)).toBeNull()
    expect(normalizePageStep(-2)).toBeNull()
    expect(normalizePageStep(2.5)).toBeNull()
    expect(normalizePageStep(null)).toBeNull()
    expect(normalizePageStep(undefined)).toBeNull()
    expect(normalizePageStep('')).toBeNull()
    expect(normalizePageStep('abc')).toBeNull()
  })

  it('step=null 이면 추가/삭제 모두 1장 (기존 동작)', () => {
    expect(pageAddCanvasCount(17, null, 1)).toBe(1)
    expect(pageDeleteCanvasCount(17, null, 2)).toBe(1)
  })

  it('step=2 낱장: 짝수면 2장, 홀수면 1장으로 배수 복귀', () => {
    expect(pageAddCanvasCount(16, 2, 1)).toBe(2)
    expect(pageDeleteCanvasCount(16, 2, 1)).toBe(2)
    expect(pageAddCanvasCount(17, 2, 1)).toBe(1)
    expect(pageDeleteCanvasCount(17, 2, 1)).toBe(1)
  })

  it('step=4 펼침면(2p/장): 정렬 상태 2장, 6p 면 1장', () => {
    expect(pageAddCanvasCount(8, 4, 2)).toBe(2)
    expect(pageAddCanvasCount(6, 4, 2)).toBe(1)
    expect(pageDeleteCanvasCount(6, 4, 2)).toBe(1)
  })

  it('해가 없으면 lcm 단위로 폴백 (step=4, per=2, 홀수 현재값)', () => {
    // 5 + 2k 는 결코 4 의 배수가 아님 → lcm(4,2)/2 = 2장 (잔여 유지)
    expect(pageAddCanvasCount(5, 4, 2)).toBe(2)
  })

  it('getPageStepViolation / 메시지', () => {
    expect(getPageStepViolation(16, 2)).toBeNull()
    expect(getPageStepViolation(17, null)).toBeNull()
    expect(getPageStepViolation(0, 2)).toBeNull()
    const v = getPageStepViolation(17, 2)
    expect(v).toEqual({ current: 17, step: 2, nextValid: 18, prevValid: 16 })
    expect(pageStepViolationMessage(v!)).toBe(
      '내지는 2페이지 단위로만 주문할 수 있습니다. 현재 17페이지 — 18페이지로 추가하거나 16페이지로 줄여 주세요.',
    )
    // 내림 배수가 0 이하 → 추가 안내만
    const v1 = getPageStepViolation(1, 4)!
    expect(v1.prevValid).toBe(4)
    expect(pageStepViolationMessage(v1)).toBe(
      '내지는 4페이지 단위로만 주문할 수 있습니다. 현재 1페이지 — 4페이지로 추가해 주세요.',
    )
  })

  it('livePhysicalPageCount: 완료 payload pageCount 와 같은 기준', () => {
    // 표지+내지 스프레드: 표지 1장 제외
    expect(livePhysicalPageCount({ canvasCount: 18, isSpreadMode: true, regionScope: 'cover' })).toBe(17)
    expect(livePhysicalPageCount({ canvasCount: 18, isSpreadMode: true, regionScope: null })).toBe(17)
    // 표지 단독 세션 → 0 (측정 불가, 가드 미적용)
    expect(livePhysicalPageCount({ canvasCount: 1, isSpreadMode: true, regionScope: null })).toBe(0)
    // 내지 전용 펼침면: ×2
    expect(livePhysicalPageCount({ canvasCount: 9, isSpreadMode: true, regionScope: 'inner' })).toBe(18)
    // 비-스프레드: 캔버스 수
    expect(livePhysicalPageCount({ canvasCount: 3, isSpreadMode: false })).toBe(3)
  })

  it('편집완료 판정: step=2, 호스트가 17p 로 시드하면 차단 / 18p 면 통과', () => {
    const at = (canvasCount: number) =>
      getPageStepViolation(livePhysicalPageCount({ canvasCount, isSpreadMode: true, regionScope: null }), 2)
    expect(at(18)).not.toBeNull() // 표지 + 17p
    expect(at(19)).toBeNull() // 표지 + 18p
  })

  it('pageStepMetric: 가드 산식과 동일한 물리 페이지 + 캔버스당 증감', () => {
    expect(pageStepMetric(3, { isSpreadMode: true, regionScope: 'inner' })).toEqual({ physical: 6, perCanvas: 2 })
    expect(pageStepMetric(4, { isSpreadMode: true, regionScope: 'cover' })).toEqual({ physical: 3, perCanvas: 1 })
    expect(pageStepMetric(1, { isSpreadMode: true, regionScope: null })).toEqual({ physical: 0, perCanvas: 1 })
    expect(pageStepMetric(17, { isSpreadMode: false, regionScope: null })).toEqual({ physical: 17, perCanvas: 1 })
  })

  it('pageStepMetric 기반 단위 이동은 홀수 시드에서도 배수에 도달한다(내지 전용 펼침면, step 4)', () => {
    const basis = { isSpreadMode: true, regionScope: 'inner' }
    for (let canvases = 1; canvases <= 12; canvases++) {
      const { physical, perCanvas } = pageStepMetric(canvases, basis)
      const added = canvases + pageAddCanvasCount(physical, 4, perCanvas)
      expect(pageStepMetric(added, basis).physical % 4).toBe(0)
      const removed = canvases - pageDeleteCanvasCount(physical, 4, perCanvas)
      if (removed > 0) expect(pageStepMetric(removed, basis).physical % 4).toBe(0)
    }
  })

  it('adjacentDeleteIndices: 뒤쪽 우선, 부족하면 앞쪽, 채우지 못하면 []', () => {
    expect(adjacentDeleteIndices(5, 1, 1)).toEqual([1])
    expect(adjacentDeleteIndices(5, 1, 2)).toEqual([1, 2])
    expect(adjacentDeleteIndices(5, 4, 2)).toEqual([4, 3])
    expect(adjacentDeleteIndices(5, 2, 2, (i) => i !== 3 && i !== 1)).toEqual([])
    expect(adjacentDeleteIndices(5, 0, 2, (i) => i !== 0)).toEqual([])
    expect(adjacentDeleteIndices(2, 5, 1)).toEqual([])
  })
})
