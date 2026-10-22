// GroupPlugin — calendar-grid 해제 차단·일반 그룹 해제 회귀·핫키 컨텍스트 은폐 (T2 그리드·기념일 안전성, 2026-10-22)
//
// 실 fabric(5.5.2 dist, node-canvas) 위에서 PhotoPrintPlugin.test 의 캔버스 스텁(history·active object)을 재사용한다.
// group() 회귀는 PhotoPrintPlugin.test (9) 가 고정하므로 여기서는 unGroup/hideContext 만 다룬다.
//
// 고정하는 계약:
//  (1) extensionType 'calendar-grid' 그룹은 unGroup 이 no-op — 객체 수·자식·활성 객체·직렬화 결과(바이트) 유지, layerChanged 미발행
//  (2) 일반 그룹(extensionType 'group')은 해제 — 그룹 제거·자식 2개가 캔버스로·새 id·ActiveSelection·layerChanged 1회 (회귀)
//  (3) '그룹 해제' 핫키(ctrl/cmd+backspace) hideContext: calendar-grid → true(은폐), 일반 그룹 → false, 선택 없음·그룹 아님 → true
import { describe, it, expect, vi } from 'vitest'
import { fabric } from 'fabric'
import { core } from '../utils/canvas'
import GroupPlugin from './GroupPlugin'
import type Editor from '../Editor'

type HistoryStub = {
  historyProcessing: boolean
  isHistoryReady: boolean
  historyNextState: string | null
  historyUndo: string[]
  _historyNext: () => string
  onHistory: () => void
  offHistory: () => void
}

function makeCanvas(): fabric.Canvas {
  const c = new fabric.StaticCanvas(null as unknown as HTMLCanvasElement, {
    width: 1000,
    height: 800,
    renderOnAddRemove: false,
  }) as unknown as fabric.Canvas
  const h = c as unknown as HistoryStub
  h.historyProcessing = false
  h.isHistoryReady = true
  h.historyUndo = []
  h._historyNext = () => JSON.stringify(c.toJSON(core.extendFabricOption as string[]))
  h.historyNextState = null
  h.offHistory = () => { h.historyProcessing = true }
  h.onHistory = () => {
    h.historyProcessing = false
    const cur = h._historyNext()
    if (h.historyNextState !== cur) { if (h.historyNextState) h.historyUndo.push(h.historyNextState); h.historyNextState = cur }
  }
  let active: fabric.Object | null = null
  ;(c as unknown as { getActiveObject: () => fabric.Object | null }).getActiveObject = () => active
  ;(c as unknown as { setActiveObject: (o: fabric.Object) => void }).setActiveObject = (o) => { active = o }
  ;(c as unknown as { discardActiveObject: () => fabric.Canvas }).discardActiveObject = () => { active = null; return c }
  return c
}

function makeEditor(): Editor & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn() } as unknown as Editor & { emit: ReturnType<typeof vi.fn> }
}

/** 자식 rect 2개로 만든 그룹을 캔버스에 올리고 활성 객체로 둔다 */
function addGroup(canvas: fabric.Canvas, extensionType: string, id = 'g1'): fabric.Group {
  const a = new fabric.Rect({ id: 'child-a', left: 10, top: 10, width: 40, height: 40, fill: '#f00' } as fabric.IRectOptions)
  const b = new fabric.Rect({ id: 'child-b', left: 80, top: 10, width: 40, height: 40, fill: '#0f0' } as fabric.IRectOptions)
  const g = new fabric.Group([a, b], { id, extensionType } as fabric.IGroupOptions)
  canvas.add(g)
  canvas.setActiveObject(g)
  return g
}

function serialize(canvas: fabric.Canvas): string {
  return JSON.stringify(canvas.toJSON(core.extendFabricOption as string[]))
}

const ungroupHotkey = (plugin: GroupPlugin) => {
  const hk = plugin.hotkeys.find((h) => h.name === '그룹 해제')
  if (!hk) throw new Error("'그룹 해제' 핫키 없음")
  return hk
}

