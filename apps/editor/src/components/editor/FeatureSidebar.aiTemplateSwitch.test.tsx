/**
 * W8-2b D4 — AI 패널 템플릿셋 전환.
 *
 * 잠그는 것:
 *   - 편집 중인 디자인(URL 에 sessionId·session_id, 또는 sessionId 없는 주문번호 진입이라도 같은 주소로
 *     다시 열면 기존 세션으로 열리는 경우 — embed 가 aiTemplateSetSwitchBlocked 로 알림)은 전환하지 않고
 *     고정 한국어 안내(토스트)만 띄운다. 재편집은 세션 세트로 열리므로(세션 세트 우선) URL templateSetId 만
 *     바꾸면 전환이 조용히 무효가 된다.
 *   - 신규 편집(위에 해당하지 않음)은 현행대로 URL 의 templateSetId 를 바꿔 다시 연다(다른 쿼리 보존).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

const panel = vi.hoisted(() => ({
  props: null as null | { onSelectTemplate?: (id: string) => void; onGenerated?: (id: string) => void },
}))

vi.mock('@/components/AiPanel', () => ({
  LazyAiPanel: (props: { onSelectTemplate?: (id: string) => void; onGenerated?: (id: string) => void }) => {
    panel.props = props
    return null
  },
}))
vi.mock('@/tools/AppText', () => ({ default: () => null }))
vi.mock('@/tools/AppImage', () => ({ default: () => null }))
vi.mock('@/tools/AppElement', () => ({ default: () => null }))
vi.mock('@/tools/AppBackground', () => ({ default: () => null }))
vi.mock('@/tools/AppTemplate', () => ({ default: () => null }))
vi.mock('@/tools/AppTemplateSwap', () => ({ default: () => null }))
vi.mock('@/tools/AppFrame', () => ({ default: () => null }))
vi.mock('@/tools/SmartCodes', () => ({ default: () => null }))

import FeatureSidebar, {
  AI_TEMPLATE_SET_SWITCH_BLOCKED_MESSAGE,
  resolveAiTemplateSetSwitch,
} from './FeatureSidebar'
import { useAppStore } from '@/stores/useAppStore'
import { useToastStore } from '@/stores/useToastStore'

const BASE = 'https://editor.example'

describe('resolveAiTemplateSetSwitch (W8-2b D4)', () => {
  it('sessionId 가 있으면 전환하지 않고 고정 안내 문구', () => {
    expect(resolveAiTemplateSetSwitch(`${BASE}/embed?sessionId=s1&templateSetId=a`, 'b')).toEqual({
      kind: 'blocked',
      message: '편집 중인 디자인은 다른 템플릿셋으로 바꿀 수 없습니다. 새로 편집해 주세요.',
    })
  })

  it('snake_case session_id 도 같은 차단', () => {
    expect(resolveAiTemplateSetSwitch(`${BASE}/embed?session_id=s1`, 'b').kind).toBe('blocked')
  })

  it('sessionId 없는 주문번호 진입이라도 기존 세션으로 다시 열리면(sessionPinned) 같은 차단', () => {
    expect(
      resolveAiTemplateSetSwitch(`${BASE}/embed?templateSetId=a&orderSeqno=7&mode=both&token=T`, 'b', true),
    ).toEqual({ kind: 'blocked', message: AI_TEMPLATE_SET_SWITCH_BLOCKED_MESSAGE })
  })

  it('신규 편집(sessionId 없음)은 templateSetId 만 바꾼 URL 로 이동(다른 쿼리 보존)', () => {
    const next = resolveAiTemplateSetSwitch(`${BASE}/embed?templateSetId=a&orderSeqno=7&token=T`, 'b')
    expect(next.kind).toBe('navigate')
    const url = new URL((next as { kind: 'navigate'; href: string }).href)
    expect(url.searchParams.get('templateSetId')).toBe('b')
    expect(url.searchParams.get('orderSeqno')).toBe('7')
    expect(url.searchParams.get('token')).toBe('T')
  })
})

describe('FeatureSidebar AI 패널 — 편집 중인 디자인의 템플릿셋 전환 차단 (W8-2b D4)', () => {
  const initialPath = `${window.location.pathname}${window.location.search}${window.location.hash}`

  beforeEach(() => {
    panel.props = null
    act(() => {
      useToastStore.setState({ toasts: [] })
      useAppStore.setState({ currentMenu: { type: 'AI', label: 'AI' }, activeSelection: [] } as never)
    })
  })

  afterEach(() => {
    window.history.replaceState(null, '', initialPath)
    act(() => {
      useToastStore.setState({ toasts: [] })
      useAppStore.setState({ currentMenu: null, activeSelection: [] } as never)
    })
  })

  it.each(['onSelectTemplate', 'onGenerated'] as const)(
    'sessionId 가 있으면 %s 가 주소를 바꾸지 않고 안내 토스트를 띄운다',
    (handler) => {
      window.history.replaceState(null, '', '/embed?sessionId=s1&templateSetId=a')
      const before = window.location.href
      render(<FeatureSidebar />)
      expect(panel.props).not.toBeNull()

      act(() => {
        panel.props![handler]!('b')
      })

      expect(window.location.href).toBe(before)
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ message: AI_TEMPLATE_SET_SWITCH_BLOCKED_MESSAGE, type: 'warning' }),
      ])
    },
  )

  it.each(['onSelectTemplate', 'onGenerated'] as const)(
    'sessionId 없는 주문번호 진입에서 aiTemplateSetSwitchBlocked 면 %s 가 주소를 바꾸지 않고 안내 토스트를 띄운다',
    (handler) => {
      window.history.replaceState(null, '', '/embed?templateSetId=a&orderSeqno=7&mode=both')
      const before = window.location.href
      render(<FeatureSidebar aiTemplateSetSwitchBlocked />)
      expect(panel.props).not.toBeNull()

      act(() => {
        panel.props![handler]!('b')
      })

      expect(window.location.href).toBe(before)
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ message: AI_TEMPLATE_SET_SWITCH_BLOCKED_MESSAGE, type: 'warning' }),
      ])
    },
  )
})
