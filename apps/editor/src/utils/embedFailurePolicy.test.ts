import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  EMBED_FAILURE_MESSAGES,
  EmbedInitError,
  SAVE_FAILURE_MESSAGES,
  canCreateSessionAfterOrderLookupFailure,
  classifyRequestFailure,
  resolveInitFailure,
  resolveTemplateSetLoadFailure,
  saveFailureMessage,
  shouldCreateGuestAfterMemberCreateFailure,
} from './embedFailurePolicy'

function httpError(status: number, data: Record<string, unknown> = {}): AxiosError {
  const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: cfg,
  })
}
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')
const timeoutError = () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED')

/** 고객 문구에 실리면 안 되는 axios·서버 원문 조각 */
const RAW_FRAGMENTS = ['Request failed', 'Network Error', 'timeout of', 'server raw']

describe('classifyRequestFailure', () => {
  it.each([
    ['ERR_NETWORK', networkError(), 'connectivity'],
    ['ECONNABORTED', timeoutError(), 'connectivity'],
    ['500', httpError(500), 'server'],
    ['502', httpError(502), 'server'],
    ['503', httpError(503), 'server'],
    ['504', httpError(504), 'server'],
    ['408', httpError(408), 'server'],
    ['429', httpError(429), 'server'],
    ['401', httpError(401), 'auth'],
    ['400', httpError(400), 'client'],
    ['403', httpError(403), 'client'],
    ['404', httpError(404), 'client'],
    ['409', httpError(409), 'client'],
    ['413', httpError(413), 'client'],
    ['422', httpError(422), 'client'],
    ['TypeError', new TypeError('x'), 'other'],
    ['빈 객체', {}, 'other'],
    ['null', null, 'other'],
  ] as const)('%s → %s', (_label, err, kind) => {
    expect(classifyRequestFailure(err).kind).toBe(kind)
  })

  it('응답 본문 code 와 상태를 함께 돌려준다', () => {
    expect(classifyRequestFailure(httpError(400, { code: 'MEMBER_REQUIRED' }))).toEqual({
      kind: 'client',
      status: 400,
      apiCode: 'MEMBER_REQUIRED',
    })
    expect(classifyRequestFailure(networkError())).toEqual({ kind: 'connectivity', apiCode: null })
  })

  it.each([
    [{ code: 'TIMEOUT', message: 'm' }, 'connectivity'],
    [{ code: 'NETWORK_ERROR', message: 'm' }, 'connectivity'],
    [{ code: 'SERVER_ERROR', message: 'm', status: 502 }, 'server'],
    [{ code: 'AUTH_EXPIRED', message: 'm', status: 401 }, 'auth'],
    [{ code: 'VALIDATION_ERROR', message: 'm', status: 400 }, 'client'],
    [{ code: 'UNKNOWN', message: 'm' }, 'client'],
    [{ code: 'SOMETHING_ELSE', message: 'm' }, 'other'],
  ] as const)('정규화 오류 객체 %o → %s', (err, kind) => {
    expect(classifyRequestFailure(err).kind).toBe(kind)
  })

  it('code 속성이 있어도 Error 인스턴스는 정규화 객체로 보지 않는다', () => {
    expect(classifyRequestFailure(Object.assign(new Error('x'), { code: 'NETWORK_ERROR' })).kind).toBe('other')
  })
})

describe('shouldCreateGuestAfterMemberCreateFailure', () => {
  it.each([
    ['400 MEMBER_REQUIRED', httpError(400, { code: 'MEMBER_REQUIRED' })],
    ['400 code 없음', httpError(400, {})],
    ['400 검증 메시지 배열', httpError(400, { message: ['orderSeqno must be a number'] })],
    ['403 PERMISSION_DENIED', httpError(403, { code: 'PERMISSION_DENIED' })],
  ])('%s → 비회원 세션 생성으로 넘어간다', (_label, err) => {
    expect(shouldCreateGuestAfterMemberCreateFailure(err)).toBe(true)
  })

  it.each([
    ['400 OTHER', httpError(400, { code: 'OTHER' })],
    ['403 ORDER_NOT_ALLOWED', httpError(403, { code: 'ORDER_NOT_ALLOWED' })],
    ['403 code 없음', httpError(403, {})],
    ['401', httpError(401)],
    ['404', httpError(404)],
    ['413', httpError(413)],
    ['422', httpError(422)],
    ['500', httpError(500)],
    ['503', httpError(503)],
    ['408', httpError(408)],
    ['429', httpError(429)],
    ['ERR_NETWORK', networkError()],
    ['ECONNABORTED', timeoutError()],
    ['TypeError', new TypeError('x')],
  ])('%s → 넘어가지 않는다', (_label, err) => {
    expect(shouldCreateGuestAfterMemberCreateFailure(err)).toBe(false)
  })
})

