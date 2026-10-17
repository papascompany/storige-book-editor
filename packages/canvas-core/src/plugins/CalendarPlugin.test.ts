// CalendarPlugin — 그리드 생성·rehydrate 보존·직렬화 왕복·hitTest (P1 캘린더, 2026-10-17)
//
// 실 fabric(5.5.2 dist, node-canvas) + 실 core.extendFabricOption / core.loadFromJSON 으로
// embed/useEmbedAutoSave/ServicePlugin 저장 경로와 같은 계약을 고정한다.
// calendar-core 의 buildMonthMatrix 는 목(날짜 데이터 무관) — 데이터 정확성은 calendar/core.test.ts 가 담당.
//
// 고정하는 계약:
//  (1) createGrid: extensionType 'calendar-grid' + extension 보존, 박스 크기·중심 위치, 날짜 텍스트 수 = 그 달 일수,
//      기본 잠금(movable/deleteable/contentEditable=false, lockMovement*)
//  (2) 월 결정: extension.monthOffset > 캔버스 월 + monthDelta > 시작월(표지 캔버스)
//  (3) rehydrate: 같은 id·중심·scale·angle·z-order·잠금 속성(lockInfo 포함)을 유지한 채 새 시작연월로 다시 그린다
//  (4) toJSON(extendFabricOption) → loadFromJSON 왕복 뒤에도 그룹의 extensionType/extension 이 남고 rehydrate 가 동작한다
//  (5) hitTestDate: 날짜 칸 중심 → 'YYYY-MM-DD', 제목 영역 → null
import { describe, it, expect, vi } from 'vitest'
import { fabric } from 'fabric'
import { core } from '../utils/canvas'
import CalendarPlugin, { CALENDAR_GRID_EXTENSION_TYPE, type CalendarRenderContext } from './CalendarPlugin'
import type Editor from '../Editor'
import type { CalendarData, MonthCell, MonthMatrix } from '../calendar/types'

const { buildCalls } = vi.hoisted(() => ({ buildCalls: [] as Array<{ year: number; month: number; includeTemporaryHolidays?: boolean }> }))
vi.mock('../calendar/core', () => ({
  buildMonthMatrix: (year: number, month: number, opts: { weekStart: 0 | 1; includeTemporaryHolidays?: boolean }) => {
    buildCalls.push({ year, month, includeTemporaryHolidays: opts.includeTemporaryHolidays })
    return synthMatrix(year, month, opts.weekStart)
  },
}))

/** 날짜 데이터 없이 Date 산술로만 만드는 6×7 행렬(1일은 '테스트휴일') */
function synthMatrix(year: number, month: number, weekStart: 0 | 1): MonthMatrix {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const order = weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]
  const lead = (first.getUTCDay() - weekStart + 7) % 7
  const rows: MonthCell[][] = []
  let usedRows = 0
  for (let r = 0; r < 6; r += 1) {
    const row: MonthCell[] = []
    for (let c = 0; c < 7; c += 1) {
      const dayIdx = r * 7 + c - lead + 1
      const d = new Date(Date.UTC(year, month - 1, dayIdx))
      const inMonth = dayIdx >= 1 && dayIdx <= daysIn
      if (inMonth) usedRows = r + 1
      row.push({
        date: d.toISOString().slice(0, 10),
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        inMonth,
        isHoliday: inMonth && dayIdx === 1,
        holidayNames: inMonth && dayIdx === 1 ? ['테스트휴일'] : [],
        lunar: null,
        solarTerm: null,
        anniversaries: [],
      })
    }
    rows.push(row)
  }
  return { year, month, weekStart, weekdayOrder: order, rows, usedRows }
}

function makeCanvas(): fabric.Canvas {
  const c = new fabric.StaticCanvas(null as unknown as HTMLCanvasElement, {
    width: 1000,
    height: 800,
    renderOnAddRemove: false,
  }) as unknown as fabric.Canvas & { offHistory: () => void; onHistory: () => void }
  // history/selection API 는 fabric.Canvas 확장 — 정적 캔버스에 최소 스텁
  // utils/history.ts 가 fabric.Canvas 에 붙이는 필드를 흉내 낸다 — onHistory 가 호출되면 undo 에 push 되는 구조
  const h = c as unknown as { historyProcessing: boolean; isHistoryReady: boolean; historyNextState: string | null; historyUndo: string[]; _historyNext: () => string; onHistory: () => void; offHistory: () => void }
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
  ;(c as unknown as { getActiveObject: () => null }).getActiveObject = () => null
  ;(c as unknown as { setActiveObject: () => void }).setActiveObject = () => {}
  return c
}

