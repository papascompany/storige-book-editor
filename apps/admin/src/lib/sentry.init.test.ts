/**
 * sentry 전처리 — initSentry 훅 배선(admin).
 *
 * @sentry/react 를 모킹하므로(vi.mock 은 파일 전체에 호이스팅) 순수 함수·실제 SDK 테스트
 * (sentryScrub.test.ts·sentryScrub.sdk.test.ts)와 파일을 분리했다. 모듈 전역 `initialized` 때문에
 * 테스트마다 vi.resetModules() 후 동적 import 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserOptions, Breadcrumb, Event } from '@sentry/react'

const h = vi.hoisted(() => ({
  init: vi.fn<(options: BrowserOptions) => void>(),
}))

vi.mock('@sentry/react', () => ({
  init: (options: BrowserOptions) => h.init(options),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}))

const DSN = 'https://publickey@o0.ingest.sentry.io/0'

async function loadSentryModule(): Promise<typeof import('./sentry')> {
  return import('./sentry')
}

function lastOptions(): BrowserOptions {
  const call = h.init.mock.calls.at(-1)
  if (!call) throw new Error('init not called')
  return call[0]
}

describe('sentry 전처리 — initSentry 훅 배선(admin)', () => {
  beforeEach(() => {
    vi.resetModules()
    h.init.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('DSN 이 있으면 init 옵션에 beforeBreadcrumb·beforeSend·beforeSendTransaction 이 함수로 있다', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN)
    const { initSentry } = await loadSentryModule()
    expect(initSentry()).toBe(true)
    expect(h.init).toHaveBeenCalledTimes(1)
    const opts = lastOptions()
    expect(opts.dsn).toBe(DSN)
    expect(typeof opts.beforeBreadcrumb).toBe('function')
    expect(typeof opts.beforeSend).toBe('function')
    expect(typeof opts.beforeSendTransaction).toBe('function')
  })

  it('ignoreErrors 는 종전 목록 그대로다', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN)
    const { initSentry, SENTRY_IGNORE_ERRORS } = await loadSentryModule()
    initSentry()
    const expected = [
      'Non-Error promise rejection captured',
      'ResizeObserver loop limit exceeded',
      'Failed to fetch',
      'NetworkError',
      'Load failed',
    ]
    expect(SENTRY_IGNORE_ERRORS).toEqual(expected)
    expect(lastOptions().ignoreErrors).toEqual(expected)
  })

  it('배선된 훅이 breadcrumb 과 error·transaction 이벤트의 자격증명 파라미터·이메일을 정리한다', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN)
    const { initSentry } = await loadSentryModule()
    initSentry()
    const opts = lastOptions()
    const email = ['operator', 'example.com'].join('@')

    const crumb: Breadcrumb = {
      category: 'console',
      level: 'error',
      message: `Login error: ${email}`,
      data: { arguments: ['Login error:', { email }], logger: 'console' },
    }
    const outCrumb = opts.beforeBreadcrumb?.(crumb)
    expect(outCrumb?.message).toBe('Login error: [Filtered]')
    expect(outCrumb?.data).toEqual({ logger: 'console' })

    const errorEvent = {
      type: undefined,
      request: { url: 'https://admin.example/edit-sessions?page=1#token=T1&refreshToken=R1' },
      extra: { operator: email, status: 401 },
    } satisfies Event
    const sent = await opts.beforeSend?.(errorEvent, {})
    expect(sent?.request?.url).toBe('https://admin.example/edit-sessions?page=1#token=[Filtered]&refreshToken=[Filtered]')
    expect(sent?.extra).toEqual({ operator: '[Filtered]', status: 401 })

    const txEvent = {
      type: 'transaction' as const,
      transaction: '/sites',
      request: { url: 'https://admin.example/sites?refreshToken=R2' },
    } satisfies Event
    const sentTx = await opts.beforeSendTransaction?.(txEvent, {})
    expect(sentTx?.transaction).toBe('/sites')
    expect(sentTx?.request?.url).toBe('https://admin.example/sites?refreshToken=[Filtered]')
  })

  it('DSN 이 없으면 init 을 호출하지 않고 false (기존 동작)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initSentry } = await loadSentryModule()
    expect(initSentry()).toBe(false)
    expect(h.init).not.toHaveBeenCalled()
  })
})
