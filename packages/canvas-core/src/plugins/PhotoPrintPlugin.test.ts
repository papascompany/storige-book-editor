// PhotoPrintPlugin — 사진인화 사진틀 채움 규칙·촬영일·흑백·직렬화 왕복 (P2-d, 2026-10-19)
//
// 실 fabric(5.5.2 dist, node-canvas) + 실 core.extendFabricOption / core.loadFromJSON 으로
// embed/useEmbedAutoSave/ServicePlugin 저장 경로와 같은 계약을 고정한다(CalendarPlugin.test 패턴).
//
// 고정하는 계약:
//  (1) 순수 헬퍼: resolveFillScale cover=기존 Math.max 산식·contain=Math.min, frameInsetScale 0/2mm, formatTakenAt
//  (2) apply 기본값(cover·inset 0): 사진 scale 이 기존 fillImageIntoFrame 산식과 바이트 동일, clip scale = frame scale
//  (3) apply contain + 유테 2mm: 사진은 축소 창에 contain, clip 복제본 scale 에 축별 비율 곱
//  (4) 직렬화: fitMode/frameInsetMm 가 toJSON(extendFabricOption)→loadFromJSON 왕복에 보존, rehydrate 가 런타임 값 복구
//  (5) date-overlay: takenAt 있음/없음/dateOverlay off, extension.frameId 로 특정 틀에 묶기
//  (6) grayscale: 멱등(필터 1개 유지), off 로 제거, 왕복 뒤(태그 소실) 재입양·해제
//  (7) undo 미기록(historyProcessing), (8) FrameInteractionPlugin._syncFromFrame 회귀 가드(inset 미설정/0 = 기존 값 동일)
//  (9) 그룹화(GroupPlugin)·clone 경로에서 fillImage extension(takenAt) 보존
//  (10) D3 창(window): 도련 세트의 풀블리드 틀에서 유테 창 = (프레임 ∩ 재단 상자) − inset, bleed 0·inset 0 은 종전 값과 동일
//  (11) D4 formatTakenAt: ISO 일시는 로컬 연월일(TZ 비의존 기대값), 날짜만/EXIF 원문은 날짜 부분 그대로
//  (12) serialization-3: 런타임 키 유실(undo 재생성) 뒤 드래그 → frameInsetMm+bleed 폴백으로 유테 유지, rehydrate 가 clip 자가 복구
//  (13) serialization-4: undo 로 plain 객체가 된 filters 에도 TypeError 없이 동작(fromObject 복원·태그 입양), applyFilters 예외 격리
//  (14) serialization-6/tests-4: 채워진 사진(또는 틀째) 삭제 뒤 apply/rehydrate → date-overlay ''
import { describe, it, expect, vi } from 'vitest'
import { fabric } from 'fabric'
import { core } from '../utils/canvas'
import { mmToPxDisplay } from '../utils/math'
import PhotoPrintPlugin, {
  DATE_OVERLAY_EXTENSION_TYPE,
  PHOTO_PRINT_EFFECT_TYPE,
  FRAME_INSET_PX_RUNTIME_KEY,
  FRAME_WINDOW_RUNTIME_KEY,
  PHOTO_PRINT_BLEED_PX_RUNTIME_KEY,
  frameInsetScale,
  resolveFillScale,
  resolveFrameWindow,
  frameWindowTransform,
  resolveFrameWindowFor,
  formatTakenAt,
  type FrameWindow,
  type PhotoPrintCanvasOptions,
} from './PhotoPrintPlugin'
import FrameInteractionPlugin from './FrameInteractionPlugin'
import GroupPlugin from './GroupPlugin'
import type Editor from '../Editor'

type AnyRecord = Record<string, unknown>
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

const editorStub = { emit: vi.fn() } as unknown as Editor

function makePlugin(canvas: fabric.Canvas): PhotoPrintPlugin {
  return new PhotoPrintPlugin(canvas, editorStub)
}

/** node-canvas 로 만든 실 fabric.Image(원본 px = w×h) */
function makeImage(w: number, h: number, id: string): fabric.Image {
  const el = fabric.util.createCanvasElement()
  el.width = w
  el.height = h
  const ctx = el.getContext('2d')
  if (ctx) { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, w, h) }
  return new fabric.Image(el, { id } as fabric.IImageOptions)
}

interface FilledFrame { frame: fabric.Rect; fore: fabric.Image; clip: fabric.Rect }

/**
 * 사진틀 + 채워진 사진 — apps/editor useImageStore.fillImageIntoFrame 와 같은 규약
 * (frame.extensionType 'frame', fore.extensionType 'fillImage' + parentLayerId/frameRef, absolutePositioned clip 복제본, cover 스케일)
 */
function makeFilledFrame(
  canvas: fabric.Canvas,
  init: { id?: string; left?: number; top?: number; w?: number; h?: number; scale?: number; imgW?: number; imgH?: number; takenAt?: string; strokeWidth?: number },
): FilledFrame {
  const id = init.id ?? 'frame-1'
  const scale = init.scale ?? 1
  const frame = new fabric.Rect({
    id, left: init.left ?? 100, top: init.top ?? 100, width: init.w ?? 200, height: init.h ?? 120,
    scaleX: scale, scaleY: scale, fill: '', extensionType: 'frame',
    ...(init.strokeWidth !== undefined ? { strokeWidth: init.strokeWidth } : {}),
  } as fabric.IRectOptions)
  const center = frame.getCenterPoint()
  const clip = new fabric.Rect({
    id: `${id}_frameClip`, width: frame.width, height: frame.height, originX: 'center', originY: 'center',
    left: center.x, top: center.y, scaleX: frame.scaleX, scaleY: frame.scaleY, angle: frame.angle, absolutePositioned: true,
  } as fabric.IRectOptions)
  const fore = makeImage(init.imgW ?? 400, init.imgH ?? 300, `${id}_fillImage`)
  const frameW = frame.width! * frame.scaleX!
  const frameH = frame.height! * frame.scaleY!
  const coverScale = Math.max(frameW / fore.width!, frameH / fore.height!)
  fore.set({
    extensionType: 'fillImage', left: center.x, top: center.y, originX: 'center', originY: 'center',
    selectable: false, evented: false, scaleX: coverScale, scaleY: coverScale,
    frameRef: id, parentLayerId: id, clipPath: clip,
    ...(init.takenAt ? { extension: { takenAt: init.takenAt } } : {}),
  } as Partial<fabric.Image>)
  fore.setCoords()
  ;(frame as fabric.Rect & AnyRecord).fillImage = fore.id
  canvas.add(fore, frame)
  return { frame, fore, clip }
}

