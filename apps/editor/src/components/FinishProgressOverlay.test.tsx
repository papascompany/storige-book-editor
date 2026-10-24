/**
 * B10: 편집완료 진행 오버레이(단계·캔버스 진행 수) + 이탈 경고 가드(arm/disarm 동기 등록·해제).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FinishProgressOverlay, {
  FINISH_LEAVE_WARNING,
  createFinishLeaveGuard,
  finishProgressPercent,
} from './FinishProgressOverlay'

function stageStates(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const li of Array.from(document.querySelectorAll('li[data-stage]'))) {
    out[li.getAttribute('data-stage') ?? ''] = li.getAttribute('data-state')
  }
  return out
}

describe('FinishProgressOverlay', () => {
  it('progress 가 null 이면 아무것도 그리지 않는다', () => {
    const { container } = render(<FinishProgressOverlay progress={null} detail="x" />)
    expect(container.innerHTML).toBe('')
  })

  it('저장 단계: 저장 active, 나머지 pending, 진행 수 없음', () => {
    render(<FinishProgressOverlay progress={{ stage: 'save' }} detail="작업을 저장하는 중..." />)
    expect(screen.getByTestId('finish-progress-overlay')).toBeTruthy()
    expect(stageStates()).toEqual({ save: 'active', generate: 'pending', upload: 'pending', complete: 'pending' })
    expect(screen.queryByTestId('finish-progress-count')).toBeNull()
    expect(screen.getByText('작업을 저장하는 중...')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('PDF 생성 단계: 저장 done, 생성 active, 캔버스 n / 총수 표시', () => {
    render(<FinishProgressOverlay progress={{ stage: 'generate', current: 3, total: 26 }} />)
    expect(stageStates()).toEqual({ save: 'done', generate: 'active', upload: 'pending', complete: 'pending' })
    expect(screen.getByTestId('finish-progress-count').textContent).toBe('캔버스 3 / 26')
  })

  it('PDF 생성 단계라도 총수를 모르면 진행 수를 숨긴다', () => {
    render(<FinishProgressOverlay progress={{ stage: 'generate' }} />)
    expect(screen.queryByTestId('finish-progress-count')).toBeNull()
  })

  it('완료 단계: 앞 3단계 done, 완료 active', () => {
    render(<FinishProgressOverlay progress={{ stage: 'complete' }} />)
    expect(stageStates()).toEqual({ save: 'done', generate: 'done', upload: 'done', complete: 'active' })
  })
})

describe('finishProgressPercent', () => {
  it('처리 중 캔버스 직전까지를 완료분으로 계산, 범위 밖은 자른다', () => {
    expect(finishProgressPercent({ stage: 'generate', current: 1, total: 4 })).toBe(0)
    expect(finishProgressPercent({ stage: 'generate', current: 3, total: 4 })).toBe(50)
    expect(finishProgressPercent({ stage: 'generate', current: 9, total: 4 })).toBe(100)
    expect(finishProgressPercent({ stage: 'generate', current: 0, total: 4 })).toBe(0)
  })

  it('생성 단계가 아니거나 총수가 없으면 null', () => {
    expect(finishProgressPercent({ stage: 'upload', current: 1, total: 4 })).toBeNull()
    expect(finishProgressPercent({ stage: 'generate' })).toBeNull()
  })
})

describe('createFinishLeaveGuard', () => {
  function fakeTarget() {
    const listeners = new Set<(e: BeforeUnloadEvent) => unknown>()
    const target = {
      addEventListener: vi.fn((type: string, fn: (e: BeforeUnloadEvent) => unknown) => {
        if (type === 'beforeunload') listeners.add(fn)
      }),
      removeEventListener: vi.fn((type: string, fn: (e: BeforeUnloadEvent) => unknown) => {
        if (type === 'beforeunload') listeners.delete(fn)
      }),
    }
    return { target: target as unknown as Window, listeners, raw: target }
  }

  it('arm 시 beforeunload 를 등록하고 핸들러는 preventDefault + returnValue 를 설정한다', () => {
    const { target, listeners } = fakeTarget()
    const guard = createFinishLeaveGuard(target)
    expect(guard.armed).toBe(false)
    guard.arm()
    expect(guard.armed).toBe(true)
    expect(listeners.size).toBe(1)

    const ev = { preventDefault: vi.fn(), returnValue: '' } as unknown as BeforeUnloadEvent
    const ret = [...listeners][0](ev)
    expect(ev.preventDefault).toHaveBeenCalledTimes(1)
    expect(ev.returnValue).toBe(FINISH_LEAVE_WARNING)
    expect(ret).toBe(FINISH_LEAVE_WARNING)
  })

  it('arm/disarm 중복 호출은 무해하고 disarm 후 리스너가 남지 않는다', () => {
    const { target, listeners, raw } = fakeTarget()
    const guard = createFinishLeaveGuard(target)
    guard.arm()
    guard.arm()
    expect(raw.addEventListener).toHaveBeenCalledTimes(1)
    guard.disarm()
    guard.disarm()
    expect(raw.removeEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
    expect(guard.armed).toBe(false)
  })
})
