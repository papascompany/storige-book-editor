/**
 * 비스프레드(단일 모드) 편집완료 PDF 대상 캔버스 선택 (P0, 2026-10-16).
 *
 * 종전 embed.tsx handleFinish 단일 분기는 현재 캔버스 1장만 `saveMultiPagePDFAsBlob([canvas], [editor], …)`
 * 에 넘겨 낱장 N장 세트(같은 판형 캔버스 N개)의 나머지 페이지가 PDF 에서 누락됐다.
 *
 * 규칙(순수 함수 — 스토어·플러그인 접근 없음):
 *  - allCanvas.length <= 1                        → [canvas],[editor]          ('single')
 *  - allEditors.length !== allCanvas.length        → [canvas],[editor]          ('fallback-length-mismatch')
 *  - pages 에 spine/wing 템플릿이 하나라도 있으면  → [canvas],[editor]          ('fallback-mixed-types')
 *      · 낱장 표지 분할 세트(날개/표지/책등)는 캔버스 크기가 서로 달라 size 1개로 한 PDF 에 묶을 수 없다.
 *  - 그 외                                         → allCanvas, allEditors      ('multi')
 *
 * pages ↔ allCanvas 대응: useEditorContents 단일 모드 로더가 templateDetails 순서로 캔버스를 만들고
 * 같은 순서로 useEditorStore.setPages 를 호출하므로 index 1:1 이다. pages 가 allCanvas 보다 짧아도
 * 길이 불일치로 보지 않고 있는 범위만 templateType 을 검사한다(없으면 'page' 로 간주).
 *
 * 'single' 과 두 fallback 은 반환 배열의 내용이 종전 호출 인자 `[canvas], [editor]` 와 동일하다.
 */
import type Editor from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { TemplateType } from '@storige/types'

export type SingleModePdfCanvasReason =
  | 'single'
  | 'multi'
  | 'fallback-mixed-types'
  | 'fallback-length-mismatch'

export interface SingleModePdfCanvasesInput {
  canvas: fabric.Canvas
  editor: Editor
  allCanvas: fabric.Canvas[]
  allEditors: Editor[]
  /** useEditorStore.getState().pages — 캔버스 순서 대응. 항목이 비어 있을 수 있다. */
  pages: ReadonlyArray<{ templateType?: string } | undefined>
}

export interface SingleModePdfCanvasesResult {
  canvases: fabric.Canvas[]
  editors: Editor[]
  reason: SingleModePdfCanvasReason
}

const MIXED_SIZE_TYPES: ReadonlySet<string> = new Set([TemplateType.SPINE, TemplateType.WING])

export function selectSingleModePdfCanvases(input: SingleModePdfCanvasesInput): SingleModePdfCanvasesResult {
  const { canvas, editor, allCanvas, allEditors, pages } = input
  const current = (reason: SingleModePdfCanvasReason): SingleModePdfCanvasesResult => ({
    canvases: [canvas],
    editors: [editor],
    reason,
  })

  if (allCanvas.length <= 1) return current('single')
  if (allEditors.length !== allCanvas.length) return current('fallback-length-mismatch')

  const limit = Math.min(pages.length, allCanvas.length)
  for (let i = 0; i < limit; i++) {
    const type = pages[i]?.templateType
    if (type && MIXED_SIZE_TYPES.has(type)) return current('fallback-mixed-types')
  }

  return { canvases: allCanvas, editors: allEditors, reason: 'multi' }
}
