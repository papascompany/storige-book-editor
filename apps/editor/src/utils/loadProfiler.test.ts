import { describe, expect, it } from 'vitest'
import {
  createLoadProfiler,
  formatLoadProfile,
  setActiveLoadProfiler,
  clearActiveLoadProfiler,
  lap,
} from './loadProfiler'

function fakeClock(steps: number[]) {
  let i = 0
  return () => steps[Math.min(i++, steps.length - 1)]
}

describe('loadProfiler (P1-5 재진입 로드 단계 계측)', () => {
  it('mark 는 직전 mark 대비 delta 와 누적 at 을 기록한다', () => {
    const p = createLoadProfiler(fakeClock([0, 100, 350, 350]))
    p.mark('a')
    p.mark('b', { n: 1 })
    const s = p.summary()
    expect(s.phases).toEqual([
      { phase: 'a', deltaMs: 100, atMs: 100 },
      { phase: 'b', deltaMs: 250, atMs: 350, extra: { n: 1 } },
    ])
    expect(s.totalMs).toBe(350)
    expect(s.slowest).toEqual({ phase: 'b', ms: 250 })
  })

  it('lap 은 반복 구간을 count/total/max 로 집계하고 slowest 후보에 포함한다', () => {
    // t0=0 | lap1 0→3000 | lap2 3000→5000 | summary 5000
    const p = createLoadProfiler(fakeClock([0, 0, 3000, 3000, 5000, 5000]))
    const end1 = p.lapStart('restore:page')
    end1()
    const end2 = p.lapStart('restore:page')
    end2()
    const s = p.summary()
    expect(s.laps['restore:page']).toEqual({ count: 2, totalMs: 5000, maxMs: 3000 })
    expect(s.slowest).toEqual({ phase: 'restore:page×2', ms: 5000 })
  })

  it('format 은 한 줄 요약을 만든다', () => {
    const p = createLoadProfiler(fakeClock([0, 10, 10]))
    p.mark('ready')
    expect(formatLoadProfile(p.summary())).toBe('total=10ms slowest=ready 10ms | ready 10')
  })

  it('performance.now 폴백 없이도 동작(기본 clock)', () => {
    const p = createLoadProfiler()
    p.mark('x')
    expect(p.summary().phases[0].phase).toBe('x')
  })
})

describe('활성 프로파일러 레지스트리', () => {
  it('미등록이면 lap 은 no-op 이고 매번 같은 상수를 돌려준다(할당 0)', () => {
    const a = lap('x')
    const b = lap('y')
    expect(a).toBe(b)
    expect(() => a()).not.toThrow()
  })

  it('등록 중에는 활성 프로파일러에 집계된다', () => {
    const p = createLoadProfiler(fakeClock([0, 0, 50, 50, 120, 120]))
    setActiveLoadProfiler(p)
    try {
      lap('grow:plugins')()
      lap('grow:plugins')()
    } finally {
      clearActiveLoadProfiler(p)
    }
    expect(p.summary().laps['grow:plugins']).toEqual({ count: 2, totalMs: 120, maxMs: 70 })
  })

  it('해제 후에는 다시 no-op 으로 돌아간다', () => {
    const p = createLoadProfiler()
    setActiveLoadProfiler(p)
    clearActiveLoadProfiler(p)
    lap('after')()
    expect(p.summary().laps).toEqual({})
  })

  it('clear 는 자기 자신일 때만 비운다(겹친 초기화가 살아 있는 계측을 끊지 않음)', () => {
    const first = createLoadProfiler()
    const second = createLoadProfiler()
    setActiveLoadProfiler(first)
    setActiveLoadProfiler(second)
    clearActiveLoadProfiler(first) // 먼저 끝난 쪽이 해제 시도 — 슬롯은 second 소유
    lap('still-counted')()
    clearActiveLoadProfiler(second)
    expect(second.summary().laps['still-counted']?.count).toBe(1)
    expect(first.summary().laps).toEqual({})
  })
})
