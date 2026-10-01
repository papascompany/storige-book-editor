import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

const client = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }))
vi.mock('./client', () => ({
  apiClient: {
    get: (...a: unknown[]) => client.get(...(a as [])),
    patch: (...a: unknown[]) => client.patch(...(a as [])),
    post: (...a: unknown[]) => client.post(...(a as [])),
  },
}))

import { editSessionsApi } from './edit-sessions'

describe('editSessionsApi.getGuest — 게스트 세션 조회', () => {
  beforeEach(() => {
    client.get.mockReset()
  })

  it('GET /edit-sessions/guest/<id> 를 x-guest-token 헤더와 함께 호출하고 응답 본문을 돌려준다', async () => {
    const session = { id: 'sess-1', guestToken: 'tok-1' }
    client.get.mockResolvedValue({ data: session })

    await expect(editSessionsApi.getGuest('sess-1', 'tok-1')).resolves.toEqual(session)

    expect(client.get).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledWith('/edit-sessions/guest/sess-1', {
      headers: { 'x-guest-token': 'tok-1' },
    })
  })

  it('토큰은 URL·쿼리에 싣지 않는다(특수문자 토큰은 헤더 값 원문 그대로)', async () => {
    const token = 'a+b/c=d&e?f g'
    client.get.mockResolvedValue({ data: { id: 'sess-2' } })

    await editSessionsApi.getGuest('sess-2', token)

    const [url, config] = client.get.mock.calls[0] as [string, { headers: Record<string, string>; params?: unknown }]
    expect(url).toBe('/edit-sessions/guest/sess-2')
    expect(url).not.toContain('?')
    expect(url).not.toContain(encodeURIComponent(token))
    expect(config.params).toBeUndefined()
    expect(config.headers['x-guest-token']).toBe(token)
  })

  it('요청 실패는 그대로 reject 한다(호출측이 폴백 판단)', async () => {
    const err = new Error('boom')
    client.get.mockRejectedValue(err)
    await expect(editSessionsApi.getGuest('sess-3', 'tok-3')).rejects.toBe(err)
  })
})

describe('editSessionsApi — 게스트 저장·버전 호출은 x-guest-token 헤더로 토큰을 보낸다', () => {
  const TOKEN = 'a+b/c=d&e?f g'

  beforeEach(() => {
    client.get.mockReset()
    client.patch.mockReset()
    client.post.mockReset()
  })

  function assertNoTokenInUrl(url: string) {
    expect(url).not.toContain('?')
    expect(url).not.toContain(TOKEN)
    expect(url).not.toContain(encodeURIComponent(TOKEN))
  }

  it('updateGuest 는 PATCH /edit-sessions/guest/<id> 를 헤더와 본문으로 보낸다', async () => {
    const session = { id: 'sess-1' }
    client.patch.mockResolvedValue({ data: session })
    const payload = { canvasData: { pages: [] }, status: 'editing' as const }

    await expect(editSessionsApi.updateGuest('sess-1', TOKEN, payload)).resolves.toEqual(session)

    expect(client.patch).toHaveBeenCalledTimes(1)
    const [url, body, config] = client.patch.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; params?: unknown },
    ]
    expect(url).toBe('/edit-sessions/guest/sess-1')
    assertNoTokenInUrl(url)
    expect(body).toBe(payload)
    expect(config.params).toBeUndefined()
    expect(config.headers['x-guest-token']).toBe(TOKEN)
  })

  it('listGuestVersions 는 GET /edit-sessions/guest/<id>/versions 를 헤더로 보낸다', async () => {
    const versions = [{ id: 'v1' }]
    client.get.mockResolvedValue({ data: versions })

    await expect(editSessionsApi.listGuestVersions('sess-2', TOKEN)).resolves.toEqual(versions)

    const [url, config] = client.get.mock.calls[0] as [string, { headers: Record<string, string>; params?: unknown }]
    expect(url).toBe('/edit-sessions/guest/sess-2/versions')
    assertNoTokenInUrl(url)
    expect(config.params).toBeUndefined()
    expect(config.headers['x-guest-token']).toBe(TOKEN)
  })

  it('listGuestVersions 는 배열이 아닌 응답을 빈 배열로 돌려준다', async () => {
    client.get.mockResolvedValue({ data: null })
    await expect(editSessionsApi.listGuestVersions('sess-2', TOKEN)).resolves.toEqual([])
  })

  it('restoreGuestVersion 은 POST .../versions/<vid>/restore 를 헤더와 __noRetry 로 보낸다', async () => {
    const session = { id: 'sess-3' }
    client.post.mockResolvedValue({ data: session })

    await expect(editSessionsApi.restoreGuestVersion('sess-3', TOKEN, 'ver-1')).resolves.toEqual(session)

    const [url, body, config] = client.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; __noRetry?: boolean; params?: unknown },
    ]
    expect(url).toBe('/edit-sessions/guest/sess-3/versions/ver-1/restore')
    assertNoTokenInUrl(url)
    expect(body).toEqual({})
    expect(config.__noRetry).toBe(true)
    expect(config.params).toBeUndefined()
    expect(config.headers['x-guest-token']).toBe(TOKEN)
  })
})

