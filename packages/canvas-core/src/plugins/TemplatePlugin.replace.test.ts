// TemplatePlugin — 페이지 템플릿 교체(replaceTemplate)·사용자 요소 복제·SVG 평탄화 clone 경로
//
// 실 fabric(5.5.2, node-canvas) StaticCanvas + 실 core.extendFabricOption 직렬화/복원으로 검증한다.
//
// 고정하는 계약:
//  (1) 사용자 요소가 있는 페이지 교체가 예외 없이 끝나고(첫 요소가 이미지여도) history 가 다시 켜진다
//  (2) 사용자 요소는 원본 1벌만 남고 커스텀 속성(id·extensionType·extension·lockInfo·frameRef·parentLayerId)을 유지한다
//  (3) 새 템플릿 객체는 JSON 그대로(id·type·커스텀 속성) 추가되고 calendar-grid 수 = 템플릿의 수, workspace 는 기존 1개
//  (4) 새 템플릿이 같은 id 로 공급하는 기존 객체는 템플릿 슬롯으로 교체돼 id 가 중복되지 않는다
//  (5) 교체로 들어온 템플릿 객체는 isUserAdded=false — 같은 세션의 다음 교체에서 사용자 요소로 오판되지 않는다
//  (6) preserveUserElements·SVG 평탄화(ungroupItems) 복제가 커스텀 속성을 유지한다
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fabric } from 'fabric'
import TemplatePlugin from './TemplatePlugin'
import type Editor from '../Editor'
import type { PluginOption } from '../plugin'

type Plain = Record<string, unknown>
type AnyObj = fabric.Object & Plain

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

interface Harness {
  canvas: fabric.StaticCanvas
  plugin: TemplatePlugin
  history: () => 'on' | 'off'
}

function makeHarness(): Harness {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 800, renderOnAddRemove: false })
  const c = canvas as unknown as Plain
  let hist: 'on' | 'off' = 'on'
  c.requestRenderAll = () => canvas
  c.offHistory = () => {
    hist = 'off'
  }
  c.onHistory = () => {
    hist = 'on'
  }
  c.setActiveObject = () => canvas
  c.discardActiveObject = () => canvas
  const editor = {
    emit: () => undefined,
    getPlugin: () => null,
    hooks: { get: () => ({ callAsync: (_arg: unknown, cb: () => void) => cb() }) },
  } as unknown as Editor
  const plugin = new TemplatePlugin(canvas as unknown as fabric.Canvas, editor, {} as PluginOption)
  ;(plugin as unknown as Plain)._getWorkspace = () => canvas.getObjects().find((o) => (o as AnyObj).id === 'workspace')
  return { canvas, plugin, history: () => hist }
}

function loadJSON(canvas: fabric.StaticCanvas, json: Plain): Promise<void> {
  return new Promise((resolve) => {
    canvas.loadFromJSON(json, () => resolve())
  })
}

function enliven(objects: Plain[]): Promise<fabric.Object[]> {
  return new Promise((resolve) => {
    fabric.util.enlivenObjects(objects as unknown as fabric.Object[], (out: fabric.Object[]) => resolve(out), '')
  })
}

