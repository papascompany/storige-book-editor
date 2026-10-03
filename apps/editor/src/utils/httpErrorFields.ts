/**
 * HTTP 실패에서 응답 code·상태를 읽는 공용 헬퍼 — embedSessionReopen(재오픈 사유 매핑)과
 * embedFailurePolicy(초기화·저장 실패 분류)가 같은 판정을 쓴다.
 * axios 에만 의존한다(테스트 하네스의 './api' mock 과 무관).
 */
import axios from 'axios'

/** 응답 본문의 `code` 문자열(없으면 null) */
export function apiErrorCodeOf(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null
  const data: unknown = err.response?.data
  if (data !== null && typeof data === 'object') {
    const code = (data as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return null
}

/** HTTP 상태(응답이 없으면 undefined). 정규화된 오류 객체({ status })도 받는다. */
export function httpStatusOf(err: unknown): number | undefined {
  if (axios.isAxiosError(err)) return err.response?.status
  if (err !== null && typeof err === 'object') {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}
