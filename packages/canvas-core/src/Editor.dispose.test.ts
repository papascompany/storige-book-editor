// Editor.dispose 정리 보강 테스트 (ED-2)
//
// 검증 대상:
//  (a) dispose() 가 dispose 규약 플러그인과 destroyed 규약(Lifecycle) 플러그인을
//      모두 정리한다 — 기존에는 dispose() 만 호출해 destroyed() 만 구현한
//      5개 플러그인(History/Workspace/Spread/Lock/Accessory)이 누수됐다.
//  (b) bindingHotkeys 가 등록한 (input, handler) 쌍을 기억해 hotkeys.unbind 한다.
//  (c) contextMenu.dispose() 를 호출해 wrapperEl DOM 리스너를 해제한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock
vi.mock('fabric', () => ({ fabric: {} }))

const { hotkeysMock } = vi.hoisted(() => {
  const fn: any = vi.fn()
  fn.unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))

const { contextMenuDisposeSpy, contextMenuAddMenuSpy } = vi.hoisted(() => ({
  contextMenuDisposeSpy: vi.fn(),
  contextMenuAddMenuSpy: vi.fn()
}))
vi.mock('./contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = contextMenuAddMenuSpy
    dispose = contextMenuDisposeSpy
  }
}))

import Editor from './Editor'
import { PluginBase } from './plugin'

// ============================================================================
// Test Plugins
// ============================================================================

/** dispose() 규약 플러그인 (DraggingPlugin 등 13개와 동일 패턴) */
class DisposeConventionPlugin extends PluginBase {
  name = 'DisposeConventionPlugin'
  events: string[] = []
  hotkeys = [
    {
      name: 'Undo',
      input: ['ctrl+z', '⌘+z'],
      onlyForActiveObject: false,
      callback: vi.fn(),
      hideContext: true
    }
  ]
  disposeCalled = 0

  constructor(canvas: any, editor: any) {
    super(canvas, editor, {})
  }

  dispose() {
    this.disposeCalled += 1
  }
}

/** destroyed() Lifecycle 규약 플러그인 (HistoryPlugin 등 5개와 동일 패턴) */
class DestroyedConventionPlugin extends PluginBase {
  name = 'DestroyedConventionPlugin'
  events: string[] = []
  hotkeys: any[] = []
  destroyedCalled = 0

  constructor(canvas: any, editor: any) {
    super(canvas, editor, {})
  }

  destroyed(): Promise<void> {
    this.destroyedCalled += 1
    return Promise.resolve()
  }
}

function makeMockCanvas(): any {
  return {
    on: vi.fn(),
    off: vi.fn(),
    getActiveObject: vi.fn(() => null)
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Editor.dispose — 플러그인/단축키/컨텍스트메뉴 정리', () => {
  beforeEach(() => {
    hotkeysMock.mockClear()
    hotkeysMock.unbind.mockClear()
    contextMenuDisposeSpy.mockClear()
    contextMenuAddMenuSpy.mockClear()
  })

  function setupEditor() {
    const editor = new Editor()
    const canvas = makeMockCanvas()
    editor.init(canvas)

    const disposePlugin = new DisposeConventionPlugin(canvas, editor)
    const destroyedPlugin = new DestroyedConventionPlugin(canvas, editor)
    editor.use(disposePlugin)
    editor.use(destroyedPlugin)

    return { editor, canvas, disposePlugin, destroyedPlugin }
  }

  it('dispose 규약 플러그인의 dispose() 를 호출한다', () => {
    const { editor, disposePlugin } = setupEditor()

    editor.dispose()

    expect(disposePlugin.disposeCalled).toBe(1)
  })

  it('destroyed 규약(Lifecycle) 플러그인의 destroyed() 를 호출한다', () => {
    const { editor, destroyedPlugin } = setupEditor()

    editor.dispose()

    expect(destroyedPlugin.destroyedCalled).toBe(1)
  })

  it('bindingHotkeys 가 등록한 (input, handler) 쌍을 그대로 hotkeys.unbind 한다', () => {
    const { editor } = setupEditor()

    // 등록 시점의 (input, handler) 캡처 — ctrl+z / ⌘+z 두 건
    expect(hotkeysMock).toHaveBeenCalledTimes(2)
    const registered = hotkeysMock.mock.calls.map((call: any[]) => ({
      input: call[0],
      handler: call[2]
    }))
    expect(registered.map((r: any) => r.input)).toEqual(['ctrl+z', '⌘+z'])

    editor.dispose()

    expect(hotkeysMock.unbind).toHaveBeenCalledTimes(2)
    registered.forEach((r: any) => {
      expect(hotkeysMock.unbind).toHaveBeenCalledWith(r.input, r.handler)
    })
  })

  it('dispose 를 두 번 호출해도 unbind 가 중복되지 않는다 (멱등)', () => {
    const { editor } = setupEditor()

    editor.dispose()
    editor.dispose()

    expect(hotkeysMock.unbind).toHaveBeenCalledTimes(2) // 등록 2건만큼만
  })

  it('contextMenu.dispose() 를 호출한다', () => {
    const { editor } = setupEditor()

    editor.dispose()

    expect(contextMenuDisposeSpy).toHaveBeenCalledTimes(1)
  })

  it('플러그인 정리 중 오류가 나도 나머지 정리를 계속한다', () => {
    const editor = new Editor()
    const canvas = makeMockCanvas()
    editor.init(canvas)

    class ThrowingPlugin extends PluginBase {
      name = 'ThrowingPlugin'
      events: string[] = []
      hotkeys: any[] = []
      constructor(c: any, e: any) {
        super(c, e, {})
      }
      dispose() {
        throw new Error('boom')
      }
    }
    const throwing = new ThrowingPlugin(canvas, editor)
    const destroyedPlugin = new DestroyedConventionPlugin(canvas, editor)
    editor.use(throwing)
    editor.use(destroyedPlugin)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => editor.dispose()).not.toThrow()
    expect(destroyedPlugin.destroyedCalled).toBe(1)
    expect(contextMenuDisposeSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('dispose 후 getPlugin 은 undefined 를 반환한다', () => {
    const { editor } = setupEditor()

    editor.dispose()

    expect(editor.getPlugin('DisposeConventionPlugin')).toBeUndefined()
    expect(editor.getPlugin('DestroyedConventionPlugin')).toBeUndefined()
  })
})
