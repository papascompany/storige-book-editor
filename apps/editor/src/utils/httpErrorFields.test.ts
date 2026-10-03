import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { apiErrorCodeOf, httpStatusOf } from './httpErrorFields'
import * as reopen from './embedSessionReopen'

function httpError(status: number, data: unknown): AxiosError {
  const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: cfg,
  })
}

describe('httpErrorFields', () => {
  it('apiErrorCodeOf 는 응답 본문의 비어 있지 않은 code 문자열만 돌려준다', () => {
    expect(apiErrorCodeOf(httpError(400, { code: 'MEMBER_REQUIRED' }))).toBe('MEMBER_REQUIRED')
    expect(apiErrorCodeOf(httpError(400, { code: '' }))).toBeNull()
    expect(apiErrorCodeOf(httpError(400, { code: 7 }))).toBeNull()
    expect(apiErrorCodeOf(httpError(400, null))).toBeNull()
    expect(apiErrorCodeOf(httpError(400, 'plain'))).toBeNull()
    expect(apiErrorCodeOf(new AxiosError('Network Error', 'ERR_NETWORK'))).toBeNull()
    expect(apiErrorCodeOf({ code: 'MEMBER_REQUIRED' })).toBeNull()
  })

  it('httpStatusOf 는 axios 응답 상태 또는 정규화 객체의 숫자 status 를 돌려준다', () => {
    expect(httpStatusOf(httpError(503, {}))).toBe(503)
    expect(httpStatusOf(new AxiosError('Network Error', 'ERR_NETWORK'))).toBeUndefined()
    expect(httpStatusOf({ code: 'SERVER_ERROR', status: 502 })).toBe(502)
    expect(httpStatusOf({ status: '502' })).toBeUndefined()
    expect(httpStatusOf(null)).toBeUndefined()
    expect(httpStatusOf('x')).toBeUndefined()
  })

  it('embedSessionReopen 은 같은 헬퍼를 다시 내보낸다', () => {
    expect(reopen.apiErrorCodeOf).toBe(apiErrorCodeOf)
    expect(reopen.httpStatusOf).toBe(httpStatusOf)
  })
})
