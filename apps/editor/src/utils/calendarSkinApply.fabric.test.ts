// @vitest-environment happy-dom
//
// 캘린더 디자인(스킨) 적용 — 실 fabric 캔버스(StaticCanvas + loadFromJSON) 통합.
// 실물: mergeSkinCanvas·toJSON(core.extendFabricOption)·loadFromJSON·workspace 리사이즈·사진틀 재바인딩·고객 잠금·필수 편집 추적.
// 대역: 템플릿셋 조회(픽스처)·그리드 재합성(strict — 이 하네스에는 CalendarPlugin·날짜 데이터 렌더가 없어 그리드 수만 돌려주는 함수로 바꾼다).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

vi.unmock('fabric')

import { fabric } from 'fabric'
import { core } from '@storige/canvas-core'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import CalendarSkinSection from '@/components/calendar/CalendarSkinSection'
import { applyCustomerLocks } from '@/hooks/useEditorContents'
import { useCalendarSkinStore } from '@/stores/useCalendarSkinStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { __resetAutosaveSuspendForTest } from '@/utils/autosaveSuspend'
import { calendarSessionMetadataFields } from '@/utils/calendarRehydrateAll'
import {
  __resetSkinApplyForTest,
  executeSkinApply,
  prepareSkinApply,
  undoSkinApply,
  type SkinApplyDeps,
  type SkinCanvasHandle,
} from './calendarSkinApply'

type Plain = Record<string, unknown>
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const WS: Plain = { type: 'rect', id: 'workspace', left: 0, top: 0, width: 600, height: 400, fill: '#fff' }
const grid = (id: string, left: number): Plain => ({
  type: 'group', id, extensionType: 'calendar-grid', deleteable: false, movable: false, left, top: 200, width: 200, height: 150,
  extension: { variant: 'month' },
  objects: [{ type: 'rect', id: `${id}-bounds`, left: -100, top: -75, width: 200, height: 150, fill: '' }],
})
const BASE_T: Plain[][] = [
  [WS, { type: 'rect', id: 'bg', extensionType: 'background', left: 0, top: 0, width: 600, height: 400, fill: '#eee' },
    { type: 'rect', id: 'frame0', extensionType: 'frame', left: 20, top: 20, width: 200, height: 150, rx: 0, ry: 0, fill: '#ccc' }, grid('grid0', 300)],
  [WS, { type: 'rect', id: 'frame1', extensionType: 'frame', left: 20, top: 20, width: 200, height: 150, rx: 0, ry: 0, fill: '#ccc' }, grid('grid1', 300)],
]
/** 템플릿 복제로 만든 스킨 — 같은 id, 색·장식만 다름 */
const SPRING_T: Plain[][] = [
  [WS, { type: 'rect', id: 'bg', extensionType: 'background', left: 0, top: 0, width: 600, height: 400, fill: '#fde' },
    { type: 'rect', id: 'deco', left: 500, top: 20, width: 40, height: 40, fill: '#f0a', deleteable: false },
    { type: 'rect', id: 'frame0', extensionType: 'frame', left: 20, top: 20, width: 200, height: 150, rx: 0, ry: 0, fill: '#fcf' }, grid('grid0', 300)],
  [WS, { type: 'rect', id: 'frame1', extensionType: 'frame', left: 20, top: 20, width: 200, height: 150, rx: 0, ry: 0, fill: '#fcf' }, grid('grid1', 300)],
]

function profile(skins: unknown[] | undefined): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 2, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: false }, dataVersion: 'kr-2025-2035-v1',
      ...(skins ? { skins } : {}),
    },
    output: { mode: 'single-pdf' },
  } as ProductProfile
}
const PROFILE = profile([{ key: 'spring', label: '봄', templateSetId: 'set-spring' }])
const setOf = (id: string, t: Plain[][]) => ({
  templateSet: { id, name: id, siteId: null, width: 100, height: 100, productProfile: PROFILE },
  templateDetails: t.map((objects, i) => ({ id: `${id}-${i}`, canvasData: { version: '5.3.0', objects: clone(objects) } })),
})
const SETS: Record<string, ReturnType<typeof setOf>> = { base: setOf('base', BASE_T), 'set-spring': setOf('set-spring', SPRING_T) }

interface HistoryStub {
  historyUndo: unknown[]
  historyRedo: unknown[]
}

async function makeCanvas(objects: Plain[]): Promise<fabric.StaticCanvas & HistoryStub> {
  const canvas = new fabric.StaticCanvas(null, { width: 800, height: 600, renderOnAddRemove: false }) as fabric.StaticCanvas & HistoryStub
  const c = canvas as unknown as Plain
  c.requestRenderAll = () => canvas
  c.renderAll = () => canvas
  c.clearContext = () => canvas
  c.getContext = () => ({})
  c.discardActiveObject = () => canvas
  c.getActiveObject = () => null
  canvas.historyUndo = ['step']
  canvas.historyRedo = ['step']
  c.offHistory = () => undefined
  c.onHistory = () => undefined
  // canvas-core 히스토리 비우기 실물(fabric.Canvas.prototype)을 그대로 쓴다
  c.clearHistory = (fabric.Canvas.prototype as unknown as { clearHistory: () => void }).clearHistory
  await new Promise<void>((r) => canvas.loadFromJSON({ version: '5.3.0', objects: clone(objects) } as unknown as string, () => r()))
  return canvas
}

