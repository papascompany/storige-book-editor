import { useEffect, useState } from 'react'

/**
 * Coarse pointer (터치 입력 우선) 디바이스 여부 감지.
 * 휴대폰/태블릿처럼 마우스가 없는 환경에서 true.
 *
 * MOBILE_BREAKPOINT 같은 폭 기반 검사보다 정확 — 외장 키보드/마우스 연결 시에도 올바르게 판별.
 */
export function useIsCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    try {
      return window.matchMedia('(pointer: coarse)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    let mql: ReturnType<typeof window.matchMedia>
    try {
      mql = window.matchMedia('(pointer: coarse)')
    } catch {
      return
    }
    const onChange = (e: { matches: boolean }) => setIsCoarse(e.matches)
    // Safari < 14 호환: addEventListener 가 없을 수 있음
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // legacy fallback
    const legacyMql = mql as unknown as {
      addListener?: (cb: (e: { matches: boolean }) => void) => void
      removeListener?: (cb: (e: { matches: boolean }) => void) => void
    }
    legacyMql.addListener?.(onChange)
    return () => legacyMql.removeListener?.(onChange)
  }, [])

  return isCoarse
}
