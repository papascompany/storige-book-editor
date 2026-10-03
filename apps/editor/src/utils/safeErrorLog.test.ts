import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { describeError, summarizeError } from './safeErrorLog'

function requestConfig(): InternalAxiosRequestConfig {
  const headers = new AxiosHeaders()
  headers.set('Authorization', 'Bearer jwt-secret')
  headers.set('x-guest-token', 'gt-secret')
  return {
    headers,
    url: '/edit-sessions/guest/sess-1?guestToken=gt-secret',
    data: '{"refreshToken":"rt-secret"}',
  } as InternalAxiosRequestConfig
}

function axios503(): AxiosError {
  const cfg = requestConfig()
  return new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', cfg, undefined, {
    status: 503,
    data: { code: 'X', message: 'server raw' },
    statusText: '',
    headers: {},
    config: cfg,
  })
}

const SECRETS = ['jwt-secret', 'gt-secret', 'rt-secret', 'sess-1', 'server raw']

describe('summarizeError / describeError', () => {
  it('AxiosError 는 종류·상태·code·응답 code·axios 문구만 담고 요청 설정·본문·URL 은 싣지 않는다', () => {
    const err = axios503()
    expect(summarizeError(err)).toEqual({
      kind: 'AxiosError',
      status: 503,
      code: 'ERR_BAD_RESPONSE',
      apiCode: 'X',
      message: 'Request failed with status code 503',
    })
    const line = describeError(err)
    expect(line).toBe(
      'AxiosError status=503 code=ERR_BAD_RESPONSE apiCode=X message="Request failed with status code 503"',
    )
    for (const secret of SECRETS) expect(line).not.toContain(secret)
  })

  it('응답 없는 연결 실패는 상태 없이 code 만 담는다', () => {
    const summary = summarizeError(new AxiosError('Network Error', 'ERR_NETWORK', requestConfig()))
    expect(summary).not.toHaveProperty('status')
    expect(summary).toMatchObject({ kind: 'AxiosError', code: 'ERR_NETWORK', message: 'Network Error' })
  })

  it('정규화 오류 객체는 code·status·message 만 쓰고 원래 오류는 무시한다', () => {
    const normalized = { code: 'SERVER_ERROR', message: '서버 오류', status: 503, originalError: axios503() }
    expect(summarizeError(normalized)).toEqual({
      kind: 'ApiError',
      code: 'SERVER_ERROR',
      status: 503,
      message: '서버 오류',
    })
    const line = describeError(normalized)
    for (const secret of SECRETS) expect(line).not.toContain(secret)
  })

  it('일반 Error 는 이름과 message', () => {
    expect(summarizeError(new TypeError('x'))).toEqual({ kind: 'TypeError', message: 'x' })
    expect(describeError(new TypeError('x'))).toBe('TypeError message="x"')
  })

  it('message 안의 Bearer 값·JWT·토큰 파라미터는 가린다', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'
    const line = describeError(
      new Error(`Bearer abc.def.ghi failed ${jwt} refreshToken=r1 guestToken=g1 "accessToken":"a1"`),
    )
    expect(line).not.toContain('abc.def.ghi')
    expect(line).not.toContain(jwt)
    expect(line).not.toContain('r1')
    expect(line).not.toContain('g1')
    expect(line).not.toContain('a1')
    expect(line).toContain('Bearer [redacted]')
    expect(line).toContain('refreshToken=[redacted]')
  })

  it('긴 message 는 200자로 자른다', () => {
    const summary = summarizeError(new Error('가'.repeat(500)))
    expect(summary.message?.length).toBe(201)
  })

  it('문자열 사유는 message 로, 평범한 객체는 값 없이 요약한다', () => {
    expect(summarizeError('boom')).toEqual({ kind: 'string', message: 'boom' })
    expect(summarizeError({ token: 't' })).toEqual({ kind: 'object' })
    expect(describeError({ token: 't' })).toBe('object')
    expect(describeError(undefined)).toBe('undefined')
    expect(describeError(null)).toBe('null')
  })

  it('읽기만 해도 예외가 나는 값·순환 객체에도 예외 없이 문자열을 돌려준다', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
      },
    )
    expect(() => describeError(hostile)).not.toThrow()
    expect(describeError(hostile)).toBe('[unloggable error]')
    expect(summarizeError(hostile)).toEqual({ kind: 'unloggable' })

    const cyclic: Record<string, unknown> = { code: 'UNKNOWN', message: 'm' }
    cyclic.self = cyclic
    expect(describeError(cyclic)).toBe('ApiError code=UNKNOWN message="m"')
  })
})
