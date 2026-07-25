// FilterPlugin.dispose — 실버그 회귀 스펙
//
// 과거: FilterPlugin.dispose() 가 항상 비어 있는 eventHandlers Map 을 순회한 뒤
//       존재하지 않는 super.dispose()(PluginBase 미구현) 를 호출 → TypeError.
//       Editor.dispose 의 try/catch 가 이를 console.warn 으로 강등해 표면상 조용했지만,
//       플러그인 정리가 매 dispose 마다 예외로 중단됐다.
// 수정: PluginBase 에 no-op dispose() 추가 + FilterPlugin 의 dead-code override 제거.
//       → FilterPlugin 은 PluginBase 의 no-op dispose 를 상속하고 예외 없이 정리된다.
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock (SafeZoneWarningPlugin.test 패턴).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => {
  class MockImage {}
  return {
    fabric: {
      Canvas: class MockCanvas {},
      Image: MockImage,
    },
  }
})

// Editor 는 타입으로만 쓰이지만 default import 는 런타임 로드 → 전체 플러그인 그래프를
// 끌어오지 않도록 경량 mock 으로 대체.
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import FilterPlugin from './FilterPlugin'
import { PluginBase } from '../plugin'

function makePlugin(): FilterPlugin {
  const canvas = {} as never
  const editor = { emit: vi.fn(), off: vi.fn(), on: vi.fn() } as never
  return new FilterPlugin(canvas, editor)
}

describe('FilterPlugin.dispose — 실버그 회귀', () => {
  it('dispose() 는 TypeError 없이 완료된다 (과거 super.dispose() 크래시)', () => {
    const plugin = makePlugin()
    expect(typeof plugin.dispose).toBe('function')
    expect(() => plugin.dispose()).not.toThrow()
  })

  it('Editor.dispose 호출 패턴(`plugin.dispose && plugin.dispose()`)에서 예외가 나지 않는다', () => {
    const plugin = makePlugin()
    let caught: unknown = null
    // Editor.ts:97-101 의 정리 루프와 동일한 형태
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      plugin.dispose && plugin.dispose()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeNull()
  })

  it('dispose 는 PluginBase 의 no-op 을 상속한다 (dead-code override 제거 확인)', () => {
    const plugin = makePlugin()
    // 자기 인스턴스/프로토타입에 dispose 를 직접 정의하지 않는다
    expect(Object.prototype.hasOwnProperty.call(plugin, 'dispose')).toBe(false)
    expect(
      Object.prototype.hasOwnProperty.call(
        Object.getPrototypeOf(plugin),
        'dispose',
      ),
    ).toBe(false)
    // 상속된 dispose 는 PluginBase 의 것이며 no-op(undefined 반환)
    expect(plugin.dispose).toBe(PluginBase.prototype.dispose)
    expect(plugin.dispose()).toBeUndefined()
  })

  it('과거 dead-code 필드 eventHandlers 는 더 이상 존재하지 않는다', () => {
    const plugin = makePlugin() as unknown as { eventHandlers?: unknown }
    expect(plugin.eventHandlers).toBeUndefined()
  })
})
