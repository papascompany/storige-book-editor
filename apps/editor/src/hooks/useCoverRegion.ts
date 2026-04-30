import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { showToast } from '@/stores/useToastStore'
import { resolveRegionRef, type SpreadPlugin, type SpreadRegion } from '@storige/canvas-core'

/**
 * 표지 region 인식 helper (cover.md §7-8 / D5 Phase 3b 인프라).
 *
 * SpreadPlugin이 활성(spread 모드)일 때 canvas X 좌표 → SpreadRegion 매핑을 반환.
 * spread 모드가 아니면 null.
 *
 * 사용 예 (composite/spread 모드 객체 추가 위치 결정):
 *   const resolveRegion = useCoverRegion()
 *   const region = resolveRegion(canvasX)
 *   if (region) {
 *     newObject.set('meta', { anchor: { kind: 'region', xNorm: ..., yNorm: ... } })
 *   }
 *
 * Phase 3b 향후 활용:
 *   1. 객체 추가 시 마우스 이벤트 좌표 → region 매핑 → ObjectAnchor 저장
 *   2. 객체 드래그 종료(modified) 시 새 region 결정 → 메타 갱신
 *   3. 책등 폭 변경 시 region 객체 자동 재배치 (SpreadPlugin.computeResizedLayout)
 */
export function useCoverRegion() {
  const getPlugin = useAppStore((s) => s.getPlugin)
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)

  return useCallback(
    (canvasX: number): SpreadRegion | null => {
      if (!isSpreadMode) return null
      const plugin = getPlugin<SpreadPlugin>('SpreadPlugin')
      return plugin?.getRegionAtX(canvasX) ?? null
    },
    [getPlugin, isSpreadMode]
  )
}

/**
 * 활성 페이지가 표지 그룹인지 + spreadConfig가 있는지 검사.
 * Composite/Spread 모드의 객체 region 인식 활성 여부 판단에 사용.
 */
export function useIsCoverContext(): boolean {
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)
  const spreadConfig = useSettingsStore((s) => s.spreadConfig)
  return isSpreadMode && spreadConfig != null
}

/**
 * Spread 모드에서 신규 객체에 region 앵커 메타를 자동 부여 (cover.md §7 / D5 Phase 3b-ii).
 *
 * SpreadPlugin은 object:modified로 메타를 갱신하지만(3b-iii), 객체가 막 추가된 직후에는
 * meta.regionRef/anchor가 비어 있다. 이 훅이 object:added를 구독해
 * SpreadLayoutEngine.resolveRegionRef로 동일한 히스테리시스 로직을 한 번 적용해
 * 첫 add 시점부터 region 메타가 정확히 부여되도록 보장한다.
 *
 * 비-spread 모드 / SpreadPlugin 미장착 / 시스템 객체에 대해서는 무동작.
 */
export function useSpreadAutoAnchor(ready: boolean): void {
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)
  const editor = useAppStore((s) => s.editor)
  const canvas = useAppStore((s) => s.canvas)

  useEffect(() => {
    if (!ready || !isSpreadMode || !canvas || !editor) return

    const spreadPlugin = editor.getPlugin<SpreadPlugin>('SpreadPlugin')
    if (!spreadPlugin) return

    const handler = (e: { target?: any }) => {
      const target = e?.target
      if (!target) return
      if (target.meta?.system) return
      if (target.meta?.regionRef !== undefined) return

      const layout = spreadPlugin.getLayout()
      if (!layout) return

      const boundingRect = target.getBoundingRect()
      const result = resolveRegionRef(layout.regions, boundingRect, null)

      if (!target.meta) target.meta = {}
      target.meta.regionRef = result.regionRef
      target.meta.primaryRegionHint = result.primaryRegionHint
      target.meta.anchor = result.anchor
    }

    canvas.on('object:added', handler)
    return () => {
      canvas.off('object:added', handler)
    }
  }, [ready, isSpreadMode, canvas, editor])
}

/**
 * 책등 폭 변경 후 캔버스 밖으로 이탈한 객체가 있을 때 toast 알림
 * (cover.md §7 / D5 Phase 3b-iv).
 *
 * `SpreadPlugin.checkObjectsOutOfBounds`가 `resizeSpine` 마지막에 발행하는
 * `spreadObjectsOutOfBounds` 이벤트를 구독해 사용자에게 warning toast 표시.
 */
export function useSpreadOutOfBoundsToast(ready: boolean): void {
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)
  const editor = useAppStore((s) => s.editor)

  useEffect(() => {
    if (!ready || !isSpreadMode || !editor) return

    const handler = (payload: { count: number }) => {
      const count = payload?.count ?? 0
      if (count <= 0) return
      showToast(
        `책등 폭이 변경되어 ${count}개 객체가 작업 영역을 벗어났습니다. 위치를 확인해 주세요.`,
        'warning',
        5000
      )
    }

    editor.on('spreadObjectsOutOfBounds', handler)
    return () => {
      editor.off?.('spreadObjectsOutOfBounds', handler)
    }
  }, [ready, isSpreadMode, editor])
}
