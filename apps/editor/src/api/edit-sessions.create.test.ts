import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { apiClient, type RetryableRequestConfig } from './client'
import { editSessionsApi, MEMBER_CREATE_RESEND_DELAY_MS, type EditSessionResponse } from './edit-sessions'
import {
  getAuthToken,
  removeAuthToken,
  removeEmbedRefreshToken,
  setAuthToken,
  setEmbedRefreshToken,
} from '@/utils/authTokenStorage'

/**
 * 세션 생성 — 실제 apiClient(인터셉터 포함)에 adapter 를 주입해 요청 횟수·순서·시각을 확인한다.
 * - 회원 create: 429 만 자동 재시도. orderSeqno 가 있고 408·5xx 면 주문별 목록을 한 번 조회해 같은
 *   mode·templateSetId 의 회원 세션을 쓰고, 없으면 1초 뒤 한 번만 다시 보낸다.
 * - createGuest: 408·429·5xx 에 1s·2s·4s 간격으로 최대 3회 다시 보낸다.
 */

const ACCESS = 'access-secret'
const ORDER = 9001

type Reply = { status: number; data?: unknown } | 'network'

interface SeenRequest {
  method: string
  url: string
  params: unknown
  at: number
  config: InternalAxiosRequestConfig & RetryableRequestConfig
}

/** method+url 별 응답 순서를 정해 두고, 마지막 응답은 이후 요청에도 반복한다 */
function scriptedAdapter(script: Record<string, Reply[]>, seen: SeenRequest[]): AxiosAdapter {
  const cursor: Record<string, number> = {}
  return (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? 'get').toUpperCase()
    const url = config.url ?? ''
    const key = `${method} ${url}`
    seen.push({ method, url, params: config.params, at: Date.now(), config })
    const replies = script[key]
    if (!replies || replies.length === 0) {
      return Promise.reject(new Error(`unexpected request ${key}`))
    }
    const index = Math.min(cursor[key] ?? 0, replies.length - 1)
    cursor[key] = (cursor[key] ?? 0) + 1
    const reply = replies[index]
    if (reply === 'network') {
      return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
    }
    const response: AxiosResponse = {
      status: reply.status,
      data: reply.data ?? {},
      statusText: '',
      headers: {},
      config,
    }
    if (reply.status >= 200 && reply.status < 300) return Promise.resolve(response)
    return Promise.reject(
      new AxiosError(`Request failed with status code ${reply.status}`, 'ERR_BAD_RESPONSE', config, undefined, response),
    )
  }
}

function session(overrides: Partial<EditSessionResponse> = {}): EditSessionResponse {
  return {
    id: 'sess-new',
    orderSeqno: ORDER,
    memberSeqno: 7,
    status: 'draft',
    mode: 'both',
    templateSetId: 'ts-1',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    guestToken: null,
    guestExpiresAt: null,
    ...overrides,
  }
}

const memberPayload = { orderSeqno: ORDER, mode: 'both' as const, templateSetId: 'ts-1', metadata: { pages: 24 } }

async function rejectionOf(p: Promise<unknown>): Promise<AxiosError> {
  try {
    await p
  } catch (e) {
    return e as AxiosError
  }
  throw new Error('expected rejection')
}

const instance = (apiClient as unknown as { client: AxiosInstance }).client
const originalAdapter = instance.defaults.adapter

function useAdapter(script: Record<string, Reply[]>): SeenRequest[] {
  const seen: SeenRequest[] = []
  instance.defaults.adapter = scriptedAdapter(script, seen)
  return seen
}

const POST_CREATE = 'POST /edit-sessions'
const GET_LIST = 'GET /edit-sessions'
const POST_GUEST = 'POST /edit-sessions/guest'

