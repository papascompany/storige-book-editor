// Editor.getRegisteredHotkeys 테스트 (C9/E2 W4 §6-2)
//
// 등록된 플러그인 hotkey 를 pluginName 과 함께 flatMap 열람 — 도움말 모달 자동 생성의 단일 소스.
//  ① 여러 플러그인 hotkey 를 pluginName 태깅해 모두 반환
//  ② additive 메타(category/hideInHelp/displayKeys) 보존
//  ③ hotkey 없는 플러그인은 건너뜀, plugins Map 은 private 유지
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))
const { hotkeysMock } = vi.hoisted(() => {
  const fn: any = vi.fn()
  fn.unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))
vi.mock('./contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = vi.fn()
    dispose = vi.fn()
  },
}))
vi.mock('./touchContextMenu', () => ({ attachTouchContextMenu: vi.fn(() => vi.fn()) }))

import Editor from './Editor'
import { PluginBase } from './plugin'

class HotkeyPlugin extends PluginBase {
  name: string
  events: string[] = []
  hotkeys: any[]
  constructor(canvas: any, editor: any, name: string, hotkeys: any[]) {
    super(canvas, editor, {})
    this.name = name
    this.hotkeys = hotkeys
  }
}
class NoHotkeyPlugin extends PluginBase {
  name = 'NoHotkeyPlugin'
  events: string[] = []
  hotkeys: any[] = []
  constructor(canvas: any, editor: any) {
    super(canvas, editor, {})
  }
}

function makeMockCanvas(): any {
  return { on: vi.fn(), off: vi.fn(), getActiveObject: vi.fn(() => null) }
}

describe('Editor.getRegisteredHotkeys', () => {
  it('여러 플러그인 hotkey 를 pluginName 태깅 + 메타 보존하여 반환', () => {
    const editor = new Editor()
    const canvas = makeMockCanvas()
    editor.init(canvas)

    const copy = new HotkeyPlugin(canvas, editor, 'CopyPlugin', [
      { name: '복사', input: ['ctrl+c', 'cmd+c'], onlyForActiveObject: true, category: 'clipboard' },
    ])
    const object = new HotkeyPlugin(canvas, editor, 'ObjectPlugin', [
      { name: '좌측 이동', input: 'left', onlyForActiveObject: true, hideContext: true, category: 'move' },
      { name: '좌측 이동(10px)', input: 'shift+left', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true },
    ])
    editor.use(copy)
    editor.use(object)
    editor.use(new NoHotkeyPlugin(canvas, editor))

    const hks = editor.getRegisteredHotkeys()

    expect(hks).toHaveLength(3)
    const copyHk = hks.find((h) => h.name === '복사')!
    expect(copyHk.pluginName).toBe('CopyPlugin')
    expect(copyHk.category).toBe('clipboard')

    const shiftLeft = hks.find((h) => h.input === 'shift+left')!
    expect(shiftLeft.pluginName).toBe('ObjectPlugin')
    expect(shiftLeft.hideInHelp).toBe(true) // 도움말 은폐 메타 보존
    expect(shiftLeft.hideContext).toBe(true) // hideContext 와 독립 보존
  })

  it('플러그인 미등록 시 빈 배열', () => {
    const editor = new Editor()
    editor.init(makeMockCanvas())
    expect(editor.getRegisteredHotkeys()).toEqual([])
  })
})
