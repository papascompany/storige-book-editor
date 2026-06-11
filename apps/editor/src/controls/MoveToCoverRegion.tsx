import { useMemo } from 'react'
import { ArrowRightLeft, Undo2 } from 'lucide-react'
import { moveObjectToCanvas, type SpreadPlugin } from '@storige/canvas-core'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { showToast } from '@/stores/useToastStore'
import { useCrossCanvasMoveStore } from '@/stores/useCrossCanvasMoveStore'
import { buildPageMeta, type PageMeta } from '@/components/PageNavigation/BookNavigation'

/**
 * 표지 영역 사이로 객체 이동 (cover.md §7 / D5 Phase 3b-v + Phase 2-A 정밀 좌표).
 *
 * 활성 페이지가 표지 그룹이고, 표지 그룹에 다른 region이 있을 때만 노출.
 * 클릭 시:
 *   1) source canvas(active) 객체를 target canvas(다른 region)로 이동
 *      (canvas-core moveObjectToCanvas helper, fabric clone + atomic history)
 *   2) **target 워크스페이스 기준 xNorm/yNorm 비례 변환**으로 좌표 결정 —
 *      source 워크스페이스 내부 상대 위치를 target 워크스페이스에서 그대로 유지
 *   3) target region 페이지로 자동 전환
 *
 * 좌표 매핑 정책 (Phase 2-A)
 * - 객체 중심점을 source 워크스페이스 좌상단 기준 정규화 (0~1, 범위 외 허용)
 * - target 워크스페이스 크기에 비례해서 역변환 → target 캔버스 좌표
 * - 객체 자체 크기(width/height/scale)는 그대로 유지 — 같은 mm/dpi 환경 가정
 * - 워크스페이스 미발견 시 fallback: target 중심
 *
 * 두 캔버스 history는 분리 (각각 1 step씩) — Undo는 target 페이지에서 add를,
 * source 페이지에서 remove를 각각 1번씩 되돌려야 양쪽 동기화. cross-canvas
 * atomic history는 Phase 2-B로 분리.
 *
 * meta.regionRef/anchor는 target SpreadPlugin이 있으면 자동 재계산,
 * 없으면 (separated 모드) regionRef를 target의 coverPosition으로 단순 설정.
 */