describe('editSessionsApi.create — 실제 apiClient 경유', () => {
  let start = 0

  beforeEach(() => {
    vi.useFakeTimers()
    start = Date.now()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setAuthToken(ACCESS)
  })

  afterEach(() => {
    instance.defaults.adapter = originalAdapter
    vi.useRealTimers()
    vi.restoreAllMocks()
    removeAuthToken()
    removeEmbedRefreshToken()
  })

  it('POST /edit-sessions 를 본문과 __retryStatuses:[429] 로 보내고 응답 세션을 돌려준다', async () => {
    const created = session()
    const seen = useAdapter({ [POST_CREATE]: [{ status: 201, data: created }] })

    await expect(editSessionsApi.create(memberPayload)).resolves.toEqual(created)

    expect(seen).toHaveLength(1)
    expect(JSON.parse(seen[0].config.data as string)).toEqual(memberPayload)
    expect(seen[0].config.__retryStatuses).toEqual([429])
  })

  it.each([408, 500, 502, 503, 504])(
    '%i 이면 주문 목록을 한 번 조회해 같은 mode·templateSetId 의 회원 세션을 돌려주고 다시 보내지 않는다',
    async (status) => {
      const committed = session({ id: 'sess-committed' })
      const seen = useAdapter({
        [POST_CREATE]: [{ status }],
        [GET_LIST]: [{ status: 200, data: { sessions: [committed], total: 1 } }],
      })

      const pending = editSessionsApi.create(memberPayload)
      await vi.runAllTimersAsync()

      await expect(pending).resolves.toEqual(committed)
      expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST])
      expect(seen[1].params).toEqual({ orderSeqno: ORDER })
    },
  )

  it('목록에 맞는 회원 세션이 없으면 1초 뒤 한 번만 다시 보내고 그 응답을 돌려준다', async () => {
    const created = session({ id: 'sess-resent' })
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 502 }, { status: 201, data: created }],
      [GET_LIST]: [
        {
          status: 200,
          data: {
            sessions: [
              // 비회원 항목(목록 응답에는 토큰 없이 만료 시각만 실린다)
              session({ id: 'sess-guest', guestExpiresAt: '2026-10-06T00:00:00.000Z' }),
              session({ id: 'sess-cover', mode: 'cover' }),
              session({ id: 'sess-other-ts', templateSetId: 'ts-2' }),
            ],
            total: 3,
          },
        },
      ],
    })

    const pending = editSessionsApi.create(memberPayload)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST])
    await vi.advanceTimersByTimeAsync(MEMBER_CREATE_RESEND_DELAY_MS - 1)
    expect(seen).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual(created)

    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST, POST_CREATE])
    expect(seen[2].at - start).toBe(1000)
    expect(seen[2].config.__retryStatuses).toEqual([429])
  })

  it('다시 보낸 요청도 5xx 면 더 보내지 않고 그 오류를 던진다(Authorization 은 가린다)', async () => {
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 503 }, { status: 500 }],
      [GET_LIST]: [{ status: 200, data: { sessions: [], total: 0 } }],
    })

    const pending = rejectionOf(editSessionsApi.create(memberPayload))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST, POST_CREATE])
    expect(err.response?.status).toBe(500)
    expect(err.config?.headers.Authorization).toBe('[redacted]')
  })

  it('주문 목록 조회가 실패하면 다시 보내지 않고 원래 생성 오류를 던진다', async () => {
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 502 }],
      [GET_LIST]: [{ status: 403 }],
    })

    const pending = rejectionOf(editSessionsApi.create(memberPayload))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST])
    expect(err.response?.status).toBe(502)
    expect(err.config?.url).toBe('/edit-sessions')
    expect(err.config?.method).toBe('post')
  })

  it('주문 목록 조회가 401 이고 갱신도 실패하면 다시 보내지 않고 그 401 오류를 던진다', async () => {
    setEmbedRefreshToken('refresh-secret')
    const refresh = vi.spyOn(axios, 'post').mockRejectedValue(new AxiosError('Request failed with status code 401'))
    const expired = vi.fn()
    const unsubscribe = apiClient.onAuthExpired(expired)
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 502 }],
      [GET_LIST]: [{ status: 401 }],
    })

    try {
      const pending = rejectionOf(editSessionsApi.create(memberPayload))
      await vi.runAllTimersAsync()
      const err = await pending

      expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST])
      expect(err.response?.status).toBe(401)
      expect(err.config?.method).toBe('get')
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(expired).toHaveBeenCalledTimes(1)
      expect(getAuthToken()).toBeNull()
    } finally {
      unsubscribe()
    }
  })

  it('다시 보낸 요청이 429 면 1초 뒤 다시 보내 성공 응답을 돌려준다', async () => {
    const created = session({ id: 'sess-resent' })
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 502 }, { status: 429 }, { status: 201, data: created }],
      [GET_LIST]: [{ status: 200, data: { sessions: [], total: 0 } }],
    })

    const pending = editSessionsApi.create(memberPayload)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(created)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST, POST_CREATE, POST_CREATE])
    expect(seen[2].at - start).toBe(MEMBER_CREATE_RESEND_DELAY_MS)
    expect(seen[3].at - start).toBe(MEMBER_CREATE_RESEND_DELAY_MS + 1000)
  })

  it('429 재시도 뒤 503 이면 주문 목록을 조회해 같은 회원 세션을 돌려준다', async () => {
    const committed = session({ id: 'sess-committed' })
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 429 }, { status: 503 }],
      [GET_LIST]: [{ status: 200, data: { sessions: [committed], total: 1 } }],
    })

    const pending = editSessionsApi.create(memberPayload)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(committed)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, POST_CREATE, GET_LIST])
    expect(seen[1].at - start).toBe(1000)
  })

  it.each([
    ['없는', undefined],
    ['빈 문자열인', ''],
  ])('templateSetId 가 %s 요청은 목록의 templateSetId 가 null 인 회원 세션을 같은 세션으로 쓴다', async (_label, templateSetId) => {
    const committed = session({ id: 'sess-no-ts', templateSetId: null })
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 504 }],
      [GET_LIST]: [{ status: 200, data: { sessions: [committed], total: 1 } }],
    })
    const { templateSetId: _omitted, ...payloadWithoutTemplateSet } = memberPayload

    const pending = editSessionsApi.create(
      templateSetId === undefined ? payloadWithoutTemplateSet : { ...payloadWithoutTemplateSet, templateSetId },
    )
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(committed)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST])
  })

  it('목록 항목의 orderSeqno 가 다르면 같은 세션으로 쓰지 않고 다시 보낸다', async () => {
    const created = session({ id: 'sess-resent' })
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 500 }, { status: 201, data: created }],
      [GET_LIST]: [{ status: 200, data: { sessions: [session({ id: 'sess-other-order', orderSeqno: ORDER + 1 })], total: 1 } }],
    })

    const pending = editSessionsApi.create(memberPayload)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(created)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, GET_LIST, POST_CREATE])
  })

  it('401 뒤 갱신한 토큰으로 다시 보낸 요청에도 __retryStatuses:[429] 가 실린다', async () => {
    setEmbedRefreshToken('refresh-secret')
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'access-renewed' } })
    const created = session()
    const seen = useAdapter({
      [POST_CREATE]: [{ status: 401 }, { status: 429 }, { status: 201, data: created }],
    })

    const pending = editSessionsApi.create(memberPayload)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(created)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, POST_CREATE, POST_CREATE])
    expect(seen[1].config.__retryStatuses).toEqual([429])
    expect(seen[1].config.headers.Authorization).toBe('Bearer access-renewed')
    expect(seen[2].at - seen[1].at).toBe(1000)
  })

  it('429 는 목록 조회 없이 1초 뒤 다시 보낸다', async () => {
    const created = session()
    const seen = useAdapter({ [POST_CREATE]: [{ status: 429 }, { status: 201, data: created }] })

    const pending = editSessionsApi.create(memberPayload)
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual(created)
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([POST_CREATE, POST_CREATE])
    expect(seen[1].at - start).toBe(1000)
  })

  it('응답이 없는 실패는 목록 조회·재전송 없이 바로 던진다', async () => {
    const seen = useAdapter({ [POST_CREATE]: ['network'] })

    const pending = rejectionOf(editSessionsApi.create(memberPayload))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen).toHaveLength(1)
    expect(err.response).toBeUndefined()
  })

  it.each([400, 403, 404])('%i 응답은 목록 조회·재전송 없이 바로 던진다', async (status) => {
    const seen = useAdapter({ [POST_CREATE]: [{ status }] })

    const pending = rejectionOf(editSessionsApi.create(memberPayload))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen).toHaveLength(1)
    expect(err.response?.status).toBe(status)
  })

  it.each([undefined, 0])('orderSeqno 가 %s 인 생성은 502 에서 목록 조회·재전송 없이 바로 던진다', async (orderSeqno) => {
    const seen = useAdapter({ [POST_CREATE]: [{ status: 502 }] })

    const pending = rejectionOf(editSessionsApi.create({ ...memberPayload, orderSeqno }))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen).toHaveLength(1)
    expect(err.response?.status).toBe(502)
  })
})

