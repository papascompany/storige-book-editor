/**
 * 전역 unhandledrejection 처리 — 요약 로그 1줄 + 브라우저 기본 처리("Uncaught (in promise)") 억제.
 *
 * 모니터링 전송(종류마다 1건):
 *   - Error·객체 reason: Sentry 기본 전역 처리기(globalHandlers)가 보낸다. 여기서는 보내지 않는다.
 *   - 원시값 reason(문자열·숫자·undefined·null 등): 기본 전역 처리기의 이벤트는 ignoreErrors
 *     ('Non-Error promise rejection captured')로 걸러지므로 여기서 1건 명시 전송한다.
 * 전송 내용은 initSentry 의 beforeSend 전처리를 거친다. DSN 이 없으면 전송하지 않는다.
 */
import { Sentry } from '../lib/sentry'
import { describeError } from './safeErrorLog'

/** 원시값 판정 — Sentry 전역 처리기(isPrimitive)와 같은 기준 */
function isPrimitiveReason(reason: unknown): boolean {
  return reason === null || (typeof reason !== 'object' && typeof reason !== 'function')
}

export function handleUnhandledRejection(event: Pick<PromiseRejectionEvent, 'reason' | 'preventDefault'>): void {
  console.error('[unhandledrejection] caught:', describeError(event.reason))
  if (isPrimitiveReason(event.reason)) {
    try {
      Sentry.captureException(event.reason)
    } catch {
      /* 모니터링 전송 실패는 무시 */
    }
  }
  event.preventDefault()
}