/** promise 가 ms 안에 정착하는지 — 'resolved' | 'rejected: …' | 'pending' */
async function settleWithin(p: Promise<unknown>, ms: number): Promise<string> {
  let state = 'pending'
  p.then(
    () => {
      state = 'resolved'
    },
    (e: unknown) => {
      state = `rejected: ${String(e)}`
    },
  )
  const deadline = Date.now() + ms
  while (state === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  return state
}

const byId = (canvas: fabric.StaticCanvas, id: string) => canvas.getObjects().filter((o) => (o as AnyObj).id === id) as AnyObj[]

/** 저장(extendFabricOption 직렬화 — isUserAdded 미포함)된 세션 페이지를 다시 연 상태 */
const REOPENED_SESSION: Plain = {
  version: '5.3.0',
  objects: [
    { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 600, fill: 'white' },
    { type: 'rect', id: 'tpl-bg', extensionType: 'background', left: 0, top: 0, width: 600, height: 600, fill: '#eee' },
    { type: 'rect', id: 'tpl-frame-1', extensionType: 'frame', left: 50, top: 50, width: 200, height: 200, fill: '#ccc', lockInfo: { locked: true }, deleteable: false },
    { type: 'rect', id: 'photo-1', extensionType: 'fillImage', frameRef: 'tpl-frame-1', parentLayerId: 'tpl-frame-1', extension: { takenAt: '2026-01-02' }, left: 50, top: 50, width: 200, height: 200, fill: '#f00' },
    { type: 'textbox', id: 'tpl-title', styles: {}, extensionType: 'text', text: '고객 제목', left: 300, top: 50, width: 200, requiredEdit: true, requiredEditTouched: true },
    { type: 'group', id: 'grid-1', extensionType: 'calendar-grid', extension: { variant: 'month', monthOffset: 0 }, left: 50, top: 300, objects: [{ type: 'rect', width: 10, height: 10 }] },
    { type: 'rect', id: 'user-sticker', extensionType: 'sticker', lockInfo: { locked: false }, left: 500, top: 500, width: 20, height: 20 },
  ],
}

/** 새 템플릿 canvasData.objects — workspace 포함, 일부 객체에 템플릿 저장 시 남은 isUserAdded:true */
const NEXT_TEMPLATE: Plain[] = [
  { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 600, fill: 'white' },
  { type: 'rect', id: 'tpl-bg', extensionType: 'background', left: 0, top: 0, width: 600, height: 600, fill: '#def' },
  { type: 'rect', id: 'tpl-frame-1', extensionType: 'frame', left: 60, top: 60, width: 180, height: 180, fill: '#bbb', lockInfo: { locked: true }, deleteable: false, isUserAdded: true },
  { type: 'textbox', id: 'tpl-title', styles: {}, extensionType: 'text', text: '기본 제목', left: 320, top: 60, width: 200, requiredEdit: true },
  { type: 'group', id: 'grid-1', extensionType: 'calendar-grid', extension: { variant: 'month', monthOffset: 0 }, isUserAdded: false, left: 60, top: 320, objects: [{ type: 'rect', width: 10, height: 10 }] },
]

/** id 체계가 다른 또 하나의 템플릿 */
const OTHER_TEMPLATE: Plain[] = [
  { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 600, fill: 'white' },
  { type: 'rect', id: 'b-bg', extensionType: 'background', left: 0, top: 0, width: 600, height: 600, fill: '#fed' },
  { type: 'rect', id: 'b-frame', extensionType: 'frame', left: 70, top: 70, width: 160, height: 160, fill: '#aaa', isUserAdded: true },
  { type: 'textbox', id: 'b-title', styles: {}, extensionType: 'text', text: '다른 제목', left: 330, top: 70, width: 200, isUserAdded: true },
  { type: 'group', id: 'b-grid', extensionType: 'calendar-grid', extension: { variant: 'mini', monthOffset: 1 }, left: 70, top: 330, objects: [{ type: 'rect', width: 10, height: 10 }] },
  { type: 'group', id: 'b-grid-2', extensionType: 'calendar-grid', extension: { variant: 'mini', monthOffset: 2 }, left: 300, top: 330, objects: [{ type: 'rect', width: 10, height: 10 }] },
]

describe('TemplatePlugin.replaceTemplate — 사용자 요소 보존·템플릿 객체 원형 유지', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('사용자 요소가 있는 페이지 교체가 예외 없이 끝나고 history 가 다시 켜진다', async () => {
    const { canvas, plugin, history } = makeHarness()
    await loadJSON(canvas, REOPENED_SESSION)
    expect(plugin.extractUserElements().length).toBeGreaterThan(0)

    await expect(plugin.replaceTemplate(await enliven(NEXT_TEMPLATE))).resolves.toBeUndefined()
    expect(history()).toBe('on')
  })

  it('첫 사용자 요소가 이미지여도 교체 promise 가 정착하고 history 가 다시 켜진다', async () => {
    const { canvas, plugin, history } = makeHarness()
    await loadJSON(canvas, {
      objects: [
        { type: 'rect', id: 'workspace', width: 300, height: 300 },
        { type: 'image', id: 'user-photo', extensionType: 'image', frameRef: 'f-1', src: PNG_1PX, width: 1, height: 1 },
        { type: 'rect', id: 'user-box', width: 5, height: 5 },
      ],
    })
    expect((plugin.extractUserElements()[0] as AnyObj).type).toBe('image')

    const tpl = await enliven([
      { type: 'rect', id: 'workspace', width: 300, height: 300 },
      { type: 'rect', id: 'x', extensionType: 'background', width: 10, height: 10 },
    ])
    const state = await settleWithin(plugin.replaceTemplate(tpl), 2000)
    expect(state).toBe('resolved')
    expect(history()).toBe('on')
    const photos = byId(canvas, 'user-photo')
    expect(photos).toHaveLength(1)
    expect(photos[0].frameRef).toBe('f-1')
  })

  it('사용자 요소는 원본 1벌만 남고 커스텀 속성을 유지한다', async () => {
    const { canvas, plugin } = makeHarness()
    await loadJSON(canvas, REOPENED_SESSION)
    const stickerBefore = byId(canvas, 'user-sticker')[0]
    const photoBefore = byId(canvas, 'photo-1')[0]

    await plugin.replaceTemplate(await enliven(NEXT_TEMPLATE))

    const stickers = byId(canvas, 'user-sticker')
    const photos = byId(canvas, 'photo-1')
    expect(stickers).toHaveLength(1)
    expect(photos).toHaveLength(1)
    expect(stickers[0]).toBe(stickerBefore)
    expect(photos[0]).toBe(photoBefore)
    expect(stickers[0].extensionType).toBe('sticker')
    expect(stickers[0].lockInfo).toEqual({ locked: false })
    expect(photos[0].extensionType).toBe('fillImage')
    expect(photos[0].frameRef).toBe('tpl-frame-1')
    expect(photos[0].parentLayerId).toBe('tpl-frame-1')
    expect(photos[0].extension).toEqual({ takenAt: '2026-01-02' })

    // 캔버스 전체에서 id 중복 0
    const ids = canvas.getObjects().map((o) => (o as AnyObj).id)
    expect(new Set(ids).size).toBe(ids.length)

    // 사용자 요소는 새 템플릿 객체보다 위
    const objs = canvas.getObjects()
    const topTemplateIndex = Math.max(...['tpl-bg', 'tpl-frame-1', 'tpl-title', 'grid-1'].map((id) => objs.indexOf(byId(canvas, id)[0])))
    expect(objs.indexOf(photos[0])).toBeGreaterThan(topTemplateIndex)
    expect(objs.indexOf(stickers[0])).toBeGreaterThan(topTemplateIndex)
  })

  it('새 템플릿 객체는 JSON 그대로 추가되고 calendar-grid·workspace 수가 맞다', async () => {
    const { canvas, plugin } = makeHarness()
    await loadJSON(canvas, REOPENED_SESSION)
    const workspaceBefore = byId(canvas, 'workspace')[0]

    await plugin.replaceTemplate(await enliven(NEXT_TEMPLATE))

    const workspaces = byId(canvas, 'workspace')
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toBe(workspaceBefore)
    expect(canvas.getObjects()[0]).toBe(workspaceBefore)
    expect(byId(canvas, 'template-background')).toHaveLength(0)

    const expectedGrids = NEXT_TEMPLATE.filter((o) => o.extensionType === 'calendar-grid').length
    const grids = canvas.getObjects().filter((o) => (o as AnyObj).extensionType === 'calendar-grid') as AnyObj[]
    expect(grids).toHaveLength(expectedGrids)
    expect(grids[0].id).toBe('grid-1')
    expect(grids[0].type).toBe('group')
    expect(grids[0].extension).toEqual({ variant: 'month', monthOffset: 0 })

    for (const src of NEXT_TEMPLATE.filter((o) => o.id !== 'workspace')) {
      const found = byId(canvas, src.id as string)
      expect(found, String(src.id)).toHaveLength(1)
      expect(found[0].type).toBe(src.type)
      expect(found[0].extensionType).toBe(src.extensionType)
      expect(found[0].isUserAdded).toBe(false)
    }
    const frame = byId(canvas, 'tpl-frame-1')[0]
    expect(frame.width).toBe(180)
    expect(frame.lockInfo).toEqual({ locked: true })
    expect(frame.deleteable).toBe(false)
    const title = byId(canvas, 'tpl-title')[0]
    expect(title.text).toBe('기본 제목')
    expect(title.requiredEdit).toBe(true)
    expect(byId(canvas, 'tpl-bg')[0].fill).toBe('#def')
  })

  it('교체로 들어온 템플릿 객체는 다음 교체에서 사용자 요소로 오판되지 않는다', async () => {
    const { canvas, plugin } = makeHarness()
    await loadJSON(canvas, REOPENED_SESSION)
    await plugin.replaceTemplate(await enliven(NEXT_TEMPLATE))

    const userIds = plugin.extractUserElements().map((o) => (o as AnyObj).id).sort()
    expect(userIds).toEqual(['photo-1', 'user-sticker'])

    await plugin.replaceTemplate(await enliven(OTHER_TEMPLATE))

    for (const id of ['tpl-bg', 'tpl-frame-1', 'tpl-title', 'grid-1']) {
      expect(byId(canvas, id), id).toHaveLength(0)
    }
    expect(byId(canvas, 'user-sticker')).toHaveLength(1)
    expect(byId(canvas, 'photo-1')).toHaveLength(1)
    const grids = canvas.getObjects().filter((o) => (o as AnyObj).extensionType === 'calendar-grid')
    expect(grids).toHaveLength(OTHER_TEMPLATE.filter((o) => o.extensionType === 'calendar-grid').length)
    expect(plugin.extractUserElements().map((o) => (o as AnyObj).id).sort()).toEqual(['photo-1', 'user-sticker'])
    expect(byId(canvas, 'workspace')).toHaveLength(1)
  })

  it('빈 배열·유효하지 않은 입력은 캔버스를 바꾸기 전에 거부하고 history 를 다시 켠다', async () => {
    const { canvas, plugin, history } = makeHarness()
    await loadJSON(canvas, REOPENED_SESSION)
    const before = canvas.getObjects().slice()

    await expect(plugin.replaceTemplate([])).rejects.toThrow('추가할 객체가 없습니다.')
    await expect(plugin.replaceTemplate([{} as fabric.Object])).rejects.toThrow('유효한 fabric 객체가 없습니다.')
    expect(canvas.getObjects()).toEqual(before)
    expect(history()).toBe('on')
  })
})

