// @vitest-environment jsdom
//
// useSnapSettingsSync 배선 테스트 (C9/E2 W4 §6-3, 적대 리뷰 #7 가드)
//  ① 3토글 → 정확한 세터 매핑
//  ② 중앙스냅 커플링: snapCenterEnabled → setCenterYieldEnabled + ruler.setCenterSnapEnabled 동시(데드존 방지)
//  ③ allEditors 전체 적용(다중 에디터)
//  ④ 킬스위치: VITE_ENABLE_SNAP_SETTINGS=false 면 persist OFF 를 무시하고 강제 true(거동 롤백)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { useAppStore } from '@/stores/useAppStore'

function makeEditor() {
  const sg = {
    setObjectSnapEnabled: vi.fn(),
    setAngleSnapEnabled: vi.fn(),
    setCenterYieldEnabled: vi.fn(),
  }
  const ruler = { setCenterSnapEnabled: vi.fn() }
  return {
    sg,
    ruler,
    getPlugin: (n: string) =>
      n === 'SmartGuidesPlugin' ? sg : n === 'RulerPlugin' ? ruler : undefined,
  }
}

beforeEach(() => {
  localStorage.clear()
  useUiPrefStore.setState({ snapGuidesEnabled: true, snapCenterEnabled: true, snapAngleEnabled: true })
})
afterEach(() => {
  useAppStore.setState({ allEditors: [] })
  vi.unstubAllEnvs()
})

describe('useSnapSettingsSync — 배선', () => {
  it('① 3토글 → 세터 매핑 + ② 중앙스냅 커플링(Yield+CenterSnap 동시)', async () => {
    const ed = makeEditor()
    useAppStore.setState({ allEditors: [ed as never] })
    useUiPrefStore.setState({ snapGuidesEnabled: true, snapCenterEnabled: false, snapAngleEnabled: false })

    const { useSnapSettingsSync } = await import('./useSnapSettingsSync')
    renderHook(() => useSnapSettingsSync(true))

    expect(ed.sg.setObjectSnapEnabled).toHaveBeenLastCalledWith(true)
    expect(ed.sg.setAngleSnapEnabled).toHaveBeenLastCalledWith(false)
    // 중앙스냅 OFF → 양보 해제 + 룰러 중앙스냅 OFF 동시(데드존 방지)
    expect(ed.sg.setCenterYieldEnabled).toHaveBeenLastCalledWith(false)
    expect(ed.ruler.setCenterSnapEnabled).toHaveBeenLastCalledWith(false)
  })

  it('③ allEditors 전체(다중 에디터)에 적용', async () => {
    const a = makeEditor()
    const b = makeEditor()
    useAppStore.setState({ allEditors: [a as never, b as never] })

    const { useSnapSettingsSync } = await import('./useSnapSettingsSync')
    renderHook(() => useSnapSettingsSync(true))

    expect(a.ruler.setCenterSnapEnabled).toHaveBeenCalled()
    expect(b.ruler.setCenterSnapEnabled).toHaveBeenCalled()
  })

  it('!ready 면 아무 세터도 호출 안 함', async () => {
    const ed = makeEditor()
    useAppStore.setState({ allEditors: [ed as never] })
    const { useSnapSettingsSync } = await import('./useSnapSettingsSync')
    renderHook(() => useSnapSettingsSync(false))
    expect(ed.sg.setObjectSnapEnabled).not.toHaveBeenCalled()
  })

  it('④ 킬스위치(VITE_ENABLE_SNAP_SETTINGS=false) → persist OFF 무시하고 강제 true', async () => {
    vi.stubEnv('VITE_ENABLE_SNAP_SETTINGS', 'false')
    vi.resetModules()
    // resetModules 후 훅이 참조하는 fresh 스토어에 상태를 세팅해야 한다(모듈 격리).
    const { useSnapSettingsSync } = await import('./useSnapSettingsSync')
    const { useAppStore: freshApp } = await import('@/stores/useAppStore')
    const { useUiPrefStore: freshPref } = await import('@/stores/useUiPrefStore')
    const ed = makeEditor()
    freshApp.setState({ allEditors: [ed as never] })
    // persist 에는 전부 OFF 저장돼 있어도
    freshPref.setState({ snapGuidesEnabled: false, snapCenterEnabled: false, snapAngleEnabled: false })

    renderHook(() => useSnapSettingsSync(true))

    // 강제 상시-ON 으로 롤백
    expect(ed.sg.setObjectSnapEnabled).toHaveBeenLastCalledWith(true)
    expect(ed.sg.setAngleSnapEnabled).toHaveBeenLastCalledWith(true)
    expect(ed.sg.setCenterYieldEnabled).toHaveBeenLastCalledWith(true)
    expect(ed.ruler.setCenterSnapEnabled).toHaveBeenLastCalledWith(true)
  })
})