function makePlugin(canvas: fabric.Canvas, ensureFont?: (f: string) => Promise<void>) {
  return new CalendarPlugin(canvas, {} as Editor, { ensureFont, defaultFontFamily: 'TestFont' })
}

const data = { version: 'test', range: { from: '2025-01', to: '2035-12' }, holidays: {}, solarTerms: {}, lunarYears: {}, source: '', generatedAt: '' } as CalendarData

function ctx(over: Partial<CalendarRenderContext> = {}): CalendarRenderContext {
  return {
    startYear: 2027,
    startMonth: 1,
    canvasMonthOffset: 0,
    weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true },
    anniversaries: [],
    data,
    ...over,
  }
}

function texts(group: fabric.Group): string[] {
  return group.getObjects().filter((o) => o.type === 'text').map((o) => (o as fabric.Text).text ?? '')
}

describe('CalendarPlugin.createGrid', () => {
  it('(1) calendar-grid 그룹: extension·박스·중심·날짜 수·기본 잠금', async () => {
    const canvas = makeCanvas()
    const fonts: string[] = []
    const plugin = makePlugin(canvas, async (f) => { fonts.push(f) })
    const ext = { variant: 'month' as const, style: { fontFamily: 'Pretendard' } }
    const g = await plugin.createGrid(ext, ctx(), { left: 100, top: 50, width: 600, height: 400 })
    const gg = g as fabric.Group & Record<string, unknown>
    expect(gg.extensionType).toBe(CALENDAR_GRID_EXTENSION_TYPE)
    expect(gg.extension).toEqual(ext)
    expect(g.width).toBeCloseTo(600, 3)
    expect(g.height).toBeCloseTo(400, 3)
    const center = g.getCenterPoint()
    expect(center.x).toBeCloseTo(400, 3)
    expect(center.y).toBeCloseTo(250, 3)
    const t = texts(g)
    // 2027-01: 31일 + 제목 3(월·연도·영문) + 요일 7 + 휴일명 1
    expect(t.filter((s) => /^\d+$/.test(s) && Number(s) <= 31 && s !== '2027').length).toBe(31 + 1) // 날짜 31 + 제목 '1'
    expect(t).toContain('JANUARY')
    expect(t).toContain('2027')
    expect(t).toContain('테스트휴일')
    expect(t.slice(t.indexOf('SUN'), t.indexOf('SUN') + 7)).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
    expect(fonts).toEqual(['Pretendard'])
    expect(gg.movable).toBe(false)
    expect(gg.deleteable).toBe(false)
    expect(gg.contentEditable).toBe(false)
    expect(gg.isUserAdded).toBe(false)
    expect(g.lockMovementX).toBe(true)
    expect(g.lockScalingY).toBe(true)
  })

  it('(1b) 경계 사각형 fill 은 none — 그룹 toSVG 에 fill-opacity: 0 이 없다(워커 TRANSPARENCY_DETECTED 방지, 2026-10-17)', async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const g = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 100, top: 50, width: 600, height: 400 })
    const bounds = g.getObjects().find((o) => (o as fabric.Object & { id?: string }).id === `${(g as fabric.Object & { id?: string }).id}-bounds`)
    expect(bounds).toBeDefined()
    expect(bounds!.fill).toBe('')
    expect(bounds!.width).toBeCloseTo(600, 3)
    expect(bounds!.height).toBeCloseTo(400, 3)
    const svg = g.toSVG()
    expect(svg).toMatch(/fill: none;/)
    expect(svg).not.toMatch(/fill-opacity: 0/)
    expect(svg).not.toMatch(/stroke-opacity: 0/)
  })

  it('(2) weekStart=1 이면 요일 헤더가 MON 부터, headerLang ko 면 한글', async () => {
    const plugin = makePlugin(makeCanvas())
    const g = await plugin.createGrid({ variant: 'month', weekStart: 1, style: { headerLang: 'ko' } }, ctx(), { left: 0, top: 0, width: 700, height: 500 })
    const t = texts(g)
    const i = t.indexOf('월')
    expect(t.slice(i, i + 7)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
  })

  it('(2) 월 결정: monthOffset 우선, 없으면 캔버스 월 + monthDelta, 표지 캔버스(null)는 시작월', async () => {
    const plugin = makePlugin(makeCanvas())
    const box = { left: 0, top: 0, width: 300, height: 300 }
    const byOffset = await plugin.createGrid({ variant: 'month', monthOffset: 5 }, ctx({ canvasMonthOffset: 2 }), box)
    expect(texts(byOffset)).toContain('JUNE')
    const byCanvas = await plugin.createGrid({ variant: 'month' }, ctx({ canvasMonthOffset: 2 }), box)
    expect(texts(byCanvas)).toContain('MARCH')
    const mini = await plugin.createGrid({ variant: 'mini', monthDelta: -1 }, ctx({ canvasMonthOffset: 0 }), box)
    expect(texts(mini)).toContain('2026.12')
    const cover = await plugin.createGrid({ variant: 'month' }, ctx({ canvasMonthOffset: null }), box)
    expect(texts(cover)).toContain('JANUARY')
  })
})

