import { create } from 'zustand'
import { authApi } from '@/api'

interface User {
  id: string
  email: string
  role: string
  createdAt: string
  updatedAt: string
}

interface AuthState {
  token: string
  refreshToken: string
  me: User | null
  loading: boolean
  initialized: boolean
}

interface AuthActions {
  setToken: (token: string, refreshToken?: string) => void
  clearToken: () => void
  initializeFromStorage: () => void
  checkAuth: () => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}

export const useAuthStore = create<AuthState & AuthActions>()((set, get) => ({
  // State
  token: '',
  refreshToken: '',
  me: null,
  loading: false,
  initialized: false,

  // Actions
  setToken: (newToken: string, newRefreshToken?: string) => {
    set({ token: newToken })
    localStorage.setItem('auth_token', newToken)
    if (newRefreshToken) {
      set({ refreshToken: newRefreshToken })
      localStorage.setItem('refresh_token', newRefreshToken)
    }
    // Trigger auth check when token changes
    get().checkAuth()
  },

  clearToken: () => {
    set({ token: '', refreshToken: '', me: null })
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
  },

  initializeFromStorage: () => {
    const storedToken = localStorage.getItem('auth_token')
    const storedRefreshToken = localStorage.getItem('refresh_token')
    console.log('initializeFromStorage', storedToken ? 'token exists' : 'no token')
    if (storedToken) {
      set({ token: storedToken })
    }
    if (storedRefreshToken) {
      set({ refreshToken: storedRefreshToken })
    }
    set({ initialized: true })
  },

  checkAuth: async () => {
    const { token, clearToken } = get()
    if (!token) return false

    set({ loading: true })

    try {
      const result = await authApi.getMe()

      if (result.success && result.data) {
        set({ me: result.data })
        return true
      }

      return false
    } catch (e) {
      console.error('error fetching me', e)
      clearToken()
      return false
    } finally {
      set({ loading: false })
    }
  },

  login: async (email: string, password: string) => {
    set({ loading: true })

    try {
      const result = await authApi.login({ email, password })

      if (result.success && result.data) {
        const { accessToken, refreshToken } = result.data
        set({ token: accessToken, refreshToken })
        localStorage.setItem('auth_token', accessToken)
        localStorage.setItem('refresh_token', refreshToken)

        // 사용자 정보 가져오기
        await get().checkAuth()
        return true
      }

      return false
    } catch (e) {
      console.error('login error', e)
      return false
    } finally {
      set({ loading: false })
    }
  },

  logout: () => {
    get().clearToken()
  },
}))

// 역할 비교는 대소문자 무관(P0-A, 2026-06-15).
// shop-session JWT 는 role:'customer'(소문자, apps/api auth.service.ts)인 반면
// 내부 admin/일반 토큰은 'CUSTOMER'/'ADMIN'(대문자)을 쓴다. 양쪽 모두 동작하도록
// 정규화한다. (과거 staff 대소문자 회귀 이력 있어 admin/super_admin 도 동일 처리.)
const normalizeRole = (role?: string | null): string =>
  (role ?? '').toUpperCase()

// Selector hooks for computed values
export const useIsAuthenticated = () => useAuthStore((state) => !!state.token)
export const useIsAdmin = () =>
  useAuthStore((state) => {
    const role = normalizeRole(state.me?.role)
    return role === 'ADMIN' || role === 'SUPER_ADMIN'
  })
export const useIsCustomer = () =>
  useAuthStore((state) => normalizeRole(state.me?.role) === 'CUSTOMER')
