import { useEffect, useRef } from 'react'

/**
 * 임베드 편집기 — 브라우저 "뒤로 가기" 데이터 무결성 가드.
 *
 * 문제: bookmoa 등 호스트 SPA 안(iframe/IIFE)에서 편집 중 브라우저 ← 뒤로가기를 누르면
 *       `beforeunload` 가 발화하지 않아(호스트의 클라이언트측 라우팅) **아무 경고 없이**
 *       편집 전 화면으로 빠져나가 작업이 유실될 수 있다.
 *
 * 해결: 마운트 시 history 에 sentinel 항목을 1개 push 해 **첫 뒤로가기를 흡수**한다.
 *  - 변경사항 없음(`getIsDirty()===false`) → 그대로 한 번 더 뒤로(자연스러운 이탈).
 *  - 변경사항 있음 → `confirm` 으로 경고:
 *      · 취소 → sentinel 재추가(머무름).
 *      · 확인 → 강제 자동저장(flush, 최대 timeoutMs) 후 이탈.
 *
 * iframe 이면 sentinel/`history.back()` 이 합쳐진 세션 히스토리에 작용하므로 호스트 화면 전환을
 * 일으키고, IIFE(호스트 윈도우 직접 실행)면 호스트 히스토리에 직접 작용한다 — 양쪽 모두 동작.
 *
 * `beforeunload`(새로고침/탭닫기/탑 네비)와 언마운트 localStorage 백업은 별도로 유지된다(중복 안전망).
 */
export function useEmbedBackGuard(opts: {
  /** 가드 활성화 (보통 ready && 세션 존재) */
  enabled: boolean
  /** 현재 미저장 변경 여부를 반환 (호출 시점 최신값) */
  getIsDirty: () => boolean
  /** 강제 자동저장(flush). 이탈 전 best-effort 로 호출 */
  saveNow: () => Promise<unknown>
  /** 저장 대기 상한(ms). 초과 시 저장을 기다리지 않고 이탈 */
  saveTimeoutMs?: number
  /** confirm 메시지 */
  message?: string
}) {
  const { enabled } = opts
  // 콜백/값은 ref 로 보관해 effect 가 enabled 변화에만 재실행되도록(불필요한 sentinel 재push 방지)
  const getIsDirtyRef = useRef(opts.getIsDirty)
  const saveNowRef = useRef(opts.saveNow)
  const timeoutRef = useRef(opts.saveTimeoutMs ?? 3000)
  const messageRef = useRef(opts.message)
  getIsDirtyRef.current = opts.getIsDirty
  saveNowRef.current = opts.saveNow
  timeoutRef.current = opts.saveTimeoutMs ?? 3000
  messageRef.current = opts.message

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let leaving = false
    const DEFAULT_MSG =
      '저장되지 않은 변경사항이 있습니다.\n편집 중인 내용을 저장하고 나가시겠습니까?\n\n[확인] 저장 후 나가기   ·   [취소] 계속 편집'

    const goBack = () => {
      // 일부 브라우저에서 popstate 핸들러 내 동기 history.back() 이 불안정 → 다음 틱에 실행
      window.setTimeout(() => {
        try {
          window.history.back()
        } catch {
          /* noop */
        }
      }, 0)
    }

    const pushSentinel = () => {
      try {
        window.history.pushState({ __storigeBackGuard: true }, '')
      } catch {
        /* SSR/프라이버시 모드 — 무시 */
      }
    }

    // 첫 뒤로가기를 흡수할 sentinel
    pushSentinel()

    const onPop = (_e: PopStateEvent) => {
      if (leaving) return

      // 변경사항 없음 → 경고 없이 이탈(자연스러운 뒤로가기)
      if (!getIsDirtyRef.current()) {
        leaving = true
        window.removeEventListener('popstate', onPop)
        goBack()
        return
      }

      // 변경사항 있음 → 경고 (confirm 은 동기 차단 → 더블-백 레이스 없음)
      const leave = window.confirm(messageRef.current ?? DEFAULT_MSG)
      if (!leave) {
        // 머무름 — 흡수용 sentinel 재추가
        pushSentinel()
        return
      }

      // 저장 후 나가기 — 강제 flush(상한 후 진행)
      leaving = true
      window.removeEventListener('popstate', onPop)
      let settled = false
      const proceed = () => {
        if (settled) return
        settled = true
        goBack()
      }
      const timer = window.setTimeout(proceed, timeoutRef.current)
      Promise.resolve()
        .then(() => saveNowRef.current())
        .catch(() => {
          /* 저장 실패해도 언마운트 localStorage 백업이 남으므로 이탈 진행 */
        })
        .finally(() => {
          window.clearTimeout(timer)
          proceed()
        })
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [enabled])
}