function makeOverlay(id: string, ext?: AnyRecord): fabric.Text {
  return new fabric.Text('placeholder', {
    id, left: 10, top: 10, fontSize: 12, extensionType: DATE_OVERLAY_EXTENSION_TYPE, ...(ext ? { extension: ext } : {}),
  } as fabric.ITextOptions)
}

const mmToPx = (mm: number): number => mm * 10

function opts(over: Partial<PhotoPrintCanvasOptions> = {}): PhotoPrintCanvasOptions {
  return { fitMode: 'cover', frameInsetMm: 0, dateOverlay: false, grayscale: false, mmToPx, ...over }
}

function filtersOf(img: fabric.Object): Array<{ type?: string; effectType?: string }> {
  return ((img as fabric.Image).filters ?? []) as Array<{ type?: string; effectType?: string }>
}

/** 브라우저 TZ 기준 로컬 연월일 — D4 기대값(TZ 비의존): 테스트가 도는 머신의 getTimezoneOffset 을 그대로 따른다 */
function localYmd(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

/** workspace(id 'workspace', 중앙원점 (0,0)) — WorkspacePlugin 과 같은 규약 */
function addWorkspace(canvas: fabric.Canvas, w: number, h: number): fabric.Rect {
  const ws = new fabric.Rect({
    id: 'workspace', width: w, height: h, left: 0, top: 0, originX: 'center', originY: 'center', selectable: false, fill: '#fff',
  } as fabric.IRectOptions)
  canvas.add(ws)
  return ws
}

const px = (mm: number): number => mmToPxDisplay(mm)

describe('PhotoPrintPlugin 순수 헬퍼', () => {
  it('(1) resolveFillScale: cover 는 기존 Math.max 산식과 동일, contain 은 Math.min, 무효 입력은 1', () => {
    expect(resolveFillScale(200, 120, 400, 300, 'cover')).toBe(Math.max(200 / 400, 120 / 300))
    expect(resolveFillScale(200, 120, 400, 300, 'contain')).toBe(Math.min(200 / 400, 120 / 300))
    expect(resolveFillScale(300, 300, 100, 50, 'cover')).toBe(6)
    expect(resolveFillScale(300, 300, 100, 50, 'contain')).toBe(3)
    expect(resolveFillScale(200, 120, 0, 300, 'cover')).toBe(1)
    expect(resolveFillScale(200, 120, Number.NaN, 300, 'contain')).toBe(1)
  })

  it('(1) frameInsetScale: inset 0 → {1,1}, 2mm(=20px) → 축별 비율, 창을 없애는 inset·무효 입력 → {1,1}', () => {
    expect(frameInsetScale(200, 120, 0)).toEqual({ sx: 1, sy: 1 })
    expect(frameInsetScale(200, 120, 20)).toEqual({ sx: 160 / 200, sy: 80 / 120 })
    expect(frameInsetScale(200, 120, 60)).toEqual({ sx: 1, sy: 1 })
    expect(frameInsetScale(200, 120, -5)).toEqual({ sx: 1, sy: 1 })
    expect(frameInsetScale(0, 120, 20)).toEqual({ sx: 1, sy: 1 })
    expect(frameInsetScale(200, 120, Number.NaN)).toEqual({ sx: 1, sy: 1 })
  })

  it('(1)(11) formatTakenAt: ISO 일시는 로컬 연월일, 날짜만·EXIF 원문은 날짜 부분 그대로, 해석 불가 → null', () => {
    // D4: exifr 는 EXIF 로컬시각을 브라우저 TZ Date 로 만들어 UTC ISO 로 저장 — UTC 날짜 부분이 아니라 로컬 날짜로 되돌린다
    const utcMidnightEdge = '2026-03-14T23:30:00.000Z' // KST 라면 03-15, UTC 라면 03-14
    expect(formatTakenAt(utcMidnightEdge)).toBe(localYmd(utcMidnightEdge))
    const offsetMin = new Date(utcMidnightEdge).getTimezoneOffset()
    expect(formatTakenAt(utcMidnightEdge)).toBe(offsetMin <= -30 ? '2026.03.15' : '2026.03.14')
    expect(formatTakenAt('2026-10-19T23:59:00+09:00')).toBe(localYmd('2026-10-19T23:59:00+09:00'))
    // 오프셋 없는 ISO 일시는 로컬로 해석되므로 날짜 부분과 일치
    expect(formatTakenAt('2026-10-19T10:20:30')).toBe('2026.10.19')
    expect(formatTakenAt('2026-10-19')).toBe('2026.10.19')
    expect(formatTakenAt('2026:10:19 08:00:00')).toBe('2026.10.19')
    expect(formatTakenAt('2026:03:15 00:10:00')).toBe('2026.03.15')
    expect(formatTakenAt('2026-13-01')).toBeNull()
    expect(formatTakenAt('2026-13-01T10:00:00Z')).toBeNull()
    expect(formatTakenAt('2026-10-00')).toBeNull()
    expect(formatTakenAt('')).toBeNull()
    expect(formatTakenAt('not a date')).toBeNull()
    expect(formatTakenAt(undefined as unknown as string)).toBeNull()
  })

  it('(10) resolveFrameWindow / frameWindowTransform: inset 0 = frame 그대로, trim 교집합 − inset, 창을 없애는 inset·빈 교집합 = frame', () => {
    const frame = { left: -px(54), top: -px(79), width: px(108), height: px(158) }
    const trim = { left: -px(51), top: -px(76), width: px(102), height: px(152) }
    expect(resolveFrameWindow(frame, trim, 0)).toEqual(frame)
    expect(resolveFrameWindow(frame, null, 0)).toEqual(frame)
    const win = resolveFrameWindow(frame, trim, px(2))
    expect(win.width).toBeCloseTo(px(98), 6)
    expect(win.height).toBeCloseTo(px(148), 6)
    expect(win.left).toBeCloseTo(-px(49), 6)
    expect(win.top).toBeCloseTo(-px(74), 6)
    const t = frameWindowTransform(frame, win)
    expect(t.sx).toBeCloseTo(98 / 108, 9)
    expect(t.sy).toBeCloseTo(148 / 158, 9)
    expect(t.cx).toBeCloseTo(0, 6)
    expect(t.cy).toBeCloseTo(0, 6)
    // trim 없음 → frame − 2·inset
    const noTrim = resolveFrameWindow(frame, null, px(2))
    expect(noTrim.width).toBeCloseTo(px(104), 6)
    expect(noTrim.height).toBeCloseTo(px(154), 6)
    // 재단 안의 작은 프레임 → trim 과 무관하게 frame − 2·inset
    const small = { left: -px(20), top: -px(30), width: px(60), height: px(40) }
    const smallWin = resolveFrameWindow(small, trim, px(2))
    expect(smallWin.width).toBeCloseTo(px(56), 6)
    expect(smallWin.height).toBeCloseTo(px(36), 6)
    expect(frameWindowTransform(small, smallWin).cx).toBeCloseTo(px(10), 6)
    expect(frameWindowTransform(small, smallWin).cy).toBeCloseTo(-px(10), 6)
    // 창을 없애는 inset·빈 교집합 → frame 그대로(frameInsetScale {1,1} 규칙)
    expect(resolveFrameWindow(small, trim, px(20))).toEqual(small)
    expect(resolveFrameWindow(small, { left: 5000, top: 5000, width: 10, height: 10 }, px(2))).toEqual(
      { left: small.left + px(2), top: small.top + px(2), width: small.width - px(4), height: small.height - px(4) },
    )
    expect(frameWindowTransform(frame, frame)).toEqual({ sx: 1, sy: 1, cx: 0, cy: 0 })
  })
})

describe('PhotoPrintPlugin.apply — 사진틀 채움 규칙', () => {
  it('(2) 기본값(cover·inset 0): 사진 scale 이 기존 cover 산식과 바이트 동일, clip scale = frame scale, 프레임에 fitMode/frameInsetMm 기록', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { w: 200, h: 120, scale: 1.37, imgW: 400, imgH: 300 })
    const expected = Math.max((200 * 1.37) / 400, (120 * 1.37) / 300)
    expect(fore.scaleX).toBe(expected)
    const n = await makePlugin(canvas).apply(opts())
    expect(n).toBe(1)
    const f = frame as fabric.Rect & AnyRecord
    expect(f.fitMode).toBe('cover')
    expect(f.frameInsetMm).toBe(0)
    expect(f[FRAME_INSET_PX_RUNTIME_KEY]).toBe(0)
    expect(fore.scaleX).toBe(expected)
    expect(fore.scaleY).toBe(expected)
    expect(clip.scaleX).toBe(1.37)
    expect(clip.scaleY).toBe(1.37)
    const fc = frame.getCenterPoint()
    expect(fore.getCenterPoint().x).toBeCloseTo(fc.x, 6)
    expect(fore.getCenterPoint().y).toBeCloseTo(fc.y, 6)
  })

  it('(3) contain + 유테 2mm: 사진은 축소 창(사방 20px)에 contain, clip 복제본 scale 에 축별 비율 곱', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { w: 200, h: 120, scale: 1, imgW: 400, imgH: 300 })
    await makePlugin(canvas).apply(opts({ fitMode: 'contain', frameInsetMm: 2 }))
    const f = frame as fabric.Rect & AnyRecord
    expect(f.fitMode).toBe('contain')
    expect(f.frameInsetMm).toBe(2)
    expect(f[FRAME_INSET_PX_RUNTIME_KEY]).toBe(20)
    // 창 160×80, 사진 400×300 → contain = min(160/400, 80/300)
    expect(fore.scaleX).toBe(Math.min(160 / 400, 80 / 300))
    expect(clip.scaleX).toBe(160 / 200)
    expect(clip.scaleY).toBe(80 / 120)
    // 프레임 자체는 불변
    expect(frame.scaleX).toBe(1)
    expect(frame.width).toBe(200)
    expect(clip.absolutePositioned).toBe(true)
  })

  it('같은 옵션으로 재적용하면 사용자의 adjust(pan/zoom)를 보존하고, 옵션이 바뀌면 다시 맞춘다', async () => {
    const canvas = makeCanvas()
    const { fore } = makeFilledFrame(canvas, { w: 200, h: 120, imgW: 400, imgH: 300 })
    const plugin = makePlugin(canvas)
    await plugin.apply(opts())
    fore.set({ scaleX: 2, scaleY: 2, left: 50 })
    fore.setCoords()
    await plugin.apply(opts())
    expect(fore.scaleX).toBe(2)
    expect(fore.left).toBe(50)
    await plugin.apply(opts({ fitMode: 'contain' }))
    expect(fore.scaleX).toBe(Math.min(200 / 400, 120 / 300))
    expect(fore.left).not.toBe(50)
  })

  it('사진틀이 없으면 0, 채워지지 않은 틀은 기록만 한다', async () => {
    const canvas = makeCanvas()
    expect(await makePlugin(canvas).apply(opts())).toBe(0)
    const empty = new fabric.Rect({ id: 'f-empty', width: 10, height: 10, extensionType: 'frame' } as fabric.IRectOptions)
    canvas.add(empty)
    expect(await makePlugin(canvas).apply(opts({ fitMode: 'contain', frameInsetMm: 1 }))).toBe(1)
    expect((empty as fabric.Rect & AnyRecord).fitMode).toBe('contain')
    expect((empty as fabric.Rect & AnyRecord).frameInsetMm).toBe(1)
  })

  it('(7) apply 는 undo 단계를 만들지 않고 history 기준 상태만 현재로 맞춘다', async () => {
    const canvas = makeCanvas()
    const h = canvas as unknown as HistoryStub
    makeFilledFrame(canvas, {})
    h.historyNextState = h._historyNext()
    await makePlugin(canvas).apply(opts({ fitMode: 'contain', grayscale: true }))
    expect(h.historyUndo).toHaveLength(0)
    expect(h.historyProcessing).toBe(false)
    expect(h.historyNextState).toBe(h._historyNext())
  })
})

