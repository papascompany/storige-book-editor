import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ADMIN_EDIT_FLAG,
  authStore,
  isAdminEditTab,
  setAdminEditTab,
  getAuthToken,
  setAuthToken,
  removeAuthToken,
  getEmbedRefreshToken,
  setEmbedRefreshToken,
  removeEmbedRefreshToken,
} from './authTokenStorage'

function memoryStorage(): Storage {
  let store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(String(k), String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map()
    },
  } as Storage
}

describe('authTokenStorage (관리자 편집 탭 저장소 선택)', () => {
  let local: Storage
  let session: Storage

  beforeEach(() => {
    local = memoryStorage()
    session = memoryStorage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', session)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('플래그가 없으면 읽기·쓰기가 localStorage 로 간다(종전 동작)', () => {
    expect(isAdminEditTab()).toBe(false)
    expect(authStore()).toBe(local)
    setAuthToken('acc-1')
    setEmbedRefreshToken('ref-1')
    expect(local.getItem('auth_token')).toBe('acc-1')
    expect(local.getItem('auth_refresh_token')).toBe('ref-1')
    expect(session.getItem('auth_token')).toBeNull()
    expect(session.getItem('auth_refresh_token')).toBeNull()
    expect(getAuthToken()).toBe('acc-1')
    expect(getEmbedRefreshToken()).toBe('ref-1')
    removeAuthToken()
    removeEmbedRefreshToken()
    expect(local.getItem('auth_token')).toBeNull()
    expect(local.getItem('auth_refresh_token')).toBeNull()
  })

  it('플래그가 있으면 sessionStorage 를 쓰고 localStorage 는 건드리지 않는다', () => {
    local.setItem('auth_token', 'partner-acc')
    local.setItem('auth_refresh_token', 'partner-ref')
    setAdminEditTab(true)
    expect(session.getItem(ADMIN_EDIT_FLAG)).toBe('1')
    expect(isAdminEditTab()).toBe(true)
    expect(authStore()).toBe(session)

    // 관리자 탭에는 아직 토큰이 없다 → localStorage 값이 새어 들어오지 않는다.
    expect(getAuthToken()).toBeNull()
    expect(getEmbedRefreshToken()).toBeNull()

    setAuthToken('staff-acc')
    setEmbedRefreshToken('staff-ref')
    expect(session.getItem('auth_token')).toBe('staff-acc')
    expect(session.getItem('auth_refresh_token')).toBe('staff-ref')
    expect(local.getItem('auth_token')).toBe('partner-acc')
    expect(local.getItem('auth_refresh_token')).toBe('partner-ref')

    removeAuthToken()
    removeEmbedRefreshToken()
    expect(session.getItem('auth_token')).toBeNull()
    expect(session.getItem('auth_refresh_token')).toBeNull()
    expect(local.getItem('auth_token')).toBe('partner-acc')
    expect(local.getItem('auth_refresh_token')).toBe('partner-ref')
  })

  it('플래그 해제 시 다시 localStorage 를 사용한다', () => {
    local.setItem('auth_token', 'partner-acc')
    setAdminEditTab(true)
    setAuthToken('staff-acc')
    expect(getAuthToken()).toBe('staff-acc')

    setAdminEditTab(false)
    expect(session.getItem(ADMIN_EDIT_FLAG)).toBeNull()
    expect(isAdminEditTab()).toBe(false)
    expect(authStore()).toBe(local)
    expect(getAuthToken()).toBe('partner-acc')
  })

  it('플래그 값이 "1" 이 아니면 관리자 탭으로 보지 않는다', () => {
    session.setItem(ADMIN_EDIT_FLAG, 'true')
    expect(isAdminEditTab()).toBe(false)
    expect(authStore()).toBe(local)
  })

  it('두 탭(서로 다른 sessionStorage)은 토큰을 따로 유지한다', () => {
    const tabA = memoryStorage()
    const tabB = memoryStorage()

    vi.stubGlobal('sessionStorage', tabA)
    setAdminEditTab(true)
    setAuthToken('token-A')
    setEmbedRefreshToken('refresh-A')

    vi.stubGlobal('sessionStorage', tabB)
    setAdminEditTab(true)
    setAuthToken('token-B')
    setEmbedRefreshToken('refresh-B')

    vi.stubGlobal('sessionStorage', tabA)
    expect(getAuthToken()).toBe('token-A')
    expect(getEmbedRefreshToken()).toBe('refresh-A')

    vi.stubGlobal('sessionStorage', tabB)
    expect(getAuthToken()).toBe('token-B')
    expect(getEmbedRefreshToken()).toBe('refresh-B')

    // 공유 localStorage 에는 아무것도 쓰이지 않았다.
    expect(local.getItem('auth_token')).toBeNull()
    expect(local.getItem('auth_refresh_token')).toBeNull()
  })

  it("로그인 흐름의 'refresh_token' 키는 다루지 않는다", () => {
    setAdminEditTab(true)
    setEmbedRefreshToken('staff-ref')
    expect(session.getItem('refresh_token')).toBeNull()
    expect(local.getItem('refresh_token')).toBeNull()
  })

  it('Storage 접근이 예외를 던져도 조용히 실패한다', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    vi.stubGlobal('sessionStorage', throwing)
    vi.stubGlobal('localStorage', throwing)
    expect(isAdminEditTab()).toBe(false)
    expect(() => setAdminEditTab(true)).not.toThrow()
    expect(() => setAuthToken('x')).not.toThrow()
    expect(() => removeAuthToken()).not.toThrow()
    expect(getAuthToken()).toBeNull()
    expect(getEmbedRefreshToken()).toBeNull()
  })
})
