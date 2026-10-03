/**
 * 전역 unhandledrejection 처리기 — 요약 로그·기본 처리 억제·원시값 reason 만 명시 전송.
 * 실제 SDK 기준 전송 건수(종류마다 1건)는 lib/sentry.test.ts 의 R3 가 잠근다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock('../lib/sentry', () => ({
  Sentry: { captureException: (...a: unknown[]) => h.captureException(...a) },
}))

import { handleUnhandledRejection } from './unhandledRejection'
import { describeError } from './safeErrorLog'

function rejectionEvent(reason: unknown): { reason: unknown; preventDefault: ReturnType<typeof vi.fn> } {
  return { reason, preventDefault: vi.fn() }
}

describe('handleUnhandledRejection', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    h.captureException.mockReset()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('R1 콘솔에는 describeError 요약 문자열만 남기고 preventDefault 를 1회 호출한다', () => {
    const reason = new Error('boom')
    const event = rejectionEvent(reason)
    handleUnhandledRejection(event)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[unhandledrejection] caught:', describeError(reason))
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['문자열', 'No accessory'],
    ['undefined', undefined],
    ['null', null],
    ['숫자', 42],
  ] as const)('R2 원시값 reason(%s)은 captureException 1회(같은 값)', (_label, reason) => {
    handleUnhandledRejection(rejectionEvent(reason))
    expect(h.captureException).toHaveBeenCalledTimes(1)
    expect(h.captureException).toHaveBeenCalledWith(reason)
  })

  it.each([
    ['Error', new Error('boom')],
    ['평범한 객체', { code: 'SERVER_ERROR', message: 'm' }],
    ['함수', () => undefined],
  ] as const)('R2 %s reason 은 명시 전송하지 않는다(기본 전역 처리기 담당)', (_label, reason) => {
    handleUnhandledRejection(rejectionEvent(reason))
    expect(h.captureException).not.toHaveBeenCalled()
  })

  it('R2 명시 전송이 throw 해도 preventDefault 는 호출된다', () => {
    h.captureException.mockImplementation(() => {
      throw new Error('transport')
    })
    const event = rejectionEvent('No accessory')
    expect(() => handleUnhandledRejection(event)).not.toThrow()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })
})
