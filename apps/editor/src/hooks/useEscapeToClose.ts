import { useEffect } from 'react'

/**
 * 대화상자가 열려 있는 동안 Esc 로 닫는다.
 * active 가 false 면 듣지 않는다(닫힘 상태, 또는 처리 중이라 닫으면 안 되는 동안).
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, onClose])
}
