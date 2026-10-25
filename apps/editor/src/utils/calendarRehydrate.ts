import type Editor from '@storige/canvas-core'
import { getCalendarData, type AnniversaryInput, type CalendarPlugin, type CalendarRenderContext } from '@storige/canvas-core'
import type { fabric } from 'fabric'
import {
  isCalendarYearDeltaAllowed,
  resolveCalendarCanvasSlot,
  type CalendarAnniversary,
  type CalendarSessionMeta,
  type CalendarYearPolicy,
} from '@storige/types'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { isCalendarProfile, resolveCalendarStart, resolveCanvasMonthOffset } from '@/utils/productProfile'

/**
 * 캘린더 그리드 재합성 — 캔버스 복원(loadJSON/loadFromJSON) 직후 호출 (P1 캘린더, 2026-10-17)
 *
 * `extensionType:'calendar-grid'` 객체는 저장 JSON 에 그룹으로 직렬화되지만 날짜 데이터·시작연월·
 * 표기 옵션은 세션 메타에만 있다. 복원 뒤 CalendarPlugin.rehydrate(ctx) 로 제자리에서 다시 그린다.
 * (rebindFrameInteractivity 와 같은 모델 — 복원 경로마다 한 줄 호출.)
 *
 * 게이트: settings.productProfile 이 null 이거나 kind≠calendar 면 즉시 0(legacy 세트 no-op).
 * 실패는 편집기 진입을 막지 않는다(catch 후 warn, 0 반환).
 *
 * 연달력(variant 'year', T3b 2026-10-24): ctx.yearSpan = 프로파일 `calendar.yearPolicy.span`(없으면 undefined = 기본 규칙),
 * ctx.yearDelta = 이 캔버스 역할(표지·에필로그)의 세션 `yearDeltas[역할]` — 정책 허용 폭 안의 정수일 때만(아니면 생략 = 템플릿 값).
 *
 * @returns 다시 그린 그리드 수
 */
export async function rehydrateCalendarGrids(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
  canvasIndex: number,
): Promise<number> {
  const profile = useSettingsStore.getState().productProfile
  if (!isCalendarProfile(profile)) return 0
  if (!editor || !canvas) return 0
  const plugin = editor.getPlugin<CalendarPlugin>('CalendarPlugin')
  if (!plugin) return 0

  const cal = profile.calendar
  const meta = useCalendarStore.getState().meta
  const dataVersion = meta?.dataVersion ?? cal.dataVersion
  const data = getCalendarData(dataVersion)
  if (!data) {
    console.warn(`[calendarRehydrate] 날짜 데이터 없음(version=${dataVersion}) — 그리드 재합성 생략(page ${canvasIndex})`)
    return 0
  }

  const start = resolveCalendarStart(profile, meta)
  const yearDelta = resolveCanvasYearDelta(cal, cal.yearPolicy, meta, canvasIndex)
  const ctx: CalendarRenderContext = {
    startYear: start.year,
    startMonth: start.month,
    canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex),
    weekStart: cal.weekStart,
    show: { ...(meta?.show ?? cal.show) },
    anniversaries: toAnniversaryInputs(meta?.anniversaries ?? []),
    data,
    yearSpan: cal.yearPolicy?.span,
  }
  if (yearDelta !== undefined) ctx.yearDelta = yearDelta

  try {
    return await plugin.rehydrate(ctx)
  } catch (error) {
    console.warn(`[calendarRehydrate] 그리드 재합성 실패(page ${canvasIndex}):`, error instanceof Error ? error.message : error)
    return 0
  }
}

export interface StrictGridRehydrateResult {
  /** false = 재합성을 끝내지 못함(편집기·캔버스·플러그인·날짜 데이터 없음, 또는 플러그인 예외) */
  ok: boolean
  /** 다시 그린 그리드 수 */
  count: number
}

