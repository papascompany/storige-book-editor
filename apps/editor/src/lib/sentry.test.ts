/**
 * sentry 전처리 — URL 파라미터 정규화 (scrubUrl / scrubDeep / scrubBreadcrumb / scrubEvent).
 *
 * A~C: 순수 함수 단위. E: 실제 @sentry/react(v7) BrowserClient + 기록용 transport 로
 * 전송 직렬화 결과(envelope 본문) 기준 판정. 초기화 배선(initSentry)은 sentry.init.test.ts.
 * 픽스처 값은 모두 더미이며 JWT 형태 문자열은 런타임에 조립한다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import type { Breadcrumb, Event } from '@sentry/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import {
  FILTERED,
  SENTRY_IGNORE_ERRORS,
  isSensitiveObjectKey,
  isSensitiveParamKey,
  scrubBreadcrumb,
  scrubDeep,
  scrubEvent,
  scrubUrl,
} from './sentry'
import { handleUnhandledRejection } from '../utils/unhandledRejection'

const JWT = ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(8)].join('.')
const GUEST = '2222aaaa-bbbb-4ccc-8ddd-eeeeffff0000'
const SESSION_UUID = '1111aaaa-bbbb-4ccc-8ddd-eeeeffff0000'

describe('sentry 전처리 — 키 판정', () => {
  it('URL 파라미터 키: 접미사 규칙 + code·sig·md5 정확일치', () => {
    for (const k of [
      'token', 'guestToken', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'uploadToken', 'id_token', 'x-guest-token', 'X-Amz-Security-Token', 'X-Amz-Signature',
      'X-Amz-Credential', 'editorAuthCode', 'editor_auth_code', 'apiKey', 'api_key', 'x-api-key',
      'code', 'sig', 'md5', 'password', 'client_secret',
    ]) {
      expect(isSensitiveParamKey(k), k).toBe(true)
    }
  })

  it('비민감 키는 걸리지 않는다', () => {
    for (const k of [
      'templateSetId', 'sessionId', 'orderSeqno', 'pageCountMin', 'pageStep', 'status_code',
      'expires', 'needsAuth', 'tokenExpiresAt', 'code2', 'parentOrigin', 'X-Amz-Expires',
    ]) {
      expect(isSensitiveParamKey(k), k).toBe(false)
      expect(isSensitiveObjectKey(k), k).toBe(false)
    }
  })

  it('객체 키: code·md5·sig 는 보존, authorization·cookie 는 대상', () => {
    expect(isSensitiveObjectKey('code')).toBe(false)
    expect(isSensitiveObjectKey('md5')).toBe(false)
    expect(isSensitiveObjectKey('sig')).toBe(false)
    expect(isSensitiveObjectKey('Authorization')).toBe(true)
    expect(isSensitiveObjectKey('cookie')).toBe(true)
    expect(isSensitiveObjectKey('Set-Cookie')).toBe(true)
    expect(isSensitiveObjectKey('guestToken')).toBe(true)
  })
})

describe('sentry 전처리 — scrubUrl', () => {
  it('A1 쿼리 token 마스킹, templateSetId·parentOrigin 보존', () => {
    expect(scrubUrl(`/embed?templateSetId=ts1&token=${JWT}&parentOrigin=https%3A%2F%2Fh`)).toBe(
      `/embed?templateSetId=ts1&token=${FILTERED}&parentOrigin=https%3A%2F%2Fh`,
    )
  })

  it('A2 fragment token·refreshToken 마스킹, sessionId·adminEdit 보존', () => {
    expect(scrubUrl('/embed?sessionId=s1&adminEdit=session#token=A1&refreshToken=R1')).toBe(
      `/embed?sessionId=s1&adminEdit=session#token=${FILTERED}&refreshToken=${FILTERED}`,
    )
  })

  it('A3 snake·대소문자·헤더형 키', () => {
    for (const k of [
      'refresh_token', 'GUESTTOKEN', 'access_token', 'id_token', 'x-api-key', 'editorAuthCode',
      'editor_auth_code', 'uploadToken', 'apiKey',
    ]) {
      expect(scrubUrl(`https://h.example/p?a=1&${k}=v1`), k).toBe(`https://h.example/p?a=1&${k}=${FILTERED}`)
    }
  })

  it('A4 게스트 API URL: 경로 uuid 보존, guestToken 쿼리만 마스킹', () => {
    const out = scrubUrl(`https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${GUEST}`)
    expect(out).toBe(`https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${FILTERED}`)
  })

  it('A5 서명 URL: Credential·Signature 마스킹, Algorithm·Expires 보존 / md5 마스킹, expires 보존', () => {
    expect(
      scrubUrl('https://up.example/b/k.pdf?X-Amz-Algorithm=AWS4&X-Amz-Credential=AK%2F2026&X-Amz-Signature=abc123&X-Amz-Expires=900'),
    ).toBe(
      `https://up.example/b/k.pdf?X-Amz-Algorithm=AWS4&X-Amz-Credential=${FILTERED}&X-Amz-Signature=${FILTERED}&X-Amz-Expires=900`,
    )
    expect(scrubUrl('https://o.example/f.pdf?md5=abc&expires=123')).toBe(
      `https://o.example/f.pdf?md5=${FILTERED}&expires=123`,
    )
  })

  it('A6 인코딩 중첩 URL 안의 token%3D 마스킹, 이웃 파라미터 보존', () => {
    expect(scrubUrl('/embed?callbackUrl=https%3A%2F%2Fh%2Fcb%3Ftoken%3Dab%2Bcd%26x%3D1')).toBe(
      `/embed?callbackUrl=https%3A%2F%2Fh%2Fcb%3Ftoken%3D${FILTERED}%26x%3D1`,
    )
  })

  it('A7 자유 텍스트의 key=value 도 정리한다(searchParams 경고 문구 형태)', () => {
    const out = scrubUrl('[searchParams] Both refreshToken=AAA and refresh_token=BBB provided. Using camelCase.')
    expect(out).toBe(
      `[searchParams] Both refreshToken=${FILTERED} and refresh_token=${FILTERED} provided. Using camelCase.`,
    )
  })

  it('A8 Bearer·단독 JWT·JSON 문자열 키', () => {
    expect(scrubUrl('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${FILTERED}`)
    expect(scrubUrl(`value ${JWT} end`)).toBe(`value ${FILTERED} end`)
    expect(scrubUrl('{"guestToken":"u-1","status":"x"}')).toBe(`{"guestToken":"${FILTERED}","status":"x"}`)
    expect(scrubUrl('{"code":"SESSION_NOT_FOUND"}')).toBe('{"code":"SESSION_NOT_FOUND"}')
  })

  it('A9 비민감 파라미터 불변 + 멱등', () => {
    const keep = '/embed?pageCountMin=16&pageStep=4&code2=x&status_code=200&tokenExpiresAt=1&needsAuth=true'
    expect(scrubUrl(keep)).toBe(keep)
    expect(scrubUrl('/cb?code=abc&sig=q&state=s')).toBe(`/cb?code=${FILTERED}&sig=${FILTERED}&state=s`)
    for (const s of [
      `/embed?templateSetId=ts1&token=${JWT}#refreshToken=R`,
      '/embed?callbackUrl=https%3A%2F%2Fh%2Fcb%3Ftoken%3Dab%2Bcd%26x%3D1',
      'Bearer abc {"apiKey":"k"}',
    ]) {
      const once = scrubUrl(s)
      expect(scrubUrl(once)).toBe(once)
    }
  })

  it('A10 비문자열·빈 입력은 예외 없이 그대로 반환', () => {
    const obj = { a: 1 }
    expect(scrubUrl('')).toBe('')
    expect(scrubUrl(undefined)).toBeUndefined()
    expect(scrubUrl(null)).toBeNull()
    expect(scrubUrl(42)).toBe(42)
    expect(scrubUrl(obj)).toBe(obj)
  })
})

describe('sentry 전처리 — scrubDeep', () => {
  it('민감 키 [Filtered], 문자열 값 scrubUrl, Error 축약, 입력 불변', () => {
    const input = {
      sessionId: 's1',
      meta: { guestToken: 'g', url: '/x?token=t&a=1' },
      list: ['/y?refreshToken=r'],
      err: new Error('GET /z?guestToken=q failed'),
      code: 'SESSION_NOT_FOUND',
    }
    const snapshot = JSON.stringify(input)
    expect(scrubDeep(input)).toEqual({
      sessionId: 's1',
      meta: { guestToken: FILTERED, url: `/x?token=${FILTERED}&a=1` },
      list: [`/y?refreshToken=${FILTERED}`],
      err: { name: 'Error', message: `GET /z?guestToken=${FILTERED} failed` },
      code: 'SESSION_NOT_FOUND',
    })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('깊이 제한과 순환 참조', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
    expect(JSON.stringify(scrubDeep(deep))).toContain('[Object]')
    const cyc: Record<string, unknown> = { name: 'n' }
    cyc.self = cyc
    expect(scrubDeep(cyc)).toEqual({ name: 'n', self: '[Circular]' })
  })
})

describe('sentry 전처리 — scrubBreadcrumb', () => {
  it('B11 navigation from/to 정리, 입력 불변', () => {
    const input: Breadcrumb = {
      category: 'navigation',
      data: { from: '/embed?x=1#token=A1&refreshToken=R1', to: '/embed?x=1' },
    }
    const snapshot = JSON.stringify(input)
    const out = scrubBreadcrumb(input)
    expect(out?.data).toEqual({
      from: `/embed?x=1#token=${FILTERED}&refreshToken=${FILTERED}`,
      to: '/embed?x=1',
    })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('B12 xhr: url 만 정리, method·status_code 보존', () => {
    const out = scrubBreadcrumb({
      category: 'xhr',
      type: 'http',
      data: { method: 'PATCH', url: `https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${GUEST}`, status_code: 200 },
    })
    expect(out?.data).toEqual({
      method: 'PATCH',
      url: `https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${FILTERED}`,
      status_code: 200,
    })
    expect(out?.type).toBe('http')
  })

  it('B13 fetch 오류 breadcrumb', () => {
    const out = scrubBreadcrumb({
      category: 'fetch',
      level: 'error',
      data: { method: 'PUT', url: 'https://up.example/k?X-Amz-Signature=s1&X-Amz-Expires=900', status_code: 403 },
    })
    expect(out?.level).toBe('error')
    expect(out?.data?.url).toBe(`https://up.example/k?X-Amz-Signature=${FILTERED}&X-Amz-Expires=900`)
  })

  it('B14 console: message 정리, data.arguments 제거, logger 보존', () => {
    const out = scrubBreadcrumb({
      category: 'console',
      level: 'warning',
      message: '[searchParams] Both refreshToken=R1 and refresh_token=R2 provided.',
      data: { arguments: ['x', { token: 't' }], logger: 'console' },
    })
    expect(out?.message).toBe(`[searchParams] Both refreshToken=${FILTERED} and refresh_token=${FILTERED} provided.`)
    expect(out?.data).toEqual({ logger: 'console' })
  })

  it('B15 data 없는 ui.click 은 그대로 통과', () => {
    const b: Breadcrumb = { category: 'ui.click', message: 'body > div.btn' }
    expect(scrubBreadcrumb(b)).toEqual(b)
  })

  it('B16 순환 참조 data 에서도 결과를 낸다', () => {
    const data: Record<string, unknown> = { url: '/a?token=t' }
    data.loop = data
    const out = scrubBreadcrumb({ category: 'custom', data })
    expect(out).not.toBeNull()
    expect(out?.data).toEqual({ url: `/a?token=${FILTERED}`, loop: '[Circular]' })
  })
})

describe('sentry 전처리 — scrubEvent', () => {
  it('C17 request.url·query_string·Referer 정리, Authorization [Filtered], User-Agent 보존, cookies 제거', () => {
    const ev: Event = {
      request: {
        url: 'https://editor.example/embed?templateSetId=ts1&token=T1',
        query_string: 'templateSetId=ts1&token=T1',
        headers: { Referer: 'https://shop.example/order?token=T2&page=3', 'User-Agent': 'UA/1', Authorization: 'Bearer T3' },
        cookies: { sid: 'c' },
      },
    }
    const out = scrubEvent(ev)
    expect(out).toBe(ev)
    expect(out.request?.url).toBe(`https://editor.example/embed?templateSetId=ts1&token=${FILTERED}`)
    expect(out.request?.query_string).toBe(`templateSetId=ts1&token=${FILTERED}`)
    expect(out.request?.headers).toEqual({
      Referer: `https://shop.example/order?token=${FILTERED}&page=3`,
      'User-Agent': 'UA/1',
      Authorization: FILTERED,
    })
    expect(out.request?.cookies).toBeUndefined()
  })

  it('C17b query_string 배열·객체 형태', () => {
    const arr = scrubEvent({ request: { query_string: [['token', 'T'], ['a', '1']] } })
    expect(arr.request?.query_string).toEqual([['token', FILTERED], ['a', '1']])
    const obj = scrubEvent({ request: { query_string: { guestToken: 'G', page: '2' } } })
    expect(obj.request?.query_string).toEqual({ guestToken: FILTERED, page: '2' })
  })

  it('C18 extra: canvasData 삭제 유지, sessionId 보존, 중첩 guestToken 마스킹, code 보존', () => {
    const ev = scrubEvent({
      extra: {
        canvasData: '{"huge":true}',
        sessionId: 's1',
        templateSetId: 'ts1',
        meta: { guestToken: 'g' },
        err: { code: 'SESSION_NOT_FOUND' },
      },
    })
    expect(ev.extra).toEqual({
      sessionId: 's1',
      templateSetId: 'ts1',
      meta: { guestToken: FILTERED },
      err: { code: 'SESSION_NOT_FOUND' },
    })
  })

  it('C19 exception value·message·tags·contexts 의 URL 값 정리', () => {
    const ev = scrubEvent({
      message: 'failed /x?token=T',
      exception: { values: [{ type: 'Error', value: 'Load failed https://h/p?guestToken=G' }] },
      tags: { route: '/embed?token=T', n: 1 },
      contexts: { trace: { trace_id: 't', span_id: 's', data: { url: '/y?refreshToken=R' } } },
    })
    expect(ev.message).toBe(`failed /x?token=${FILTERED}`)
    expect(ev.exception?.values?.[0].value).toBe(`Load failed https://h/p?guestToken=${FILTERED}`)
    expect(ev.tags).toEqual({ route: `/embed?token=${FILTERED}`, n: 1 })
    expect(ev.contexts?.trace?.data).toEqual({ url: `/y?refreshToken=${FILTERED}` })
  })

  it('C20 event.breadcrumbs 도 정리한다', () => {
    const ev = scrubEvent({
      breadcrumbs: [
        { category: 'navigation', data: { from: '/e#token=A', to: '/e' } },
        { category: 'console', message: 'refreshToken=R', data: { arguments: ['R'] } },
      ],
    })
    expect(ev.breadcrumbs).toEqual([
      { category: 'navigation', data: { from: `/e#token=${FILTERED}`, to: '/e' } },
      { category: 'console', message: `refreshToken=${FILTERED}`, data: {} },
    ])
  })

  it('C21a plain object span: description·data 정리, transaction 이름 보존', () => {
    const span = {
      description: `PATCH https://api.example/g/${SESSION_UUID}?guestToken=${GUEST}`,
      data: { 'http.url': `https://api.example/g/${SESSION_UUID}?guestToken=${GUEST}`, url: `/g?guestToken=${GUEST}` },
    }
    const ev = scrubEvent({ type: 'transaction', transaction: '/embed', spans: [span] } as unknown as Event)
    expect(ev.transaction).toBe('/embed')
    expect(JSON.stringify(ev.spans)).not.toContain(GUEST)
    expect(span.description).toBe(`PATCH https://api.example/g/${SESSION_UUID}?guestToken=${FILTERED}`)
  })

  it('C21c 값 뒤에 따옴표·줄바꿈이 붙은 span 도 정리 후 유지된다(request·spans 보존)', () => {
    const quoted = { description: 'GET /x?token=a"b', data: { note: 'line1\nline2?token=c"d' } }
    const newline = { description: 'GET /y?guestToken=g\nnext' }
    const ev = scrubEvent({
      type: 'transaction',
      transaction: '/embed',
      request: { url: 'https://editor.example/embed?templateSetId=ts1' },
      spans: [quoted, newline],
    } as unknown as Event)
    expect(ev.spans).toHaveLength(2)
    expect(ev.request?.url).toBe('https://editor.example/embed?templateSetId=ts1')
    expect(quoted.description).toBe(`GET /x?token=${FILTERED}"b`)
    expect(quoted.data).toEqual({ note: `line1\nline2?token=${FILTERED}"d` })
    expect(newline.description).toBe(`GET /y?guestToken=${FILTERED}\nnext`)
  })

  it('C21d 정리 대상 밖 span 필드에 값이 남으면 spans·request 를 제거한다', () => {
    const span = { description: 'GET /ok', op: 'http.client /z?token=RAWSPAN1' }
    const ev = scrubEvent({
      type: 'transaction',
      transaction: '/embed',
      request: { url: 'https://editor.example/embed' },
      extra: { canvasData: '{"huge":true}', sessionId: 's1' },
      spans: [span],
    } as unknown as Event)
    expect(ev.spans).toBeUndefined()
    expect(ev.request).toBeUndefined()
    expect(ev.extra).toEqual({ sessionId: 's1' })
    expect(JSON.stringify(ev)).not.toContain('RAWSPAN1')
  })

  it('C22 내부 예외 시 request·breadcrumbs·spans 제거 후 반환(예외 전파 없음), canvasData 제외·extra·contexts 정리 유지', () => {
    const ev: Event = {
      breadcrumbs: [{ category: 'x' }],
      spans: [],
      exception: { values: [{ type: 'Error', value: 'v' }] },
      extra: { canvasData: '{"huge":true}', sessionId: 's1', meta: { guestToken: 'g' } },
      contexts: { diag: { url: '/y?refreshToken=R' } },
    }
    Object.defineProperty(ev, 'request', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('getter')
      },
    })
    let out: Event | undefined
    expect(() => {
      out = scrubEvent(ev)
    }).not.toThrow()
    expect(out).toBe(ev)
    expect('request' in ev).toBe(false)
    expect(ev.breadcrumbs).toBeUndefined()
    expect(ev.spans).toBeUndefined()
    expect(ev.exception?.values?.[0].value).toBe('v')
    expect(ev.extra).toEqual({ sessionId: 's1', meta: { guestToken: FILTERED } })
    expect(ev.contexts).toEqual({ diag: { url: `/y?refreshToken=${FILTERED}` } })
  })

  it('C22b extra·contexts 정리 중 예외 시 canvasData 와 정리 전 extra·contexts·tags 도 제거한다', () => {
    const contexts: Record<string, unknown> = {}
    Object.defineProperty(contexts, 'diag', {
      enumerable: true,
      get() {
        throw new Error('getter')
      },
    })
    const ev = {
      message: 'm',
      request: { url: '/e?token=T' },
      breadcrumbs: [{ category: 'x' }],
      extra: { canvasData: '{"huge":true}', sessionId: 's1' },
      contexts,
      tags: { route: '/embed?token=T' },
    } as unknown as Event
    const extraRef = ev.extra
    let out: Event | undefined
    expect(() => {
      out = scrubEvent(ev)
    }).not.toThrow()
    expect(out).toBe(ev)
    expect(extraRef).not.toHaveProperty('canvasData')
    expect(ev.extra).toBeUndefined()
    expect(ev.contexts).toBeUndefined()
    expect(ev.tags).toBeUndefined()
    expect(ev.request).toBeUndefined()
    expect(ev.breadcrumbs).toBeUndefined()
    expect(ev.message).toBe('m')
  })
})

// ─── E. 실제 SDK(v7) 직렬화 기준 ────────────────────────────────────────────────

interface Harness {
  client: Sentry.BrowserClient
  bodies: string[]
}

function makeHarness(opts: {
  /** true: 세 훅 모두, 'beforeBreadcrumb': beforeBreadcrumb 만, false: 미배선 */
  hooks: boolean | 'beforeBreadcrumb'
  integrations?: ReturnType<typeof Sentry.httpContextIntegration>[]
  /** initSentry 와 같은 목록을 쓰려면 SENTRY_IGNORE_ERRORS */
  ignoreErrors?: Array<string | RegExp>
}): Harness {
  const bodies: string[] = []
  const client = new Sentry.BrowserClient({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    stackParser: Sentry.defaultStackParser,
    integrations: opts.integrations ?? [],
    tracesSampleRate: 1,
    sendClientReports: false,
    ...(opts.ignoreErrors ? { ignoreErrors: opts.ignoreErrors } : {}),
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, (request) => {
        bodies.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body))
        return Promise.resolve({ statusCode: 200 })
      }),
    ...(opts.hooks === true
      ? {
          beforeBreadcrumb: (b: Breadcrumb) => scrubBreadcrumb(b),
          beforeSend: <T extends Event>(e: T) => scrubEvent(e),
          beforeSendTransaction: <T extends Event>(e: T) => scrubEvent(e),
        }
      : opts.hooks === 'beforeBreadcrumb'
        ? { beforeBreadcrumb: (b: Breadcrumb) => scrubBreadcrumb(b) }
        : {}),
  })
  Sentry.setCurrentClient(client)
  client.init()
  return { client, bodies }
}