describe('PhotoPrintPlugin 직렬화 왕복', () => {
  it('(4) fitMode/frameInsetMm·extension.takenAt 이 toJSON(extendFabricOption)→loadFromJSON 왕복에 보존되고 rehydrate 가 런타임 값을 복구한다', async () => {
    const c1 = makeCanvas()
    const { frame } = makeFilledFrame(c1, { w: 200, h: 120, imgW: 400, imgH: 300, takenAt: '2026-10-19T10:00:00Z' })
    c1.add(makeOverlay('d1'))
    await makePlugin(c1).apply(opts({ fitMode: 'contain', frameInsetMm: 2, dateOverlay: true }))
    const saved = c1.toJSON(core.extendFabricOption as string[])
    const wire = JSON.parse(JSON.stringify(saved))
    const savedFrame = (wire.objects as AnyRecord[]).find((o) => o.id === 'frame-1')!
    expect(savedFrame.fitMode).toBe('contain')
    expect(savedFrame.frameInsetMm).toBe(2)
    expect(savedFrame[FRAME_INSET_PX_RUNTIME_KEY]).toBeUndefined()

    const c2 = makeCanvas()
    await core.loadFromJSON(c2, wire)
    const restoredFrame = c2.getObjects().find((o) => o.id === 'frame-1') as fabric.Object & AnyRecord
    const restoredFore = c2.getObjects().find((o) => o.id === 'frame-1_fillImage') as fabric.Image & AnyRecord
    const restoredOverlay = c2.getObjects().find((o) => o.id === 'd1') as fabric.Text
    expect(restoredFrame.fitMode).toBe('contain')
    expect(restoredFrame.frameInsetMm).toBe(2)
    expect(restoredFrame[FRAME_INSET_PX_RUNTIME_KEY]).toBeUndefined()
    expect(restoredFore.extension).toEqual({ takenAt: '2026-10-19T10:00:00Z' })
    expect(restoredFore.parentLayerId).toBe('frame-1')
    expect(restoredFore.clipPath?.absolutePositioned).toBe(true)
    expect(restoredOverlay.text).toBe(localYmd('2026-10-19T10:00:00Z'))

    const plugin2 = makePlugin(c2)
    expect(plugin2.getFrames().map((f) => f.id)).toEqual([frame.id])
    expect(await plugin2.rehydrate(opts({ fitMode: 'contain', frameInsetMm: 2, dateOverlay: true }))).toBe(1)
    expect(restoredFrame[FRAME_INSET_PX_RUNTIME_KEY]).toBe(20)
    // 값이 같으므로 복원된 사진 scale(사용자 adjust 포함)은 그대로 — fabric toJSON 은 소수 2자리로 저장(NUM_FRACTION_DIGITS)
    const persisted = restoredFore.scaleX
    expect(persisted).toBeCloseTo(Math.min(160 / 400, 80 / 300), 2)
    expect(restoredFore.scaleX).toBe(persisted)
  })
})

