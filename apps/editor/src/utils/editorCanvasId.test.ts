import { describe, it, expect } from 'vitest'
import { isEditorCanvasId } from './editorCanvasId'

describe('isEditorCanvasId', () => {
  it('편집기 캔버스 id(canvas + 숫자)만 참이다', () => {
    expect(isEditorCanvasId('canvas0')).toBe(true)
    expect(isEditorCanvasId('canvas12')).toBe(true)
  })

  it('UUID·시드 템플릿 id·빈 값은 거짓이다', () => {
    expect(isEditorCanvasId('3f2b8c1e-0d4a-4c7e-9a51-2b6f0e8d7c90')).toBe(false)
    expect(isEditorCanvasId('sample-page-8x8')).toBe(false)
    expect(isEditorCanvasId('canvas')).toBe(false)
    expect(isEditorCanvasId('canvas2-copy')).toBe(false)
    expect(isEditorCanvasId(undefined)).toBe(false)
    expect(isEditorCanvasId(null)).toBe(false)
  })
})
