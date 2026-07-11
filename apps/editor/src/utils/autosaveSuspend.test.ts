import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isAutosaveSuspended,
  deferUntilAutosaveResumed,
  runWithAutosaveSuspended,
  __resetAutosaveSuspendForTest,
} from './autosaveSuspend'

/**
 * L4-② (2026-07-11): PDF 생성 중 autosave suspend 회귀 테스트.
 * 계약: suspend 창에서 발화한 자동저장은 **스킵이 아니라 지연** — 창이 닫히면 1회 실행.
 */

beforeEach(() => {
  __resetAutosaveSuspendForTest()
})

describe('autosaveSuspend', () => {
  it('기본 상태: suspend 아님 + defer 는 즉시 실행', () => {
    expect(isAutosaveSuspended()).toBe(false)
    const fn = vi.fn()
    deferUntilAutosaveResumed('k', fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('suspend 창 안에서는 실행 유예, 창이 닫히면 정확히 1회 실행', async () => {
    const save = vi.fn()
    await runWithAutosaveSuspended(async () => {
      expect(isAutosaveSuspended()).toBe(true)
      deferUntilAutosaveResumed('autosave', save)
      // 창 내부에서는 실행되지 않아야 한다 (toJSON 누락 창)
      expect(save).not.toHaveBeenCalled()
    })
    expect(isAutosaveSuspended()).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('같은 key 다중 발화는 1회로 dedupe (마지막 콜백 실행)', async () => {
    const first = vi.fn()
    const last = vi.fn()
    await runWithAutosaveSuspended(async () => {
      deferUntilAutosaveResumed('autosave', first)
      deferUntilAutosaveResumed('autosave', last)
    })
    expect(first).not.toHaveBeenCalled()
    expect(last).toHaveBeenCalledTimes(1)
  })

  it('다른 key 는 각각 1회 실행', async () => {
    const a = vi.fn()
    const b = vi.fn()
    await runWithAutosaveSuspended(async () => {
      deferUntilAutosaveResumed('server', a)
      deferUntilAutosaveResumed('local', b)
    })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('중첩 suspend: 최외곽 창이 닫힐 때만 flush', async () => {
    const save = vi.fn()
    await runWithAutosaveSuspended(async () => {
      await runWithAutosaveSuspended(async () => {
        deferUntilAutosaveResumed('autosave', save)
      })
      // 내부 창이 닫혀도 외곽 창이 살아 있으면 아직 유예
      expect(save).not.toHaveBeenCalled()
      expect(isAutosaveSuspended()).toBe(true)
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('PDF 생성 실패(throw)에도 suspend 해제 + 지연분 실행 (finally 계약)', async () => {
    const save = vi.fn()
    await expect(
      runWithAutosaveSuspended(async () => {
        deferUntilAutosaveResumed('autosave', save)
        throw new Error('pdf-gen-failed')
      }),
    ).rejects.toThrow('pdf-gen-failed')
    expect(isAutosaveSuspended()).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('fn 반환값 전달 (Blob 등 결과 파이프 유지)', async () => {
    const result = await runWithAutosaveSuspended(() => Promise.resolve('blob'))
    expect(result).toBe('blob')
  })

  it('지연 콜백의 예외는 다른 지연분 실행을 막지 않음', async () => {
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    await runWithAutosaveSuspended(async () => {
      deferUntilAutosaveResumed('a', bad)
      deferUntilAutosaveResumed('b', good)
    })
    expect(good).toHaveBeenCalledTimes(1)
  })
})