describe('PhotoPrintPlugin date-overlay', () => {
  it('(5) takenAt 있음 → YYYY.MM.DD, 없음 → 빈 문자열, dateOverlay off → 빈 문자열', async () => {
    const canvas = makeCanvas()
    makeFilledFrame(canvas, { takenAt: '2025-03-07T01:02:03Z' })
    const overlay = makeOverlay('d1')
    canvas.add(overlay)
    const plugin = makePlugin(canvas)
    await plugin.apply(opts({ dateOverlay: true }))
    expect(overlay.text).toBe(localYmd('2025-03-07T01:02:03Z'))
    await plugin.apply(opts({ dateOverlay: false }))
    expect(overlay.text).toBe('')

    const c2 = makeCanvas()
    makeFilledFrame(c2, {})
    const o2 = makeOverlay('d2')
    c2.add(o2)
    await makePlugin(c2).apply(opts({ dateOverlay: true }))
    expect(o2.text).toBe('')
  })

  it('(5) extension.frameId 가 있으면 그 틀의 사진, 없으면 캔버스의 첫 채워진 틀', async () => {
    const canvas = makeCanvas()
    makeFilledFrame(canvas, { id: 'a', takenAt: '2024-01-02' })
    makeFilledFrame(canvas, { id: 'b', left: 500, takenAt: '2023-12-31' })
    const bound = makeOverlay('db', { frameId: 'b' })
    const first = makeOverlay('df')
    const missing = makeOverlay('dm', { frameId: 'zzz' })
    canvas.add(bound, first, missing)
    await makePlugin(canvas).apply(opts({ dateOverlay: true }))
    expect(bound.text).toBe('2023.12.31')
    expect(first.text).toBe('2024.01.02')
    expect(missing.text).toBe('')
    expect(PhotoPrintPlugin.isDateOverlay(bound)).toBe(true)
    expect(PhotoPrintPlugin.isDateOverlay(canvas.getObjects()[0])).toBe(false)
  })
})

