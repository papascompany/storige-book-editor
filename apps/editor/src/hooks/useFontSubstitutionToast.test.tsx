import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EventEmitter } from 'events'
import { useFontSubstitutionToast } from './useCoverRegion'
import { useAppStore } from '@/stores/useAppStore'
import { showToast } from '@/stores/useToastStore'

vi.mock('@/stores/useToastStore', () => ({ showToast: vi.fn() }))

/**
 * useFontSubstitutionToast (2026-11-05): FontPlugin 의 `fontSubstituted` 이벤트 → 안내 toast 브리지.
 * - 구독 시점에 FontPlugin 이 보관한 지난 대체 내역(ready 이전 로드분)을 재생한다
 * - 이후 이벤트는 요청 패밀리당 1회만 toast
 * - ready=false 또는 editor 없음이면 아무것도 하지 않는다
 * - 언마운트 시 구독 해제
 */

const DEFAULT = '본고딕(Noto Sans) Regular'

function makeEditor(pastSubstitutions: Array<{ requested: string; applied: string }> = []) {
  const emitter = new EventEmitter()
  const fontPlugin = { getFontSubstitutions: vi.fn(() => pastSubstitutions) }
  const editor = Object.assign(emitter, {
    getPlugin: vi.fn((name: string) => (name === 'FontPlugin' ? fontPlugin : undefined)),
  })
  return { editor, fontPlugin, emitter }
}

beforeEach(() => {
  vi.mocked(showToast).mockClear()
  useAppStore.setState({ editor: null })
})

describe('useFontSubstitutionToast', () => {
  it('ready 이전 로드에서 일어난 대체 내역을 구독 시점에 재생한다', () => {
    const { editor } = makeEditor([{ requested: 'Times New Roman', applied: DEFAULT }])
    useAppStore.setState({ editor: editor as never })

    renderHook(() => useFontSubstitutionToast(true))

    expect(showToast).toHaveBeenCalledTimes(1)
    const [message, type] = vi.mocked(showToast).mock.calls[0]
    expect(message).toContain("'Times New Roman'")
    expect(message).toContain(`'${DEFAULT}'`)
    expect(type).toBe('warning')
  })

  it('이벤트는 요청 패밀리당 1회만 toast 하고, 다른 패밀리는 따로 안내한다', () => {
    const { editor, emitter } = makeEditor()
    useAppStore.setState({ editor: editor as never })

    renderHook(() => useFontSubstitutionToast(true))
    expect(showToast).not.toHaveBeenCalled()

    emitter.emit('fontSubstituted', { requested: 'Times New Roman', applied: DEFAULT })
    emitter.emit('fontSubstituted', { requested: 'Times New Roman', applied: DEFAULT })
    expect(showToast).toHaveBeenCalledTimes(1)

    emitter.emit('fontSubstituted', { requested: 'Arial', applied: DEFAULT })
    expect(showToast).toHaveBeenCalledTimes(2)
    expect(vi.mocked(showToast).mock.calls[1][0]).toContain("'Arial'")
  })

  it('빈 payload 는 무시한다', () => {
    const { editor, emitter } = makeEditor()
    useAppStore.setState({ editor: editor as never })
    renderHook(() => useFontSubstitutionToast(true))

    emitter.emit('fontSubstituted', { requested: '', applied: DEFAULT })
    emitter.emit('fontSubstituted', undefined)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('ready=false 이면 구독도 재생도 하지 않는다', () => {
    const { editor, fontPlugin, emitter } = makeEditor([{ requested: 'Arial', applied: DEFAULT }])
    useAppStore.setState({ editor: editor as never })

    renderHook(() => useFontSubstitutionToast(false))

    expect(fontPlugin.getFontSubstitutions).not.toHaveBeenCalled()
    expect(emitter.listenerCount('fontSubstituted')).toBe(0)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('언마운트 시 구독을 해제한다', () => {
    const { editor, emitter } = makeEditor()
    useAppStore.setState({ editor: editor as never })

    const { unmount } = renderHook(() => useFontSubstitutionToast(true))
    expect(emitter.listenerCount('fontSubstituted')).toBe(1)

    unmount()
    expect(emitter.listenerCount('fontSubstituted')).toBe(0)

    emitter.emit('fontSubstituted', { requested: 'Arial', applied: DEFAULT })
    expect(showToast).not.toHaveBeenCalled()
  })
})
