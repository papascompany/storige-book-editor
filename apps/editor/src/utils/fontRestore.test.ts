import { describe, it, expect, vi } from 'vitest'
import { normalizeRestoredFonts } from './fontRestore'

/**
 * normalizeRestoredFonts (2026-11-05): 복원 직후 FontPlugin.normalizeCanvasFonts 위임 + 안전 가드.
 * - FontPlugin 이 있으면 해당 캔버스로 위임하고 변경 수를 돌려준다
 * - editor/canvas/FontPlugin 부재, 구형 플러그인(메서드 없음), 예외 → 0 (복원은 계속)
 */

const canvas = { getObjects: () => [] } as never

describe('normalizeRestoredFonts', () => {
  it('FontPlugin.normalizeCanvasFonts 에 캔버스를 넘기고 변경 수를 돌려준다', () => {
    const normalizeCanvasFonts = vi.fn(() => 2)
    const editor = { getPlugin: vi.fn(() => ({ normalizeCanvasFonts })) } as never
    expect(normalizeRestoredFonts(editor, canvas)).toBe(2)
    expect(normalizeCanvasFonts).toHaveBeenCalledWith(canvas)
  })

  it('editor 또는 canvas 가 없으면 0', () => {
    expect(normalizeRestoredFonts(undefined, canvas)).toBe(0)
    expect(normalizeRestoredFonts({ getPlugin: vi.fn() } as never, null)).toBe(0)
  })

  it('FontPlugin 이 없거나 메서드가 없으면 0', () => {
    expect(normalizeRestoredFonts({ getPlugin: vi.fn(() => undefined) } as never, canvas)).toBe(0)
    expect(normalizeRestoredFonts({ getPlugin: vi.fn(() => ({})) } as never, canvas)).toBe(0)
  })

  it('정규화 중 예외가 나도 0 을 돌려주고 던지지 않는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const editor = {
      getPlugin: vi.fn(() => ({
        normalizeCanvasFonts: () => {
          throw new Error('boom')
        }
      }))
    } as never
    expect(normalizeRestoredFonts(editor, canvas)).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
