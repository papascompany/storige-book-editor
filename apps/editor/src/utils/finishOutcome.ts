/**
 * 편집완료 결과 → 편집기 안 안내 토스트.
 * - completed(또는 결과값 없는 호출자): 완료 안내(success)
 * - needsAuth(비회원 세션): 저장 안내 + 로그인 뒤 주문 가능 안내(info). 호스트 이벤트(editor.complete → editor.needAuth)는 그대로다.
 * - skipped(편집 작업 정보 없음): 완료하지 못했다는 안내(warning)
 */
import type { ToastType } from '../stores/useToastStore'

export type FinishOutcome = 'completed' | 'needsAuth' | 'skipped'

export interface FinishToast {
  message: string
  type: ToastType
}

export const FINISH_TOASTS: Record<FinishOutcome, FinishToast> = {
  completed: { message: '편집이 완료되었습니다.', type: 'success' },
  needsAuth: { message: '작업이 저장되었습니다. 로그인하면 이어서 주문할 수 있어요.', type: 'info' },
  skipped: {
    message: '편집 작업 정보가 없어 완료할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.',
    type: 'warning',
  },
}

/** 편집완료 결과 → 토스트. 알 수 없는 값·결과값 없음은 완료 안내. throw 하지 않는다. */
export function finishToastFor(outcome: FinishOutcome | void): FinishToast {
  if (outcome === 'needsAuth' || outcome === 'skipped') return FINISH_TOASTS[outcome]
  return FINISH_TOASTS.completed
}