describe('CalendarPlugin.rehydrate', () => {
  it('(3) 같은 id·중심·scale·angle·z-order·잠금을 유지한 채 새 시작연월로 다시 그린다', async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const photo = new fabric.Rect({ left: 0, top: 0, width: 50, height: 50, id: 'photo' } as fabric.IRectOptions)
    const g = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 100, top: 100, width: 400, height: 300 })
    const gg = g as fabric.Group & Record<string, unknown>
    gg.lockInfo = { isLocked: true, lockLevel: 'position' }
    gg.name = '날짜 그리드'
    g.set({ scaleX: 1.5, scaleY: 1.5, angle: 10 })
    g.setCoords()
    const after = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, id: 'after' } as fabric.IRectOptions)
    canvas.add(photo, g, after)
    const centerBefore = g.getCenterPoint()
    const id = gg.id as string

    const n = await plugin.rehydrate(ctx({ startYear: 2028, startMonth: 3, canvasMonthOffset: 1 }))
    expect(n).toBe(1)
    const objs = canvas.getObjects()
    expect(objs.length).toBe(3)
    expect((objs[0] as fabric.Object & { id?: string }).id).toBe('photo')
    const next = objs[1] as fabric.Group & Record<string, unknown>
    expect((objs[2] as fabric.Object & { id?: string }).id).toBe('after')
    expect(next).not.toBe(g)
    expect(next.id).toBe(id)
    expect(next.extensionType).toBe(CALENDAR_GRID_EXTENSION_TYPE)
    expect(next.scaleX).toBeCloseTo(1.5, 6)
    expect(next.angle).toBeCloseTo(10, 6)
    expect(next.lockInfo).toEqual({ isLocked: true, lockLevel: 'position' })
    expect(next.name).toBe('날짜 그리드')
    expect(next.movable).toBe(false)
    const c = next.getCenterPoint()
    expect(c.x).toBeCloseTo(centerBefore.x, 3)
    expect(c.y).toBeCloseTo(centerBefore.y, 3)
    expect(next.width).toBeCloseTo(400, 3)
    expect(next.height).toBeCloseTo(300, 3)
    expect(texts(next)).toContain('APRIL') // 2028-03 + offset 1
    expect(texts(next)).toContain('2028')
  })

  it('(3) rehydrate 는 undo 단계를 만들지 않고 history 기준 상태만 현재로 맞춘다', async () => {
    const canvas = makeCanvas()
    const h = canvas as unknown as { historyProcessing: boolean; historyNextState: string | null; historyUndo: string[]; _historyNext: () => string }
    const plugin = makePlugin(canvas)
    const g = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 300, height: 200 })
    canvas.add(g)
    h.historyNextState = h._historyNext() // 재오픈 직후 기준 상태
    expect(await plugin.rehydrate(ctx({ startYear: 2028, startMonth: 2 }))).toBe(1)
    expect(h.historyUndo).toHaveLength(0)
    expect(h.historyProcessing).toBe(false)
    expect(h.historyNextState).toBe(h._historyNext())
  })

  it('그리드가 없으면 0 을 반환하고 캔버스를 건드리지 않는다', async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    canvas.add(new fabric.Rect({ width: 10, height: 10, id: 'r' } as fabric.IRectOptions))
    expect(await plugin.rehydrate(ctx())).toBe(0)
    expect(canvas.getObjects().length).toBe(1)
  })
})

