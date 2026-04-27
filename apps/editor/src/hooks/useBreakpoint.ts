import { useEffect, useState } from 'react'

/**
 * 화면 크기 breakpoint 감지 hook (PC/태블릿/모바일).
 * - 모바일: < 640px
 * - 태블릿: 640~1024px
 * - 데스크톱: >= 1024px
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(width: number): Breakpoint {
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window !== 'undefined' ? getBreakpoint(window.innerWidth) : 'desktop'
  )

  useEffect(() => {
    const onResize = () => setBp(getBreakpoint(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return bp
}
