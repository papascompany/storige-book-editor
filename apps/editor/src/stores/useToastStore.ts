import { create } from 'zustand'

/**
 * 가벼운 자체 토스트 알림 시스템 (외부 의존성 없음).
 *
 * 사용:
 *   import { showToast } from '@/stores/useToastStore'
 *   showToast('저장됐습니다', 'success')
 *   showToast('PDF 변환 실패: ...', 'error')
 *
 * 화면 렌더는 ToastViewport 컴포넌트가 App 루트에서 처리.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  message: string
  type: ToastType
  /** ms. 0이면 수동 닫기만 */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, type?: ToastType, duration?: number) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, type = 'info', duration = 3500) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration)
    }
    return id
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

/**
 * showToast — 컴포넌트 외부(callbacks, async 핸들러)에서도 호출 가능한 헬퍼.
 */
export function showToast(message: string, type: ToastType = 'info', duration = 3500): string {
  return useToastStore.getState().push(message, type, duration)
}