describe('PhotoPrintPlugin grayscale', () => {
  it('(6) on 멱등(태그 필터 1개 유지), off 로 제거, 다른 필터는 보존', async () => {
    const canvas = makeCanvas()
    const { fore } = makeFilledFrame(canvas, {})
    const other = new fabric.Image.filters.Brightness({ brightness: 0.1, effectType: 'emboss' } as unknown as Record<string, unknown>)
    fore.filters = [other]
    const plugin = makePlugin(canvas)
    await plugin.apply(opts({ grayscale: true }))
    await plugin.apply(opts({ grayscale: true }))
    const on = filtersOf(fore)
    expect(on).toHaveLength(2)
    expect(on.filter((f) => f.effectType === PHOTO_PRINT_EFFECT_TYPE).map((f) => f.type)).toEqual(['Grayscale'])
    expect((fore as fabric.Image & AnyRecord).extension).toEqual({ grayscale: true })
    await plugin.apply(opts({ grayscale: false }))
    const off = filtersOf(fore)
    expect(off).toHaveLength(1)
    expect(off[0].effectType).toBe('emboss')
    expect((fore as fabric.Image & AnyRecord).extension).toBeUndefined()
  })

  it('(6) 왕복 뒤 태그가 사라져도 extension.grayscale 로 재입양 — on 유지 시 1개, off 시 제거', async () => {
    const c1 = makeCanvas()
    const { fore } = makeFilledFrame(c1, { takenAt: '2026-01-01' })
    await makePlugin(c1).apply(opts({ grayscale: true }))
    expect((fore as fabric.Image & AnyRecord).extension).toEqual({ takenAt: '2026-01-01', grayscale: true })
    const wire = JSON.parse(JSON.stringify(c1.toJSON(core.extendFabricOption as string[])))
    const c2 = makeCanvas()
    await core.loadFromJSON(c2, wire)
    const restored = c2.getObjects().find((o) => o.id === 'frame-1_fillImage') as fabric.Image & AnyRecord
    expect(filtersOf(restored).map((f) => ({ type: f.type, effectType: f.effectType }))).toEqual([{ type: 'Grayscale', effectType: undefined }])
    const plugin2 = makePlugin(c2)
    await plugin2.rehydrate(opts({ grayscale: true }))
    expect(filtersOf(restored)).toHaveLength(1)
    expect(filtersOf(restored)[0].effectType).toBe(PHOTO_PRINT_EFFECT_TYPE)
    await plugin2.apply(opts({ grayscale: false }))
    expect(filtersOf(restored)).toHaveLength(0)
    expect(restored.extension).toEqual({ takenAt: '2026-01-01' })
  })
})

describe('FrameInteractionPlugin._syncFromFrame 회귀 가드 (유테 비율)', () => {
  type SyncAccess = { _syncFromFrame: (frame: fabric.Object) => void }

  function dragFrame(canvas: fabric.Canvas, frame: fabric.Object, fore: fabric.Object, dx: number): void {
    ;(frame as fabric.Object & AnyRecord).__frameTxStart = frame.calcTransformMatrix()
    ;(fore as fabric.Object & AnyRecord).__frameTxStart = fore.calcTransformMatrix()
    frame.set({ left: (frame.left ?? 0) + dx })
    frame.setCoords()
  }

  it('(8) inset 미설정·0 이면 clip scale 이 frame.scaleX/Y 와 바이트 동일(기존 동작)', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { scale: 1.37 })
    const fip = new FrameInteractionPlugin(canvas, editorStub, {})
    dragFrame(canvas, frame, fore, 30)
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    expect(clip.scaleX).toBe(frame.scaleX)
    expect(clip.scaleY).toBe(frame.scaleY)
    expect(clip.left).toBe(frame.getCenterPoint().x)

    await makePlugin(canvas).apply(opts())
    expect((frame as fabric.Object & AnyRecord)[FRAME_INSET_PX_RUNTIME_KEY]).toBe(0)
    dragFrame(canvas, frame, fore, 30)
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    expect(clip.scaleX).toBe(frame.scaleX)
    expect(clip.scaleY).toBe(frame.scaleY)
    fip.dispose()
  })

  it('(8) 유테 2mm 가 적용된 틀은 드래그 뒤에도 clip scale 에 같은 축별 비율이 유지된다', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { w: 200, h: 120, scale: 1 })
    await makePlugin(canvas).apply(opts({ frameInsetMm: 2 }))
    const fip = new FrameInteractionPlugin(canvas, editorStub, {})
    dragFrame(canvas, frame, fore, 40)
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    expect(clip.scaleX).toBe(160 / 200)
    expect(clip.scaleY).toBe(80 / 120)
    expect(clip.left).toBe(frame.getCenterPoint().x)
    fip.dispose()
  })
})

describe('fillImage extension 보존 — 그룹화(GroupPlugin)·clone 경로', () => {
  it('(9) 틀+사진을 GroupPlugin.group 으로 묶고 왕복해도 자식 fillImage 의 extension.takenAt 이 남는다; clone(extendFabricOption) 도 보존', async () => {
    const canvas = makeCanvas()
    const { frame, fore } = makeFilledFrame(canvas, { takenAt: '2026-05-05T00:00:00Z' })
    const sel = new fabric.ActiveSelection([fore, frame], { canvas } as fabric.IObjectOptions)
    canvas.setActiveObject(sel)
    new GroupPlugin(canvas, editorStub).group()
    const group = canvas.getObjects().find((o) => o.type === 'group') as fabric.Group
    expect(group).toBeDefined()
    const wire = JSON.parse(JSON.stringify(canvas.toJSON(core.extendFabricOption as string[])))
    const c2 = makeCanvas()
    await core.loadFromJSON(c2, wire)
    const g2 = c2.getObjects().find((o) => o.type === 'group') as fabric.Group
    const child = g2.getObjects().find((o) => (o as fabric.Object & AnyRecord).extensionType === 'fillImage') as fabric.Object & AnyRecord
    expect(child.extension).toEqual({ takenAt: '2026-05-05T00:00:00Z' })
    expect(child.parentLayerId).toBe('frame-1')

    const cloned = await new Promise<fabric.Object & AnyRecord>((resolve) => {
      child.clone((c: fabric.Object & AnyRecord) => resolve(c), core.extendFabricOption as string[])
    })
    expect(cloned.extension).toEqual({ takenAt: '2026-05-05T00:00:00Z' })
  })
})

