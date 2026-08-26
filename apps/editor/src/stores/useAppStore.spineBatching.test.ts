import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'
import { recalculateSpineWidth } from '@/utils/spineCalculator'

/**
 * debouncedRecalcSpine — 대량 페이지 생성 구간의 책등 재계산 배칭 (2026-08-26 적대검증 후속).
 *
 * 배경: 3ddce60 은 addPage 의 책등 재계산을 debounce(300ms)로 바꾸면 재진입 증설 루프에서
 * "9회 → 1회"로 접힌다고 봤으나, addPage 1회가 실측 ≈390ms 라 타이머가 매 반복 만료된다.
 * 즉 debounce 는 이 루프에서 배칭 도구가 아니다(아래 대조군 스펙이 그 사실을 고정한다).
 * 실제 배칭은 썸네일과 동일한 runBulkPageOps 구간 게이트가 담당한다.
 */

vi.mock('@/utils/spineCalculator', () => ({
  recalculateSpineWidth: vi.fn(async () => ({
    success: true,
    spineWidth: 10,
    pageCount: 2,
    warnings: [],
  })),
}))

const calc = vi.mocked(recalculateSpineWidth)

/** debounce(300ms) 만료를 넘긴다 */
const settle = () => vi.advanceTimersByTime(500)

describe('useAppStore.debouncedRecalcSpine — 대량 구간 배칭', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calc.mockClear()
    useAppStore.setState({ isSpreadMode: true, spineResizeAbortController: null })
  })
  afterEach(() => {
    useAppStore.getState().reset()
    vi.useRealTimers()
  })

  it('대조군: 구간 밖에서 debounce 창(300ms)보다 느린 간격이면 접히지 않는다', () => {
    // addPage 1회 ≈390ms — 재진입 증설 루프의 실제 간격을 재현한다.
    for (let i = 0; i < 9; i++) {
      useAppStore.getState().debouncedRecalcSpine()
      vi.advanceTimersByTime(390)
    }
    settle()
    expect(calc).toHaveBeenCalledTimes(9)
  })

  it('구간 안에서는 발사하지 않고, 종료 후 1회만 발사한다', async () => {
    const p = useAppStore.getState().runBulkPageOps(async () => {
      for (let i = 0; i < 9; i++) {
        useAppStore.getState().debouncedRecalcSpine()
        vi.advanceTimersByTime(390)
      }
      expect(calc).not.toHaveBeenCalled() // 구간 내 API 왕복 0회
    })
    await p
    settle()
    expect(calc).toHaveBeenCalledTimes(1)
  })

  it('구간 진입 전에 걸려 있던 예약도 무효화하고 종료 후 1회로 접는다', async () => {
    useAppStore.getState().debouncedRecalcSpine() // 구간 밖 예약(300ms 타이머)
    const p = useAppStore.getState().runBulkPageOps(async () => {
      useAppStore.getState().debouncedRecalcSpine() // 구간 진입 → 이전 예약 무효화
      vi.advanceTimersByTime(390)
      expect(calc).not.toHaveBeenCalled() // 중간 pageCount 로 발사되지 않는다
    })
    await p
    settle()
    expect(calc).toHaveBeenCalledTimes(1)
  })

  it('중첩 구간: 안쪽 종료가 바깥 구간을 조기 발사시키지 않는다', async () => {
    const app = useAppStore.getState()
    await app.runBulkPageOps(async () => {
      await app.runBulkPageOps(async () => {
        app.debouncedRecalcSpine()
        vi.advanceTimersByTime(390)
      })
      vi.advanceTimersByTime(390)
      expect(calc).not.toHaveBeenCalled()
    })
    settle()
    expect(calc).toHaveBeenCalledTimes(1)
  })

  it('구간 중 요청이 없었으면 종료 시에도 발사하지 않는다', async () => {
    await useAppStore.getState().runBulkPageOps(async () => {
      /* 증설 없음 */
    })
    settle()
    expect(calc).not.toHaveBeenCalled()
  })

  it('비스프레드 모드는 구간 안에서도 예약되지 않는다', async () => {
    useAppStore.setState({ isSpreadMode: false })
    await useAppStore.getState().runBulkPageOps(async () => {
      useAppStore.getState().debouncedRecalcSpine()
      vi.advanceTimersByTime(390)
    })
    settle()
    expect(calc).not.toHaveBeenCalled()
  })

  it('구간 안에서 예외가 나도 접어둔 재계산이 유실되지 않는다', async () => {
    await expect(
      useAppStore.getState().runBulkPageOps(async () => {
        useAppStore.getState().debouncedRecalcSpine()
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    settle()
    expect(calc).toHaveBeenCalledTimes(1)
  })
})
