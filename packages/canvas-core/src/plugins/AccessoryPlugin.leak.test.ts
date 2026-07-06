// AccessoryPlugin object:moving 리스너 누수 회귀 테스트
//
// 검증 대상 (2026-07-02 적대검증으로 확정된 누수 a):
//  - bindObject() 가 등록하는 object:moving 리스너는 익명 클로저였고 참조를 저장하지
//    않아 해제 불가 → afterLoad/afterSave 재바인딩마다 리스너가 순증했다.
//  - 수정 후: 같은 객체(id)에 대한 bindObject 재호출 시 기존 리스너를 off 후 교체하고,
//    destroyed() 에서 일괄 해제한다.
import { describe, it, expect, vi } from 'vitest'

// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock
// (Editor.dispose.test.ts 와 동일 패턴)
vi.mock('fabric', () => ({ fabric: {} }))

const { hotkeysMock } = vi.hoisted(() => {
  const fn: any = vi.fn()
  fn.unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))

vi.mock('../contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = vi.fn()
    dispose = vi.fn()
  }
}))

import AccessoryPlugin from './AccessoryPlugin'

/** fabric Observable 의 on/off/__eventListeners 의미론을 흉내낸 mock 캔버스 */
function makeMockCanvas(): any {
  const __eventListeners: Record<string, Array<(e: any) => void>> = {}
  return {
    __eventListeners,
    on(eventName: string, handler: (e: any) => void) {
      if (!__eventListeners[eventName]) __eventListeners[eventName] = []
      __eventListeners[eventName].push(handler)
    },
    off(eventName: string, handler: (e: any) => void) {
      const listeners = __eventListeners[eventName]
      if (!listeners) return
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    getObjects: () => []
  }
}

function setupPlugin() {
  const canvas = makeMockCanvas()
  const plugin = new (AccessoryPlugin as any)(canvas, {} as any, {})
  return { canvas, plugin }
}

describe('AccessoryPlugin — object:moving 리스너 누수 회귀', () => {
  it('같은 객체에 bindObject 를 반복 호출해도 object:moving 리스너가 늘지 않는다', () => {
    const { canvas, plugin } = setupPlugin()
    const obj: any = { id: 'accessory', accessory: { movingArea: 'inner' } }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // addAccessory 1회 + afterLoad/afterSave 재바인딩을 흉내낸 반복 호출
    plugin.bindObject(obj)
    plugin.bindObject(obj)
    plugin.bindObject(obj)
    logSpy.mockRestore()

    expect(canvas.__eventListeners['object:moving']).toHaveLength(1)
  })

  it('destroyed() 가 bindObject 로 등록된 object:moving 리스너를 모두 해제한다', async () => {
    const { canvas, plugin } = setupPlugin()
    const objA: any = { id: 'accessory', accessory: { movingArea: 'inner' } }
    const objB: any = { id: 'accessory-2', accessory: { movingArea: 'inner' } }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    plugin.bindObject(objA)
    plugin.bindObject(objB)
    logSpy.mockRestore()

    expect(canvas.__eventListeners['object:moving']).toHaveLength(2)

    await plugin.destroyed()

    expect(canvas.__eventListeners['object:moving']).toHaveLength(0)
  })
})
