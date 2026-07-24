import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { showToast } from '@/stores/useToastStore'
import { type SpreadPlugin } from '@storige/canvas-core'
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

      // ⚠️ 좌표계 주의(라이브 P1, 2026-06-11/12): 과거 이 훅은 `target.getBoundingRect()`
      // (무인자 = viewport 좌표, 줌·팬 의존)를 resolveRegionRef(content 좌표 엔진)에 그대로
      // 넘겨 fit-zoom(≈0.49)에서 front-cover 객체를 back-cover 로 오판/재앵커했고, 오염된
      // anchor 가 다음 책등가변(repositionObjects) 때 객체를 반대편 표지로 텔레포트시켰다.
      // SpreadPlugin.resolveRegionMetaForObject 가 scene bbox(getBoundingRect(true,true))
      // → content 변환을 캡슐화한다 — 외부에서는 반드시 이 API 를 사용.
      const result = spreadPlugin.resolveRegionMetaForObject(target, null)
      if (!result) return

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

/**
 * E1 §5-5: 재단/안전영역 침범 실시간 경고 toast (화면 가이드).
 *
 * `SafeZoneWarningPlugin`(canvas-core) 이 object:moving/scaling 중 침범 **진입 전이**
 * 시 1회 발행하는 `safeZoneViolation` 이벤트를 구독해 안내 toast 를 띄운다
 * (경계 강조 오버레이는 플러그인이 캔버스에서 직접 처리 — 여기는 문구만).
 *
 * 플러그인이 전이 기반 디바운스를 하지만, 드래그 반복으로 전이가 잦을 수 있어
 * useObjectOutOfTrimToast 와 동일한 쿨다운을 한 겹 더 둔다.
 */
export function useSafeZoneWarningToast(ready: boolean): void {
  const editor = useAppStore((s) => s.editor)

  useEffect(() => {
    if (!ready || !editor) return

    let lastShownAt = 0
    const COOLDOWN_MS = 2000

    const handler = () => {
      const now = Date.now()
      if (now - lastShownAt < COOLDOWN_MS) return
      lastShownAt = now
      showToast('중요한 내용은 재단 안전선 안쪽에 배치해 주세요.', 'warning', 3500)
    }

    editor.on('safeZoneViolation', handler)
    return () => {
      editor.off?.('safeZoneViolation', handler)
    }
  }, [ready, editor])
}

/**
 * A-3① (트랙 C, 2026-07-23): 무선제본 얇은 책등 텍스트 배치 경고 toast.
 *
 * 무선 책등이 SPINE_TEXT_MIN_WIDTH_MM(3mm) 미만이면 책등 글자가 접힘·재단
 * 편차로 표지면에 걸릴 수 있어 배치 자체를 권장하지 않는다(제작 안내 관행).
 * 순수 화면 경고 — 출력/저장/차단 동작 없음.
 *
 * 트리거 2종:
 *  (a) spineWidthChange(SpreadPlugin resizeSpine — 종전 구독자 0건 이벤트 활용):
 *      새 폭이 임계 미만 && 책등에 텍스트 객체가 이미 있으면 발화.
 *  (b) canvas object:added/modified: 텍스트 계열 && meta.regionRef==='spine'
 *      (useSpreadAutoAnchor 가 add 직후 보장) && 현재 폭이 임계 미만이면 발화.
 * 게이트: spineConfig.bindingType === 'perfect' (양장은 최소 8mm 라 비대상).
 * 폭 소스: spineWidthChange payload > spineConfig.calculatedSpineWidth 캐시.
 * 임계값 3mm 는 제작(bookmoa) 정본 미확정 — 확정 시 상수 1곳 수정(설계 §7-6).
 */
export const SPINE_TEXT_MIN_WIDTH_MM = 3

export function useSpineNarrowTextWarningToast(ready: boolean): void {
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)
  const editor = useAppStore((s) => s.editor)
  const canvas = useAppStore((s) => s.canvas)

  useEffect(() => {
    if (!ready || !isSpreadMode || !editor || !canvas) return

    let lastShownAt = 0
    const COOLDOWN_MS = 5000

    const isTextType = (t?: string): boolean =>
      t === 'text' || t === 'i-text' || t === 'textbox'

    const isNarrowPerfect = (spineMm: number | null | undefined): spineMm is number => {
      if (useSettingsStore.getState().spineConfig.bindingType !== 'perfect') return false
      return typeof spineMm === 'number' && spineMm > 0 && spineMm < SPINE_TEXT_MIN_WIDTH_MM
    }

    const warn = (spineMm: number): void => {
      const now = Date.now()
      if (now - lastShownAt < COOLDOWN_MS) return
      lastShownAt = now
      showToast(
        `무선제본 책등 폭이 ${spineMm.toFixed(1)}mm로 ${SPINE_TEXT_MIN_WIDTH_MM}mm 미만입니다 — 책등 글자는 접힘·재단 편차로 표지면에 걸릴 수 있어 권장하지 않습니다.`,
        'warning',
        5000,
      )
    }

    const spineHasText = (): boolean =>
      canvas
        .getObjects()
        .some(
          (o: { type?: string; meta?: { regionRef?: string | null } }) =>
            isTextType(o.type) && o.meta?.regionRef === 'spine',
        )

    // (a) 책등 폭 변경 — 이미 배치된 책등 텍스트가 있을 때만
    const onSpineChange = (payload: { newSpineWidth?: number }): void => {
      if (!isNarrowPerfect(payload?.newSpineWidth)) return
      if (!spineHasText()) return
      warn(payload.newSpineWidth as number)
    }

    // (b) 책등에 텍스트 추가/이동 — 현재 폭이 이미 임계 미만일 때
    const onObject = (e: { target?: { type?: string; meta?: { regionRef?: string | null; system?: unknown } } }): void => {
      const target = e?.target
      if (!target || target.meta?.system) return
      if (!isTextType(target.type) || target.meta?.regionRef !== 'spine') return
      const spineMm = useSettingsStore.getState().spineConfig.calculatedSpineWidth
      if (!isNarrowPerfect(spineMm)) return
      warn(spineMm)
    }

    editor.on('spineWidthChange', onSpineChange)
    canvas.on('object:added', onObject)
    canvas.on('object:modified', onObject)
    return () => {
      editor.off?.('spineWidthChange', onSpineChange)
      canvas.off('object:added', onObject)
      canvas.off('object:modified', onObject)
    }
  }, [ready, isSpreadMode, editor, canvas])
}
