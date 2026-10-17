// core.ensureTextStyles — styles 없는 텍스트(최상위·그룹 자식) 보정으로 toJSON 예외 방지 (2026-10-17)
//
// 배경: 외부 변환기·스크립트가 만든 템플릿의 textbox 에 styles 가 없으면 fabric 5 toObject(stylesToArray)가
// 예외를 내고, 편집기 자동저장 수집기가 그 캔버스를 통째로 잃었다(26캔버스 세트가 24장으로 저장).
// 고정하는 계약: (1) 최상위 텍스트 보정 (2) 그룹 자식 텍스트 보정 (3) 이미 있는 styles 는 불변 (4) 보정 뒤 toJSON 완주
import { describe, it, expect } from 'vitest'
import { fabric } from 'fabric'
import { core } from './canvas'

function staticCanvas(): fabric.StaticCanvas {
  return new fabric.StaticCanvas(null as unknown as HTMLCanvasElement, { width: 400, height: 300, renderOnAddRemove: false })
}

function textWithoutStyles(str: string): fabric.Textbox {
  const t = new fabric.Textbox(str, { left: 10, top: 10, width: 200, fontSize: 20 })
  ;(t as unknown as { styles?: unknown }).styles = undefined
  return t
}

describe('core.ensureTextStyles', () => {
  it('(1)(4) styles 가 없는 최상위 textbox 는 {} 로 보정되고 toJSON 이 완주한다', () => {
    const c = staticCanvas()
    const t = textWithoutStyles('표지')
    c.add(t)
    expect(() => c.toJSON(core.extendFabricOption as string[])).toThrow()
    core.ensureTextStyles(c)
    expect((t as unknown as { styles: unknown }).styles).toEqual({})
    const json = c.toJSON(core.extendFabricOption as string[]) as { objects: Array<{ type: string }> }
    expect(json.objects[0].type).toBe('textbox')
  })

  it('(2) 그룹 자식 텍스트도 보정된다', () => {
    const c = staticCanvas()
    const child = new fabric.Text('15', { left: 0, top: 0, fontSize: 12 })
    ;(child as unknown as { styles?: unknown }).styles = null
    const group = new fabric.Group([new fabric.Rect({ width: 50, height: 50 }), child], { left: 20, top: 20 })
    c.add(group)
    core.ensureTextStyles(c)
    expect((child as unknown as { styles: unknown }).styles).toEqual({})
    expect(() => c.toJSON(core.extendFabricOption as string[])).not.toThrow()
  })

  it('(3) 이미 있는 styles 는 바뀌지 않는다', () => {
    const c = staticCanvas()
    const t = new fabric.Textbox('ab', { width: 100, styles: { 0: { 0: { fill: '#ff0000' } } } })
    c.add(t)
    core.ensureTextStyles(c)
    expect((t as unknown as { styles: Record<string, unknown> }).styles).toEqual({ 0: { 0: { fill: '#ff0000' } } })
  })
})
