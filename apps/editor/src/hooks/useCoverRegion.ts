import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { showToast } from '@/stores/useToastStore'
import { resolveRegionRef, type SpreadPlugin } from '@storige/canvas-core'
import type { SpreadRegion } from '@storige/types'

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

    const handler = (payload: { count: number; autoRelocated?: boolean }) => {
      const count = payload?.count ?? 0
      if (count <= 0) return
      const msg = payload.autoRelocated
        ? `책등 폭 변경: ${count}개 객체를 작업 영역 안으로 자동 재배치했습니다. 위치를 확인해 주세요.`
        : `책등 폭이 변경되어 ${count}개 객체가 작업 영역을 벗어났습니다. 위치를 확인해 주세요.`
      showToast(msg, payload.autoRelocated ? 'info' : 'warning', 5000)
    }

    // 책등 콘텐츠 오버플로우(책등이 좁아져 책등 객체가 표지 침범) 경고. (SF-5)
    // 텍스트 자동 축소는 하지 않음(폰트품질 보존) — 사용자에게 조정 안내만.
    const spineHandler = (payload: { count: number; spineWidthMm?: number }) => {
      const count = payload?.count ?? 0
      if (count <= 0) return
      showToast(
        `책등 폭(${payload?.spineWidthMm ?? '?'}mm)이 좁아 책등 객체 ${count}개가 표지를 침범합니다. 책등 텍스트/이미지 크기를 줄이거나 위치를 조정해 주세요.`,
        'warning',
        6000,
      )
    }

    editor.on('spreadObjectsOutOfBounds', handler)
    editor.on('spreadSpineOverflow', spineHandler)
    return () => {
      editor.off?.('spreadObjectsOutOfBounds', handler)
      editor.off?.('spreadSpineOverflow', spineHandler)
    }
  }, [ready, isSpreadMode, editor])
}

/**
 * P2: 객체가 재단선(트림박스)을 벗어났을 때 warning toast 알림 (화면 가이드).
 *
 * `WorkspacePlugin`이 object:modified / object:moving / object:scaling 시 발행하는
 * `objectOutOfTrim` { count, objects } 이벤트를 구독해 사용자에게 경고 toast 표시.
 *
 * spread 모드와 무관하게 일반 편집 모드에서도 동작한다 (가드는 ready/editor 만).
 * 출력/저장 동작에는 영향 없음 — 순수 화면 경고.
 *
 * 드래그/리사이즈 중 연속 발행되므로, 동일 메시지를 매 프레임 띄우지 않도록
 * 마지막 표시 후 짧은 쿨다운(throttle)을 둔다.
 */
export function useObjectOutOfTrimToast(ready: boolean): void {
  const editor = useAppStore((s) => s.editor)

  useEffect(() => {
    if (!ready || !editor) return

    let lastShownAt = 0
    const COOLDOWN_MS = 2000

    const handler = (payload: { count: number; objects?: unknown[] }) => {
      const count = payload?.count ?? 0
      if (count <= 0) return
      const now = Date.now()
      if (now - lastShownAt < COOLDOWN_MS) return
      lastShownAt = now
      showToast(
        `재단선을 벗어난 객체가 ${count}개 있습니다 — 인쇄 시 잘릴 수 있습니다.`,
        'warning',
        4000,
      )
    }

    editor.on('objectOutOfTrim', handler)
    return () => {
      editor.off?.('objectOutOfTrim', handler)
    }
  }, [ready, editor])
}