/** xhr 계측과 같은 형태(attributes 로 시작) + fetch 계측과 같은 형태(생성 후 setAttributes) span 을 만든다. */
function emitHttpSpans(): void {
  Sentry.addTracingExtensions()
  Sentry.startSpan({ name: '/embed', op: 'pageload', forceTransaction: true }, () => {
    const guestPath = `https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${GUEST}`
    const xhr = Sentry.startInactiveSpan({
      name: `PATCH ${guestPath}`,
      onlyIfParent: true,
      op: 'http.client',
      attributes: {
        type: 'xhr',
        'http.method': 'PATCH',
        'http.url': guestPath,
        url: guestPath,
        'server.address': 'api.example',
      },
    })
    xhr?.end()

    const upload = 'https://up.example/b/k.pdf?X-Amz-Credential=AKDUMMY&X-Amz-Signature=SIGDUMMY&X-Amz-Expires=900'
    const fetchSpan = Sentry.startInactiveSpan({
      name: `PUT ${upload}`,
      onlyIfParent: true,
      op: 'http.client',
      attributes: { url: upload, type: 'fetch', 'http.method': 'PUT' },
    })
    fetchSpan?.setAttributes({ 'http.url': upload, 'server.address': 'up.example' })
    fetchSpan?.end()
  })
}

