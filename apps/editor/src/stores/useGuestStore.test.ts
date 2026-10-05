/**
 * useGuestStore.ensureGuestSession — 저장된 게스트 세션은 게스트 조회 경로로 읽는다.
 * 같은 templateSetId·mode 로 진행 중인 호출은 결과를 함께 쓴다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
}))
vi.mock('../api/edit-sessions', () => ({
  editSessionsApi: {
    get: (...a: unknown[]) => api.get(...(a as [])),
    getGuest: (...a: unknown[]) => api.getGuest(...(a as [])),
    createGuest: (...a: unknown[]) => api.createGuest(...(a as [])),
  },
}))

import { resetGuestSessionInFlight, useGuestStore } from './useGuestStore'

const STORAGE_KEY = 'storige_guest_session_v1'
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()

function seedStore(templateSetId = 'ts-1') {
  useGuestStore.getState().setGuest({ sessionId: 'g-old', guestToken: 'tok-old', expiresAt: FUTURE, templateSetId })
}

function guestHttpError(status: number, token: string): AxiosError {
  const headers = new AxiosHeaders()
  headers.set('x-guest-token', token)
  const cfg = { url: '/edit-sessions/guest/g-old', method: 'get', headers } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data: {},
    statusText: '',
    headers: {},
    config: cfg,
  })
}

function guestNetworkError(token: string): AxiosError {
  const headers = new AxiosHeaders()
  headers.set('x-guest-token', token)
  const cfg = { url: '/edit-sessions/guest/g-old', method: 'get', headers } as InternalAxiosRequestConfig
  return new AxiosError('Network Error', 'ERR_NETWORK', cfg)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useGuestStore.ensureGuestSession', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    resetGuestSessionInFlight()
    sessionStorage.clear()
    useGuestStore.setState({ sessionId: null, guestToken: null, expiresAt: null })
    api.createGuest.mockResolvedValue({
      id: 'g-new',
      guestToken: 'tok-new',
      guestExpiresAt: FUTURE,
      templateSetId: 'ts-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('저장된 세션이 있으면 getGuest(sessionId, guestToken)으로 읽고 get 은 호출하지 않는다', async () => {
    seedStore()
    const existing = { id: 'g-old', templateSetId: 'ts-1' }
    api.getGuest.mockResolvedValue(existing)

    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toBe(existing)

    expect(api.getGuest).toHaveBeenCalledTimes(1)
    expect(api.getGuest).toHaveBeenCalledWith('g-old', 'tok-old')
    expect(api.get).not.toHaveBeenCalled()
    expect(api.createGuest).not.toHaveBeenCalled()
    expect(useGuestStore.getState().sessionId).toBe('g-old')
  })

  it('getGuest 가 403 으로 거절되면 기록을 지우고 새 게스트 세션을 만든다(오류 객체의 토큰은 가린다)', async () => {
    seedStore()
    const err = guestHttpError(403, 'tok-old')
    api.getGuest.mockRejectedValue(err)

    const created = await useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1', mode: 'both' })

    expect(created).toMatchObject({ id: 'g-new' })
    expect(api.get).not.toHaveBeenCalled()
    expect(api.createGuest).toHaveBeenCalledTimes(1)
    expect(useGuestStore.getState()).toMatchObject({ sessionId: 'g-new', guestToken: 'tok-new' })
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) as string)).toMatchObject({ sessionId: 'g-new' })
    expect(err.config?.headers['x-guest-token']).toBe('[redacted]')
  })

  it('templateSetId 가 다르면 새로 만든다', async () => {
    seedStore('ts-other')
    api.getGuest.mockResolvedValue({ id: 'g-old', templateSetId: 'ts-other' })

    const created = await useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })

    expect(api.getGuest).toHaveBeenCalledWith('g-old', 'tok-old')
    expect(api.createGuest).toHaveBeenCalledTimes(1)
    expect(created).toMatchObject({ id: 'g-new' })
  })

  it('저장된 세션이 없으면 조회 없이 새로 만든다', async () => {
    await useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })
    expect(api.getGuest).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.createGuest).toHaveBeenCalledTimes(1)
  })

  it('같은 templateSetId·mode 로 동시에 두 번 부르면 게스트 세션을 한 번만 만들고 같은 결과를 돌려준다', async () => {
    const pending = deferred<{ id: string; guestToken: string; guestExpiresAt: string; templateSetId: string }>()
    api.createGuest.mockReturnValue(pending.promise)

    const first = useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1', mode: 'both' })
    const second = useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })
    pending.resolve({ id: 'g-new', guestToken: 'tok-new', guestExpiresAt: FUTURE, templateSetId: 'ts-1' })
    const [a, b] = await Promise.all([first, second])

    expect(api.createGuest).toHaveBeenCalledTimes(1)
    expect(a).toMatchObject({ id: 'g-new' })
    expect(b).toBe(a)
    expect(useGuestStore.getState().sessionId).toBe('g-new')
  })

  it('templateSetId 가 다르면 동시에 불러도 각각 만든다', async () => {
    await Promise.all([
      useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' }),
      useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-2' }),
    ])

    expect(api.createGuest).toHaveBeenCalledTimes(2)
  })

  it('진행 중 생성이 끝난 뒤의 다음 호출은 다시 생성한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.createGuest.mockRejectedValueOnce(new Error('boom'))

    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toBeNull()
    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toMatchObject({
      id: 'g-new',
    })

    expect(api.createGuest).toHaveBeenCalledTimes(2)
  })

  it('resetGuestSessionInFlight 뒤의 호출은 진행 중 생성과 결과를 공유하지 않는다', async () => {
    const pending = deferred<{ id: string; guestToken: string; guestExpiresAt: string; templateSetId: string }>()
    api.createGuest.mockReturnValueOnce(pending.promise)

    const first = useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })
    resetGuestSessionInFlight()
    const second = useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })
    pending.resolve({ id: 'g-first', guestToken: 'tok-first', guestExpiresAt: FUTURE, templateSetId: 'ts-1' })

    await expect(first).resolves.toMatchObject({ id: 'g-first' })
    await expect(second).resolves.toMatchObject({ id: 'g-new' })
    expect(api.createGuest).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['503', () => guestHttpError(503, 'tok-old')],
    ['응답 없음', () => guestNetworkError('tok-old')],
  ])('저장된 세션 조회가 %s 이면 기록을 유지하고 새로 만들지 않는다', async (_label, makeError) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seedStore()
    const err = makeError()
    api.getGuest.mockRejectedValue(err)

    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toBeNull()

    expect(api.createGuest).not.toHaveBeenCalled()
    expect(useGuestStore.getState()).toMatchObject({ sessionId: 'g-old', guestToken: 'tok-old' })
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) as string)).toMatchObject({ sessionId: 'g-old' })
    expect(err.config?.headers['x-guest-token']).toBe('[redacted]')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tok-old')
  })

  it('저장된 세션 조회가 404 면 기록을 지우고 새로 만든다', async () => {
    seedStore()
    api.getGuest.mockRejectedValue(guestHttpError(404, 'tok-old'))

    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toMatchObject({
      id: 'g-new',
    })

    expect(api.createGuest).toHaveBeenCalledTimes(1)
    expect(useGuestStore.getState()).toMatchObject({ sessionId: 'g-new', guestToken: 'tok-new' })
  })

  it.each([
    ['guestToken', { id: 'g-new', guestExpiresAt: FUTURE, templateSetId: 'ts-1' }],
    ['guestExpiresAt', { id: 'g-new', guestToken: 'tok-new', templateSetId: 'ts-1' }],
  ])('생성 응답에 %s 이 없으면 저장하지 않고 null 을 돌려준다', async (_field, response) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.createGuest.mockResolvedValue(response)

    await expect(useGuestStore.getState().ensureGuestSession({ templateSetId: 'ts-1' })).resolves.toBeNull()

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(useGuestStore.getState()).toMatchObject({ sessionId: null, guestToken: null, expiresAt: null })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tok-new')
  })
})