describe('TemplatePlugin 복제 경로 — 커스텀 속성 보존', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('preserveUserElements 는 이미지 포함 사용자 요소를 커스텀 속성째 복제하고 정착한다', async () => {
    const { canvas, plugin } = makeHarness()
    await loadJSON(canvas, {
      objects: [
        { type: 'rect', id: 'workspace', width: 300, height: 300 },
        { type: 'image', id: 'user-photo', extensionType: 'fillImage', frameRef: 'f-1', parentLayerId: 'f-1', extension: { takenAt: 'x' }, src: PNG_1PX, width: 1, height: 1 },
        { type: 'rect', id: 'user-box', extensionType: 'shape', lockInfo: { locked: true }, left: 10, top: 20, width: 5, height: 5 },
      ],
    })

    const p = plugin.preserveUserElements()
    expect(await settleWithin(p, 2000)).toBe('resolved')
    const clones = (await p) as AnyObj[]
    expect(clones.map((o) => o.id)).toEqual(['user-photo', 'user-box'])
    expect(clones[0].extensionType).toBe('fillImage')
    expect(clones[0].frameRef).toBe('f-1')
    expect(clones[0].parentLayerId).toBe('f-1')
    expect(clones[0].extension).toEqual({ takenAt: 'x' })
    expect(clones[1].lockInfo).toEqual({ locked: true })
    expect(clones.every((o) => o.isUserAdded === true)).toBe(true)
    expect(clones[1].originalPosition).toEqual({ left: 10, top: 20, scaleX: 1, scaleY: 1, angle: 0 })
  })

  it('SVG 평탄화(addTemplateToCanvas → ungroupItems) 복제가 원본 id·커스텀 속성을 유지한다', async () => {
    const { canvas, plugin } = makeHarness()
    await loadJSON(canvas, { objects: [{ type: 'rect', id: 'workspace', left: 0, top: 0, width: 400, height: 400 }] })

    const bg = new fabric.Rect({ left: 0, top: 0, width: 200, height: 200, fill: '#fff' }) as AnyObj
    bg.id = 'svg-bg'
    const logo = new fabric.Rect({ left: 20, top: 20, width: 30, height: 30, fill: '#123' }) as AnyObj
    Object.assign(logo, { id: 'svg-logo', extension: { k: 1 }, lockInfo: { locked: true }, parentLayerId: 'svg-bg' })
    const group = new fabric.Group([bg, logo])

    await plugin.addTemplateToCanvas(group)

    const logos = byId(canvas, 'svg-logo')
    expect(logos).toHaveLength(1)
    expect(logos[0].extension).toEqual({ k: 1 })
    expect(logos[0].lockInfo).toEqual({ locked: true })
    expect(logos[0].parentLayerId).toBe('svg-bg')
    // 첫 객체는 기존 규약대로 template-background
    expect(byId(canvas, 'template-background')).toHaveLength(1)
  })
})