describe('sentry 전처리 — 실제 SDK 직렬화 기준', () => {
  let current: Harness | null = null

  afterEach(async () => {
    if (current) await current.client.close(0)
    current = null
    Sentry.getCurrentScope().clear()
    window.history.replaceState(null, '', '/')
  })

  it('E0 하네스 대조 — 훅 미배선 클라이언트 직렬화에는 입력 값이 그대로 있다', async () => {
    current = makeHarness({ hooks: false })
    emitHttpSpans()
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('"type":"transaction"')
    expect(body).toContain(GUEST)
    expect(body).toContain('SIGDUMMY')
  })

  it('C21b/E1 실제 Span(xhr·fetch) + request.url: 전송 본문에 원문 값이 없다', async () => {
    window.history.replaceState(null, '', `/embed?templateSetId=ts1&token=${JWT}`)
    current = makeHarness({ hooks: true, integrations: [Sentry.httpContextIntegration()] })
    emitHttpSpans()
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('"type":"transaction"')
    expect(body).not.toContain(GUEST)
    expect(body).not.toContain('AKDUMMY')
    expect(body).not.toContain('SIGDUMMY')
    expect(body).not.toContain(JWT)
    // 비민감 값은 보존
    expect(body).toContain(SESSION_UUID)
    expect(body).toContain('X-Amz-Expires=900')
    expect(body).toContain('templateSetId=ts1')

    const item = current.bodies
      .flatMap((b) => b.split('\n'))
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find((o): o is Record<string, unknown> => o !== null && o.type === 'transaction' && Array.isArray(o.spans))
    expect(item).toBeDefined()
    expect(item?.transaction).toBe('/embed')
    const spans = (item?.spans ?? []) as Array<{ description?: string; data?: Record<string, unknown> }>
    const xhr = spans.find((s) => s.data?.type === 'xhr')
    const fetchSpan = spans.find((s) => s.data?.type === 'fetch')
    expect(xhr?.description).toBe(
      `PATCH https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${FILTERED}`,
    )
    expect(xhr?.data?.['http.url']).toBe(
      `https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${FILTERED}`,
    )
    expect(xhr?.data?.url).toBe(`https://api.example/api/edit-sessions/guest/${SESSION_UUID}?guestToken=${FILTERED}`)
    expect(fetchSpan?.data?.['http.url']).toBe(
      `https://up.example/b/k.pdf?X-Amz-Credential=${FILTERED}&X-Amz-Signature=${FILTERED}&X-Amz-Expires=900`,
    )
    expect(fetchSpan?.data?.['http.method']).toBe('PUT')
  })

  it('E2 history.replaceState 로 fragment 를 지울 때의 navigation breadcrumb 도 정리된다', async () => {
    window.history.replaceState(null, '', '/embed?sessionId=s1&adminEdit=session#token=FRAGTOKEN1&refreshToken=FRAGREFRESH1')
    current = makeHarness({
      hooks: true,
      integrations: [
        Sentry.breadcrumbsIntegration({ console: false, dom: false, fetch: false, xhr: false, sentry: false, history: true }),
      ],
    })
    window.history.replaceState(null, '', '/embed?sessionId=s1&adminEdit=session')
    Sentry.captureMessage('probe')
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('"category":"navigation"')
    expect(body).not.toContain('FRAGTOKEN1')
    expect(body).not.toContain('FRAGREFRESH1')
    expect(body).toContain(`#token=${FILTERED}&refreshToken=${FILTERED}`)
    expect(body).toContain('sessionId=s1')
  })

  it('E2b beforeBreadcrumb 단독 배선: 기록 시점에 정리된다(대조: 미배선이면 원문 유지)', async () => {
    const historyOnly = (): ReturnType<typeof Sentry.breadcrumbsIntegration>[] => [
      Sentry.breadcrumbsIntegration({ console: false, dom: false, fetch: false, xhr: false, sentry: false, history: true }),
    ]
    const withFragment = '/embed?sessionId=s1&adminEdit=session#token=FRAGTOKEN2&refreshToken=FRAGREFRESH2'
    // v7 은 breadcrumb 을 current scope 에 기록한다
    const lastNavigationFrom = (): unknown => {
      const last = Sentry.getCurrentScope().getLastBreadcrumb()
      return last?.category === 'navigation' ? last.data?.from : undefined
    }

    // 대조군: 훅 미배선이면 기록된 breadcrumb 과 전송 본문에 원문이 남는다
    window.history.replaceState(null, '', withFragment)
    current = makeHarness({ hooks: false, integrations: historyOnly() })
    window.history.replaceState(null, '', '/embed?sessionId=s1&adminEdit=session')
    expect(String(lastNavigationFrom())).toContain('FRAGTOKEN2')
    Sentry.captureMessage('probe-control')
    await current.client.flush(2000)
    expect(current.bodies.join('\n')).toContain('FRAGTOKEN2')
    await current.client.close(0)

    // beforeBreadcrumb 만 배선(beforeSend 없음). 사전 상태 설정 때 이전 클라이언트가 남긴 기록은 비운다.
    window.history.replaceState(null, '', withFragment)
    Sentry.getCurrentScope().clear()
    current = makeHarness({ hooks: 'beforeBreadcrumb', integrations: historyOnly() })
    window.history.replaceState(null, '', '/embed?sessionId=s1&adminEdit=session')
    expect(lastNavigationFrom()).toBe(`/embed?sessionId=s1&adminEdit=session#token=${FILTERED}&refreshToken=${FILTERED}`)
    Sentry.captureMessage('probe')
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('"category":"navigation"')
    expect(body).not.toContain('FRAGTOKEN2')
    expect(body).not.toContain('FRAGREFRESH2')
  })
})

