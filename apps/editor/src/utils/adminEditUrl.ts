/**
 * 관리자 편집 탭(adminEdit=session) URL fragment 토큰 전달 헬퍼 (2026-09-29, 순수 함수).
 *
 * 관리자 화면은 편집기를 `/embed?sessionId=..&adminEdit=session#token=..&refreshToken=..` 로 연다.
 * fragment 는 서버·엣지 미들웨어·Referer 로 전송되지 않는다. 편집기는 토큰을 읽어 탭 저장소에
 * 옮긴 뒤 주소창에서 지운다(stripAuthFragment + history.replaceState).
 */

const TOKEN_KEYS = ['token'] as const
const REFRESH_KEYS = ['refreshToken', 'refresh_token'] as const
const AUTH_KEYS: readonly string[] = [...TOKEN_KEYS, ...REFRESH_KEYS]

export interface AuthFragment {
  token?: string
  refreshToken?: string
}

function parseHash(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(raw)
}

function firstNonEmpty(params: URLSearchParams, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = params.get(k)
    if (v) return v
  }
  return undefined
}

/** `#token=..&refreshToken=..`(또는 refresh_token) 에서 토큰을 읽는다. 없는 값은 생략. */
export function readAuthFragment(hash: string | null | undefined): AuthFragment {
  if (!hash) return {}
  const params = parseHash(hash)
  const out: AuthFragment = {}
  const token = firstNonEmpty(params, TOKEN_KEYS)
  const refreshToken = firstNonEmpty(params, REFRESH_KEYS)
  if (token) out.token = token
  if (refreshToken) out.refreshToken = refreshToken
  return out
}

/**
 * href 의 fragment 에서 토큰 키만 제거한다. 쿼리와 다른 fragment 키는 유지하고,
 * 남는 것이 없으면 '#' 도 지운다. 토큰 키가 없으면 입력을 그대로 돌려준다.
 */
export function stripAuthFragment(href: string): string {
  const hashIdx = href.indexOf('#')
  if (hashIdx < 0) return href
  const base = href.slice(0, hashIdx)
  const params = parseHash(href.slice(hashIdx))
  const hasAuth = AUTH_KEYS.some((k) => params.has(k))
  if (!hasAuth) return href
  for (const k of AUTH_KEYS) params.delete(k)
  const rest = params.toString()
  return rest ? `${base}#${rest}` : base
}
