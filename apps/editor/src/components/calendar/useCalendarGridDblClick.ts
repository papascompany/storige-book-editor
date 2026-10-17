import { useEffect } from 'react'
import type { fabric } from 'fabric'
import { CalendarPlugin } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'

/**
 * useCalendarGridDblClick — 활성 캔버스의 calendar-grid 날짜칸 더블클릭 → 날짜('YYYY-MM-DD') 콜백 (P1-d 캘린더, 2026-10-17)
 *
 * - `mouse:dblclick` 의 target 이 CalendarPlugin.isGrid 인 경우만 `plugin.hitTestDate(target, pointer)` 로 날짜를 얻는다.
 * - 캔버스 전환(useAppStore.canvas 변경) 시 이전 캔버스 구독을 해제하고 새 캔버스에 다시 건다.
 * - 날짜칸 밖(제목·요일 헤더·빈 칸)이나 그리드가 아닌 객체는 무시한다.
 */
export function useCalendarGridDblClick(onDate: (date: string) => void, enabled = true): void {
  const canvas = useAppStore((s) => s.canvas)
  const editor = useAppStore((s) => s.editor)

  useEffect(() => {
    if (!enabled || !canvas || !editor) return
    const plugin = editor.getPlugin<CalendarPlugin>('CalendarPlugin')
    if (!plugin) return

    const handler = (opt: fabric.IEvent<MouseEvent>) => {
      const target = opt.target
      if (!CalendarPlugin.isGrid(target)) return
      const pointer = canvas.getPointer(opt.e)
      const date = plugin.hitTestDate(target, { x: pointer.x, y: pointer.y })
      if (date) onDate(date)
    }

    canvas.on('mouse:dblclick', handler)
    return () => {
      canvas.off('mouse:dblclick', handler)
    }
  }, [canvas, editor, enabled, onDate])
}
