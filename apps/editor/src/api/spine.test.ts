import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'

/**
 * spineApi.calculate 의 signal 관통 + isRequestCancelled 판별식 (2026-08-26).
 *
 * 왜 별도 파일인가: `utils/spineRace.test.ts` 는 `@/api/spine` 의 `spineApi` 를 통째로
 * 대체하므로, 거기서는 "spineCalculator 가 2번째 인자로 {signal} 을 넘긴다"까지만 증명된다.
 * **그 signal 이 axios config 로 실제로 넘어가는지**는 무커버리지였고(적대검증 2026-08-26
 * 지적), `spine.ts` 의 포워딩 3줄을 지워도 그 파일 12스펙이 전부 초록이었다.
 *
 * 이 파일이 그 마지막 한 칸을 채운다 — apiClient 를 대체해 3번째 인자(axios config)를 직접
 * 단언한다. 관통이 끊기면 실패 모드는 '스테일 책등 폭'(정확성)이 아니라 '취소된 요청이
 * 소켓·서버를 계속 점유'(자원)지만, 2중 방어의 한 층이 무증상으로 사라지는 건 막아야 한다.
 */

const post = vi.fn()
vi.mock('./client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }))

// 위 mock 이 적용된 뒤 로드해야 한다.
const { spineApi, isRequestCancelled } = await import('./spine')

const PARAMS = { pageCount: 100, paperType: 'mojo_80g', bindingType: 'perfect' }

describe('spineApi.calculate — AbortSignal 관통', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({ data: { spineWidth: 5, paperThickness: 0.1, bindingMargin: 0, warnings: [], formula: 'x' } })
  })

  it('signal 을 주면 axios config 의 signal 로 그대로 전달한다', async () => {
    const controller = new AbortController()
    await spineApi.calculate(PARAMS, { signal: controller.signal })

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, config] = post.mock.calls[0]!
    expect(url).toBe('/products/spine/calculate')
    expect(body).toEqual(PARAMS)
    // 이 단언이 spine.ts 의 포워딩 3줄을 고정한다 — 지우면 여기서만 실패한다.
    expect(config).toEqual({ signal: controller.signal })
  })

  it('전달한 signal 은 동일 인스턴스여야 한다(복제하면 취소가 전파되지 않는다)', async () => {
    const controller = new AbortController()
    await spineApi.calculate(PARAMS, { signal: controller.signal })
    const config = post.mock.calls[0]![2] as { signal: AbortSignal }
    controller.abort()
    expect(config.signal.aborted).toBe(true)
  })

  it('signal 미전달 시 config 를 넘기지 않는다(기존 호출자 비회귀)', async () => {
    await spineApi.calculate(PARAMS)
    expect(post.mock.calls[0]![2]).toBeUndefined()
  })

  it('options 는 있으나 signal 이 없으면 config 를 넘기지 않는다', async () => {
    await spineApi.calculate(PARAMS, {})
    expect(post.mock.calls[0]![2]).toBeUndefined()
  })

  it('응답 body 를 그대로 반환한다', async () => {
    const r = await spineApi.calculate(PARAMS)
    expect(r.spineWidth).toBe(5)
  })
})

describe('isRequestCancelled — 취소/타임아웃 판별', () => {
  it('axios CanceledError 를 취소로 판정한다 (name 은 AbortError 가 아니다)', () => {
    const err = new axios.CanceledError('canceled')
    expect(err.name).not.toBe('AbortError') // 이름 비교식이 왜 안 되는지 고정
    expect(isRequestCancelled(err)).toBe(true)
  })

  it('__CANCEL__ 없이 code 만 ERR_CANCELED 인 객체도 취소로 판정한다(폴백 분기)', () => {
    // axios.isCancel 은 __CANCEL__ 플래그를 보므로 이 객체에서는 false 다 —
    // 두 번째 분기가 없으면 이 케이스가 새 나간다.
    const plain = { code: 'ERR_CANCELED', message: 'canceled' }
    expect(axios.isCancel(plain)).toBe(false)
    expect(isRequestCancelled(plain)).toBe(true)
  })

  it('타임아웃(ECONNABORTED)은 취소가 아니다 — 에러로 남아야 한다', () => {
    expect(isRequestCancelled({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })).toBe(false)
  })

  it('일반 에러·null·undefined 는 취소가 아니다', () => {
    expect(isRequestCancelled(new Error('boom'))).toBe(false)
    expect(isRequestCancelled(null)).toBe(false)
    expect(isRequestCancelled(undefined)).toBe(false)
  })
})
