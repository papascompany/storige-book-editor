/**
 * useGuestStore.ensureGuestSession — 저장된 게스트 세션은 게스트 조회 경로로 읽는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { useGuestStore } from './useGuestStore'

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

describe('useGuestStore.ensureGuestSession', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    sessionStorage.clear()
    useGuestStore.setState({ sessionId: null, guestToken: null, expiresAt: null })
    api.createGuest.mockResolvedValue({
      id: 'g-new',
      guestToken: 'tok-new',
      guestExpiresAt: FUTURE,
      templateSetId: 'ts-1',
    })
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

  it('getGuest 가 실패하면 기록을 지우고 새 게스트 세션을 만든다(오류 객체의 토큰은 가린다)', async () => {
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
})
