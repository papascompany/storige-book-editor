import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { useBreakpoint } from './useBreakpoint'

/**
 * 사용자 선호(pageNavPosition) + 화면 크기를 합쳐서 실제 위치 결정.
 * - 'auto' : desktop → right, tablet/mobile → bottom
 * - 'right'/'bottom' : 강제 적용
 */
export function useResolvedPageNavPosition(): 'right' | 'bottom' {
  const prefer = useUiPrefStore((s) => s.pageNavPosition)
  const bp = useBreakpoint()
  if (prefer === 'auto') return bp === 'desktop' ? 'right' : 'bottom'
  return prefer
}
