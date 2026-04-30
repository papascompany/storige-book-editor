import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { SpreadPlugin, SpreadRegion } from '@storige/canvas-core'

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
