/**
 * 임베드 인증 토큰 저장소 선택 헬퍼 (2026-09-29, Storige 관리자 편집데이터 관리).
 *
 * - 기본(파트너 임베드·기타 라우트): 종전과 동일하게 `localStorage` 를 쓴다.
 * - 관리자 편집 탭(`/embed?...&adminEdit=session`): EmbedView 가 탭 플래그를 켜면
 *   `auth_token`·`auth_refresh_token` 을 **탭 단위** `sessionStorage` 에 둔다.
 *   → 여러 관리자 탭이 서로 다른 세션 권한 토큰을 덮어쓰지 않는다.
 *
 * 로그인 흐름의 'refresh_token' 키(useAuthStore)는 이 헬퍼를 거치지 않는다(종전 그대로).
 * 모든 접근은 try/catch — SSR·프라이버시 모드에서 Storage 접근 예외를 무시한다.
 * Storage 는 호출 시점에 전역에서 다시 읽는다(캐시하지 않음).
 */

export const ADMIN_EDIT_FLAG = 'storige_admin_edit'
export const AUTH_TOKEN_KEY = 'auth_token'
export const EMBED_REFRESH_TOKEN_KEY = 'auth_refresh_token'

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 현재 탭이 관리자 편집 탭(adminEdit=session 으로 진입)인지. */
export function isAdminEditTab(): boolean {
  try {
    return sessionStore()?.getItem(ADMIN_EDIT_FLAG) === '1'
  } catch {
    return false
  }
}

/** 관리자 편집 탭 플래그 설정(true) 또는 해제(false). */
export function setAdminEditTab(on: boolean): void {
  try {
    const s = sessionStore()
    if (!s) return
    if (on) s.setItem(ADMIN_EDIT_FLAG, '1')
    else s.removeItem(ADMIN_EDIT_FLAG)
  } catch {
    /* SSR/프라이버시 모드 무시 */
  }
}

/** 토큰 저장소 — 관리자 편집 탭이면 sessionStorage, 아니면 localStorage. */
export function authStore(): Storage | null {
  return isAdminEditTab() ? sessionStore() : localStore()
}

function readKey(key: string): string | null {
  try {
    return authStore()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    authStore()?.setItem(key, value)
  } catch {
    /* SSR/프라이버시 모드 무시 */
  }
}

function removeKey(key: string): void {
  try {
    authStore()?.removeItem(key)
  } catch {
    /* SSR/프라이버시 모드 무시 */
  }
}

export function getAuthToken(): string | null {
  return readKey(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  writeKey(AUTH_TOKEN_KEY, token)
}

export function removeAuthToken(): void {
  removeKey(AUTH_TOKEN_KEY)
}

/** 임베드 사일런트 리프레시용 refreshToken('auth_refresh_token'). */
export function getEmbedRefreshToken(): string | null {
  return readKey(EMBED_REFRESH_TOKEN_KEY)
}

export function setEmbedRefreshToken(token: string): void {
  writeKey(EMBED_REFRESH_TOKEN_KEY, token)
}

export function removeEmbedRefreshToken(): void {
  removeKey(EMBED_REFRESH_TOKEN_KEY)
}
