import { describe, it, expect } from 'vitest'
import type Editor from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { selectSingleModePdfCanvases } from './singleModePdfCanvases'

/**
 * 비스프레드 편집완료 PDF 대상 캔버스 선택(P0 낱장 N장 PDF).
 * 캔버스·에디터는 참조 동일성만 보면 되므로 빈 객체 더미를 쓴다.
 */
const fakeCanvas = (id: string): fabric.Canvas => ({ id } as unknown as fabric.Canvas)
const fakeEditor = (id: string): Editor => ({ id } as unknown as Editor)

function set(n: number): { allCanvas: fabric.Canvas[]; allEditors: Editor[] } {
  return {
    allCanvas: Array.from({ length: n }, (_, i) => fakeCanvas(`c${i}`)),
    allEditors: Array.from({ length: n }, (_, i) => fakeEditor(`e${i}`)),
  }
}

describe('selectSingleModePdfCanvases', () => {
  it('캔버스 1장 → 현재 캔버스/에디터 1개씩, reason single (종전 호출 인자와 동일)', () => {
    const { allCanvas, allEditors } = set(1)
    const canvas = allCanvas[0]
    const editor = allEditors[0]
    const r = selectSingleModePdfCanvases({ canvas, editor, allCanvas, allEditors, pages: [{ templateType: 'page' }] })
    expect(r.reason).toBe('single')
    expect(r.canvases).toEqual([canvas])
    expect(r.editors).toEqual([editor])
    expect(r.canvases[0]).toBe(canvas)
    expect(r.editors[0]).toBe(editor)
  })

  it('캔버스 0장(allCanvas 비어 있음) → 현재 캔버스 1개, reason single', () => {
    const canvas = fakeCanvas('cur')
    const editor = fakeEditor('cur')
    const r = selectSingleModePdfCanvases({ canvas, editor, allCanvas: [], allEditors: [], pages: [] })
    expect(r.reason).toBe('single')
    expect(r.canvases).toEqual([canvas])
    expect(r.editors).toEqual([editor])
  })

  it('같은 판형 낱장 N장(page 만) → allCanvas/allEditors 전체, reason multi', () => {
    const { allCanvas, allEditors } = set(3)
    const r = selectSingleModePdfCanvases({
      canvas: allCanvas[1],
      editor: allEditors[1],
      allCanvas,
      allEditors,
      pages: [{ templateType: 'page' }, { templateType: 'page' }, { templateType: 'page' }],
    })
    expect(r.reason).toBe('multi')
    expect(r.canvases).toBe(allCanvas)
    expect(r.editors).toBe(allEditors)
    expect(r.canvases).toHaveLength(3)
  })

  it('pages 가 allCanvas 보다 짧거나 항목이 비어도(templateType 없음) multi — 길이 불일치로 보지 않는다', () => {
    const { allCanvas, allEditors } = set(4)
    const r = selectSingleModePdfCanvases({
      canvas: allCanvas[0],
      editor: allEditors[0],
      allCanvas,
      allEditors,
      pages: [{ templateType: 'cover' }, undefined, {}],
    })
    expect(r.reason).toBe('multi')
    expect(r.canvases).toBe(allCanvas)
  })

  it('spine 템플릿 포함(낱장 표지 분할 세트) → 현재 캔버스 1개, reason fallback-mixed-types', () => {
    const { allCanvas, allEditors } = set(3)
    const canvas = allCanvas[2]
    const editor = allEditors[2]
    const r = selectSingleModePdfCanvases({
      canvas,
      editor,
      allCanvas,
      allEditors,
      pages: [{ templateType: 'cover' }, { templateType: 'spine' }, { templateType: 'cover' }],
    })
    expect(r.reason).toBe('fallback-mixed-types')
    expect(r.canvases).toEqual([canvas])
    expect(r.editors).toEqual([editor])
    expect(r.canvases[0]).toBe(canvas)
    expect(r.editors[0]).toBe(editor)
  })

  it('wing 템플릿 포함 → 현재 캔버스 1개, reason fallback-mixed-types', () => {
    const { allCanvas, allEditors } = set(5)
    const canvas = allCanvas[1]
    const editor = allEditors[1]
    const r = selectSingleModePdfCanvases({
      canvas,
      editor,
      allCanvas,
      allEditors,
      pages: [
        { templateType: 'wing' },
        { templateType: 'cover' },
        { templateType: 'spine' },
        { templateType: 'cover' },
        { templateType: 'wing' },
      ],
    })
    expect(r.reason).toBe('fallback-mixed-types')
    expect(r.canvases).toEqual([canvas])
    expect(r.editors).toEqual([editor])
  })

  it('allEditors 길이가 allCanvas 와 다르면 → 현재 캔버스 1개, reason fallback-length-mismatch', () => {
    const { allCanvas } = set(3)
    const allEditors = [fakeEditor('e0'), fakeEditor('e1')]
    const canvas = allCanvas[0]
    const editor = allEditors[0]
    const r = selectSingleModePdfCanvases({
      canvas,
      editor,
      allCanvas,
      allEditors,
      pages: [{ templateType: 'page' }, { templateType: 'page' }, { templateType: 'page' }],
    })
    expect(r.reason).toBe('fallback-length-mismatch')
    expect(r.canvases).toEqual([canvas])
    expect(r.editors).toEqual([editor])
    expect(r.canvases[0]).toBe(canvas)
    expect(r.editors[0]).toBe(editor)
  })

  it('single 과 fallback 결과는 항상 길이 1 의 [canvas],[editor] (종전 saveMultiPagePDFAsBlob 인자 형태 고정)', () => {
    const { allCanvas, allEditors } = set(2)
    const canvas = allCanvas[0]
    const editor = allEditors[0]
    const cases = [
      selectSingleModePdfCanvases({ canvas, editor, allCanvas: [canvas], allEditors: [editor], pages: [] }),
      selectSingleModePdfCanvases({ canvas, editor, allCanvas, allEditors, pages: [{ templateType: 'spine' }] }),
      selectSingleModePdfCanvases({ canvas, editor, allCanvas, allEditors: [editor], pages: [] }),
    ]
    for (const r of cases) {
      expect(r.reason).not.toBe('multi')
      expect(r.canvases).toHaveLength(1)
      expect(r.editors).toHaveLength(1)
      expect(r.canvases[0]).toBe(canvas)
      expect(r.editors[0]).toBe(editor)
    }
  })
})