describe('editSessionsApi.createGuest — 실제 apiClient 경유', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    instance.defaults.adapter = originalAdapter
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('POST /edit-sessions/guest 를 asGuest:true 본문으로 보내고 재시도 옵션을 싣지 않는다', async () => {
    const created = session({ id: 'g-1', guestToken: 'tok-1', guestExpiresAt: '2026-10-06T00:00:00.000Z' })
    const seen = useAdapter({ [POST_GUEST]: [{ status: 201, data: created }] })

    await expect(editSessionsApi.createGuest({ mode: 'both', templateSetId: 'ts-1' })).resolves.toEqual(created)

    expect(seen).toHaveLength(1)
    expect(JSON.parse(seen[0].config.data as string)).toEqual({ mode: 'both', templateSetId: 'ts-1', asGuest: true })
    expect(seen[0].config.__retryStatuses).toBeUndefined()
    expect(seen[0].config.__noRetry).toBeUndefined()
  })

  it('503 이면 1s·2s·4s 간격으로 최대 3회 다시 보낸다', async () => {
    const seen = useAdapter({ [POST_GUEST]: [{ status: 503 }] })

    const pending = rejectionOf(editSessionsApi.createGuest({ mode: 'both' }))
    await vi.runAllTimersAsync()
    const err = await pending

    expect(seen).toHaveLength(4)
    expect(seen.every((r) => `${r.method} ${r.url}` === POST_GUEST)).toBe(true)
    expect(err.response?.status).toBe(503)
  })
})
