import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./client', () => ({ apiClient: { get: (...a: unknown[]) => client.get(...(a as [])) } }))

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