describe('D3 — 유테 창은 재단 상자 기준 (bleedPx·__frameWindow·__photoPrintBleedPx)', () => {
  type SyncAccess = { _syncFromFrame: (frame: fabric.Object) => void }
  function dragFrame(frame: fabric.Object, fore: fabric.Object, dx: number): void {
    ;(frame as fabric.Object & AnyRecord).__frameTxStart = frame.calcTransformMatrix()
    ;(fore as fabric.Object & AnyRecord).__frameTxStart = fore.calcTransformMatrix()
    frame.set({ left: (frame.left ?? 0) + dx })
    frame.setCoords()
  }
  /** 108×158mm 풀블리드 틀(재단 102×152 + 도련 3mm) + 같은 크기 workspace — A 레인 샘플 digital 앞면과 같은 저작 */
  function makeBleedCanvas(init: { imgW?: number; imgH?: number } = {}): { canvas: fabric.Canvas } & FilledFrame {
    const canvas = makeCanvas()
    addWorkspace(canvas, px(108), px(158))
    // strokeWidth 0: fabric Rect 기본 stroke 1px 이 getCenterPoint 를 0.5px 밀어 재단 중심과 어긋나는 것을 배제(샘플 틀도 stroke 없음)
    const filled = makeFilledFrame(canvas, {
      id: 'full', left: -px(54), top: -px(79), w: px(108), h: px(158), scale: 1, imgW: init.imgW ?? 4000, imgH: init.imgH ?? 3000, strokeWidth: 0,
    })
    return { canvas, ...filled }
  }

  it('(10) 108×158 틀·bleed px(3)·inset px(2): window = 98×148mm 상당, 중심 = 프레임 중심, clip scale = 창 비율, 사진은 창 기준 cover', async () => {
    const { canvas, frame, fore, clip } = makeBleedCanvas()
    await makePlugin(canvas).apply(opts({ frameInsetMm: 2, mmToPx: px, bleedPx: px(3) }))
    const win = (frame as fabric.Rect & AnyRecord)[FRAME_WINDOW_RUNTIME_KEY] as FrameWindow
    expect((canvas as unknown as AnyRecord)[PHOTO_PRINT_BLEED_PX_RUNTIME_KEY]).toBe(px(3))
    expect(win.sx).toBeCloseTo(98 / 108, 9)
    expect(win.sy).toBeCloseTo(148 / 158, 9)
    const fc = frame.getCenterPoint()
    expect(win.cx).toBeCloseTo(fc.x, 6)
    expect(win.cy).toBeCloseTo(fc.y, 6)
    expect(clip.scaleX).toBeCloseTo(98 / 108, 9)
    expect(clip.scaleY).toBeCloseTo(148 / 158, 9)
    expect(clip.left).toBeCloseTo(fc.x, 6)
    expect(clip.top).toBeCloseTo(fc.y, 6)
    // 창(98×148mm) 안쪽 가장자리 = 재단선에서 2mm → 재단 뒤 흰 띠 2mm 가 남는다
    const clipW = (clip.width ?? 0) * (clip.scaleX ?? 1)
    expect(clipW).toBeCloseTo(px(98), 6)
    expect(fore.scaleX).toBeCloseTo(Math.max(px(98) / 4000, px(148) / 3000), 9)
    expect(fore.getCenterPoint().x).toBeCloseTo(fc.x, 6)
    // 직렬화에는 런타임 키가 나가지 않는다
    const wire = JSON.parse(JSON.stringify(canvas.toJSON(core.extendFabricOption as string[])))
    const savedFrame = (wire.objects as AnyRecord[]).find((o) => o.id === 'full')!
    expect(savedFrame[FRAME_WINDOW_RUNTIME_KEY]).toBeUndefined()
    expect(savedFrame[FRAME_INSET_PX_RUNTIME_KEY]).toBeUndefined()
    expect(savedFrame.frameInsetMm).toBe(2)
    expect(wire[PHOTO_PRINT_BLEED_PX_RUNTIME_KEY]).toBeUndefined()
  })

  it('(10) contain 은 창(98×148) 기준 min', async () => {
    const { canvas, fore } = makeBleedCanvas({ imgW: 4000, imgH: 3000 })
    await makePlugin(canvas).apply(opts({ fitMode: 'contain', frameInsetMm: 2, mmToPx: px, bleedPx: px(3) }))
    expect(fore.scaleX).toBeCloseTo(Math.min(px(98) / 4000, px(148) / 3000), 9)
  })

  it('(10) 재단 안의 작은 틀(60×40mm)은 window = frame − 2·inset, 중심 = 틀 중심', async () => {
    const canvas = makeCanvas()
    addWorkspace(canvas, px(108), px(158))
    const { frame, clip } = makeFilledFrame(canvas, { id: 'small', left: -px(30), top: -px(20), w: px(60), h: px(40), scale: 1, strokeWidth: 0 })
    await makePlugin(canvas).apply(opts({ frameInsetMm: 2, mmToPx: px, bleedPx: px(3) }))
    const win = (frame as fabric.Rect & AnyRecord)[FRAME_WINDOW_RUNTIME_KEY] as FrameWindow
    expect(win.sx).toBeCloseTo(56 / 60, 9)
    expect(win.sy).toBeCloseTo(36 / 40, 9)
    expect(win.cx).toBeCloseTo(frame.getCenterPoint().x, 6)
    expect(clip.scaleX).toBeCloseTo(56 / 60, 9)
  })

  it('(10) bleed 0·inset 0 이면 종전 값과 바이트 동일(window = 프레임 bbox, sx=sy=1, 중심 = 프레임 중심, clip scale = frame scale)', async () => {
    const canvas = makeCanvas()
    addWorkspace(canvas, px(108), px(158))
    const { frame, fore, clip } = makeFilledFrame(canvas, { id: 'full', left: -px(54), top: -px(79), w: px(108), h: px(158), scale: 1.37, strokeWidth: 0 })
    const beforeScale = fore.scaleX
    const beforeLeft = fore.left
    await makePlugin(canvas).apply(opts({ mmToPx: px }))
    const win = (frame as fabric.Rect & AnyRecord)[FRAME_WINDOW_RUNTIME_KEY] as FrameWindow
    const fc = frame.getCenterPoint()
    expect(win).toEqual({ sx: 1, sy: 1, cx: fc.x, cy: fc.y })
    expect((canvas as unknown as AnyRecord)[PHOTO_PRINT_BLEED_PX_RUNTIME_KEY]).toBe(0)
    expect(clip.scaleX).toBe(1.37)
    expect(clip.scaleY).toBe(1.37)
    expect(clip.left).toBe(fc.x)
    expect(clip.top).toBe(fc.y)
    expect(fore.scaleX).toBe(beforeScale)
    expect(fore.left).toBe(beforeLeft)
    // bleed 만 있고 inset 0 이어도 동일
    await makePlugin(canvas).apply(opts({ mmToPx: px, bleedPx: px(3) }))
    expect(clip.scaleX).toBe(1.37)
    expect(fore.scaleX).toBe(beforeScale)
    expect(resolveFrameWindowFor(frame, canvas, 0, px(3))).toEqual({ sx: 1, sy: 1, cx: fc.x, cy: fc.y })
  })

  it('(10) 드래그(FrameInteractionPlugin._syncFromFrame) 뒤에도 창은 재단 상자 기준으로 다시 계산되고 __frameWindow 가 갱신된다', async () => {
    const { canvas, frame, fore, clip } = makeBleedCanvas()
    await makePlugin(canvas).apply(opts({ frameInsetMm: 2, mmToPx: px, bleedPx: px(3) }))
    const fip = new FrameInteractionPlugin(canvas, editorStub, {})
    // 틀을 오른쪽으로 10mm 이동 → 틀 [-44, 64] ∩ 재단 [-51, 51] = [-44, 51] → inset 2 → 창 [-42, 49] = 91mm, 중심 +3.5mm(틀 중심 +10 아님)
    dragFrame(frame, fore, px(10))
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    const win = (frame as fabric.Rect & AnyRecord)[FRAME_WINDOW_RUNTIME_KEY] as FrameWindow
    expect(win.sx).toBeCloseTo(91 / 108, 9)
    expect(win.sy).toBeCloseTo(148 / 158, 9)
    expect(clip.scaleX).toBeCloseTo(91 / 108, 9)
    expect(win.cx).toBeCloseTo(px(3.5), 6)
    expect(clip.left).toBeCloseTo(px(3.5), 6)
    expect(clip.top).toBeCloseTo(frame.getCenterPoint().y, 6)
    fip.dispose()
  })
})