describe('canCreateSessionAfterOrderLookupFailure', () => {
  it.each([
    ['400', httpError(400)],
    ['403', httpError(403)],
    ['404', httpError(404)],
    ['409', httpError(409)],
    ['TypeError', new TypeError('x')],
  ])('%s → 새 세션 생성으로 진행한다', (_label, err) => {
    expect(canCreateSessionAfterOrderLookupFailure(err)).toBe(true)
  })

  it.each([
    ['ERR_NETWORK', networkError()],
    ['ECONNABORTED', timeoutError()],
    ['500', httpError(500)],
    ['503', httpError(503)],
    ['408', httpError(408)],
    ['429', httpError(429)],
    ['401', httpError(401)],
  ])('%s → 중단한다', (_label, err) => {
    expect(canCreateSessionAfterOrderLookupFailure(err)).toBe(false)
  })
})

describe('resolveInitFailure', () => {
  const M = EMBED_FAILURE_MESSAGES

  it.each([
    ['ERR_NETWORK', networkError(), 'NETWORK_ERROR', M.sessionConnectivity],
    ['ECONNABORTED', timeoutError(), 'NETWORK_ERROR', M.sessionConnectivity],
    ['503', httpError(503, { message: 'server raw' }), 'NETWORK_ERROR', M.sessionServer],
    ['429', httpError(429), 'NETWORK_ERROR', M.sessionServer],
    ['403', httpError(403, { code: 'ORDER_NOT_ALLOWED', message: 'server raw' }), 'INVALID_DATA', M.sessionRejected],
    ['404', httpError(404), 'INVALID_DATA', M.sessionRejected],
    ['정규화 TIMEOUT', { code: 'TIMEOUT', message: 'm' }, 'NETWORK_ERROR', M.sessionConnectivity],
    ['정규화 NETWORK_ERROR', { code: 'NETWORK_ERROR', message: 'm' }, 'NETWORK_ERROR', M.sessionConnectivity],
    ['정규화 SERVER_ERROR', { code: 'SERVER_ERROR', message: 'm' }, 'NETWORK_ERROR', M.sessionServer],
    ['정규화 VALIDATION_ERROR', { code: 'VALIDATION_ERROR', message: 'm' }, 'INVALID_DATA', M.sessionRejected],
    ['TypeError', new TypeError("Cannot read properties of undefined (reading 'objects')"), 'INVALID_DATA', M.initGeneric],
    ['Error', new Error('SpreadSpec 구성에 실패했습니다.'), 'INVALID_DATA', M.initGeneric],
    ['문자열', 'boom', 'INVALID_DATA', M.initGeneric],
  ] as const)('%s → %s(고정 문구)', (_label, err, code, message) => {
    expect(resolveInitFailure(err)).toEqual({ action: 'notifyHost', code, message })
  })

  it('편집기가 직접 던진 안내 오류는 그 문구를 INVALID_DATA 로 쓴다', () => {
    expect(resolveInitFailure(new EmbedInitError('접근 권한이 없습니다. 로그인 후 다시 시도해주세요.'))).toEqual({
      action: 'notifyHost',
      code: 'INVALID_DATA',
      message: '접근 권한이 없습니다. 로그인 후 다시 시도해주세요.',
    })
  })

  it.each([
    ['401', httpError(401)],
    ['정규화 AUTH_EXPIRED', { code: 'AUTH_EXPIRED', message: 'm', status: 401 }],
  ])('%s → 호스트 알림 없이 인증 만료 화면 문구', (_label, err) => {
    expect(resolveInitFailure(err)).toEqual({ action: 'screenOnly', screenMessage: M.authExpired })
  })

  it('어떤 입력도 axios·서버 원문을 문구에 싣지 않는다', () => {
    for (const err of [networkError(), timeoutError(), httpError(503, { message: 'server raw' }), httpError(404)]) {
      const r = resolveInitFailure(err)
      const text = r.action === 'notifyHost' ? r.message : r.screenMessage
      for (const fragment of RAW_FRAGMENTS) expect(text).not.toContain(fragment)
    }
  })
})

