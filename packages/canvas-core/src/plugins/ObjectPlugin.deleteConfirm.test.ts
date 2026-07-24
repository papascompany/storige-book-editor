// ObjectPlugin 삭제 확인 정합 테스트 (C6-b / E2 §5-5, 오너결정 D-E2-4)
//
// 컨텍스트 메뉴/롱프레스 '삭제'가 S2 확인 모달을 우회하고 del() 직행하던 결함의 additive 처방
// 검증. 삭제 hotkey 콜백이 onDeleteRequest(앱 주입)를 먼저 호출하고:
//  ① true 반환(앱이 확인 모달 인수) → 코어 del() 미호출
//  ② false 반환(앱이 인수 거절) → 현행대로 del() 호출
//  ③ 콜백 부재(외부 임베더) → 현행대로 del() 호출 (canvas-core 기본 동작 불변)
//  ★④ 재귀 함정: 가드가 콜백층에만 있어 del() 직접호출(confirmDeleteSelection→del() 경로 시뮬)은
//     onDeleteRequest 를 재발화하지 않는다 — 무한 모달 루프 없음(가드를 del() 코어에 두면 발생).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))
vi.mock('../utils/render', () => ({ RenderOptimizer: { queueRender: vi.fn() } }))

import ObjectPlugin from './ObjectPlugin'

type DeleteObj = { id?: string; extensionType?: string; clipPath?: unknown }

function makeCanvas(activeObjects: DeleteObj[]) {
  return {
    on: vi.fn(),
    offHistory: vi.fn(),
    onHistory: vi.fn(),
    getActiveObjects: () => activeObjects,
    getObjects: () => activeObjects,
    remove: vi.fn(),
    discardActiveObject: vi.fn(),
    requestRenderAll: vi.fn(),
  }
}

interface TestPlugin {
  hotkeys: Array<{ name: string; input: string | string[]; callback: () => void }>
  del: (object?: unknown) => void
}

function setup(options: Record<string, unknown>, activeObjects: DeleteObj[] = []) {
  const canvas = makeCanvas(activeObjects)
  const editor = { emit: vi.fn() }
  const plugin = new (ObjectPlugin as unknown as new (
    c: unknown,
    e: unknown,
    o: unknown
  ) => TestPlugin)(canvas, editor, options)
  const delHotkey = plugin.hotkeys.find((h) => h.name === '삭제')!
  return { canvas, editor, plugin, delHotkey }
}

describe('ObjectPlugin 삭제 hotkey — onDeleteRequest 인수 (C6-b §5-5)', () => {
  it('① onDeleteRequest 가 true 반환 시 코어 del() 을 호출하지 않는다', () => {
    const onDeleteRequest = vi.fn(() => true)
    const { plugin, delHotkey } = setup({ onDeleteRequest })
    plugin.del = vi.fn()

    delHotkey.callback()

    expect(onDeleteRequest).toHaveBeenCalledTimes(1)
    expect(plugin.del).not.toHaveBeenCalled()
  })

  it('② onDeleteRequest 가 false 반환 시 현행대로 del() 을 호출한다', () => {
    const onDeleteRequest = vi.fn(() => false)
    const { plugin, delHotkey } = setup({ onDeleteRequest })
    plugin.del = vi.fn()

    delHotkey.callback()

    expect(onDeleteRequest).toHaveBeenCalledTimes(1)
    expect(plugin.del).toHaveBeenCalledTimes(1)
  })

  it('③ 콜백 부재(외부 임베더)면 기존대로 del() 을 호출한다 — 기본 동작 불변', () => {
    const { plugin, delHotkey } = setup({})
    plugin.del = vi.fn()

    delHotkey.callback()

    expect(plugin.del).toHaveBeenCalledTimes(1)
  })
})

describe('ObjectPlugin 삭제 — 재귀 함정 방지 (가드는 콜백층에만)', () => {
  it('④ del() 직접 호출(confirmDeleteSelection 경로 시뮬)은 onDeleteRequest 를 재발화하지 않는다', () => {
    const onDeleteRequest = vi.fn(() => true)
    const obj: DeleteObj = { id: 'o1' }
    const { canvas, editor, plugin } = setup({ onDeleteRequest }, [obj])

    // confirmDeleteSelection(useAppStore) → getPlugin('ObjectPlugin').del() 를 그대로 재현.
    plugin.del()

    // 가드가 del() 코어에 없으므로 재요청(모달 재오픈) 없음 = 무한 루프 없음.
    expect(onDeleteRequest).not.toHaveBeenCalled()
    // 실제 삭제는 정상 수행(기존 del 보호가드/동반제거 로직 불변).
    expect(canvas.remove).toHaveBeenCalledWith(obj)
    expect(canvas.discardActiveObject).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('layerChanged')
  })
})