describe('serialization-3 — 런타임 키 유실(undo 틀 재생성) 뒤에도 유테 유지', () => {
  type SyncAccess = { _syncFromFrame: (frame: fabric.Object) => void }
  function dragFrame(frame: fabric.Object, fore: fabric.Object, dx: number): void {
    ;(frame as fabric.Object & AnyRecord).__frameTxStart = frame.calcTransformMatrix()
    ;(fore as fabric.Object & AnyRecord).__frameTxStart = fore.calcTransformMatrix()
    frame.set({ left: (frame.left ?? 0) + dx })
    frame.setCoords()
  }

  it('(12) __frameInsetPx·__frameWindow 를 지운 뒤 드래그 → 직렬화된 frameInsetMm(mmToPxDisplay)+캔버스 bleed 폴백으로 clip 비율 유지', async () => {
    const canvas = makeCanvas()
    addWorkspace(canvas, px(108), px(158))
    const { frame, fore, clip } = makeFilledFrame(canvas, { id: 'full', left: -px(54), top: -px(79), w: px(108), h: px(158), scale: 1, strokeWidth: 0 })
    await makePlugin(canvas).apply(opts({ frameInsetMm: 2, mmToPx: px, bleedPx: px(3) }))
    expect(clip.scaleX).toBeCloseTo(98 / 108, 9)
    // undo 재추가 = 새 인스턴스: 직렬화 속성(frameInsetMm)만 남고 런타임 키는 없다
    const f = frame as fabric.Rect & AnyRecord
    delete f[FRAME_INSET_PX_RUNTIME_KEY]
    delete f[FRAME_WINDOW_RUNTIME_KEY]
    expect(f.frameInsetMm).toBe(2)
    const fip = new FrameInteractionPlugin(canvas, editorStub, {})
    dragFrame(frame, fore, 1)
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    // 종전(결함): clip.scaleX = frame.scaleX = 1 → 유테 소실. 수정 후: 폴백으로 창 비율 유지(1px 이동은 3mm 도련 안이라 교집합 불변)
    expect(clip.scaleX).toBeCloseTo(98 / 108, 9)
    expect(clip.scaleY).toBeCloseTo(148 / 158, 9)
    expect(clip.left).toBeCloseTo(0, 6)
    expect(f[FRAME_WINDOW_RUNTIME_KEY]).toBeDefined()
    fip.dispose()
  })

  it('(12) 런타임 키·캔버스 bleed 가 모두 없고 frameInsetMm 도 없으면 종전 1:1', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { scale: 1.37 })
    const fip = new FrameInteractionPlugin(canvas, editorStub, {})
    dragFrame(frame, fore, 30)
    ;(fip as unknown as SyncAccess)._syncFromFrame(frame)
    expect(clip.scaleX).toBe(frame.scaleX)
    expect(clip.left).toBe(frame.getCenterPoint().x)
    expect((frame as fabric.Rect & AnyRecord)[FRAME_WINDOW_RUNTIME_KEY]).toBeUndefined()
    fip.dispose()
  })

  it('(12) 같은 옵션으로 rehydrate 해도 어긋난 clip 복제본은 창에 다시 맞춘다(사진 adjust 는 보존)', async () => {
    const canvas = makeCanvas()
    const { frame, fore, clip } = makeFilledFrame(canvas, { w: 200, h: 120, scale: 1 })
    const plugin = makePlugin(canvas)
    await plugin.apply(opts({ frameInsetMm: 2 }))
    expect(clip.scaleX).toBe(160 / 200)
    // 결함 시나리오: 런타임 키 없는 상태에서 드래그돼 clip 이 1:1 로 덮였고, 사용자가 사진을 adjust 했다
    clip.set({ scaleX: frame.scaleX, scaleY: frame.scaleY })
    fore.set({ scaleX: 2, scaleY: 2, left: 50 })
    fore.setCoords()
    await plugin.rehydrate(opts({ frameInsetMm: 2 }))
    expect(clip.scaleX).toBe(160 / 200)
    expect(clip.scaleY).toBe(80 / 120)
    expect(fore.scaleX).toBe(2)
    expect(fore.left).toBe(50)
  })
})

