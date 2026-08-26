import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

/**
 * runBulkPageOps — 대량 페이지 생성 구간의 썸네일 배칭 (2026-08-24 §2 ⑤).
 *
 * 배경: 썸네일 debounce 는 200ms 인데 addPage 1회가 그보다 오래 걸린다(재진입 시드 실측
 * ≈390ms/장). 감싸지 않으면 루프 매 반복에서 debounce 가 만료돼 그 시점의 전 캔버스를
 * 재캡처하고, N장 증설이 toDataURL O(N²) 이 된다. 이 스펙이 그 배칭 계약을 고정한다.
 */

let capture = 0

function fakeCanvas(id: string) {
  return {
    id,
    disposed: false,
    getContext: () => ({}),
    getObjects: () => [],
    toDataURL: () => `data:${id}#${++capture}`,
  }
}

describe('useAppStore.runBulkPageOps — 썸네일 캡처 배칭', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    capture = 0
    useAppStore.setState({
      allCanvas: [fakeCanvas('c0'), fakeCanvas('c1')] as never,
      screenshots: [],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** debounce(200ms) 만료를 넘긴다 */
  const settle = () => vi.advanceTimersByTime(500)

  it('평상시엔 debounce 만료마다 캡처한다(대조군)', () => {
    useAppStore.getState().takeCanvasScreenshot()
    settle()
    expect(capture).toBe(2) // 캔버스 2장 전량
    useAppStore.getState().takeCanvasScreenshot()
    settle()
    expect(capture).toBe(4)
  })

  it('구간 안에서는 debounce 가 만료돼도 캡처하지 않고, 종료 시 1회만 캡처한다', async () => {
    const p = useAppStore.getState().runBulkPageOps(async () => {
      for (let i = 0; i < 5; i++) {
        useAppStore.getState().takeCanvasScreenshot()
        // 각 '페이지 추가'가 debounce 창보다 오래 걸리는 상황을 재현
        vi.advanceTimersByTime(400)
      }
      expect(capture).toBe(0) // 구간 내 캡처 0회
    })
    await p
    settle()
    // 5회 요청이 종료 후 전량 캡처 1회(=캔버스 2장)로 접힌다
    expect(capture).toBe(2)
  })

  it('중첩 구간: 안쪽 종료가 바깥 구간을 조기 해제하지 않는다', async () => {
    const app = useAppStore.getState()
    await app.runBulkPageOps(async () => {
      await app.runBulkPageOps(async () => {
        app.takeCanvasScreenshot()
        vi.advanceTimersByTime(400)
      })
      // 안쪽이 끝났어도 바깥 구간이 살아 있으므로 아직 캡처 없음
      vi.advanceTimersByTime(400)
      expect(capture).toBe(0)
    })
    settle()
    expect(capture).toBe(2)
  })

  it('아무 요청도 없던 구간은 종료 시 플러시하지 않는다', async () => {
    // 내지 PDF 앉히기(contentPdfGuide)는 부족분이 0이어도 구간을 무조건 연다.
    // 그때마다 전 캔버스 toDataURL 이 헛돌면 페이지 수에 비례한 낭비가 된다.
    await useAppStore.getState().runBulkPageOps(async () => {
      /* 페이지 증설 없음 */
    })
    settle()
    expect(capture).toBe(0)

    // 다음 평상시 캡처는 정상 동작(플래그가 정지 상태로 남지 않는다)
    useAppStore.getState().takeCanvasScreenshot()
    settle()
    expect(capture).toBe(2)
  })

  it('구간 안에서 예외가 나도 깊이가 풀리고(썸네일 영구 정지 없음) 예외는 전파된다', async () => {
    await expect(
      useAppStore.getState().runBulkPageOps(async () => {
        useAppStore.getState().takeCanvasScreenshot()
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    settle()
    expect(capture).toBe(2) // finally 의 플러시가 돌았다

    // 이후 평상시 동작 복귀
    capture = 0
    useAppStore.getState().takeCanvasScreenshot()
    settle()
    expect(capture).toBe(2)
  })
})
