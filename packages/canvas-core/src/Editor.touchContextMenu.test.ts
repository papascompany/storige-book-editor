// Editor.enableTouchContextMenu 배선 테스트 (C6 / E2 W3)
//
// 검증 대상:
//  ① enableTouchContextMenu → attachTouchContextMenu(canvas, contextMenu, options) 호출
//  ② dispose → 저장한 정리 함수 호출(this.canvas=null 이전, wrapperEl 도달 가능)
//  ③ 재호출 멱등 — 기존 트리거 정리 후 재부착
//  ④ init 전(canvas 없음) 호출은 no-op 가드
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// attachTouchContextMenu 를 스파이로 대체 — 호출마다 새 disposer 스파이 반환(멱등 검증용)
const { attachSpy, disposers } = vi.hoisted(() => {
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  const attachSpy = vi.fn(() => {
    const d = vi.fn()
    disposers.push(d)
    return d
  })
  return { attachSpy, disposers }
})
vi.mock('./touchContextMenu', () => ({ attachTouchContextMenu: attachSpy }))

import Editor from './Editor'

function makeMockCanvas(): any {
  return { on: vi.fn(), off: vi.fn(), getActiveObject: vi.fn(() => null), wrapperEl: {} }
}

describe('Editor.enableTouchContextMenu 배선', () => {
  beforeEach(() => {
    attachSpy.mockClear()
    disposers.length = 0
    hotkeysMock.mockClear()
  })

  it('① enable → attachTouchContextMenu(canvas, contextMenu, options) 호출', () => {
    const editor = new Editor()
    const canvas = makeMockCanvas()
    editor.init(canvas)

    ;(editor as any).enableTouchContextMenu({ haptic: true })

    expect(attachSpy).toHaveBeenCalledTimes(1)
    const [passedCanvas, , passedOptions] = attachSpy.mock.calls[0]
    expect(passedCanvas).toBe(canvas)
    expect(passedOptions).toEqual({ haptic: true })
  })

  it('② dispose → 저장한 정리 함수 호출', () => {
    const editor = new Editor()
    editor.init(makeMockCanvas())
    ;(editor as any).enableTouchContextMenu()

    expect(disposers[0]).not.toHaveBeenCalled()
    editor.dispose()
    expect(disposers[0]).toHaveBeenCalledTimes(1)
  })

  it('③ 재호출 멱등 — 기존 정리 후 재부착', () => {
    const editor = new Editor()
    editor.init(makeMockCanvas())

    ;(editor as any).enableTouchContextMenu()
    ;(editor as any).enableTouchContextMenu() // 재호출

    expect(attachSpy).toHaveBeenCalledTimes(2)
    expect(disposers[0]).toHaveBeenCalledTimes(1) // 첫 트리거 정리됨
    expect(disposers[1]).not.toHaveBeenCalled() // 두 번째는 살아 있음

    editor.dispose()
    expect(disposers[1]).toHaveBeenCalledTimes(1)
  })

  it('④ init 전 호출은 no-op(canvas 없음)', () => {
    const editor = new Editor()
    ;(editor as any).enableTouchContextMenu()
    expect(attachSpy).not.toHaveBeenCalled()
  })

  it('dispose 2회 멱등 — 정리 함수 중복 호출 없음', () => {
    const editor = new Editor()
    editor.init(makeMockCanvas())
    ;(editor as any).enableTouchContextMenu()

    editor.dispose()
    editor.dispose()
    expect(disposers[0]).toHaveBeenCalledTimes(1)
  })
})