describe('editSessionsApi — 실패 오류 객체의 게스트 토큰은 가려진다', () => {
  const TOKEN = 'a+b/c=d&e?f g'

  type RequestOptions = { headers?: Record<string, string> }

  /** axios 처럼 요청 설정(헤더 포함)을 담은 HTTP 오류를 만든다 */
  function httpErrorFor(status: number, method: string, url: string, options: RequestOptions | undefined): AxiosError {
    const headers = new AxiosHeaders()
    headers.set('Authorization', 'Bearer shop-jwt')
    for (const [name, value] of Object.entries(options?.headers ?? {})) headers.set(name, value)
    const cfg = { url, method, headers } as InternalAxiosRequestConfig
    return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
      status,
      data: {},
      statusText: '',
      headers: {},
      config: cfg,
    })
  }

  beforeEach(() => {
    client.get.mockReset()
    client.patch.mockReset()
    client.post.mockReset()
  })

  async function caught(p: Promise<unknown>): Promise<AxiosError> {
    try {
      await p
    } catch (err) {
      return err as AxiosError
    }
    throw new Error('expected rejection')
  }

  function assertRedacted(err: AxiosError) {
    expect(err).toBeInstanceOf(AxiosError)
    const headers = err.config?.headers as unknown as Record<string, unknown>
    expect(headers['x-guest-token']).toBe('[redacted]')
    expect(headers['Authorization']).toBe('Bearer shop-jwt')
    expect(JSON.stringify(err.config)).not.toContain(TOKEN)
    expect(JSON.stringify(err.response?.config)).not.toContain(TOKEN)
  }

  it.each([403, 500])('updateGuest %i 실패 — 같은 오류를 던지고 요청 설정의 토큰은 [redacted]', async (status) => {
    client.patch.mockImplementation(async (url: string, _body: unknown, options?: RequestOptions) => {
      throw httpErrorFor(status, 'patch', url, options)
    })
    const err = await caught(editSessionsApi.updateGuest('sess-1', TOKEN, { status: 'editing' }))
    expect(err.response?.status).toBe(status)
    assertRedacted(err)
  })

  it.each([403, 500])('listGuestVersions %i 실패 — 같은 오류를 던지고 요청 설정의 토큰은 [redacted]', async (status) => {
    client.get.mockImplementation(async (url: string, options?: RequestOptions) => {
      throw httpErrorFor(status, 'get', url, options)
    })
    const err = await caught(editSessionsApi.listGuestVersions('sess-2', TOKEN))
    expect(err.response?.status).toBe(status)
    assertRedacted(err)
  })

  it.each([403, 500])('restoreGuestVersion %i 실패 — 같은 오류를 던지고 요청 설정의 토큰은 [redacted]', async (status) => {
    client.post.mockImplementation(async (url: string, _body: unknown, options?: RequestOptions) => {
      throw httpErrorFor(status, 'post', url, options)
    })
    const err = await caught(editSessionsApi.restoreGuestVersion('sess-3', TOKEN, 'ver-1'))
    expect(err.response?.status).toBe(status)
    assertRedacted(err)
  })

  it.each([403, 500])('getGuest %i 실패 — 같은 오류를 던지고 요청 설정의 토큰은 [redacted]', async (status) => {
    client.get.mockImplementation(async (url: string, options?: RequestOptions) => {
      throw httpErrorFor(status, 'get', url, options)
    })
    const err = await caught(editSessionsApi.getGuest('sess-4', TOKEN))
    expect(err.response?.status).toBe(status)
    assertRedacted(err)
  })
})
