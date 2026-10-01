/**
 * 게스트 토큰 가림 — 오류 객체의 요청 설정에서 게스트 토큰 원문을 '[redacted]' 로 바꾼다.
 *
 * API 모듈(api/edit-sessions)과 재오픈 유틸(embedSessionReopen)이 함께 쓰므로 axios 외 의존성을 두지 않는다.
 */
import axios from 'axios'

const REDACTED = '[redacted]'

/**
 * 오류 객체의 요청 설정에서 게스트 토큰 원문을 가린다 — 오류가 콘솔·모니터링으로
 * 전달되더라도 헤더·URL 에 토큰 값이 남지 않게 한다. 같은 오류에 여러 번 불러도 결과는 같다.
 */
export function redactGuestTokenInError(err: unknown, guestToken: string | null | undefined): void {
  if (!axios.isAxiosError(err) || !guestToken) return
  for (const cfg of [err.config, err.response?.config]) {
    if (!cfg) continue
    try {
      const headers = cfg.headers as unknown as Record<string, unknown> | undefined
      if (headers) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'x-guest-token') headers[name] = REDACTED
        }
      }
      if (typeof cfg.url === 'string') {
        cfg.url = cfg.url.split(encodeURIComponent(guestToken)).join(REDACTED).split(guestToken).join(REDACTED)
      }
    } catch {
      /* 가림 실패는 무시 — 원래 오류 전달이 우선 */
    }
  }
}
