import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { apiClient, redactAuthorizationInError } from './client'
import {
  removeAuthToken,
  removeEmbedRefreshToken,
  setAuthToken,
  setEmbedRefreshToken,
} from '@/utils/authTokenStorage'

/**
 * 호출부로 넘기는 최종 오류(재시도 소진·비재시도·인증 만료)는 요청 설정의 Authorization 값이 '[redacted]' 이고,
 * 재시도 요청에는 원래 Authorization 이 실린다. 사일런트 리프레시 실패 경고는 요약 문자열이다.
 */

const ACCESS = 'access-secret'
const REFRESH = 'rt-secret'

function failingAdapter(status: number, seen: string[]): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    seen.push(String(config.headers.Authorization))
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

function expectRedacted(err: AxiosError) {
  expect(axios.isAxiosError(err)).toBe(true)
  expect(err.config?.headers.Authorization).toBe('[redacted]')
  expect(err.response?.config.headers.Authorization).toBe('[redacted]')
  expect(JSON.stringify(err.toJSON())).not.toContain(ACCESS)
}

describe('apiClient — 최종 오류의 Authorization 가림', () => {
  beforeEach(() => {
    setAuthToken(ACCESS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    removeAuthToken()
    removeEmbedRefreshToken()
  })

  it('재시도를 모두 소진한 503 은 Authorization 이 가려진 오류로 거부되고, 재시도 요청에는 원래 값이 실린다', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const seen: string[] = []
    const pending = rejectionOf(apiClient.get('/x', { adapter: failingAdapter(503, seen) }))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen).toEqual(Array(4).fill(`Bearer ${ACCESS}`))
    expect(err.response?.status).toBe(503)
    expectRedacted(err)
  })

  it('재시도하지 않는 오류(404·__noRetry 503)도 Authorization 이 가려진 오류로 거부된다', async () => {
    const seen: string[] = []
    expectRedacted(await rejectionOf(apiClient.get('/x', { adapter: failingAdapter(404, seen) })))
    expectRedacted(
      await rejectionOf(apiClient.get('/x', { adapter: failingAdapter(503, seen), __noRetry: true })),
    )
    expect(seen).toEqual([`Bearer ${ACCESS}`, `Bearer ${ACCESS}`])
  })

  it('인증 만료(401, 갱신 실패)는 Authorization 이 가려진 오류로 거부되고 리프레시 실패 경고는 요약 문자열이다', async () => {
    setEmbedRefreshToken(REFRESH)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      const cfg = { headers: {}, url, data: JSON.stringify({ refreshToken: REFRESH }) } as unknown as InternalAxiosRequestConfig
      throw new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', cfg, undefined, {
        status: 401,
        data: {},
        statusText: '',
        headers: {},
        config: cfg,
      })
    })
    const expired = vi.fn()
    const unsubscribe = apiClient.onAuthExpired(expired)
    const seen: string[] = []

    const err = await rejectionOf(apiClient.get('/x', { adapter: failingAdapter(401, seen) }))
    unsubscribe()

    expect(expired).toHaveBeenCalledTimes(1)
    expectRedacted(err)
    const refreshWarn = warn.mock.calls.find(([first]) => first === '[ApiClient] 사일런트 리프레시 실패:')
    expect(refreshWarn).toBeDefined()
    expect(typeof refreshWarn![1]).toBe('string')
    expect(refreshWarn![1]).toContain('status=401')
    expect(refreshWarn![1]).not.toContain(REFRESH)
    expect(refreshWarn![1]).not.toContain(ACCESS)
  })

  it('redactAuthorizationInError 는 axios 오류가 아니면 아무것도 하지 않고, 여러 번 불러도 결과가 같다', () => {
    expect(() => redactAuthorizationInError(new Error('x'))).not.toThrow()
    expect(() => redactAuthorizationInError(undefined)).not.toThrow()
    const cfg = { headers: { authorization: `Bearer ${ACCESS}` } } as unknown as InternalAxiosRequestConfig
    const err = new AxiosError('m', 'ERR_NETWORK', cfg)
    redactAuthorizationInError(err)
    redactAuthorizationInError(err)
    expect((cfg.headers as unknown as Record<string, string>).authorization).toBe('[redacted]')
  })
})
