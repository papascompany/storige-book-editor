/**
 * sentry 전처리 — initSentry 훅 배선.
 *
 * @sentry/react 를 모킹하므로(vi.mock 은 파일 전체에 호이스팅) 순수 함수·실제 SDK 테스트
 * (sentry.test.ts)와 파일을 분리했다. 모듈 전역 `initialized` 때문에 테스트마다
 * vi.resetModules() 후 동적 import 한다.
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

async function loadInitSentry(): Promise<() => boolean> {
  const mod = await import('./sentry')
  return mod.initSentry
}

function lastOptions(): BrowserOptions {
  const call = h.init.mock.calls.at(-1)
  if (!call) throw new Error('init not called')
  return call[0]
}

describe('sentry 전처리 — initSentry 훅 배선', () => {
  beforeEach(() => {
    vi.resetModules()
    h.init.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('D23 DSN 이 있으면 init 옵션에 beforeBreadcrumb·beforeSend·beforeSendTransaction 이 함수로 있다', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN)
    const initSentry = await loadInitSentry()
    expect(initSentry()).toBe(true)
    expect(h.init).toHaveBeenCalledTimes(1)
    const opts = lastOptions()
    expect(opts.dsn).toBe(DSN)
    expect(typeof opts.beforeBreadcrumb).toBe('function')
    expect(typeof opts.beforeSend).toBe('function')
    expect(typeof opts.beforeSendTransaction).toBe('function')
  })

  it('D24 배선된 훅이 navigation breadcrumb 과 canvasData·쿼리 token 이벤트를 정리한다', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN)
    const initSentry = await loadInitSentry()
    initSentry()
    const opts = lastOptions()

    const crumb: Breadcrumb = {
      category: 'navigation',
      data: { from: '/embed?sessionId=s1&adminEdit=session#token=A1&refreshToken=R1', to: '/embed?sessionId=s1&adminEdit=session' },
    }
    const outCrumb = opts.beforeBreadcrumb?.(crumb)
    expect(outCrumb?.data?.from).toBe('/embed?sessionId=s1&adminEdit=session#token=[Filtered]&refreshToken=[Filtered]')

    const errorEvent = {
      type: undefined,
      request: { url: 'https://editor.example/embed?templateSetId=ts1&token=T1' },
      extra: { canvasData: '{"big":true}', sessionId: 's1' },
    } satisfies Event
    const sent = await opts.beforeSend?.(errorEvent, {})
    expect(sent?.request?.url).toBe('https://editor.example/embed?templateSetId=ts1&token=[Filtered]')
    expect(sent?.extra).toEqual({ sessionId: 's1' })

    const txEvent = {
      type: 'transaction' as const,
      transaction: '/embed',
      request: { url: 'https://editor.example/embed?refreshToken=R2' },
    } satisfies Event
    const sentTx = await opts.beforeSendTransaction?.(txEvent, {})
    expect(sentTx?.transaction).toBe('/embed')
    expect(sentTx?.request?.url).toBe('https://editor.example/embed?refreshToken=[Filtered]')
  })

  it('D25 DSN 이 없으면 init 을 호출하지 않고 false (기존 동작)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const initSentry = await loadInitSentry()
    expect(initSentry()).toBe(false)
    expect(h.init).not.toHaveBeenCalled()
  })
})
