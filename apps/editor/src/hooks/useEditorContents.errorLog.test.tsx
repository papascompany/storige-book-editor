// @vitest-environment jsdom
//
// useEditorContents 오류 로그 — 콘솔에는 오류 객체 대신 describeError 한 줄 요약만 남긴다.
// 호출자에게는 같은 오류 객체를 그대로 던진다(실패 분류가 원본을 쓴다).
// 픽스처 값은 더미이며 JWT 형태 문자열은 런타임에 조립한다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

const h = vi.hoisted(() => ({
  getTemplateSetWithTemplates: vi.fn<(id: string) => Promise<unknown>>(),
}))

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    templateSetsApi: {
      ...actual.templateSetsApi,
      getTemplateSetWithTemplates: (id: string) => h.getTemplateSetWithTemplates(id),
    },
  }
})

import { useEditorContents } from './useEditorContents'

const JWT = ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(8)].join('.')

function templateSetRequestError(): AxiosError {
  const headers = new AxiosHeaders()
  headers.set('Authorization', `Bearer ${JWT}`)
  const config = { url: '/template-sets/ts1/with-templates', method: 'get', headers } as InternalAxiosRequestConfig
  return new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', config, undefined, {
    status: 503,
    data: { message: 'Service Unavailable' },
    statusText: '',
    headers: {},
    config,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  h.getTemplateSetWithTemplates.mockReset()
})

describe('useEditorContents — 오류 로그 요약', () => {
  it('템플릿셋 조회가 AxiosError(503)로 실패하면 같은 오류 객체로 reject 하고, 로그 인자는 Bearer 값 없는 문자열이다', async () => {
    const err = templateSetRequestError()
    h.getTemplateSetWithTemplates.mockRejectedValue(err)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useEditorContents())
    await expect(result.current.loadTemplateSetEditor({ templateSetId: 'ts1' } as never)).rejects.toBe(err)

    const loadErrorCalls = errorSpy.mock.calls.filter((c) => String(c[0]).includes('Template set editor load error'))
    expect(loadErrorCalls).toHaveLength(1)
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) expect(typeof arg).toBe('string')
    }
    expect(String(loadErrorCalls[0][1]).startsWith('AxiosError status=503')).toBe(true)
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain('Bearer')
    expect(logged).not.toContain(JWT)
  })
})
