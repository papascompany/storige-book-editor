// @vitest-environment happy-dom
//
// AppTemplateSwap — 다시 연 세션의 템플릿 교체(실 fabric + 실 TemplatePlugin).
// 앞 세션에서 연결 템플릿 A→B 로 바꾸고 저장한 뒤 다시 열면, 저장본에는 isUserAdded 가 없고
// pages[].templateId 는 세트 원본(A)으로 돌아올 수 있다. 이 상태에서 C 로 바꾸면
// B 요소(잠금 포함)가 0개 남고 고객 요소는 보존돼야 한다 — 교체 id 목록 = 연결 템플릿 전체 ∪ 현재 템플릿.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

vi.unmock('fabric')
vi.mock('@/api/templates', () => ({ templatesApi: { getTemplate: vi.fn() } }))
vi.mock('@/api/sessions', () => ({ sessionsApi: { replaceTemplate: vi.fn() } }))
vi.mock('@/utils/calendarRehydrate', () => ({ rehydrateCalendarGrids: vi.fn(async () => 0) }))
vi.mock('@/utils/objectPermissions', () => ({ applyCoverMaterialLock: vi.fn() }))

import { fabric } from 'fabric'
import { TemplatePlugin } from '@storige/canvas-core'
import AppTemplateSwap from './AppTemplateSwap'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore, type LinkedPrintTemplate } from '@/stores/useSettingsStore'

type Plain = Record<string, unknown>
const WS: Plain = { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 600, fill: '#fff' }
const linked = (id: string, name: string, objects: Plain[]): LinkedPrintTemplate => ({
  id,
  name,
  type: 'page',
  width: 100,
  height: 100,
  canvasData: { objects: [WS, ...objects] },
})
const TPL_A = linked('tpl-a', '템플릿 A', [
  { type: 'rect', id: 'a-bg', extensionType: 'background', width: 600, height: 600 },
  { type: 'rect', id: 'a-frame', extensionType: 'frame', left: 50, top: 50, width: 200, height: 200, lockInfo: { locked: true }, deleteable: false },
])
const TPL_B = linked('tpl-b', '템플릿 B', [
  { type: 'rect', id: 'b-bg', extensionType: 'background', width: 600, height: 600 },
  { type: 'rect', id: 'b-frame', extensionType: 'frame', left: 60, top: 60, width: 180, height: 180, lockInfo: { locked: true }, deleteable: false },
  { type: 'rect', id: 'b-title', left: 300, top: 60, width: 200, height: 40, lockMovementX: true, deleteable: false },
])
const TPL_C = linked('tpl-c', '템플릿 C', [
  { type: 'rect', id: 'c-bg', extensionType: 'background', width: 600, height: 600 },
  { type: 'rect', id: 'c-frame', extensionType: 'frame', left: 70, top: 70, width: 160, height: 160, lockInfo: { locked: true }, deleteable: false },
])
const CUSTOMER: Plain[] = [
  { type: 'rect', id: 'u-sticker', extensionType: 'sticker', left: 500, top: 500, width: 20, height: 20 },
  { type: 'rect', id: 'u-note', left: 400, top: 450, width: 60, height: 20 },
]

const enliven = (objects: Plain[]) =>
  new Promise<fabric.Object[]>((r) => fabric.util.enlivenObjects(objects as unknown as fabric.Object[], (o: fabric.Object[]) => r(o), ''))

/** 저장본(B 상태 캔버스, isUserAdded 없음)을 다시 연 캔버스 + 실 TemplatePlugin */
async function reopenedCanvasInStateB() {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 800, renderOnAddRemove: false })
  const c = canvas as unknown as Plain
  c.requestRenderAll = () => canvas
  c.offHistory = () => undefined
  c.onHistory = () => undefined
  c.setActiveObject = () => canvas
  c.discardActiveObject = () => canvas
  const editor = { emit: () => undefined, getPlugin: () => null, hooks: { get: () => ({ callAsync: (_a: unknown, cb: () => void) => cb() }) } }
  const plugin = new TemplatePlugin(canvas as unknown as fabric.Canvas, editor as never, {} as never)
  ;(plugin as unknown as Plain)._getWorkspace = () => canvas.getObjects().find((o) => (o as unknown as Plain).id === 'workspace')
  // 다시 열 때처럼 object:added 로 isUserAdded 를 재판정하게 추가한다
  for (const o of await enliven([...(TPL_B.canvasData!.objects as Plain[]), ...CUSTOMER])) canvas.add(o)
  return { canvas, plugin }
}

const ids = (canvas: fabric.StaticCanvas) => canvas.getObjects().map((o) => (o as unknown as Plain).id as string)
const isLocked = (o: Plain) =>
  o.deleteable === false || (o.lockInfo as { locked?: boolean } | undefined)?.locked === true || o.lockMovementX === true

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ canvas: null, allCanvas: [], allEditors: [] } as never)
    useSettingsStore.setState({ linkedPrintTemplates: [] } as never)
    useEditorStore.setState({ pages: [], currentPageIndex: 0 } as never)
  })
})

describe('AppTemplateSwap — 다시 연 세션(templateId=세트 원본, 캔버스=다른 연결 템플릿)의 교체', () => {
  it('C 로 교체하면 B 요소·잠금 요소 0개, 고객 요소 보존', async () => {
    const { canvas, plugin } = await reopenedCanvasInStateB()
    // 다시 연 직후: B 의 틀·문구는 판정 근거가 없어 사용자 요소로 보인다
    expect(plugin.extractUserElements().map((o) => (o as unknown as Plain).id)).toEqual(expect.arrayContaining(['b-frame', 'b-title']))
    act(() => {
      useAppStore.setState({
        canvas,
        allCanvas: [canvas],
        allEditors: [{}],
        getPlugin: (name: string) => (name === 'TemplatePlugin' ? plugin : undefined),
      } as never)
      useSettingsStore.setState({ linkedPrintTemplates: [TPL_A, TPL_B, TPL_C], spreadConfig: null } as never)
      useEditorStore.setState({
        sessionId: null,
        pages: [{ id: 'p1', templateId: 'tpl-a', templateType: 'page' }],
        currentPageIndex: 0,
      } as never)
    })
    render(<AppTemplateSwap />)

    fireEvent.click(screen.getByText('템플릿 C'))
    expect(screen.getByText(/템플릿 문구 칸에 쓴 글은 새 템플릿 값으로 바뀝니다/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('교체'))
      for (let i = 0; i < 50 && !ids(canvas).includes('c-bg'); i++) await new Promise((r) => setTimeout(r, 10))
    })

    const after = ids(canvas)
    expect(after.filter((id) => id.startsWith('b-'))).toEqual([])
    expect((canvas.getObjects() as unknown as Plain[]).filter(isLocked).map((o) => o.id)).toEqual(['c-frame'])
    expect(after.filter((id) => id.startsWith('u-')).sort()).toEqual(['u-note', 'u-sticker'])
    expect(after).toEqual(expect.arrayContaining(['workspace', 'c-bg', 'c-frame']))
    expect(new Set(after).size).toBe(after.length)
    expect(useEditorStore.getState().pages[0].templateId).toBe('tpl-c')
  })
})