describe('serialization-4 — undo/redo 뒤 plain 객체 filters 내성', () => {
  it('(13) filters=[{type:"Grayscale"}] plain + extension.grayscale → apply 예외 없음, fromObject 로 복원·태그 입양·필터 1개', async () => {
    const canvas = makeCanvas()
    const { fore } = makeFilledFrame(canvas, {})
    const f = fore as fabric.Image & AnyRecord
    f.extension = { grayscale: true }
    // fabric-history _loadHistory 의 set(historyObj) 가 만드는 상태: toObject 결과(plain) 를 그대로 filters 에 넣는다
    fore.filters = [{ type: 'Grayscale', mode: 'average' }] as unknown as fabric.IBaseFilter[]
    expect(typeof (fore.filters[0] as unknown as AnyRecord).applyTo).toBe('undefined')
    await expect(makePlugin(canvas).apply(opts({ grayscale: true }))).resolves.toBe(1)
    const after = fore.filters as unknown as Array<{ type?: string; effectType?: string; applyTo?: unknown }>
    expect(after).toHaveLength(1)
    expect(after[0].type).toBe('Grayscale')
    expect(after[0].effectType).toBe(PHOTO_PRINT_EFFECT_TYPE)
    expect(typeof after[0].applyTo).toBe('function')
    expect(after[0]).toBeInstanceOf(fabric.Image.filters.Grayscale)
  })

  it('(13) plain Grayscale + 소유 표식 없음(결함 순서 B) → 흑백 on/off 가 예외 없이 동작하고 off 로 태그 필터가 빠진다', async () => {
    const canvas = makeCanvas()
    const { fore } = makeFilledFrame(canvas, {})
    const other = new fabric.Image.filters.Brightness({ brightness: 0.1 } as unknown as Record<string, unknown>).toObject()
    fore.filters = [{ type: 'Grayscale', mode: 'average' }, other] as unknown as fabric.IBaseFilter[]
    const plugin = makePlugin(canvas)
    await expect(plugin.apply(opts({ grayscale: true }))).resolves.toBe(1)
    const on = filtersOf(fore) as Array<{ type?: string; effectType?: string; applyTo?: unknown }>
    expect(on.every((f) => typeof f.applyTo === 'function')).toBe(true)
    expect(on.filter((f) => f.effectType === PHOTO_PRINT_EFFECT_TYPE)).toHaveLength(1)
    expect(on.map((f) => f.type)).toEqual(['Grayscale', 'Brightness', 'Grayscale'])
    await expect(plugin.apply(opts({ grayscale: false }))).resolves.toBe(1)
    const off = filtersOf(fore)
    expect(off.map((f) => f.type)).toEqual(['Grayscale', 'Brightness'])
    expect(off.every((f) => f.effectType !== PHOTO_PRINT_EFFECT_TYPE)).toBe(true)
  })

  it('(13) 복원 불가 plain 항목(미지 type)은 경고 후 제외, 나머지 틀·date-overlay 처리는 계속된다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const canvas = makeCanvas()
      const a = makeFilledFrame(canvas, { id: 'a', takenAt: '2024-01-02' })
      const b = makeFilledFrame(canvas, { id: 'b', left: 500, takenAt: '2024-02-03' })
      const overlay = makeOverlay('db', { frameId: 'b' })
      canvas.add(overlay)
      a.fore.filters = [{ type: 'NoSuchFilter' }, null] as unknown as fabric.IBaseFilter[]
      const n = await makePlugin(canvas).apply(opts({ grayscale: true, dateOverlay: true }))
      expect(n).toBe(2)
      expect(filtersOf(a.fore).map((f) => ({ type: f.type, effectType: f.effectType }))).toEqual([{ type: 'Grayscale', effectType: PHOTO_PRINT_EFFECT_TYPE }])
      expect(filtersOf(b.fore)).toHaveLength(1)
      expect(overlay.text).toBe('2024.02.03')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('(13) applyFilters 가 throw 해도 apply 는 중단되지 않고 다음 틀·date-overlay·필터 목록 갱신을 끝낸다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const canvas = makeCanvas()
      const a = makeFilledFrame(canvas, { id: 'a' })
      const b = makeFilledFrame(canvas, { id: 'b', left: 500, takenAt: '2024-02-03' })
      const overlay = makeOverlay('d')
      canvas.add(overlay)
      ;(a.fore as fabric.Image & AnyRecord).applyFilters = () => { throw new TypeError('filter.isNeutralState is not a function') }
      const n = await makePlugin(canvas).apply(opts({ grayscale: true, dateOverlay: true }))
      expect(n).toBe(2)
      expect(filtersOf(a.fore).filter((f) => f.effectType === PHOTO_PRINT_EFFECT_TYPE)).toHaveLength(1)
      expect(filtersOf(b.fore).filter((f) => f.effectType === PHOTO_PRINT_EFFECT_TYPE)).toHaveLength(1)
      // 첫 채워진 틀(a) 에는 takenAt 이 없으므로 '' — 루프가 b 까지 돌았음은 b 의 필터로 확인
      expect(overlay.text).toBe('')
      expect((canvas as unknown as HistoryStub).historyProcessing).toBe(false)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('serialization-6 / tests-4 — 채워진 사진 삭제 뒤 date-overlay', () => {
  it('(14) 사진(fillImage)만 제거된 틀: apply → "" (adjust 모드에서 사진 DEL)', async () => {
    const canvas = makeCanvas()
    const { fore } = makeFilledFrame(canvas, { takenAt: '2025-03-07' })
    const overlay = makeOverlay('d1')
    canvas.add(overlay)
    const plugin = makePlugin(canvas)
    await plugin.apply(opts({ dateOverlay: true }))
    expect(overlay.text).toBe('2025.03.07')
    canvas.remove(fore)
    await plugin.apply(opts({ dateOverlay: true }))
    expect(overlay.text).toBe('')
  })

  it('(14) 틀+사진이 함께 제거(ObjectPlugin.del 동반 삭제): apply/rehydrate → "", frameId 바인딩도 ""', async () => {
    const canvas = makeCanvas()
    const a = makeFilledFrame(canvas, { id: 'a', takenAt: '2025-03-07' })
    const bound = makeOverlay('db', { frameId: 'a' })
    const first = makeOverlay('df')
    canvas.add(bound, first)
    const plugin = makePlugin(canvas)
    await plugin.apply(opts({ dateOverlay: true }))
    expect(bound.text).toBe('2025.03.07')
    expect(first.text).toBe('2025.03.07')
    canvas.remove(a.fore, a.frame)
    expect(await plugin.rehydrate(opts({ dateOverlay: true }))).toBe(0)
    expect(bound.text).toBe('')
    expect(first.text).toBe('')
    const wire = JSON.parse(JSON.stringify(canvas.toJSON(core.extendFabricOption as string[])))
    expect((wire.objects as AnyRecord[]).find((o) => o.id === 'db')!.text).toBe('')
  })
})
