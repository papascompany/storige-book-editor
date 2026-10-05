import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { apiClient } from './client'
import { removeAuthToken, setAuthToken } from '@/utils/authTokenStorage'

/**
 * 요청별 재시도 옵션 — __retryStatuses 가 있으면 그 상태 코드만 자동 재시도하고, __noRetry 가 우선한다.
 * 옵션이 없는 요청은 408·429·5xx 를 1s·2s·4s 간격으로 최대 3회 다시 보낸다.
 */

const ACCESS = 'access-secret'

/** 매 요청 시각(가짜 타이머 기준 ms)을 기록하고 같은 상태로 거부하는 adapter */
function failingAdapter(status: number, calls: number[]): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    calls.push(Date.now())
    return Promise.reject(
      new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, undefined, {
        status,
        data: {},
        statusText: '',
        headers: {},
        config,
      }),
    )
  }
}

async function rejectionOf(p: Promise<unknown>): Promise<AxiosError> {
  try {
    await p
  } catch (e) {
    return e as AxiosError
  }
  throw new Error('expected rejection')
}

describe('apiClient — 요청별 재시도 옵션', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    setAuthToken(ACCESS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    removeAuthToken()
  })

  it.each([408, 500, 502, 503, 504])(
    '__retryStatuses:[429] 인 POST 는 %i 응답에서 다시 보내지 않고 한 번만 요청한다',
    async (status) => {
      const calls: number[] = []
      const pending = rejectionOf(
        apiClient.post('/x', {}, { adapter: failingAdapter(status, calls), __retryStatuses: [429] }),
      )
      await vi.runAllTimersAsync()
      const err = await pending

      expect(calls).toHaveLength(1)
      expect(axios.isAxiosError(err)).toBe(true)
      expect(err.response?.status).toBe(status)
      expect(err.config?.headers.Authorization).toBe('[redacted]')
    },
  )

  it('__retryStatuses:[429] 인 POST 는 429 에서 1s·2s·4s 간격으로 최대 3회 다시 보낸다', async () => {
    const calls: number[] = []
    const start = Date.now()
    const pending = rejectionOf(
      apiClient.post('/x', {}, { adapter: failingAdapter(429, calls), __retryStatuses: [429] }),
    )

    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1999)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(3999)
    expect(calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(4)

    const err = await pending
    expect(calls.map((t) => t - start)).toEqual([0, 1000, 3000, 7000])
    expect(err.response?.status).toBe(429)
    expect(err.config?.headers.Authorization).toBe('[redacted]')
  })

  it('옵션 없는 GET 은 504 에서 3회까지 다시 보낸다', async () => {
    const calls: number[] = []
    const pending = rejectionOf(apiClient.get('/x', { adapter: failingAdapter(504, calls) }))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(calls).toHaveLength(4)
    expect(err.response?.status).toBe(504)
  })

  it('__retryStatuses 에 있어도 기본 재시도 상태 코드가 아니면 다시 보내지 않는다', async () => {
    const calls: number[] = []
    const pending = rejectionOf(
      apiClient.post('/x', {}, { adapter: failingAdapter(404, calls), __retryStatuses: [404, 429] }),
    )
    await vi.runAllTimersAsync()
    const err = await pending

    expect(calls).toHaveLength(1)
    expect(err.response?.status).toBe(404)
  })

  it('__noRetry 는 __retryStatuses 보다 우선한다', async () => {
    const calls: number[] = []
    const pending = rejectionOf(
      apiClient.post('/x', {}, { adapter: failingAdapter(429, calls), __noRetry: true, __retryStatuses: [429] }),
    )
    await vi.runAllTimersAsync()
    const err = await pending

    expect(calls).toHaveLength(1)
    expect(err.response?.status).toBe(429)
    expect(err.config?.headers.Authorization).toBe('[redacted]')
  })

  it('응답이 없는 실패는 __retryStatuses 와 상관없이 다시 보내지 않는다', async () => {
    let count = 0
    const adapter: AxiosAdapter = (config) => {
      count += 1
      return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
    }
    const pending = rejectionOf(apiClient.post('/x', {}, { adapter, __retryStatuses: [429] }))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(count).toBe(1)
    expect(err.response).toBeUndefined()
  })
})