// ─── R·P. 미처리 rejection 전송 건수와 오류 객체 전송 본문 ─────────────────────────

/** 전송 본문에서 error 이벤트 항목 수 */
function errorEventCount(bodies: string[]): number {
  return bodies
    .flatMap((b) => b.split('\n'))
    .filter((line) => {
      try {
        const o = JSON.parse(line) as { type?: unknown }
        return o !== null && typeof o === 'object' && o.type === 'event'
      } catch {
        return false
      }
    }).length
}

/** 브라우저가 미처리 rejection 1건을 알릴 때처럼 전역 처리기(onunhandledrejection)와 등록 리스너를 차례로 부른다 */
function fireUnhandledRejection(reason: unknown): void {
  const event = { reason, preventDefault: (): void => {} }
  const g = globalThis as unknown as { onunhandledrejection?: ((e: unknown) => unknown) | null }
  expect(typeof g.onunhandledrejection).toBe('function')
  g.onunhandledrejection?.(event)
  handleUnhandledRejection(event)
}

/** 요청 헤더(Authorization·x-guest-token)와 본문(refreshToken·canvasData)을 가진 AxiosError */
function requestError(refreshValue: string): AxiosError {
  const headers = new AxiosHeaders()
  headers.set('Authorization', `Bearer ${JWT}`)
  headers.set('x-guest-token', GUEST)
  const config = {
    url: `/edit-sessions/${SESSION_UUID}`,
    method: 'patch',
    headers,
    data: JSON.stringify({ refreshToken: refreshValue, canvasData: [{ objects: [] }] }),
  } as InternalAxiosRequestConfig
  return new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', config, undefined, {
    status: 503,
    data: { message: 'Service Unavailable' },
    statusText: '',
    headers: {},
    config,
  })
}

