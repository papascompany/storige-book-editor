import { describe, it, expect, vi, beforeEach } from 'vitest'

// 라이브 스토어 결선만 검증 — 무거운 앱/설정 스토어는 최소 상태로 대체한다.
const appState = { allCanvas: [] as unknown[], isSpreadMode: true }
const settingsState: { spreadConfig: { regionScope?: string } | null } = { spreadConfig: null }
vi.mock('@/stores/useAppStore', () => ({ useAppStore: { getState: () => appState } }))
vi.mock('@/stores/useSettingsStore', () => ({ useSettingsStore: { getState: () => settingsState } }))

import { useEditorStore } from '@/stores/useEditorStore'
import { getPageStepBlockMessage, getLivePageStepViolation } from './pageStepGuard'

describe('pageStepGuard — 편집완료 차단 판정 (S8)', () => {
  beforeEach(() => {
    appState.allCanvas = []
    appState.isSpreadMode = true
    settingsState.spreadConfig = null
    useEditorStore.setState({ pageStep: null })
  })

  it('pageStep=null 이면 홀수여도 차단하지 않는다 (기존 동작)', () => {
    appState.allCanvas = new Array(18) // 표지 + 17p
    expect(getPageStepBlockMessage()).toBeNull()
  })

  it('pageStep=2, 표지 + 17p → 차단 메시지', () => {
    useEditorStore.setState({ pageStep: 2 })
    appState.allCanvas = new Array(18)
    expect(getLivePageStepViolation()).toMatchObject({ current: 17, nextValid: 18, prevValid: 16 })
    expect(getPageStepBlockMessage()).toContain('2페이지 단위')
  })

  it('pageStep=2, 표지 + 18p → 통과', () => {
    useEditorStore.setState({ pageStep: 2 })
    appState.allCanvas = new Array(19)
    expect(getPageStepBlockMessage()).toBeNull()
  })

  it('내지 전용 펼침면(inner): 캔버스 × 2 기준 — step 2 는 항상 통과, step 4 는 홀수 캔버스 차단', () => {
    settingsState.spreadConfig = { regionScope: 'inner' }
    appState.allCanvas = new Array(3) // 6p
    useEditorStore.setState({ pageStep: 2 })
    expect(getPageStepBlockMessage()).toBeNull()
    useEditorStore.setState({ pageStep: 4 })
    expect(getPageStepBlockMessage()).not.toBeNull()
  })
})
