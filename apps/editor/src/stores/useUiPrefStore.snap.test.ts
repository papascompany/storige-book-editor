// useUiPrefStore 스냅 설정 + persist 마이그레이션 (C9/E2 W4 §6-3)
//
//  ① 기본값: 스냅 3종 전부 true(현행 상시-ON 거동)
//  ② setter 동작
//  ③ persist v7→8 마이그레이션: 기존 사용자(snap 키 부재)도 true 로 승격(얕은 병합 회귀 방지)
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('useUiPrefStore — 스냅 기본값·setter', () => {
  it('① 스냅 3종 기본 true', async () => {
    localStorage.clear()
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    const s = useUiPrefStore.getState()
    expect(s.snapGuidesEnabled).toBe(true)
    expect(s.snapCenterEnabled).toBe(true)
    expect(s.snapAngleEnabled).toBe(true)
  })

  it('② setter 로 개별 토글', async () => {
    localStorage.clear()
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    useUiPrefStore.getState().setSnapCenterEnabled(false)
    expect(useUiPrefStore.getState().snapCenterEnabled).toBe(false)
    // 다른 토글은 불변
    expect(useUiPrefStore.getState().snapGuidesEnabled).toBe(true)
  })
})

describe('useUiPrefStore — persist v7→8 마이그레이션', () => {
  beforeEach(() => localStorage.clear())

  it('③ 기존 사용자(v7, snap 키 없음)는 snap 전부 true 로 승격 + 기존 값 보존', async () => {
    // v7 상태 시드(스냅 키 없음, showRuler=true)
    localStorage.setItem(
      'storige-ui-pref',
      JSON.stringify({ state: { showRuler: true }, version: 7 })
    )
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    const s = useUiPrefStore.getState()

    expect(s.snapGuidesEnabled).toBe(true) // undefined → true 승격(OFF 회귀 방지)
    expect(s.snapCenterEnabled).toBe(true)
    expect(s.snapAngleEnabled).toBe(true)
    expect(s.showRuler).toBe(true) // 기존 값 보존
  })

  it('명시적으로 false 저장된 값은 마이그레이션이 덮어쓰지 않는다', async () => {
    // 이미 v8 에서 off 로 저장한 사용자
    localStorage.setItem(
      'storige-ui-pref',
      JSON.stringify({ state: { snapCenterEnabled: false }, version: 8 })
    )
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    expect(useUiPrefStore.getState().snapCenterEnabled).toBe(false)
  })
})
