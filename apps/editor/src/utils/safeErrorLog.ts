/**
 * 오류 로그 요약 — 콘솔에는 오류 객체 대신 종류·상태·code·짧은 message 만 담은 한 줄 문자열을 남긴다.
 * 요청 설정(config)·헤더·본문(data)·URL 은 싣지 않으므로 Authorization·x-guest-token·refreshToken·
 * 요청 URL 이 로그에 나가지 않는다. message 안의 토큰 모양 값도 가린다.
 *
 * 문자열로 출력하는 이유: 모니터링 콘솔 breadcrumb 은 인자를 문자열로 이어 붙이므로 객체는 내용이 남지 않는다.
 * axios 와 httpErrorFields 에만 의존한다(테스트 하네스의 './api' mock 과 무관).
 */
import axios from 'axios'
import { apiErrorCodeOf, httpStatusOf } from './httpErrorFields'

export interface SafeErrorSummary {
  /** 'AxiosError' | 'ApiError'(정규화 객체) | Error.name | 'string' | 'object' | typeof 값 | 'unloggable' */
  kind: string
  /** HTTP 상태 — 응답이 있을 때만 */
  status?: number
  /** axios 오류 code(ERR_NETWORK·ECONNABORTED·ERR_BAD_RESPONSE…) 또는 정규화 오류의 code */
  code?: string
  /** 응답 본문 code 문자열(MEMBER_REQUIRED 등) */
  apiCode?: string
  /** 최대 200자. 토큰 모양 값은 가린다. 평범한 객체는 message 없음 */
  message?: string
}

const REDACTED = '[redacted]'
const MESSAGE_MAX = 200
const FIELD_MAX = 64

/** message 안의 자격증명 모양 값 가림: Bearer 값, JWT, token=/token: 값 */
function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED)
    .replace(
      /\b((?:access|refresh|guest)?[Tt]oken|[Aa]uthorization|x-guest-token)("?\s*[:=]\s*"?)(?!\[redacted\])[^\s"'&,;}]+/g,
      `$1$2${REDACTED}`,
    )
}

function safeText(value: string, max: number): string {
  const redacted = redactSecrets(value)
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted
}

function summarizeUnsafe(err: unknown): SafeErrorSummary {
  if (axios.isAxiosError(err)) {
    const summary: SafeErrorSummary = { kind: 'AxiosError' }
    const status = err.response?.status
    if (typeof status === 'number') summary.status = status
    if (typeof err.code === 'string' && err.code !== '') summary.code = safeText(err.code, FIELD_MAX)
    const apiCode = apiErrorCodeOf(err)
    if (apiCode) summary.apiCode = safeText(apiCode, FIELD_MAX)
    // axios 자체 문구만 쓴다(서버 응답 본문 message 는 싣지 않는다).
    if (typeof err.message === 'string' && err.message !== '') summary.message = safeText(err.message, MESSAGE_MAX)
    return summary
  }
  if (err instanceof Error) {
    const summary: SafeErrorSummary = { kind: safeText(err.name || 'Error', FIELD_MAX) }
    if (typeof err.message === 'string' && err.message !== '') summary.message = safeText(err.message, MESSAGE_MAX)
    return summary
  }
  if (typeof err === 'string') {
    return err === '' ? { kind: 'string' } : { kind: 'string', message: safeText(err, MESSAGE_MAX) }
  }
  if (err !== null && typeof err === 'object') {
    // 정규화 오류 객체({ code, message, status?, originalError? }) — code·status·message 만 쓴다.
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') {
      const summary: SafeErrorSummary = { kind: 'ApiError', code: safeText(code, FIELD_MAX) }
      const status = httpStatusOf(err)
      if (status !== undefined) summary.status = status
      const message = (err as { message?: unknown }).message
      if (typeof message === 'string' && message !== '') summary.message = safeText(message, MESSAGE_MAX)
      return summary
    }
    return { kind: 'object' }
  }
  return { kind: err === null ? 'null' : typeof err }
}

/** 오류 → 안전 요약. 요약 중 예외가 나면 { kind: 'unloggable' }. throw 하지 않는다. */
export function summarizeError(err: unknown): SafeErrorSummary {
  try {
    return summarizeUnsafe(err)
  } catch {
    return { kind: 'unloggable' }
  }
}

/**
 * 오류 → 로그용 한 줄 문자열.
 * 예: `AxiosError status=503 code=ERR_BAD_RESPONSE apiCode=MEMBER_REQUIRED message="Request failed with status code 503"`
 * 요약할 수 없으면 '[unloggable error]'. throw 하지 않는다.
 */
export function describeError(err: unknown): string {
  try {
    const s = summarizeUnsafe(err)
    const parts: string[] = [s.kind]
    if (s.status !== undefined) parts.push(`status=${s.status}`)
    if (s.code !== undefined) parts.push(`code=${s.code}`)
    if (s.apiCode !== undefined) parts.push(`apiCode=${s.apiCode}`)
    if (s.message !== undefined) parts.push(`message=${JSON.stringify(s.message)}`)
    return parts.join(' ')
  } catch {
    return '[unloggable error]'
  }
}
