import { useMemo } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { moveObjectToCanvas, resolveRegionRef, type SpreadPlugin } from '@storige/canvas-core'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { showToast } from '@/stores/useToastStore'
import { buildPageMeta, type PageMeta } from '@/components/PageNavigation/BookNavigation'

/**
 * 표지 영역 사이로 객체 이동 (cover.md §7 / D5 Phase 3b-v).
 *
 * 활성 페이지가 표지 그룹이고, 표지 그룹에 다른 region이 있을 때만 노출.
 * 클릭 시:
 *   1) source canvas(active) 객체를 target canvas(다른 region)로 이동
 *      (canvas-core moveObjectToCanvas helper, fabric clone + atomic history)
 *   2) target region에 맞춰 좌표/메타 갱신 (target 워크스페이스 중심 배치)
 *   3) target region 페이지로 자동 전환
 *
 * 1차 정책 메모
 * - 위치 매핑은 target 워크스페이스 중심 (정밀 좌표 매핑은 향후 Phase 2)
 * - 두 캔버스 history 분리 (각각 1 step씩) — Undo는 target 페이지에서 add를,
 *   source 페이지에서 remove를 각각 1번씩 되돌려야 양쪽 동기화
 * - meta.regionRef/anchor는 target SpreadPlugin이 있으면 자동 재계산,
 *   없으면 (separated 모드) regionRef를 target의 coverPosition으로 단순 설정
 */
export default function MoveToCoverRegion() {
  const activeSelection = useActiveSelection()
  const pages = useEditorStore((s) => s.pages)
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const goToPage = useEditorStore((s) => s.goToPage)
  const setPage = useAppStore((s) => s.setPage)
  const allCanvas = useAppStore((s) => s.allCanvas)
  const allEditors = useAppStore((s) => s.allEditors)

  const meta = useMemo<PageMeta[]>(() => {
    if (pages.length === 0) return []
    return buildPageMeta(pages.map((p) => ({ id: p.id, type: p.templateType })))
  }, [pages])

  const activeGroup = useMemo(() => {
    if (meta.length === 0) return null
    const active = meta.find((m) => m.index === currentPageIndex)
    if (!active || !active.isCover) return null
    let start = active.index
    let end = active.index
    while (start > 0 && meta[start - 1]?.isCover) start -= 1
    while (end < meta.length - 1 && meta[end + 1]?.isCover) end += 1
    return meta.slice(start, end + 1)
  }, [meta, currentPageIndex])

  // 노출 조건
  if (!activeGroup || activeGroup.length < 2) return null
  if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) return null
  // 멀티 선택은 1차에서 미지원 (clone 정확성 이슈) — 향후 별도 처리
  if (activeSelection.length > 1) return null

  const obj = activeSelection[0]
  if (!obj) return null
  // 시스템 객체는 ControlBar showBar 조건에서 이미 걸러지지만 안전 가드 추가
  if ((obj as any).id === 'workspace') return null
  if ((obj as any).meta?.system) return null

  const targets = activeGroup.filter((m) => m.index !== currentPageIndex)
  if (targets.length === 0) return null

  const handleMove = async (targetIdx: number) => {
    const source = useAppStore.getState().canvas
    const target = allCanvas[targetIdx]
    if (!source || !target) {
      showToast('대상 영역 캔버스를 찾을 수 없습니다.', 'error', 3000)
      return
    }
    if (source === target) return

    // target 워크스페이스 중심 좌표 계산 (1차: 단순 중심)
    let targetLeft: number | undefined
    let targetTop: number | undefined
    try {
      const ws = target.getObjects?.().find((o: any) => o.id === 'workspace')
      if (ws) {
        const center = ws.getCenterPoint?.()
        if (center) {
          targetLeft = center.x
          targetTop = center.y
        }
      }
    } catch (e) {
      console.warn('[MoveToCoverRegion] target workspace center calc failed:', e)
    }

    const moved = await moveObjectToCanvas(obj, source, target, {
      left: targetLeft,
      top: targetTop,
      preserveId: true,
      preserveMeta: true,
    })

    if (!moved) {
      showToast('객체 이동에 실패했습니다.', 'error', 3000)
      return
    }

    // target SpreadPlugin이 있으면 (spread 모드) regionRef/anchor 자동 갱신
    const targetEditor = allEditors[targetIdx] as any
    const targetSpread = targetEditor?.getPlugin?.('SpreadPlugin') as SpreadPlugin | undefined
    if (targetSpread?.getLayout) {
      try {
        const layout = targetSpread.getLayout()
        if (layout) {
          const br = (moved as any).getBoundingRect?.()
          if (br) {
            const result = resolveRegionRef(layout.regions, br, null)
            if (!(moved as any).meta) (moved as any).meta = {}
            ;(moved as any).meta.regionRef = result.regionRef
            ;(moved as any).meta.primaryRegionHint = result.primaryRegionHint
            ;(moved as any).meta.anchor = result.anchor
          }
        }
      } catch (e) {
        console.warn('[MoveToCoverRegion] target spread meta recompute failed:', e)
      }
    } else {
      // Separated 모드: target의 coverPosition을 regionRef로 단순 설정
      const targetMeta = activeGroup.find((m) => m.index === targetIdx)
      if (targetMeta?.coverPosition) {
        if (!(moved as any).meta) (moved as any).meta = {}
        ;(moved as any).meta.regionRef = targetMeta.coverPosition
      }
    }

    // target 페이지로 자동 전환
    setPage(targetIdx)
    goToPage(targetIdx)

    const targetLabel = activeGroup.find((m) => m.index === targetIdx)?.label ?? '대상 영역'
    showToast(`"${targetLabel}"(으)로 이동했습니다.`, 'success', 2500)
  }

  return (
    <div className="move-to-cover-region px-3 pb-2">
      <div className="text-[11px] font-semibold text-editor-text-muted mb-1.5 px-1 flex items-center gap-1">
        <ArrowRightLeft className="h-3 w-3" />
        다른 영역으로 이동
      </div>
      <div className="flex flex-wrap gap-1">
        {targets.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => handleMove(m.index)}
            className="text-[11px] px-2 py-1.5 rounded-md border border-editor-border bg-editor-surface-low hover:bg-editor-hover hover:border-editor-accent text-editor-text transition-colors"
            title={`이 객체를 "${m.label}"(으)로 이동`}
            aria-label={`${m.label}로 이동`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