function editorFor(canvas: fabric.StaticCanvas) {
  const servicePlugin = { loadJSON: (data: unknown, cb?: () => void) => canvas.loadFromJSON(data as string, () => cb?.()) }
  return { getPlugin: (name: string) => (name === 'ServicePlugin' ? servicePlugin : undefined), emit: () => undefined }
}

let handles: SkinCanvasHandle[]

function deps(): Partial<SkinApplyDeps> {
  return {
    fetchSet: async (id) => clone(SETS[id]) as never,
    getSaveNow: () => undefined,
    getHandles: () => handles,
    rehydrateStrict: async (_e, c) => ({ ok: true, count: c.getObjects().filter((o) => (o as Plain).extensionType === 'calendar-grid').length }),
    emit: () => undefined,
    requestFrame: () => undefined,
  }
}

const json = (c: fabric.StaticCanvas) => c.toJSON(core.extendFabricOption) as unknown as { objects: Plain[] }

/** 세션: 기준 디자인 + 표지 틀에 채운 사진(이동·확대 변환) + 고객 스티커 */
async function openSession(p: ProductProfile | null) {
  const photo: Plain = { type: 'rect', id: 'frame0_fillImage', extensionType: 'fillImage', frameRef: 'frame0', left: 15, top: 18, width: 300, height: 200, scaleX: 0.8, scaleY: 0.8, fill: '#000' }
  const sticker: Plain = { type: 'rect', id: 'u-sticker', extensionType: 'sticker', left: 550, top: 350, width: 20, height: 20, fill: '#00f' }
  const c0 = await makeCanvas([...BASE_T[0], photo, sticker])
  const c1 = await makeCanvas(BASE_T[1])
  handles = [c0, c1].map((canvas) => ({ canvas: canvas as unknown as fabric.Canvas, editor: editorFor(canvas) as never }))
  useSettingsStore.getState().setProductProfile(p)
  useSettingsStore.setState({
    customerPreview: false,
    linkedPrintTemplates: BASE_T.map((objects, i) => ({ id: `base-${i}`, name: `t${i}`, type: 'page', width: 100, height: 100, canvasData: { objects: clone(objects) } })),
    currentSettings: { ...useSettingsStore.getState().currentSettings, editMode: false, size: { width: 100, height: 60, cutSize: 0 } },
  } as never)
  useCalendarStore.getState().setFromProfile(p)
  useCalendarSkinStore.getState().reset()
  useCalendarSkinStore.getState().setBase('base')
  useEditorStore.setState({ pages: [{ id: 'p0' }, { id: 'p1' }] } as never)
  // 세션을 열 때 재오픈 경로가 이미 고객 잠금을 건 상태(적용·복원 경로도 같은 후처리를 한다)
  for (const c of [c0, c1]) applyCustomerLocks(c as unknown as fabric.Canvas)
  return [c0, c1]
}

beforeEach(() => {
  __resetAutosaveSuspendForTest()
  __resetSkinApplyForTest()
  useSaveStore.setState({ status: 'saved', isDirty: false } as never)
})

