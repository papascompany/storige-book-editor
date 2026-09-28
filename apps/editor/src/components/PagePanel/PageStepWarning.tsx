import { memo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { getPageStepViolation, livePhysicalPageCount, pageStepViolationMessage } from '@/utils/pageStep'

/**
 * S8 (2026-09-28): 내지 페이지 수가 증감 단위(pageStep)의 배수가 아닐 때 페이지 패널 상단 경고 배지.
 * 호스트가 홀수 pageCount 로 시드한 경우 등 — 이 상태에서는 편집완료가 차단된다(EditorHeader/embed).
 * pageStep=null 이거나 배수를 만족하면 렌더하지 않는다(기존 화면 무변화).
 */
export const PageStepWarning = memo(function PageStepWarning() {
  const pageStep = useEditorStore((s) => s.pageStep)
  const canvasCount = useAppStore((s) => s.allCanvas.length)
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)
  const regionScope = useSettingsStore((s) => s.spreadConfig?.regionScope ?? null)

  const violation = getPageStepViolation(
    livePhysicalPageCount({ canvasCount, isSpreadMode, regionScope }),
    pageStep,
  )
  if (!violation) return null

  return (
    <div
      role="alert"
      className="absolute left-2 right-2 top-1 z-10 flex items-start gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 shadow-sm"
    >
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>{pageStepViolationMessage(violation)}</span>
    </div>
  )
})
