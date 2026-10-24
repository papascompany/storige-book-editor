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
import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { fabric } from 'fabric'
import { core } from '../utils/canvas'
import CalendarPlugin, { CALENDAR_GRID_EXTENSION_TYPE, type CalendarRenderContext } from './CalendarPlugin'
import type Editor from '../Editor'
import type { CalendarData, MonthCell, MonthMatrix } from '../calendar/types'

const { buildCalls, yearCalls } = vi.hoisted(() => ({
  buildCalls: [] as Array<{ year: number; month: number; includeTemporaryHolidays?: boolean }>,
  yearCalls: [] as Array<{ year: number; month: number; weekStart: 0 | 1; monthCount?: number; includeTemporaryHolidays?: boolean; anniversaries?: unknown[] }>,
}))
vi.mock('../calendar/core', () => ({
  buildMonthMatrix: (year: number, month: number, opts: { weekStart: 0 | 1; includeTemporaryHolidays?: boolean }) => {
    buildCalls.push({ year, month, includeTemporaryHolidays: opts.includeTemporaryHolidays })
    return synthMatrix(year, month, opts.weekStart)
  },
  // 연달력: 실제 buildYearMatrix 와 같은 형태(연속 월의 synthMatrix) — 데이터 정확성은 core.test.ts 가 담당
  buildYearMatrix: (year: number, month: number, opts: { weekStart: 0 | 1; includeTemporaryHolidays?: boolean; anniversaries?: unknown[] }, monthCount = 12) => {
    yearCalls.push({ year, month, weekStart: opts.weekStart, monthCount, includeTemporaryHolidays: opts.includeTemporaryHolidays, anniversaries: opts.anniversaries })
    const months: MonthMatrix[] = []
    for (let k = 0; k < monthCount; k += 1) {
      const idx = year * 12 + (month - 1) + k
      months.push(synthMatrix(Math.floor(idx / 12), (idx % 12) + 1, opts.weekStart))
    }
    return { year, month, weekStart: opts.weekStart, weekdayOrder: months[0].weekdayOrder, months }
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

/**
 * T3a 'year' variant 추가 전(origin/master 12de30af CalendarPlugin)에서 같은 정규화로 캡처한 값 — month/mini 렌더 구조가 바뀌면 깨진다.
 * 플랫폼 독립: 폰트 메트릭에서 오는 값(텍스트·그룹의 width/height/left/top/scale)은 넣지 않는다(로컬 macOS 와 CI ubuntu 가 같은 값).
 */
const BASELINE_SHA256 = {
  month: 'd2eb8d2eb09694e3ce155a7cc93768518b201670d72d41fa4ae93c576c9970c8',
  monthStyled: '473aae22ffc088c2d155e55be5a15ee9699078fa9566cbfb8237ca106d208938',
  mini: 'fd23f43f08512b9f05359c80e0f0af3d214b1f53b1d152ee2e65bac051290cb7',
  miniNoTitle: '0c1fa387edf61f16c65dce9e46db319dc73ac6539d6782328f07e4e330cc0e8f',
}

/** 숫자는 소수 3자리 반올림(-0 → 0) */
const r3 = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1000) / 1000 + 0 : v)

type Plain = Record<string, unknown>

/**
 * 그리드 toObject JSON 을 플랫폼 독립 구조로 정규화한다.
 * - 공통: type·id·fill·stroke·strokeWidth·opacity·visible 와 extensionType/extension(그룹).
 * - 텍스트: 내용·fontSize·fontFamily·fontWeight·fontStyle·originX/originY(위치·크기는 폰트 메트릭 의존이라 제외).
 * - 사각형·선: 격자 분할로 정해지는 left/top/width/height/x1/y1/x2/y2(소수 3자리).
 * - 그룹: 크기·위치는 자식 경계(텍스트 폭 포함)로 정해지므로 제외하고 자식만 재귀.
 */
function normalizeGrid(o: Plain): Plain {
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, r3(o[k])]))
  const base = pick(['type', 'id', 'fill', 'stroke', 'strokeWidth', 'opacity', 'visible'])
  const type = o.type as string
  if (type === 'group') {
    return {
      ...base,
      ...(o.extensionType !== undefined ? { extensionType: o.extensionType } : {}),
      ...(o.extension !== undefined ? { extension: o.extension } : {}),
      objects: ((o.objects as Plain[] | undefined) ?? []).map(normalizeGrid),
    }
  }
  if (type === 'text' || type === 'i-text' || type === 'textbox') {
    return { ...base, ...pick(['text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'originX', 'originY']) }
  }
  return { ...base, ...pick(['left', 'top', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'originX', 'originY']) }
}

describe("CalendarPlugin — 'month'/'mini' 렌더 구조 고정(플랫폼 독립, T3a 'year' 추가 전 기준값)", () => {
  /** 고정 ctx·박스로 만든 그리드의 toObject(EXTEND) 를 정규화(무작위 uuid → 'GRID')한 JSON sha256 */
  async function digest(ext: Parameters<CalendarPlugin['createGrid']>[0], over: Partial<CalendarRenderContext> = {}): Promise<string> {
    const plugin = makePlugin(makeCanvas())
    const g = await plugin.createGrid(ext, ctx(over), { left: 10, top: 20, width: 700, height: 520 })
    const id = (g as fabric.Group & { id?: string }).id as string
    const raw = JSON.stringify(g.toObject(core.extendFabricOption as string[])).split(id).join('GRID')
    const json = JSON.stringify(normalizeGrid(JSON.parse(raw) as Plain))
    return createHash('sha256').update(json).digest('hex')
  }

  it("'month'/'mini' 렌더 구조 불변 — 고정 ctx·박스의 정규화 JSON(id 치환) sha256 이 변경 전 기준값과 같다", async () => {
    const got = {
      month: await digest({ variant: 'month' }),
      monthStyled: await digest({ variant: 'month', weekStart: 1, style: { headerLang: 'ko', rows: 'used', fillAdjacent: true, showLines: false, fontSize: 14, colors: { holiday: '#ff0000' } } }, { startMonth: 3, canvasMonthOffset: 4 }),
      mini: await digest({ variant: 'mini', monthDelta: -1 }),
      miniNoTitle: await digest({ variant: 'mini', monthDelta: 1, style: { showTitle: false, showLines: true } }, { canvasMonthOffset: null }),
    }
    expect(got).toEqual(BASELINE_SHA256)
  })
})

describe("CalendarPlugin — 연달력 variant 'year' (T3a)", () => {
  type Obj = fabric.Object & { id?: string }
  const box = { left: 0, top: 0, width: 1200, height: 900 }
  const idOf = (g: fabric.Object) => (g as Obj).id as string
  const childIds = (g: fabric.Group) => g.getObjects().map((o) => (o as Obj).id ?? '')
  const child = (g: fabric.Group, suffix: string) => g.getObjects().find((o) => (o as Obj).id === `${idOf(g)}${suffix}`) as fabric.Text | undefined
  /** '-m{k}-title' 소제목 텍스트 12개 */
  const monthTitles = (g: fabric.Group) => Array.from({ length: 12 }, (_, k) => child(g, `-m${k}-title`)?.text)
  /** 날짜 자식 id 의 'YYYY-MM-DD' 목록 */
  const dates = (g: fabric.Group) => childIds(g).map((i) => /-m\d+-d-(\d{4}-\d{2}-\d{2})$/.exec(i)?.[1]).filter((d): d is string => !!d)

  it("createGrid({variant:'year'}) — 월 소제목 12개·inMonth 날짜 365(2027)·기본 잠금·extension 보존", async () => {
    const plugin = makePlugin(makeCanvas())
    const ext = { variant: 'year' as const, yearDelta: 0, style: { fontFamily: 'Pretendard', headerLang: 'en' as const, showTitle: true, showLines: false } }
    const g = await plugin.createGrid(ext, ctx(), box)
    const gg = g as fabric.Group & Record<string, unknown>
    expect(gg.extensionType).toBe(CALENDAR_GRID_EXTENSION_TYPE)
    expect(gg.extension).toEqual(ext)
    expect(g.width).toBeCloseTo(1200, 3)
    expect(g.height).toBeCloseTo(900, 3)
    expect(monthTitles(g)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    const d = dates(g)
    expect(d).toHaveLength(365)
    expect(new Set(d).size).toBe(365)
    expect(d[0]).toBe('2027-01-01')
    expect(d.at(-1)).toBe('2027-12-31')
    expect(child(g, '-title')?.text).toBe('2027')
    expect(child(g, '-bounds')?.fill).toBe('')
    // 요일 헤더 12×7(en 1글자), 공휴일명·음력·절기 문구 없음
    expect(childIds(g).filter((i) => /-m\d+-wd-\d$/.test(i))).toHaveLength(84)
    expect(child(g, '-m0-wd-0')?.text).toBe('S')
    expect(texts(g)).not.toContain('테스트휴일')
    expect(childIds(g).some((i) => i.includes('-n-'))).toBe(false)
    expect(gg.movable).toBe(false)
    expect(gg.deleteable).toBe(false)
    expect(gg.contentEditable).toBe(false)
    expect(g.lockMovementX).toBe(true)
    // 기념일은 넘기지 않는다
    expect(yearCalls.at(-1)?.anniversaries).toEqual([])
    expect(yearCalls.at(-1)?.monthCount).toBe(12)
  })

  it("span: ctx.yearSpan 생략 = DEFAULT, 'calendar-year' 는 1~12월, 'start-span' 은 시작연월부터(2027-03 → 2028-02)", async () => {
    const plugin = makePlugin(makeCanvas())
    const ext = { variant: 'year' as const }
    // 생략 + 1월 시작 = 기준 연도(DEFAULT_CALENDAR_YEAR_SPAN 'calendar-year')
    const defJan = await plugin.createGrid(ext, ctx(), box)
    expect(dates(defJan)[0]).toBe('2027-01-01')
    expect(child(defJan, '-title')?.text).toBe('2027')
    // 생략 + 시작연월 변경(3월) = 선택한 월부터 12개월(오너 답 Q1)
    const defMar = await plugin.createGrid(ext, ctx({ startMonth: 3 }), box)
    expect(dates(defMar)[0]).toBe('2027-03-01')
    expect(dates(defMar).at(-1)).toBe('2028-02-29')
    expect(child(defMar, '-title')?.text).toBe('2027.3 – 2028.2')
    // 명시 calendar-year 는 시작연월과 무관하게 1~12월
    const cy = await plugin.createGrid(ext, ctx({ startMonth: 3, yearSpan: 'calendar-year' }), box)
    expect(dates(cy)[0]).toBe('2027-01-01')
    expect(dates(cy).at(-1)).toBe('2027-12-31')
    expect(child(cy, '-title')?.text).toBe('2027')
    // 명시 start-span
    const ss = await plugin.createGrid(ext, ctx({ startMonth: 3, yearSpan: 'start-span' }), box)
    expect(monthTitles(ss)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2'])
    expect(dates(ss)[0]).toBe('2027-03-01')
    expect(dates(ss).at(-1)).toBe('2028-02-29')
  })

  it('yearDelta: ext 1 → 다음 해, ctx.yearDelta 가 ext 보다 우선, 비정수는 0; monthOffset·monthDelta·canvasMonthOffset 무시', async () => {
    const plugin = makePlugin(makeCanvas())
    const first = async (ext: Parameters<CalendarPlugin['createGrid']>[0], over: Partial<CalendarRenderContext> = {}) =>
      dates(await plugin.createGrid(ext, ctx(over), box))[0]
    expect(await first({ variant: 'year', yearDelta: 1 })).toBe('2028-01-01')
    expect(await first({ variant: 'year', yearDelta: 1 }, { yearDelta: -1 })).toBe('2026-01-01')
    expect(await first({ variant: 'year', yearDelta: 1 }, { yearDelta: 0 })).toBe('2027-01-01')
    expect(await first({ variant: 'year', yearDelta: 1 }, { yearDelta: 0.5 })).toBe('2028-01-01') // ctx 비정수 → ext
    expect(await first({ variant: 'year', yearDelta: 1.5 })).toBe('2027-01-01') // ext 비정수 → 0
    expect(await first({ variant: 'year', yearDelta: 1 }, { startMonth: 3 })).toBe('2028-03-01') // 기본 규칙 start-span +12개월
    expect(await first({ variant: 'year', monthOffset: 5, monthDelta: 2 }, { canvasMonthOffset: 7 })).toBe('2027-01-01')
  })

  it("윤년: calendar-year 2028 은 '-d-2028-02-29' 자식이 있고 2027 은 없다", async () => {
    const plugin = makePlugin(makeCanvas())
    const y2028 = await plugin.createGrid({ variant: 'year', yearDelta: 1 }, ctx(), box)
    expect(childIds(y2028)).toContain(`${idOf(y2028)}-m1-d-2028-02-29`)
    expect(dates(y2028)).toHaveLength(366)
    const y2027 = await plugin.createGrid({ variant: 'year' }, ctx(), box)
    expect(dates(y2027).some((d) => d === '2027-02-29' || d.startsWith('2028-02-29'))).toBe(false)
    expect(dates(y2027).filter((d) => d.startsWith('2027-02-'))).toHaveLength(28)
  })

  it('weekStart 1 → 각 월 헤더가 월요일부터, headerLang ko 면 한글', async () => {
    const plugin = makePlugin(makeCanvas())
    const g = await plugin.createGrid({ variant: 'year', weekStart: 1, style: { headerLang: 'ko' } }, ctx(), box)
    for (let k = 0; k < 12; k += 1) {
      expect(Array.from({ length: 7 }, (_, c) => child(g, `-m${k}-wd-${c}`)?.text)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
    }
    expect(yearCalls.at(-1)?.weekStart).toBe(1)
    const en = await plugin.createGrid({ variant: 'year' }, ctx({ weekStart: 1 }), box)
    expect(Array.from({ length: 7 }, (_, c) => child(en, `-m0-wd-${c}`)?.text)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('style 재사용: showTitle false 면 제목 없음, showLines 기본 false·true 면 선 생성, 공휴일 색 = colors.holiday', async () => {
    const plugin = makePlugin(makeCanvas())
    const plain = await plugin.createGrid({ variant: 'year' }, ctx(), box)
    expect(childIds(plain).some((i) => i.includes('-yl-'))).toBe(false)
    const noTitle = await plugin.createGrid({ variant: 'year', style: { showTitle: false } }, ctx(), box)
    expect(child(noTitle, '-title')).toBeUndefined()
    // 고객 연도 제목 옵션(show.yearTitle, v1.26): false 면 숨김, 템플릿 showTitle=false 면 true 여도 숨김
    const custOff = await plugin.createGrid({ variant: 'year' }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, yearTitle: false } }), box)
    expect(child(custOff, '-title')).toBeUndefined()
    const custOn = await plugin.createGrid({ variant: 'year', style: { showTitle: false } }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, yearTitle: true } }), box)
    expect(child(custOn, '-title')).toBeUndefined()
    const extOn = await plugin.createGrid({ variant: 'year', show: { yearTitle: true } }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, yearTitle: false } }), box)
    expect(child(extOn, '-title')?.text).toBe('2027')
    // 선: 박스 안(클램프)
    const lined = await plugin.createGrid({ variant: 'year', style: { showLines: true, colors: { holiday: '#ff00aa', line: '#123456' } } }, ctx(), box)
    const lines = lined.getObjects().filter((o) => ((o as Obj).id ?? '').includes('-yl-'))
    expect(lines.length).toBe(12 * (7 + 8))
    expect(lined.width).toBeCloseTo(1200, 3)
    expect(lined.height).toBeCloseTo(900, 3)
    // synthMatrix 는 매월 1일이 휴일 — 2027-01-01(금) 은 holiday 색, 2027-01-03(일) 은 sunday 색
    expect(child(lined, '-m0-d-2027-01-01')?.fill).toBe('#ff00aa')
    expect(child(lined, '-m0-d-2027-01-03')?.fill).toBe('#d93025')
    expect(child(lined, '-m0-d-2027-01-02')?.fill).toBe('#1a56db')
    // show.holidays false 면 휴일 색 없음
    const noHol = await plugin.createGrid({ variant: 'year', show: { holidays: false } }, ctx(), box)
    expect(child(noHol, '-m0-d-2027-01-01')?.fill).toBe('#222222')
    // 임시공휴일 옵션은 buildYearMatrix 로 전달
    await plugin.createGrid({ variant: 'year' }, ctx({ show: { holidays: true, lunar: true, solarTerms: true, temporaryHolidays: true } }), box)
    expect(yearCalls.at(-1)?.includeTemporaryHolidays).toBe(true)
    // rows 'used' — 12개월 중 최대 usedRows 만큼(2027 은 6행 달 있음) / fillAdjacent 면 인접 월 날짜도 채운다
    const adj = await plugin.createGrid({ variant: 'year', style: { fillAdjacent: true } }, ctx(), box)
    expect(dates(adj).length).toBe(12 * 42)
  })

  it('배열: 박스 비율에 따라 6×2·4×3·3×4·2×6 — 월 소제목 위치로 확인', async () => {
    const plugin = makePlugin(makeCanvas())
    const colsOf = async (width: number, height: number) => {
      const g = await plugin.createGrid({ variant: 'year' }, ctx(), { left: 0, top: 0, width, height })
      const tops = monthTitles(g).map((_, k) => Math.round((child(g, `-m${k}-title`)?.top ?? 0) * 1000))
      return tops.filter((t) => t === tops[0]).length
    }
    expect(await colsOf(1200, 500)).toBe(6)
    expect(await colsOf(1000, 900)).toBe(4)
    expect(await colsOf(600, 1000)).toBe(3)
    expect(await colsOf(400, 1000)).toBe(2)
  })

  it("hitTestDate 는 'year' 그리드에서 항상 null(기념일 폼 대상 아님)", async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const g = await plugin.createGrid({ variant: 'year' }, ctx(), box)
    canvas.add(g)
    const day = child(g, '-m0-d-2027-01-15') as fabric.Text
    const p = fabric.util.transformPoint(new fabric.Point(day.left ?? 0, day.top ?? 0), g.calcTransformMatrix())
    expect(plugin.hitTestDate(g, p)).toBeNull()
    expect(plugin.hitTestDate(g, { x: 600, y: 450 })).toBeNull()
    // 같은 id 가 month 였다가 'year' 로 다시 그려져도 남은 레이아웃이 없다
    const m = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 700, height: 600 })
    canvas.add(m)
    ;(m as fabric.Group & { extension: unknown }).extension = { variant: 'year' }
    expect(await plugin.rehydrate(ctx())).toBe(2)
    const redrawn = canvas.getObjects().find((o) => (o as Obj).id === idOf(m)) as fabric.Group
    expect(plugin.hitTestDate(redrawn, { x: 550, y: 187.5 })).toBeNull()
  })

  it("rehydrate: 'year' 그리드도 같은 id·중심·잠금·z-order 로 새 시작연도에 맞춰 다시 그린다", async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const photo = new fabric.Rect({ left: 0, top: 0, width: 50, height: 50, id: 'photo' } as fabric.IRectOptions)
    const g = await plugin.createGrid({ variant: 'year', yearDelta: 1 }, ctx(), { left: 100, top: 100, width: 800, height: 600 })
    const gg = g as fabric.Group & Record<string, unknown>
    gg.lockInfo = { isLocked: true, lockLevel: 'position' }
    const after = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, id: 'after' } as fabric.IRectOptions)
    canvas.add(photo, g, after)
    const centerBefore = g.getCenterPoint()
    const id = idOf(g)
    expect(await plugin.rehydrate(ctx({ startYear: 2030, startMonth: 1 }))).toBe(1)
    const objs = canvas.getObjects()
    expect(objs.map((o) => (o as Obj).id)).toEqual(['photo', id, 'after'])
    const next = objs[1] as fabric.Group & Record<string, unknown>
    expect(next).not.toBe(g)
    expect(next.lockInfo).toEqual({ isLocked: true, lockLevel: 'position' })
    expect(next.movable).toBe(false)
    expect(next.getCenterPoint().x).toBeCloseTo(centerBefore.x, 3)
    expect(next.getCenterPoint().y).toBeCloseTo(centerBefore.y, 3)
    expect(next.width).toBeCloseTo(800, 3)
    expect(next.height).toBeCloseTo(600, 3)
    expect(dates(next)[0]).toBe('2031-01-01') // 2030 + yearDelta 1
    expect(child(next, '-title')?.text).toBe('2031')
    // 고객 선택(ctx.yearDelta)·기간 정책(ctx.yearSpan)으로 다시 그리기
    expect(await plugin.rehydrate(ctx({ startYear: 2030, startMonth: 4, yearDelta: 0, yearSpan: 'start-span' }))).toBe(1)
    const again = canvas.getObjects()[1] as fabric.Group
    expect(dates(again)[0]).toBe('2030-04-01')
    expect(next.width).toBeCloseTo(800, 3)
  })

  it("직렬화 왕복: toJSON(extendFabricOption) → loadFromJSON 뒤 extension {variant:'year', yearDelta} 유지 + rehydrate 동작", async () => {
    const c1 = makeCanvas()
    const plugin1 = makePlugin(c1)
    const ext = { variant: 'year' as const, yearDelta: 1, style: { fontFamily: 'Pretendard', showLines: false } }
    c1.add(await plugin1.createGrid(ext, ctx(), { left: 20, top: 30, width: 900, height: 600 }))
    const wire = JSON.parse(JSON.stringify(c1.toJSON(core.extendFabricOption as string[])))
    const c2 = makeCanvas()
    await core.loadFromJSON(c2, wire)
    const restored = c2.getObjects()[0] as fabric.Group & Record<string, unknown>
    expect(restored.extensionType).toBe(CALENDAR_GRID_EXTENSION_TYPE)
    expect(restored.extension).toEqual(ext)
    expect(restored.deleteable).toBe(false)
    const plugin2 = makePlugin(c2)
    expect(await plugin2.rehydrate(ctx({ startYear: 2029, startMonth: 1 }))).toBe(1)
    const next = c2.getObjects()[0] as fabric.Group & Record<string, unknown>
    expect(next.id).toBe(restored.id)
    expect(next.extension).toEqual(ext)
    expect(dates(next)[0]).toBe('2030-01-01')
    expect(next.width).toBeCloseTo(900, 3)
  })

  it("미지 variant('decade')·extension 없음은 rehydrate 가 건너뛰고 크래시 없음 — 객체·자식 그대로, 반환 수에 미포함", async () => {
    const canvas = makeCanvas()
    const plugin = makePlugin(canvas)
    const known = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 400, height: 300 })
    const unknown = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 400, height: 300 })
    ;(unknown as fabric.Group & { extension: unknown }).extension = { variant: 'decade', yearDelta: 0 }
    const bare = await plugin.createGrid({ variant: 'month' }, ctx(), { left: 0, top: 0, width: 400, height: 300 })
    delete (bare as fabric.Group & { extension?: unknown }).extension
    canvas.add(known, unknown, bare)
    const unknownChildren = unknown.getObjects().length
    expect(await plugin.rehydrate(ctx({ startYear: 2028 }))).toBe(1)
    const objs = canvas.getObjects()
    expect(objs[1]).toBe(unknown)
    expect(objs[2]).toBe(bare)
    expect(unknown.getObjects().length).toBe(unknownChildren)
    expect((unknown as fabric.Group & { extension: unknown }).extension).toEqual({ variant: 'decade', yearDelta: 0 })
  })
})