describe('GroupPlugin.unGroup — calendar-grid 가드', () => {
  it('(1) extensionType calendar-grid 그룹은 unGroup 이 no-op(객체 수·자식·활성 객체·직렬화 바이트 동일, layerChanged 없음)', () => {
    const canvas = makeCanvas()
    const editor = makeEditor()
    const grid = addGroup(canvas, 'calendar-grid', 'grid-1')
    const before = serialize(canvas)

    new GroupPlugin(canvas, editor).unGroup()

    expect(canvas.getObjects()).toHaveLength(1)
    expect(canvas.getObjects()[0]).toBe(grid)
    expect(grid.getObjects().map((o) => o.id)).toEqual(['child-a', 'child-b'])
    expect(canvas.getActiveObject()).toBe(grid)
    expect((grid as fabric.Group & { extensionType?: string }).extensionType).toBe('calendar-grid')
    expect(editor.emit).not.toHaveBeenCalled()
    expect(serialize(canvas)).toBe(before)
  })

  it('(1b) toggleGroup 도 calendar-grid 그룹에서는 unGroup 경로라 no-op', () => {
    const canvas = makeCanvas()
    const editor = makeEditor()
    const grid = addGroup(canvas, 'calendar-grid', 'grid-2')
    new GroupPlugin(canvas, editor).toggleGroup()
    expect(canvas.getObjects()).toEqual([grid])
    expect(grid.getObjects()).toHaveLength(2)
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('(2) 일반 그룹(extensionType group)은 해제된다 — 그룹 제거·자식 2개 캔버스 복귀·새 id·ActiveSelection·layerChanged 1회 (회귀)', () => {
    const canvas = makeCanvas()
    const editor = makeEditor()
    addGroup(canvas, 'group', 'g-plain')

    new GroupPlugin(canvas, editor).unGroup()

    const objects = canvas.getObjects()
    expect(objects).toHaveLength(2)
    expect(objects.map((o) => o.type)).toEqual(['rect', 'rect'])
    for (const o of objects) {
      // unGroup 은 자식마다 uuid 를 새로 부여한다
      expect(typeof o.id).toBe('string')
      expect(['child-a', 'child-b', 'g-plain']).not.toContain(o.id)
    }
    const active = canvas.getActiveObject()
    expect(active).toBeInstanceOf(fabric.ActiveSelection)
    expect((active as fabric.ActiveSelection).getObjects()).toHaveLength(2)
    expect(editor.emit).toHaveBeenCalledTimes(1)
    expect(editor.emit).toHaveBeenCalledWith('layerChanged')
  })

  it('(2b) extensionType 이 없는 그룹(템플릿 JSON 등)도 해제된다 — 가드는 calendar-grid 에만 걸린다', () => {
    const canvas = makeCanvas()
    const editor = makeEditor()
    const a = new fabric.Rect({ id: 'x', left: 0, top: 0, width: 10, height: 10 } as fabric.IRectOptions)
    const b = new fabric.Rect({ id: 'y', left: 20, top: 0, width: 10, height: 10 } as fabric.IRectOptions)
    const g = new fabric.Group([a, b], { id: 'g-noext' } as fabric.IGroupOptions)
    canvas.add(g)
    canvas.setActiveObject(g)

    new GroupPlugin(canvas, editor).unGroup()

    expect(canvas.getObjects()).toHaveLength(2)
    expect(canvas.getObjects().some((o) => o.type === 'group')).toBe(false)
    expect(editor.emit).toHaveBeenCalledWith('layerChanged')
  })
})

describe("GroupPlugin — '그룹 해제' 핫키 hideContext", () => {
  it('입력은 ctrl+backspace·cmd+backspace, hideContext 는 함수형(활성 객체에 반응)', () => {
    const plugin = new GroupPlugin(makeCanvas(), makeEditor())
    const hk = ungroupHotkey(plugin)
    expect(hk.input).toEqual(['ctrl+backspace', 'cmd+backspace'])
    expect(hk.onlyForActiveObject).toBe(true)
    expect(typeof hk.hideContext).toBe('function')
  })

  it('(3) calendar-grid 그룹이 활성이면 true(은폐)', () => {
    const canvas = makeCanvas()
    addGroup(canvas, 'calendar-grid', 'grid-3')
    const plugin = new GroupPlugin(canvas, makeEditor())
    expect((ungroupHotkey(plugin).hideContext as () => boolean)()).toBe(true)
  })

  it('(3) 일반 그룹이 활성이면 false(노출) — 회귀', () => {
    const canvas = makeCanvas()
    addGroup(canvas, 'group', 'g-plain-3')
    const plugin = new GroupPlugin(canvas, makeEditor())
    expect((ungroupHotkey(plugin).hideContext as () => boolean)()).toBe(false)
  })

  it('(3) 활성 객체 없음 → true, 그룹 아닌 객체(rect) → true (기존 동작 유지)', () => {
    const canvas = makeCanvas()
    const plugin = new GroupPlugin(canvas, makeEditor())
    expect((ungroupHotkey(plugin).hideContext as () => boolean)()).toBe(true)

    const rect = new fabric.Rect({ id: 'r', left: 0, top: 0, width: 10, height: 10 } as fabric.IRectOptions)
    canvas.add(rect)
    canvas.setActiveObject(rect)
    expect((ungroupHotkey(plugin).hideContext as () => boolean)()).toBe(true)
  })
})