describe('CalendarPlugin 직렬화 왕복', () => {
  it('(4) toJSON(extendFabricOption) → loadFromJSON 뒤 extension 유지 + rehydrate 동작', async () => {
    const c1 = makeCanvas()
    const plugin1 = makePlugin(c1)
    const g = await plugin1.createGrid({ variant: 'month', monthOffset: 2, style: { fontFamily: 'Pretendard' } }, ctx(), { left: 20, top: 30, width: 500, height: 350 })
    c1.add(g)
    const saved = c1.toJSON(core.extendFabricOption as string[])
    const wire = JSON.parse(JSON.stringify(saved))
    const c2 = makeCanvas()
    await core.loadFromJSON(c2, wire)
    const restored = c2.getObjects()[0] as fabric.Group & Record<string, unknown>
    expect(restored.type).toBe('group')
    expect(restored.extensionType).toBe(CALENDAR_GRID_EXTENSION_TYPE)
    expect(restored.extension).toEqual({ variant: 'month', monthOffset: 2, style: { fontFamily: 'Pretendard' } })
    expect(restored.deleteable).toBe(false)
    expect(restored.movable).toBe(false)
    const plugin2 = makePlugin(c2)
    expect(plugin2.getGrids().length).toBe(1)
    expect(await plugin2.rehydrate(ctx({ startYear: 2030, startMonth: 11 }))).toBe(1)
    const next = c2.getObjects()[0] as fabric.Group & Record<string, unknown>
    expect(next.id).toBe(restored.id)
    expect(texts(next)).toContain('JANUARY') // 2030-11 + 2 = 2031-01
    expect(texts(next)).toContain('2031')
    expect(next.width).toBeCloseTo(500, 3)
  })
})

describe('CalendarPlugin.hitTestDate', () => {
  it('(5) 날짜 칸 중심 → 날짜, 제목 영역 → null', async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const g = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 700, height: 600 })
    canvas.add(g)
    // 2027-01-01 은 금요일 → 1행 5열(0-based col 5). 제목 18% + 헤더 7% = 150px, 셀 높이 (600-150)/6 = 75
    const cellW = 100
    const cellTop = 600 * 0.25
    const cellH = (600 - cellTop) / 6
    const p = { x: 5 * cellW + cellW / 2, y: cellTop + cellH / 2 }
    expect(plugin.hitTestDate(g, p)).toBe('2027-01-01')
    const p15 = { x: 5 * cellW + cellW / 2, y: cellTop + 2 * cellH + cellH / 2 } // 셋째 주 금요일 = 15일
    expect(plugin.hitTestDate(g, p15)).toBe('2027-01-15')
    expect(plugin.hitTestDate(g, { x: 50, y: 20 })).toBeNull()
    expect(plugin.hitTestDate(g, { x: 50, y: cellTop + cellH / 2 })).toBeNull() // 1행 일요일 = 전월(빈 칸)
  })
})

describe('CalendarPlugin — 임시공휴일·선거일 옵션(show.temporaryHolidays, 2026-10-17)', () => {
  // 휴일 판정은 buildMonthMatrix(core.test.ts 가 데이터 검증) — 플러그인은 옵션을 includeTemporaryHolidays 로 넘기는지 고정
  it('ctx.show 에 키가 없으면 false(법정 공휴일만), true 면 true, extension.show 가 ctx 보다 우선', async () => {
    const plugin = makePlugin(makeCanvas())
    const box = { left: 0, top: 0, width: 600, height: 400 }
    buildCalls.length = 0
    await plugin.createGrid({ variant: 'month' }, ctx(), box)
    expect(buildCalls.at(-1)).toEqual({ year: 2027, month: 1, includeTemporaryHolidays: false })

    await plugin.createGrid({ variant: 'month' }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, temporaryHolidays: true } }), box)
    expect(buildCalls.at(-1)?.includeTemporaryHolidays).toBe(true)

    await plugin.createGrid({ variant: 'month', show: { temporaryHolidays: false } }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, temporaryHolidays: true } }), box)
    expect(buildCalls.at(-1)?.includeTemporaryHolidays).toBe(false)
  })

  it('rehydrate 는 새 ctx 의 temporaryHolidays 로 모든 그리드를 다시 그린다', async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    canvas.add(await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 600, height: 400 }))
    buildCalls.length = 0
    expect(await plugin.rehydrate(ctx({ show: { holidays: true, lunar: false, solarTerms: false, temporaryHolidays: true } }))).toBe(1)
    expect(buildCalls).toEqual([{ year: 2027, month: 1, includeTemporaryHolidays: true }])
    buildCalls.length = 0
    expect(await plugin.rehydrate(ctx())).toBe(1)
    expect(buildCalls).toEqual([{ year: 2027, month: 1, includeTemporaryHolidays: false }])
  })
})
