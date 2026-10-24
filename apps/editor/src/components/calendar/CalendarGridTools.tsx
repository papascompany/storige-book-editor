import { useCallback, useMemo, useState } from 'react'
import type { fabric } from 'fabric'
import {
  CalendarPlugin as CalendarPluginClass,
  getCalendarData,
  type CalendarData,
  type CalendarGridExtension,
  type CalendarPlugin,
  type CalendarRenderContext,
} from '@storige/canvas-core'
import { CALENDAR_YEAR_DELTA_LIMIT, DEFAULT_CALENDAR_DATA_VERSION } from '@storige/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { DEFAULT_FONT_FAMILY, getFontListAsSource } from '@/utils/fontManager'
import { isCalendarProfile, resolveCanvasMonthOffset } from '@/utils/productProfile'
import { resolveCanvasYearDelta, toAnniversaryInputs } from '@/utils/calendarRehydrate'
import { EMPTY_GRID_STYLE_DRAFT, gridStyleFromDraft, type GridStyleDraft } from './calendarPanelUtils'

/**
 * CalendarGridTools — editMode(관리자 템플릿 제작) 전용: 날짜 그리드/미니 달력/연달력을 캔버스 중앙에 추가 (P1-d 캘린더, 2026-10-17)
 *
 * - 기본 박스: 캔버스(workspace) 폭의 80%, 비율 월·연달력 4:3 / 미니 1:1(높이는 workspace 높이 80% 로 클램프).
 *   연달력 4:3 근거(T3b, 2026-10-24): 플러그인은 박스 비율 r=w/h 로 월 배열을 정한다(r ≥ 2 → 6×2, r ≥ 0.9 → 4×3, r ≥ 0.45 → 3×4,
 *   그 밖 2×6). 한 달 블록은 7열 × (소제목 + 요일 + 최대 6주 ≈ 8행)이라 4:3(r≈1.33 → 4×3)이면 칸이 정사각에 가깝다.
 *   정사각(1:1)도 4×3 이지만 칸이 세로로 길어져 날짜 숫자 사이가 벌어진다.
 * - ctx: 세션 메타가 있으면 그 값, 없으면 {내년 1월 시작, 캔버스 index 기준 월 오프셋(없으면 0), weekStart 0, show 전부 true}.
 *   연달력은 ctx.yearSpan(프로파일 정책)·ctx.yearDelta(고객 선택, 정책 허용 폭 안일 때만)를 함께 받는다.
 * - SmartCodes 선례: offHistory 로 생성 → onHistory → canvas.add → setActiveObject.
 * - 날짜 데이터가 없으면 버튼 비활성 + 안내.
 * - 그리드 스타일 최소 4종(D1: fontFamily·headerLang·showTitle·showLines) — 비운 항목은 키를 쓰지 않는다(variant 별 기본값).
 *   '현재 페이지에 적용' 은 이 캔버스의 그리드 전부의 `extension.style` 에 지정 항목만 덮어쓰고 다시 그린다(다른 스타일 키 유지).
 * - 연도 제목은 `style.showTitle` 로만 정한다. `extension.show.yearTitle` 은 쓰지 않는다 — 플러그인이 그 값을 고객 on/off
 *   (`metadata.calendar.show.yearTitle`)보다 먼저 읽기 때문에 템플릿에 쓰면 고객 선택이 무력화된다.
 */
interface WorkspaceLike {
  id?: string
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  getCenterPoint: () => { x: number; y: number }
}

const SELECT_CLASS =
  'h-8 rounded-md border border-editor-border bg-editor-panel px-2 text-xs text-editor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent disabled:cursor-not-allowed disabled:opacity-50'

function pickDataVersion(): string {
  const meta = useCalendarStore.getState().meta
  const profile = useSettingsStore.getState().productProfile
  return meta?.dataVersion ?? profile?.calendar?.dataVersion ?? DEFAULT_CALENDAR_DATA_VERSION
}

/** 이 캔버스용 렌더 ctx — 그리드 추가·스타일 적용 공용 */
function buildToolsContext(canvasIndex: number, data: CalendarData): CalendarRenderContext {
  const meta = useCalendarStore.getState().meta
  const profile = useSettingsStore.getState().productProfile
  const yearPolicy = profile?.calendar?.yearPolicy
  const ctx: CalendarRenderContext = meta
    ? {
        startYear: meta.startYear,
        startMonth: meta.startMonth,
        canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex),
        weekStart: profile?.calendar?.weekStart ?? 0,
        show: { ...meta.show },
        anniversaries: toAnniversaryInputs(meta.anniversaries),
        data,
        yearSpan: yearPolicy?.span,
      }
    : {
        startYear: new Date().getFullYear() + 1,
        startMonth: 1,
        canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex) ?? 0,
        weekStart: 0,
        show: { holidays: true, lunar: true, solarTerms: true },
        anniversaries: [],
        data,
        yearSpan: yearPolicy?.span,
      }
  if (isCalendarProfile(profile)) {
    const yearDelta = resolveCanvasYearDelta(profile.calendar, yearPolicy, meta, canvasIndex)
    if (yearDelta !== undefined) ctx.yearDelta = yearDelta
  }
  return ctx
}