describe('resolveTemplateSetLoadFailure', () => {
  const M = EMBED_FAILURE_MESSAGES

  it.each([404, 400, 403, 410, 422])('%s → TEMPLATE_SET_NOT_FOUND(고정 문구)', (status) => {
    expect(resolveTemplateSetLoadFailure(httpError(status))).toEqual({
      action: 'notifyHost',
      code: 'TEMPLATE_SET_NOT_FOUND',
      message: M.templateSetNotFound,
    })
  })

  it.each([500, 502, 503, 504, 408, 429])('%s → NETWORK_ERROR(서버 문구)', (status) => {
    expect(resolveTemplateSetLoadFailure(httpError(status))).toEqual({
      action: 'notifyHost',
      code: 'NETWORK_ERROR',
      message: M.sessionServer,
    })
  })

  it.each([
    ['ERR_NETWORK', networkError()],
    ['ECONNABORTED', timeoutError()],
  ])('%s → NETWORK_ERROR(연결 문구)', (_label, err) => {
    expect(resolveTemplateSetLoadFailure(err)).toEqual({
      action: 'notifyHost',
      code: 'NETWORK_ERROR',
      message: M.sessionConnectivity,
    })
  })

  it('401 → 호스트 알림 없이 인증 만료 화면 문구', () => {
    expect(resolveTemplateSetLoadFailure(httpError(401))).toEqual({
      action: 'screenOnly',
      screenMessage: M.authExpired,
    })
  })

  it('HTTP 가 아닌 로드 실패는 TEMPLATE_SET_NOT_FOUND 이고 원문을 싣지 않는다', () => {
    const r = resolveTemplateSetLoadFailure(new Error('SpreadSpec 구성에 실패했습니다.'))
    expect(r).toEqual({ action: 'notifyHost', code: 'TEMPLATE_SET_NOT_FOUND', message: M.templateSetNotFound })
    expect(JSON.stringify(r)).not.toContain('SpreadSpec')
  })
})

describe('saveFailureMessage', () => {
  it.each(['save', 'complete'] as const)('%s 단계: 분류별 고정 문구', (phase) => {
    const M = SAVE_FAILURE_MESSAGES[phase]
    expect(saveFailureMessage(networkError(), phase)).toBe(M.connectivity)
    expect(saveFailureMessage(timeoutError(), phase)).toBe(M.connectivity)
    expect(saveFailureMessage(httpError(503), phase)).toBe(M.server)
    expect(saveFailureMessage(httpError(429), phase)).toBe(M.server)
    expect(saveFailureMessage(httpError(401), phase)).toBe(M.auth)
    expect(saveFailureMessage(httpError(403, { code: 'GUEST_SESSION_EXPIRED' }), phase)).toBe(M.rejected)
    expect(saveFailureMessage(httpError(400, { code: 'PDF_ATTACHED_EXCLUSIVE' }), phase)).toBe(M.rejected)
    expect(saveFailureMessage(httpError(413), phase)).toBe(M.tooLarge)
    expect(saveFailureMessage(new Error('저장에 실패했습니다.'), phase)).toBe(M.other)
    expect(saveFailureMessage(undefined, phase)).toBe(M.other)
  })

  it('정규화 오류 객체도 같은 분류를 쓴다', () => {
    expect(saveFailureMessage({ code: 'SERVER_ERROR', message: 'm', status: 500 }, 'save')).toBe(
      SAVE_FAILURE_MESSAGES.save.server,
    )
    expect(saveFailureMessage({ code: 'VALIDATION_ERROR', message: 'm', status: 413 }, 'complete')).toBe(
      SAVE_FAILURE_MESSAGES.complete.tooLarge,
    )
  })

  it('모든 문구가 서로 다르고 axios 원문을 싣지 않는다', () => {
    const all = [...Object.values(SAVE_FAILURE_MESSAGES.save), ...Object.values(SAVE_FAILURE_MESSAGES.complete)]
    expect(new Set(all).size).toBe(all.length)
    for (const text of all) for (const fragment of RAW_FRAGMENTS) expect(text).not.toContain(fragment)
  })
})