describe('캘린더 디자인 적용 — 실 fabric 캔버스', () => {
  it('복제 스킨 적용: 출력 id·순서, 채운 사진 링크·변환 유지, 그리드 1개, 커스텀 속성 왕복, 히스토리 비움', async () => {
    const [c0, c1] = await openSession(PROFILE)
    const out = await prepareSkinApply('spring', deps())
    expect(out.kind).toBe('confirm')
    if (out.kind !== 'confirm') return
    expect(out.plan.summarySkin.customerKept).toBe(1)
    expect(out.plan.summarySkin.photosKept).toBe(1)
    expect((await executeSkinApply(out.plan, 'skin', deps())).kind).toBe('applied')

    const after = json(c0)
    expect(after.objects.map((o) => o.id)).toEqual(['workspace', 'bg', 'deco', 'frame0', 'frame0_fillImage', 'grid0', 'u-sticker'])
    const photo = after.objects.find((o) => o.id === 'frame0_fillImage') as Plain
    expect(photo).toMatchObject({ frameRef: 'frame0', extensionType: 'fillImage', left: 15, top: 18, scaleX: 0.8, scaleY: 0.8 })
    expect(after.objects.find((o) => o.id === 'bg')?.fill).toBe('#fde')
    expect(after.objects.find((o) => o.id === 'deco')).toMatchObject({ deleteable: false })
    expect(after.objects.filter((o) => o.extensionType === 'calendar-grid')).toHaveLength(1)
    expect(json(c1).objects.filter((o) => o.extensionType === 'calendar-grid')).toHaveLength(1)
    expect(c0.historyUndo).toEqual([])
    expect(c0.historyRedo).toEqual([])
    // 고객 잠금 적용(movable=false 템플릿 그리드 → 이동 잠금) — 재오픈과 같은 후처리
    expect((c0.getObjects().find((o) => (o as Plain).id === 'grid0') as Plain).lockMovementX).toBe(true)
    // workspace 는 재오픈 경로와 같은 식으로 리사이즈된다
    const ws = c0.getObjects().find((o) => (o as Plain).id === 'workspace') as fabric.Object
    const { getEffectiveValue } = useSettingsStore.getState()
    expect(ws.width).toBeCloseTo(getEffectiveValue(100))
    expect(useCalendarStore.getState().meta?.skinKey).toBe('spring')
  })

  it('스킨 틀에 rx·ry 가 없어도(관리자 JSON) 실 fabric 저장본(rx:0·ry:0)과 같은 틀 모양 — 사진 변환 유지, 다시 채우지 않음', async () => {
    const original = SETS['set-spring']
    const noRadius = SPRING_T.map((objs) => objs.map((o) => {
      if (o.extensionType !== 'frame') return o
      const { rx: _rx, ry: _ry, ...rest } = o
      return rest
    }))
    SETS['set-spring'] = setOf('set-spring', noRadius)
    try {
      const [c0] = await openSession(PROFILE)
      expect(json(c0).objects.find((o) => o.id === 'frame0')).toMatchObject({ rx: 0, ry: 0 })
      const out = await prepareSkinApply('spring', deps())
      if (out.kind !== 'confirm') throw new Error(out.kind)
      expect(out.plan.summarySkin).toMatchObject({ photosKept: 1, photosRefilled: 0 })
      expect((await executeSkinApply(out.plan, 'skin', deps())).kind).toBe('applied')
      expect(json(c0).objects.find((o) => o.id === 'frame0_fillImage')).toMatchObject({ frameRef: 'frame0', left: 15, top: 18, scaleX: 0.8, scaleY: 0.8 })
    } finally {
      SETS['set-spring'] = original
    }
  })

  it('「적용 취소」 → toJSON 이 적용 전과 같다(객체 id·순서·속성)', async () => {
    const [c0, c1] = await openSession(PROFILE)
    const before = [json(c0), json(c1)]
    const out = await prepareSkinApply('spring', deps())
    if (out.kind !== 'confirm') throw new Error(out.kind)
    await executeSkinApply(out.plan, 'skin', deps())
    expect(json(c0)).not.toEqual(before[0])
    expect(await undoSkinApply(deps())).toBe(true)
    // 리사이즈는 재오픈 경로와 같으므로 workspace 크기만 다를 수 있다 — 적용 전 캔버스에도 같은 리사이즈를 건 값과 비교
    const norm = (j: { objects: Plain[] }) => j.objects.map((o) => (o.id === 'workspace' ? { id: o.id } : o))
    expect(norm(json(c0))).toEqual(norm(before[0]))
    expect(norm(json(c1))).toEqual(norm(before[1]))
    expect(json(c0).objects.map((o) => o.id)).toEqual(before[0].objects.map((o) => o.id))
    expect(useCalendarStore.getState().meta?.skinKey).toBeUndefined()
  })
})

describe('불변 — 프로파일 NULL 세트·스킨 없는 캘린더 세트', () => {
  for (const [name, p] of [['프로파일 NULL', null], ['스킨 없는 캘린더', profile(undefined)]] as const) {
    it(`${name}: 절 비노출·적용 no-op·toJSON diff 0·저장 metadata 키 집합 불변`, async () => {
      const [c0, c1] = await openSession(p)
      const before = JSON.stringify([json(c0), json(c1)])
      const fieldsBefore = JSON.stringify(calendarSessionMetadataFields())
      const { container } = render(createElement(CalendarSkinSection))
      expect(container.innerHTML).toBe('')
      const d = deps()
      const fetch = vi.fn(d.fetchSet)
      expect(await prepareSkinApply('spring', { ...d, fetchSet: fetch })).toEqual({ kind: 'rejected', reason: 'disabled' })
      expect(fetch).not.toHaveBeenCalled()
      expect(JSON.stringify([json(c0), json(c1)])).toBe(before)
      expect(JSON.stringify(calendarSessionMetadataFields())).toBe(fieldsBefore)
      if (p) for (const k of ['skinKey', 'skinUploads']) expect(Object.keys(calendarSessionMetadataFields().metadata?.calendar ?? {})).not.toContain(k)
      else expect(calendarSessionMetadataFields()).toEqual({})
    })
  }
})
