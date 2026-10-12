/**
 * sentry 전처리 — 순수 함수(scrubUrl / scrubDeep / scrubBreadcrumb / scrubEvent), node 환경.
 *
 * A~C 는 apps/editor/src/lib/sentry.test.ts(@06a44f3)와 같은 사례다. AD 는 admin 규칙(사이트 키·이메일).
 * 실제 SDK 직렬화 기준은 sentryScrub.sdk.test.ts, 초기화 배선은 sentry.init.test.ts.
 * 픽스처 값은 모두 더미이며 JWT·사이트 키 형태 문자열은 런타임에 조립한다.
 */
import { describe, it, expect } from 'vitest'
import type { Breadcrumb, Event } from '@sentry/react'
import {
  FILTERED,
  isSensitiveObjectKey,
  isSensitiveParamKey,
  scrubBreadcrumb,
  scrubDeep,
  scrubEvent,
  scrubUrl,
} from './sentryScrub'

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

// ─── AD. admin 규칙: 사이트 키·이메일 ────────────────────────────────────────────

/** 사이트 키 형태(접두어 + hex 48자) — 런타임 조립 */
const SITE_KEY = 'sk-storige-' + '0a'.repeat(24)
const SITE_KEY_MASKED = `sk-storige-${FILTERED}`
const EMAIL = ['operator', 'example.com'].join('@')

describe('sentry 전처리 — admin 규칙(사이트 키·이메일)', () => {
  it('AD1 사이트 키 형식 문자열은 접두어만 남기고 [Filtered]로 바꾼다', () => {
    expect(scrubUrl(`site key ${SITE_KEY} copied`)).toBe(`site key ${SITE_KEY_MASKED} copied`)
    expect(scrubUrl(`https://api.example/x?key=${SITE_KEY}&page=2`)).toBe(
      `https://api.example/x?key=${SITE_KEY_MASKED}&page=2`,
    )
    expect(scrubUrl(SITE_KEY.toUpperCase().replace('SK-STORIGE-', 'sk-storige-'))).toBe(SITE_KEY_MASKED)
    expect(scrubDeep({ name: 'site-a', note: `key=${SITE_KEY}`, list: [SITE_KEY] })).toEqual({
      name: 'site-a',
      note: `key=${SITE_KEY_MASKED}`,
      list: [SITE_KEY_MASKED],
    })
    const once = scrubUrl(`a ${SITE_KEY} b`)
    expect(scrubUrl(once)).toBe(once)
  })

  it('AD2 이메일 형식 문자열을 [Filtered]로 바꾼다', () => {
    expect(scrubUrl(`login failed for ${EMAIL}`)).toBe(`login failed for ${FILTERED}`)
    expect(scrubUrl(`{"email":"${EMAIL}","status":"x"}`)).toBe(`{"email":"${FILTERED}","status":"x"}`)
    expect(scrubUrl(`/users?email=${EMAIL}&page=1`)).toBe(`/users?email=${FILTERED}&page=1`)
    expect(scrubDeep({ user: { email: EMAIL, role: 'admin' } })).toEqual({ user: { email: FILTERED, role: 'admin' } })
    const once = scrubUrl(`a ${EMAIL} b`)
    expect(scrubUrl(once)).toBe(once)
  })

  it('AD3 사이트 키 형식이 아닌 접두어 문자열과 @ 가 들어간 비이메일 문자열은 그대로 둔다', () => {
    for (const s of [
      'sk-storige-REDACTED_SEE_VPS_ENV',
      'sk-storige-' + 'a'.repeat(8),
      'sk-storige-l3YV',
      '@sentry/react',
      'node_modules/@storige/types',
      'v@1',
    ]) {
      expect(scrubUrl(s), s).toBe(s)
    }
  })

  it('AD4 이벤트 메시지·예외 값·extra·breadcrumb 의 사이트 키와 이메일을 [Filtered]로 바꾼다', () => {
    const ev = scrubEvent({
      message: `create site failed: ${SITE_KEY}`,
      exception: { values: [{ type: 'Error', value: `user ${EMAIL} not found` }] },
      extra: { site: { name: 'site-a', key: SITE_KEY }, operator: EMAIL },
      breadcrumbs: [
        { category: 'console', level: 'error', message: `Login error: ${EMAIL}`, data: { arguments: [EMAIL], logger: 'console' } },
      ],
    })
    expect(ev.message).toBe(`create site failed: ${SITE_KEY_MASKED}`)
    expect(ev.exception?.values?.[0].value).toBe(`user ${FILTERED} not found`)
    expect(ev.extra).toEqual({ site: { name: 'site-a', key: SITE_KEY_MASKED }, operator: FILTERED })
    expect(ev.breadcrumbs).toEqual([
      { category: 'console', level: 'error', message: `Login error: ${FILTERED}`, data: { logger: 'console' } },
    ])
    expect(JSON.stringify(ev)).not.toContain(SITE_KEY)
    expect(JSON.stringify(ev)).not.toContain(EMAIL)
  })

  it('AD5 사이트 키는 대소문자 섞인 영문·숫자 16자 이상이면 접두어만 남기고 키 뒤에 붙은 문자는 그대로 둔다', () => {
    const mixed = 'sk-storige-' + 'Ab9x'.repeat(8)
    expect(scrubUrl(`key ${mixed} end`)).toBe(`key ${SITE_KEY_MASKED} end`)
    expect(scrubUrl(`${SITE_KEY}_copy`)).toBe(`${SITE_KEY_MASKED}_copy`)
    expect(scrubDeep({ note: `site ${mixed}` })).toEqual({ note: `site ${SITE_KEY_MASKED}` })
    const once = scrubUrl(`a ${mixed}_x b`)
    expect(scrubUrl(once)).toBe(once)
  })

  it('AD6 긴 문자열도 짧은 시간 안에 처리하고 로컬 파트가 긴 이메일의 도메인도 바꾼다', () => {
    const inputs = ['a'.repeat(200_000), 'a@' + 'b'.repeat(200_000), 'x.'.repeat(100_000)]
    for (const s of inputs) {
      const t0 = Date.now()
      expect(scrubUrl(s)).toBe(s)
      expect(Date.now() - t0).toBeLessThan(1000)
    }
    const longLocal = scrubUrl('x'.repeat(100) + '@example.com') as string
    expect(longLocal).not.toContain('@example.com')
    expect(longLocal.endsWith(FILTERED)).toBe(true)
  })
})
