import { useCallback, useState } from 'react'
import type { fabric } from 'fabric'
import {
  getCalendarData,
  type CalendarGridVariant,
  type CalendarPlugin,
  type CalendarRenderContext,
} from '@storige/canvas-core'
import { DEFAULT_CALENDAR_DATA_VERSION } from '@storige/types'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { resolveCanvasMonthOffset } from '@/utils/productProfile'

/**
 * CalendarGridTools — editMode(관리자 템플릿 제작) 전용: 날짜 그리드/미니 달력을 캔버스 중앙에 추가 (P1-d 캘린더, 2026-10-17)
 *
 * - 기본 박스: 캔버스(workspace) 폭의 80%, 비율 월 4:3 / 미니 1:1(높이는 workspace 높이 80% 로 클램프).
 * - ctx: 세션 메타가 있으면 그 값, 없으면 {내년 1월 시작, 캔버스 index 기준 월 오프셋(없으면 0), weekStart 0, show 전부 true}.
 * - SmartCodes 선례: offHistory 로 생성 → onHistory → canvas.add → setActiveObject.
 * - 날짜 데이터가 없으면 버튼 비활성 + 안내.
 */
interface WorkspaceLike {
  id?: string
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  getCenterPoint: () => { x: number; y: number }
}

function pickDataVersion(): string {
  const meta = useCalendarStore.getState().meta
  const profile = useSettingsStore.getState().productProfile
  return meta?.dataVersion ?? profile?.calendar?.dataVersion ?? DEFAULT_CALENDAR_DATA_VERSION
}

export default function CalendarGridTools() {
  const canvas = useAppStore((s) => s.canvas)
  const ready = useAppStore((s) => s.ready)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const dataVersion = pickDataVersion()
  const hasData = getCalendarData(dataVersion) !== null

  const addGrid = useCallback(
    async (variant: CalendarGridVariant, monthDelta: number) => {
      const { canvas: cvs, editor, allCanvas } = useAppStore.getState()
      if (!ready || !cvs || !editor) return
      const plugin = editor.getPlugin<CalendarPlugin>('CalendarPlugin')
      if (!plugin) {
        setMessage('CalendarPlugin 이 등록되지 않았습니다.')
        return
      }
      const data = getCalendarData(pickDataVersion())
      if (!data) {
        setMessage('날짜 데이터 준비 중 — 그리드를 추가할 수 없습니다.')
        return
      }
      const workspace = (cvs.getObjects() as WorkspaceLike[]).find((o) => o.id === 'workspace')
      if (!workspace || !workspace.width || !workspace.height) {
        setMessage('workspace 를 등록해 주세요.')
        return
      }

      const meta = useCalendarStore.getState().meta
      const profile = useSettingsStore.getState().productProfile
      const canvasIndex = Math.max(0, allCanvas.indexOf(cvs))
      const ctx: CalendarRenderContext = meta
        ? {
            startYear: meta.startYear,
            startMonth: meta.startMonth,
            canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex),
            weekStart: profile?.calendar?.weekStart ?? 0,
            show: { ...meta.show },
            anniversaries: meta.anniversaries.map((a) => ({ date: a.date, lunar: a.lunar, isLeapMonth: a.isLeapMonth, text: a.text })),
            data,
          }
        : {
            startYear: new Date().getFullYear() + 1,
            startMonth: 1,
            canvasMonthOffset: resolveCanvasMonthOffset(profile, canvasIndex) ?? 0,
            weekStart: 0,
            show: { holidays: true, lunar: true, solarTerms: true },
            anniversaries: [],
            data,
          }

      const wsW = workspace.width * (workspace.scaleX ?? 1)
      const wsH = workspace.height * (workspace.scaleY ?? 1)
      let width = wsW * 0.8
      let height = variant === 'month' ? (width * 3) / 4 : width
      const maxH = wsH * 0.8
      if (height > maxH) {
        height = maxH
        width = variant === 'month' ? (height * 4) / 3 : height
      }
      const center = workspace.getCenterPoint()
      const box = { left: center.x - width / 2, top: center.y - height / 2, width, height }

      setBusy(true)
      setMessage(null)
      try {
        cvs.offHistory()
        let grid: fabric.Group
        try {
          grid = await plugin.createGrid({ variant, monthDelta }, ctx, box)
        } finally {
          cvs.onHistory()
        }
        cvs.add(grid)
        cvs.setActiveObject(grid)
        cvs.requestRenderAll()
      } catch (error) {
        console.warn('[CalendarGridTools] 그리드 추가 실패:', error instanceof Error ? error.message : error)
        setMessage('그리드 추가에 실패했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [ready],
  )

  const disabled = !ready || !canvas || busy || !hasData

  return (
    <section className="flex flex-col gap-2" aria-label="그리드 배치(관리자)">
      <h3 className="text-xs font-semibold text-editor-text">그리드 배치(관리자)</h3>
      {!hasData && (
        <p className="text-xs text-editor-text-muted">날짜 데이터 준비 중(version={dataVersion}) — 그리드 추가는 데이터 등록 후 가능합니다.</p>
      )}
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid('month', 0)}>
        날짜 그리드 추가(월)
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid('mini', -1)}>
          미니 달력 추가(전월)
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void addGrid('mini', 1)}>
          미니 달력 추가(익월)
        </Button>
      </div>
      {message && <p className="text-xs text-red-500">{message}</p>}
    </section>
  )
}