/** 템플릿 연달력 연도 이동 후보(관리자, Q2 답: 표지·에필로그 연도 관계는 그리드마다 정함) */
const YEAR_DELTA_OPTIONS: number[] = Array.from({ length: CALENDAR_YEAR_DELTA_LIMIT * 2 + 1 }, (_, i) => i - CALENDAR_YEAR_DELTA_LIMIT)

function yearDeltaOptionLabel(d: number): string {
  if (d === 0) return '기준 연도'
  return d > 0 ? `기준 연도 +${d}년` : `기준 연도 ${d}년`
}

export interface CalendarGridToolsProps {
  /** 그리드를 추가했거나 스타일을 적용한 뒤(패널의 연달력 섹션 갱신용) */
  onGridsChanged?: () => void
}

export default function CalendarGridTools({ onGridsChanged }: CalendarGridToolsProps = {}) {
  const canvas = useAppStore((s) => s.canvas)
  const ready = useAppStore((s) => s.ready)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<GridStyleDraft>(EMPTY_GRID_STYLE_DRAFT)
  const [yearDelta, setYearDelta] = useState(0)
  const dataVersion = pickDataVersion()
  const hasData = getCalendarData(dataVersion) !== null
  const fontNames = useMemo(() => {
    const names = getFontListAsSource().map((f) => f.name)
    return Array.from(new Set([DEFAULT_FONT_FAMILY, ...names]))
  }, [])

  /** 공통 준비: 플러그인·데이터·활성 캔버스. 실패 시 안내 메시지 후 null */
  const prepare = useCallback(() => {
    const { canvas: cvs, editor, allCanvas } = useAppStore.getState()
    if (!ready || !cvs || !editor) return null
    const plugin = editor.getPlugin<CalendarPlugin>('CalendarPlugin')
    if (!plugin) {
      setMessage('CalendarPlugin 이 등록되지 않았습니다.')
      return null
    }
    const data = getCalendarData(pickDataVersion())
    if (!data) {
      setMessage('날짜 데이터 준비 중 — 그리드를 추가할 수 없습니다.')
      return null
    }
    const canvasIndex = Math.max(0, allCanvas.indexOf(cvs))
    return { cvs, plugin, ctx: buildToolsContext(canvasIndex, data) }
  }, [ready])

  const addGrid = useCallback(
    async (ext: CalendarGridExtension) => {
      const prepared = prepare()
      if (!prepared) return
      const { cvs, plugin, ctx } = prepared
      const workspace = (cvs.getObjects() as WorkspaceLike[]).find((o) => o.id === 'workspace')
      if (!workspace || !workspace.width || !workspace.height) {
        setMessage('workspace 를 등록해 주세요.')
        return
      }

      const wsW = workspace.width * (workspace.scaleX ?? 1)
      const wsH = workspace.height * (workspace.scaleY ?? 1)
      // 월·연달력 4:3, 미니 1:1 (근거는 파일 머리 주석)
      const ratio = ext.variant === 'mini' ? 1 : 4 / 3
      let width = wsW * 0.8
      let height = width / ratio
      const maxH = wsH * 0.8
      if (height > maxH) {
        height = maxH
        width = height * ratio
      }
      const center = workspace.getCenterPoint()
      const box = { left: center.x - width / 2, top: center.y - height / 2, width, height }

      setBusy(true)
      setMessage(null)
      try {
        cvs.offHistory()
        let grid: fabric.Group
        try {
          grid = await plugin.createGrid(ext, ctx, box)
        } finally {
          cvs.onHistory()
        }
        cvs.add(grid)
        cvs.setActiveObject(grid)
        cvs.requestRenderAll()
        onGridsChanged?.()
      } catch (error) {
        console.warn('[CalendarGridTools] 그리드 추가 실패:', error instanceof Error ? error.message : error)
        setMessage('그리드 추가에 실패했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [prepare, onGridsChanged],
  )

  const style = gridStyleFromDraft(draft)
  const withStyle = (ext: CalendarGridExtension): CalendarGridExtension => (style ? { ...ext, style: { ...style } } : ext)

  const applyStyleToPage = useCallback(async () => {
    const patch = gridStyleFromDraft(draft)
    if (!patch) return
    const prepared = prepare()
    if (!prepared) return
    const { cvs, plugin, ctx } = prepared
    const grids = (cvs.getObjects() as fabric.Object[]).filter((o) => CalendarPluginClass.isGrid(o)) as Array<
      fabric.Object & { extension?: CalendarGridExtension }
    >
    if (grids.length === 0) {
      setMessage('이 페이지에 그리드가 없습니다.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      for (const g of grids) {
        if (!g.extension) continue
        // 지정한 항목만 덮어쓴다(colors·rows 등 다른 키 유지). show 는 건드리지 않는다(yearTitle 미기록)
        g.extension = { ...g.extension, style: { ...(g.extension.style ?? {}), ...patch } }
      }
      await plugin.rehydrate(ctx)
      useSaveStore.getState().markDirty()
      onGridsChanged?.()
    } catch (error) {
      console.warn('[CalendarGridTools] 스타일 적용 실패:', error instanceof Error ? error.message : error)
      setMessage('스타일 적용에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }, [draft, prepare, onGridsChanged])

  const disabled = !ready || !canvas || busy || !hasData

  return (
    <section className="flex flex-col gap-2" aria-label="그리드 배치(관리자)">
      <h3 className="text-xs font-semibold text-editor-text">그리드 배치(관리자)</h3>
      {!hasData && (
        <p className="text-xs text-editor-text-muted">날짜 데이터 준비 중(version={dataVersion}) — 그리드 추가는 데이터 등록 후 가능합니다.</p>
      )}

      <fieldset className="flex flex-col gap-1.5 rounded-md border border-editor-border p-2" aria-label="그리드 스타일">
        <legend className="px-1 text-xs text-editor-text-muted">그리드 스타일(비우면 종류별 기본값)</legend>
        <select
          aria-label="그리드 글꼴"
          className={cn(SELECT_CLASS, 'w-full')}
          value={draft.fontFamily}
          onChange={(e) => setDraft({ ...draft, fontFamily: e.target.value })}
        >
          <option value="">글꼴: 기본</option>
          {fontNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1">
          <select
            aria-label="요일 표기"
            className={SELECT_CLASS}
            value={draft.headerLang}
            onChange={(e) => setDraft({ ...draft, headerLang: e.target.value as GridStyleDraft['headerLang'] })}
          >
            <option value="">요일: 기본</option>
            <option value="en">요일: 영문</option>
            <option value="ko">요일: 한글</option>
          </select>
          <select
            aria-label="제목 표시"
            className={SELECT_CLASS}
            value={draft.showTitle}
            onChange={(e) => setDraft({ ...draft, showTitle: e.target.value as GridStyleDraft['showTitle'] })}
          >
            <option value="">제목: 기본</option>
            <option value="on">제목: 표시</option>
            <option value="off">제목: 숨김</option>
          </select>
          <select
            aria-label="칸 구분선"
            className={SELECT_CLASS}
            value={draft.showLines}
            onChange={(e) => setDraft({ ...draft, showLines: e.target.value as GridStyleDraft['showLines'] })}
          >
            <option value="">선: 기본</option>
            <option value="on">선: 표시</option>
            <option value="off">선: 숨김</option>
          </select>
        </div>
        <Button variant="outline" size="sm" disabled={disabled || !style} onClick={() => void applyStyleToPage()}>
          현재 페이지 그리드에 스타일 적용
        </Button>
      </fieldset>

      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid(withStyle({ variant: 'month', monthDelta: 0 }))}>
        날짜 그리드 추가(월)
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid(withStyle({ variant: 'mini', monthDelta: -1 }))}>
          미니 달력 추가(전월)
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid(withStyle({ variant: 'mini', monthDelta: 1 }))}>
          미니 달력 추가(익월)
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label="연달력 연도"
          className={cn(SELECT_CLASS, 'flex-1')}
          value={yearDelta}
          onChange={(e) => setYearDelta(Number(e.target.value))}
        >
          {YEAR_DELTA_OPTIONS.map((d) => (
            <option key={d} value={d}>{yearDeltaOptionLabel(d)}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid(withStyle({ variant: 'year', yearDelta }))}>
          연달력 추가
        </Button>
      </div>
      <p className="text-xs text-editor-text-muted">연달력은 표지·에필로그 페이지에 두면 고객이 연도·제목 표시를 고를 수 있습니다.</p>
      {message && <p className="text-xs text-red-500">{message}</p>}
    </section>
  )
}