/** 워크스페이스 객체에서 중심점/크기 추출 (id='workspace' 기준) */
function getWorkspaceBox(canvas: any): { centerX: number; centerY: number; width: number; height: number } | null {
  if (!canvas?.getObjects) return null
  try {
    const ws = canvas.getObjects().find((o: any) => o?.id === 'workspace')
    if (!ws) return null
    const center = ws.getCenterPoint?.()
    if (!center) return null
    const width = (ws.width ?? 0) * (ws.scaleX ?? 1)
    const height = (ws.height ?? 0) * (ws.scaleY ?? 1)
    if (width <= 0 || height <= 0) return null
    return { centerX: center.x, centerY: center.y, width, height }
  } catch {
    return null
  }
}
export default function MoveToCoverRegion() {
  const activeSelection = useActiveSelection()
  const pages = useEditorStore((s) => s.pages)
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const goToPage = useEditorStore((s) => s.goToPage)
  const setPage = useAppStore((s) => s.setPage)
  const allCanvas = useAppStore((s) => s.allCanvas)
  const allEditors = useAppStore((s) => s.allEditors)
  const lastCrossMove = useCrossCanvasMoveStore((s) => s.last)
  const pushCrossMove = useCrossCanvasMoveStore((s) => s.pushMove)
  const clearLastCrossMove = useCrossCanvasMoveStore((s) => s.clearLast)

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

  // 시스템/워크스페이스 객체를 제외한 이동 가능한 객체 목록
  const moveableObjects = activeSelection.filter(
    (o: any) => o && o.id !== 'workspace' && !o.meta?.system
  )
  if (moveableObjects.length === 0) return null

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

    const srcBox = getWorkspaceBox(source)
    const tgtBox = getWorkspaceBox(target)
    const targetEditor = allEditors[targetIdx] as any
    const targetSpread = targetEditor?.getPlugin?.('SpreadPlugin') as SpreadPlugin | undefined
    const targetMeta = activeGroup.find((m) => m.index === targetIdx)

    let movedCount = 0

    for (const obj of moveableObjects) {
      // target 좌표 계산 (Phase 2-A: 워크스페이스 기준 xNorm/yNorm 비례 변환)
      let targetLeft: number | undefined
      let targetTop: number | undefined
      if (srcBox && tgtBox) {
        try {
          const objCenter = (obj as any).getCenterPoint?.()
          if (objCenter) {
            const srcLeftEdge = srcBox.centerX - srcBox.width / 2
            const srcTopEdge = srcBox.centerY - srcBox.height / 2
            const xNorm = (objCenter.x - srcLeftEdge) / srcBox.width
            const yNorm = (objCenter.y - srcTopEdge) / srcBox.height
            targetLeft = tgtBox.centerX - tgtBox.width / 2 + xNorm * tgtBox.width
            targetTop = tgtBox.centerY - tgtBox.height / 2 + yNorm * tgtBox.height
          }
        } catch (e) {
          console.warn('[MoveToCoverRegion] coord ratio calc failed:', e)
        }
      }
      if (targetLeft === undefined && tgtBox) {
        targetLeft = tgtBox.centerX
        targetTop = tgtBox.centerY
      }

      const moved = await moveObjectToCanvas(obj, source, target, {
        left: targetLeft,
        top: targetTop,
        preserveId: true,
        preserveMeta: true,
      })

      if (!moved) continue
      movedCount++

      // target SpreadPlugin이 있으면 (spread 모드) regionRef/anchor 자동 갱신
      if (targetSpread?.resolveRegionMetaForObject) {
        try {
          // ⚠️ raw getBoundingRect()(무인자 = viewport 좌표) 금지 — 줌에 따라 영역을 오판해
          // meta 를 오염시킨다(라이브 P1, 2026-06-12). scene→content 변환을 캡슐화한
          // SpreadPlugin.resolveRegionMetaForObject 만 사용한다.
          const result = targetSpread.resolveRegionMetaForObject(moved as any, null)
          if (result) {
            if (!(moved as any).meta) (moved as any).meta = {}
            ;(moved as any).meta.regionRef = result.regionRef
            ;(moved as any).meta.primaryRegionHint = result.primaryRegionHint
            ;(moved as any).meta.anchor = result.anchor
          }
        } catch (e) {
          console.warn('[MoveToCoverRegion] target spread meta recompute failed:', e)
        }
      } else {
        // Separated 모드: target의 coverPosition을 regionRef로 단순 설정
        if (targetMeta?.coverPosition) {
          if (!(moved as any).meta) (moved as any).meta = {}
          ;(moved as any).meta.regionRef = targetMeta.coverPosition
        }
      }
    }

    if (movedCount === 0) {
      showToast('이동할 수 있는 객체가 없습니다.', 'error', 3000)
      return
    }

    // target 페이지로 자동 전환
    setPage(targetIdx)
    goToPage(targetIdx)

    const targetLabel = targetMeta?.label ?? '대상 영역'

    // cross-canvas move log push (Phase 2-B — "방금 이동 되돌리기" 액션 활성화)
    pushCrossMove({
      id: `move-${Date.now()}`,
      sourceIdx: currentPageIndex,
      targetIdx,
      targetLabel,
      count: movedCount,
    })

    const objWord = movedCount === 1 ? '객체' : `${movedCount}개 객체`
    showToast(`${objWord}를 "${targetLabel}"(으)로 이동했습니다. 30초 안에 "되돌리기"로 복구 가능.`, 'success', 3500)
  }

  // "방금 이동 되돌리기" — Phase 2-B
  // 양 캔버스의 history undo를 count만큼 호출 (target N add 되돌림 + source N remove 되돌림)
  const handleUndoLastMove = () => {
    const last = lastCrossMove
    if (!last) return
    const src = allCanvas[last.sourceIdx] as any
    const tgt = allCanvas[last.targetIdx] as any
    const count = last.count ?? 1
    try {
      // target 먼저 (add 되돌림 → 객체 사라짐) — 이동한 객체 수만큼
      for (let i = 0; i < count; i++) tgt?.undo?.()
      // source (remove 되돌림 → 객체 복원)
      for (let i = 0; i < count; i++) src?.undo?.()
      // source 페이지로 자동 전환
      setPage(last.sourceIdx)
      goToPage(last.sourceIdx)
      const objWord = count === 1 ? '영역 이동을' : `${count}개 객체 이동을`
      showToast(`${objWord} 되돌렸습니다.`, 'info', 2500)
    } catch (e) {
      console.warn('[MoveToCoverRegion] undo cross-canvas failed:', e)
      showToast('되돌리기에 실패했습니다.', 'error', 3000)
    } finally {
      clearLastCrossMove()
    }
  }

  // "방금 이동 되돌리기" 버튼 노출 조건:
  // 1) lastCrossMove 존재 (TTL 30초 내)
  // 2) 현재 페이지가 target — 즉 이동 직후 사용자가 옮긴 영역에 있음
  // 3) (UX) 만료된 이전 move가 보일 수 있어 ts 30초 가드 추가
  const showUndoBtn =
    lastCrossMove != null &&
    lastCrossMove.targetIdx === currentPageIndex &&
    Date.now() - lastCrossMove.ts < 30_000

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
            title={moveableObjects.length === 1 ? `이 객체를 "${m.label}"(으)로 이동` : `선택한 ${moveableObjects.length}개 객체를 "${m.label}"(으)로 이동`}
            aria-label={`${m.label}로 이동`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* 방금 영역 이동 되돌리기 — Phase 2-B (cross-canvas atomic undo) */}
      {showUndoBtn && (
        <button
          type="button"
          onClick={handleUndoLastMove}
          className="mt-2 w-full text-[11px] px-2 py-1.5 rounded-md border border-editor-border bg-editor-surface-low hover:bg-editor-hover text-editor-text-muted hover:text-editor-text transition-colors flex items-center justify-center gap-1"
          title="방금 이동을 되돌리고 원래 영역으로 객체 복구"
          aria-label="방금 이동 되돌리기"
        >
          <Undo2 className="h-3 w-3" />
          방금 이동 되돌리기
        </button>
      )}
    </div>
  )
}