describe('sentry — 미처리 rejection 1건당 전송 1건(실제 SDK: inboundFilters·globalHandlers·dedupe)', () => {
  let current: Harness | null = null

  afterEach(async () => {
    if (current) await current.client.close(0)
    current = null
    Sentry.getCurrentScope().clear()
    vi.restoreAllMocks()
  })

  function makeRejectionHarness(): Harness {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return makeHarness({
      hooks: true,
      ignoreErrors: SENTRY_IGNORE_ERRORS,
      integrations: [
        Sentry.inboundFiltersIntegration(),
        Sentry.globalHandlersIntegration({ onerror: false, onunhandledrejection: true }),
        Sentry.dedupeIntegration(),
      ],
    })
  }

  it.each([
    ['Error', () => new Error('rejection-error-probe')],
    ['평범한 객체', () => ({ code: 'SERVER_ERROR', message: 'rejection-object-probe' })],
    ['원시값(문자열)', () => 'rejection-primitive-probe'],
  ] as const)('R3 %s reason → error 이벤트 1건', async (_label, makeReason) => {
    current = makeRejectionHarness()
    fireUnhandledRejection(makeReason())
    await current.client.flush(2000)
    expect(errorEventCount(current.bodies)).toBe(1)
  })

  it('R3b 원시값 reason 전송 본문에는 값이 실리고 자격증명 모양 값은 정리된다', async () => {
    current = makeRejectionHarness()
    fireUnhandledRejection(`rejection-primitive-probe Bearer ${JWT}`)
    await current.client.flush(2000)
    expect(errorEventCount(current.bodies)).toBe(1)
    const body = current.bodies.join('\n')
    expect(body).toContain('rejection-primitive-probe')
    expect(body).not.toContain(JWT)
  })
})

