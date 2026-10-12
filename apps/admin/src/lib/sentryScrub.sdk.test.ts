// @vitest-environment happy-dom
/**
 * sentry 전처리 — 실제 @sentry/react(v7) BrowserClient + 기록용 transport 로 전송 본문(envelope) 기준 판정.
 *
 * 로그인 요청(POST /auth/login) 실패 오류와 그 console breadcrumb 이 전송될 때의 본문을 본다.
 * 픽스처 값은 모두 더미이며 JWT·사이트 키 형태 문자열은 런타임에 조립한다.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi, type MockInstance } from 'vitest'
import * as Sentry from '@sentry/react'
import type { Breadcrumb, Event } from '@sentry/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { FILTERED, scrubBreadcrumb, scrubEvent } from './sentryScrub'

const JWT = ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(8)].join('.')
const EMAIL = ['operator.login', 'example.com'].join('@')
const PASSWORD = 'PWDUMMY-login-1'
const SITE_KEY = 'sk-storige-' + '0b'.repeat(24)

interface Harness {
  client: Sentry.BrowserClient
  bodies: string[]
}

function makeHarness(hooks: boolean): Harness {
  const bodies: string[] = []
  const decoder = new globalThis.TextDecoder()
  const client = new Sentry.BrowserClient({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    stackParser: Sentry.defaultStackParser,
    integrations: [
      Sentry.breadcrumbsIntegration({ console: true, dom: false, fetch: false, xhr: false, sentry: false, history: false }),
    ],
    sendClientReports: false,
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, (request) => {
        bodies.push(typeof request.body === 'string' ? request.body : decoder.decode(request.body))
        return Promise.resolve({ statusCode: 200 })
      }),
    ...(hooks
      ? {
          beforeBreadcrumb: (b: Breadcrumb) => scrubBreadcrumb(b),
          beforeSend: <T extends Event>(e: T) => scrubEvent(e),
          beforeSendTransaction: <T extends Event>(e: T) => scrubEvent(e),
        }
      : {}),
  })
  Sentry.setCurrentClient(client)
  client.init()
  return { client, bodies }
}

/** POST /auth/login 실패(401) AxiosError — 요청 헤더 Authorization, 본문 email·password */
function loginError(): AxiosError {
  const headers = new AxiosHeaders()
  headers.set('Authorization', `Bearer ${JWT}`)
  headers.set('Content-Type', 'application/json')
  const config = {
    url: '/auth/login',
    method: 'post',
    headers,
    data: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  } as InternalAxiosRequestConfig
  return new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, undefined, {
    status: 401,
    data: { message: '이메일 또는 비밀번호가 올바르지 않습니다' },
    statusText: '',
    headers: {},
    config,
  })
}

/** 로그인 화면과 같은 순서로 console.error 후 요청 정보를 담은 오류 객체를 보낸다 */
function emitLoginFailure(): void {
  const err = loginError()
  console.error('Login error:', err)
  Sentry.captureException({
    code: 'LOGIN_FAILED',
    message: 'login-failure-probe',
    url: err.config?.url,
    method: err.config?.method,
    headers: { Authorization: `Bearer ${JWT}` },
    data: err.config?.data,
  })
}

/** 전송 본문에서 console breadcrumb 항목 */
function consoleBreadcrumbs(bodies: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const line of bodies.flatMap((b) => b.split('\n'))) {
    let item: unknown
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    const crumbs = (item as { breadcrumbs?: unknown }).breadcrumbs
    if (!Array.isArray(crumbs)) continue
    for (const c of crumbs as Array<Record<string, unknown>>) {
      if (c.category === 'console') out.push(c)
    }
  }
  return out
}

describe('sentry 전처리 — 실제 SDK 직렬화 기준(admin)', () => {
  let current: Harness | null = null
  // console 계측은 처음 만든 클라이언트에서 한 번 감싼다 — 파일 전체에서 같은 spy 를 유지한다.
  let consoleError: MockInstance<typeof console.error>

  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  afterEach(async () => {
    if (current) await current.client.close(0)
    current = null
    Sentry.getCurrentScope().clear()
  })

  it('하네스 대조 — 훅 미배선 클라이언트 전송 본문에는 입력 값이 그대로 있다', async () => {
    current = makeHarness(false)
    emitLoginFailure()
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('login-failure-probe')
    expect(body).toContain(PASSWORD)
    expect(body).toContain(JWT)
    const crumbs = consoleBreadcrumbs(current.bodies)
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].data).toHaveProperty('arguments')
  })

  it('로그인 요청 이벤트의 본문 필드와 Authorization 값을 [Filtered]로 보낸다', async () => {
    current = makeHarness(true)
    emitLoginFailure()
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('login-failure-probe')
    expect(body).toContain('/auth/login')
    expect(body).toContain(FILTERED)
    expect(body).not.toContain(PASSWORD)
    expect(body).not.toContain(EMAIL)
    expect(body).not.toContain(JWT)
    expect(body).not.toContain('Bearer')
    const crumbs = consoleBreadcrumbs(current.bodies)
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].message).toBe('Login error: AxiosError: Request failed with status code 401')
    expect(crumbs[0].data).toEqual({ logger: 'console' })
  })

  it('메시지 안의 사이트 키·이메일 형식 문자열은 [Filtered]로 보낸다', async () => {
    current = makeHarness(true)
    Sentry.captureMessage(`site-key-probe ${SITE_KEY} by ${EMAIL}`)
    await current.client.flush(2000)
    const body = current.bodies.join('\n')
    expect(body).toContain('site-key-probe')
    expect(body).toContain(`sk-storige-${FILTERED}`)
    expect(body).not.toContain(SITE_KEY)
    expect(body).not.toContain(EMAIL)
  })
})