/**
 * `rehydrateCalendarGrids` 의 실패 신호 변형 — 캘린더 디자인(스킨) 적용·롤백 경로 전용.
 * 기존 함수는 진입을 막지 않으려고 예외를 삼키고 0 을 돌려주지만, 적용 경로는 그리드를 못 그리면 되돌려야 한다.
 * 같은 렌더 입력을 쓰고, 실패를 `{ ok:false }` 로 돌려준다. 그리드 수 대조(count vs 캔버스의 calendar-grid 수)는 호출자가 한다.
 * - 캘린더 프로파일이 아니면 `{ ok:true, count:0 }`(할 일 없음)
 * - 플러그인이 없으면 그리드가 없는 캔버스만 ok
 */
export async function rehydrateCalendarGridsStrict(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
  canvasIndex: number,
): Promise<StrictGridRehydrateResult> {
  const profile = useSettingsStore.getState().productProfile
  if (!isCalendarProfile(profile)) return { ok: true, count: 0 }
  if (!editor || !canvas) return { ok: false, count: 0 }
  const plugin = editor.getPlugin<CalendarPlugin>('CalendarPlugin')
  if (!plugin) {
    const grids = canvas.getObjects().filter((o) => (o as { extensionType?: unknown }).extensionType === 'calendar-grid')
    return { ok: grids.length === 0, count: 0 }
  }
  const cal = profile.calendar
  const meta = useCalendarStore.getState().meta
  const data = getCalendarData(meta?.dataVersion ?? cal.dataVersion)
  if (!data) return { ok: false, count: 0 }
  const start = resolveCalendarStart(profile, meta)
  const yearDelta = resolveCanvasYearDelta(cal, cal.yearPolicy, meta, canvasIndex)
  const ctx: CalendarRenderContext = {
    startYear: start.year,
    startMonth: start.month,
    canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex),
    weekStart: cal.weekStart,
    show: { ...(meta?.show ?? cal.show) },
    anniversaries: toAnniversaryInputs(meta?.anniversaries ?? []),
    data,
    yearSpan: cal.yearPolicy?.span,
  }
  if (yearDelta !== undefined) ctx.yearDelta = yearDelta
  try {
    return { ok: true, count: await plugin.rehydrate(ctx) }
  } catch (error) {
    console.warn(`[calendarRehydrate] 그리드 재합성 실패(strict, page ${canvasIndex}):`, error instanceof Error ? error.message : error)
    return { ok: false, count: 0 }
  }
}

/**
 * 세션 기념일 → 렌더 입력. 문구 스타일은 D1(b) 최소 2종(fill·fontWeight)만 넘기고(정제는 canvas-core 가 한 번 더),
 * 둘 다 없으면 style 키를 두지 않는다 — 스타일 없는 기념일의 렌더 입력은 종전과 같다.
 */
export function toAnniversaryInputs(list: readonly CalendarAnniversary[]): AnniversaryInput[] {
  return list.map((a) => {
    const input: AnniversaryInput = { date: a.date, lunar: a.lunar, isLeapMonth: a.isLeapMonth, text: a.text }
    const style: NonNullable<AnniversaryInput['style']> = {}
    if (a.style?.fill !== undefined) style.fill = a.style.fill
    if (a.style?.fontWeight !== undefined) style.fontWeight = a.style.fontWeight
    if (Object.keys(style).length > 0) input.style = style
    return input
  })
}

/**
 * 캔버스 역할별 고객 연도 선택값. 표지·에필로그 캔버스가 아니거나, 값이 정책(`yearPolicy.select`) 허용 폭 밖·비정수면 undefined.
 * 세션 판독기도 같은 필터를 거치지만, 런처·PATCH 로 스토어에 들어온 값이 그대로 렌더로 가지 않도록 여기서 한 번 더 막는다.
 */
export function resolveCanvasYearDelta(
  cal: Parameters<typeof resolveCalendarCanvasSlot>[0],
  yearPolicy: CalendarYearPolicy | undefined,
  meta: Pick<CalendarSessionMeta, 'yearDeltas'> | null | undefined,
  canvasIndex: number,
): number | undefined {
  const slot = resolveCalendarCanvasSlot(cal, canvasIndex)
  if (!slot || (slot.role !== 'cover' && slot.role !== 'epilogue')) return undefined
  const v: unknown = meta?.yearDeltas?.[slot.role]
  return isCalendarYearDeltaAllowed(yearPolicy, v) ? v : undefined
}