describe('sentry — 오류 객체 전송 본문(실제 SDK 직렬화 + 전처리 훅)', () => {
  let current: Harness | null = null

  afterEach(async () => {
    if (current) await current.client.close(0)
    current = null
    Sentry.getCurrentScope().clear()
  })

  it('P1 AxiosError(요청 헤더·본문 포함) → 전송 본문에 Bearer·JWT·refreshToken 값·canvasData 가 없다', async () => {
    current = makeHarness({ hooks: true })
    Sentry.captureException(requestError('REFRESHDUMMY1'))
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(errorEventCount(current.bodies)).toBe(1)
    expect(body).not.toContain('Bearer')
    expect(body).not.toContain(JWT)
    expect(body).not.toContain('REFRESHDUMMY1')
    expect(body).not.toContain('canvasData')
    expect(body).not.toContain(GUEST)
  })

  it('P2 정규화 오류 객체({code, message, originalError: AxiosError}) → Bearer·JWT·refreshToken 값·x-guest-token 값이 없다', async () => {
    current = makeHarness({ hooks: true })
    Sentry.captureException({ code: 'SERVER_ERROR', message: 'm', originalError: requestError('REFRESHDUMMY2') })
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(errorEventCount(current.bodies)).toBe(1)
    expect(body).not.toContain('Bearer')
    expect(body).not.toContain(JWT)
    expect(body).not.toContain('REFRESHDUMMY2')
    expect(body).not.toContain(GUEST)
  })

  it('P2b 얕은 객체(headers.Authorization·x-guest-token, data 의 refreshToken) → 전처리로 값이 정리되고 진단값은 남는다', async () => {
    current = makeHarness({ hooks: true })
    Sentry.captureException({
      code: 'SERVER_ERROR',
      message: 'shallow-object-probe',
      headers: { Authorization: `Bearer ${JWT}`, 'x-guest-token': GUEST },
      data: JSON.stringify({ refreshToken: 'REFRESHDUMMY3', status: 'editing' }),
    })
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(errorEventCount(current.bodies)).toBe(1)
    expect(body).not.toContain('Bearer')
    expect(body).not.toContain(JWT)
    expect(body).not.toContain(GUEST)
    expect(body).not.toContain('REFRESHDUMMY3')
    // 깊이 절단이 아니라 전처리 경로를 거쳤는지: 정리 표지와 진단값이 함께 있다
    expect(body).toContain(FILTERED)
    expect(body).toContain('shallow-object-probe')
    expect(body).toContain('SERVER_ERROR')
  })
})
