import { useCallback, useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import type { CopyPlugin, LockPlugin } from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'

/**
 * ObjectActionBar (E1 §5-3) — 선택 객체 상단 플로팅 액션 바.
 *
 * - 객체 선택 시 선택 경계 상단 중앙에 복제·삭제 버튼 2종(v1)을 띄운다.
 * - selection:created/updated/cleared 구독, 변형 중(moving/scaling/rotating) 숨김
 *   → object:modified/mouse:up 재표시 (TransformFeedback 과 동일 3이벤트 정합).
 * - 뷰포트 clamp: 임베드 소형 뷰포트 포함, 바가 캔버스 영역 밖으로 이탈하지 않는다.
 * - 게이팅 (레이어 UX L1④ 규약 정합 — SidePanel 복제/삭제 가드와 동일 판정):
 *   · 삭제: 비-editMode 에서 deleteable===false 포함 선택이면 숨김
 *   · 복제: CopyPlugin.isCloneProtected() 판정 재사용(움직임/삭제/내용 잠금 + designer+ 고급잠금)
 *   · LockPlugin 4단계: designer/admin/system 잠금 포함 선택은 두 버튼 모두 숨김(방어적 —
 *     통상 해당 객체는 고객 선택 자체가 차단되지만 프로그래매틱 선택 경로를 봉쇄)
 *   · 두 버튼 모두 숨김이면 바 자체 미표시
 * - 멀티 선택(ActiveSelection) 지원: CopyPlugin.clone() 은 copyActiveSelection 경로,
 *   삭제는 requestDeleteSelection(S2 확인 모달) → ObjectPlugin.del() 다중 경로가 실물
 *   지원함을 확인함 — 멤버 전체가 게이트를 통과할 때만 노출.
 * - 액션은 기존 경로 재사용(신규 복제/삭제 로직 없음):
 *   복제 = CopyPlugin.clone() (ctrl+d 핫키·SidePanel 행 버튼과 동일),
 *   삭제 = useAppStore.requestDeleteSelection() (휴지통 버튼·DEL 핫키 공통 S2 모달 경로).
 * - 플래그 VITE_ENABLE_OBJECT_ACTION_BAR (기본 on) — React 컴포넌트라 createCanvas 가
 *   아닌 렌더 지점 게이팅(컴포넌트 내부 early-return).
 * - 시스템 객체(EmptyCanvasHint 와 동일 정책) 포함 선택에는 표시하지 않는다.
 */

const ENABLE_OBJECT_ACTION_BAR = import.meta.env.VITE_ENABLE_OBJECT_ACTION_BAR !== 'false'

// EmptyCanvasHint 와 동일 정책(+printguide) — 시스템 객체 선택에는 바 미표시
const SYSTEM_IDS = new Set(['workspace', 'cut-border', 'safe-zone-border', 'template-background'])
const SYSTEM_EXTENSION_TYPES = new Set([
  'guideline',
  'background',
  'overlay',
  'outline',
  'moldIcon',
  'clipping',
  'printguide',
])

/** 선택 상단 기준 바 오프셋 (px) */
const BAR_GAP_PX = 8
/** clamp 여백 (px) */
const CLAMP_MARGIN_PX = 4

interface BarPlacement {
  x: number
  y: number
}

/**
 * 뷰포트 clamp — 바 앵커(x=중앙, y=하단: translate(-50%,-100%))가 컨테이너 밖으로
 * 나가지 않도록 좌표를 보정한다. 컨테이너 치수가 0(미측정)이면 원좌표 유지.
 * 순수 함수 — 테스트 대상.
 */
export function clampBarPosition(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
  barWidth: number,
  barHeight: number,
  margin: number = CLAMP_MARGIN_PX
): BarPlacement {
  let cx = x
  let cy = y
  if (containerWidth > 0) {
    const minX = margin + barWidth / 2
    const maxX = containerWidth - margin - barWidth / 2
    // 컨테이너가 바보다 좁으면(극소형 임베드) 중앙 고정
    cx = maxX < minX ? containerWidth / 2 : Math.min(Math.max(cx, minX), maxX)
  }
  if (containerHeight > 0) {
    const minY = margin + barHeight
    const maxY = containerHeight - margin
    cy = maxY < minY ? containerHeight / 2 : Math.min(Math.max(cy, minY), maxY)
  }
  return { x: cx, y: cy }
}

type ProtectedFlags = {
  deleteable?: boolean
  movable?: boolean
  contentEditable?: boolean
  lockInfo?: { isLocked?: boolean; lockLevel?: string }
  extensionType?: string
  id?: string
  type?: string
}

interface BarState extends BarPlacement {
  showClone: boolean
  showDelete: boolean
}

function isSystemObject(obj: fabric.Object): boolean {
  const o = obj as fabric.Object & ProtectedFlags
  if (o.id && SYSTEM_IDS.has(o.id)) return true
  if (o.extensionType && SYSTEM_EXTENSION_TYPES.has(o.extensionType)) return true
  if (o.type === 'GuideLine') return true
  if (typeof o.id === 'string' && o.id.startsWith('center-guideline-')) return true
  if (obj.excludeFromExport === true) return true
  return false
}

export default function ObjectActionBar() {
  const ready = useAppStore((s) => s.ready)
  const canvas = useAppStore((s) => s.canvas)
  const getPlugin = useAppStore((s) => s.getPlugin)
  const requestDeleteSelection = useAppStore((s) => s.requestDeleteSelection)
  const editMode = useSettingsStore((s) => s.currentSettings.editMode)
  const isCoarse = useIsCoarsePointer()

  const [bar, setBar] = useState<BarState | null>(null)

  // 바 추정 치수 — clamp 계산용 (버튼 2개 + 패딩). coarse 는 44px+ 터치 타깃.
  const buttonSizePx = isCoarse ? 44 : 32
  const estBarWidth = buttonSizePx * 2 + 4 /* gap */ + 8 /* padding */
  const estBarHeight = buttonSizePx + 8

  const computeState = useCallback((): BarState | null => {
    if (!canvas || typeof canvas.getActiveObjects !== 'function') return null
    const selection = canvas.getActiveObjects() as Array<fabric.Object & ProtectedFlags>
    if (!selection || selection.length === 0) return null
    if (selection.some((obj) => isSystemObject(obj))) return null

    // ── 게이팅 (L1④·잠금 4단계 규약) ──
    let showClone: boolean
    let showDelete: boolean
    if (editMode) {
      // 관리자(템플릿 제작)는 보호 게이트 면제 — SidePanel/ControlBar 와 동일 규약
      showClone = true
      showDelete = true
    } else {
      const copyPlugin = getPlugin<CopyPlugin>('CopyPlugin')
      const lockPlugin = getPlugin<LockPlugin>('LockPlugin')
      // designer+ 고급잠금(4단계 중 user 제외) 포함 선택 — 두 버튼 모두 차단
      const hasElevatedLock = selection.some((obj) => {
        const info = lockPlugin?.getLockInfo
          ? lockPlugin.getLockInfo(obj)
          : (obj.lockInfo as { isLocked?: boolean; lockLevel?: string } | undefined)
        return info?.isLocked === true && info.lockLevel !== 'user'
      })
      showDelete = !hasElevatedLock && selection.every((obj) => obj.deleteable !== false)
      showClone =
        !hasElevatedLock &&
        copyPlugin != null &&
        selection.every((obj) => !copyPlugin.isCloneProtected(obj))
    }
    if (!showClone && !showDelete) return null

    // ── 위치: 선택(단일/ActiveSelection) 경계 상단 중앙 → 컨테이너 좌표로 변환 + clamp ──
    const active = canvas.getActiveObject?.() ?? selection[0]
    if (!active || typeof active.getBoundingRect !== 'function') return null
    // getBoundingRect() 기본 호출 = viewport 반영 화면 좌표 (canvas 요소 기준)
    const rect = active.getBoundingRect()

    const upperCanvas = (canvas as fabric.Canvas & { upperCanvasEl?: HTMLElement }).upperCanvasEl
    const containerEl = upperCanvas?.closest('main') ?? null
    let offsetX = 0
    let offsetY = 0
    let containerW = 0
    let containerH = 0
    if (upperCanvas && containerEl) {
      const canvasRect = upperCanvas.getBoundingClientRect()
      const containerRect = containerEl.getBoundingClientRect()
      offsetX = canvasRect.left - containerRect.left
      offsetY = canvasRect.top - containerRect.top
      containerW = containerRect.width
      containerH = containerRect.height
    }

    const rawX = offsetX + rect.left + rect.width / 2
    const rawY = offsetY + rect.top - BAR_GAP_PX
    const { x, y } = clampBarPosition(rawX, rawY, containerW, containerH, estBarWidth, estBarHeight)

    return { x: Math.round(x), y: Math.round(y), showClone, showDelete }
  }, [canvas, editMode, getPlugin, estBarWidth, estBarHeight])

  useEffect(() => {
    if (!ready || !canvas || !ENABLE_OBJECT_ACTION_BAR) {
      setBar(null)
      return
    }

    // 변형 중 숨김 플래그 — object:modified/mouse:up 에서 해제 (TransformFeedback 정합)
    let transforming = false

    const apply = () => {
      if (transforming) {
        setBar(null)
        return
      }
      // after:render 등 고빈도 이벤트에서 불필요 리렌더 방지 — 동일 상태면 이전 참조 유지
      setBar((prev) => {
        const next = computeState()
        if (prev === null && next === null) return prev
        if (
          prev !== null &&
          next !== null &&
          prev.x === next.x &&
          prev.y === next.y &&
          prev.showClone === next.showClone &&
          prev.showDelete === next.showDelete
        ) {
          return prev
        }
        return next
      })
    }

    const onTransform = () => {
      transforming = true
      setBar(null)
    }
    const onTransformEnd = () => {
      transforming = false
      apply()
    }

    apply() // 마운트 시점에 이미 선택이 있으면 즉시 표시

    const updateEvents = ['selection:created', 'selection:updated', 'selection:cleared']
    const transformEvents = ['object:moving', 'object:scaling', 'object:rotating']
    const endEvents = ['object:modified', 'mouse:up']
    updateEvents.forEach((ev) => canvas.on(ev, apply))
    transformEvents.forEach((ev) => canvas.on(ev, onTransform))
    endEvents.forEach((ev) => canvas.on(ev, onTransformEnd))
    // 줌/팬으로 객체 화면 위치가 바뀌면 추종 (동일 상태 비교로 렌더 루프 없음 —
    // EmptyCanvasHint 의 after:render 구독 전례)
    canvas.on('after:render', apply)

    return () => {
      updateEvents.forEach((ev) => canvas.off(ev, apply))
      transformEvents.forEach((ev) => canvas.off(ev, onTransform))
      endEvents.forEach((ev) => canvas.off(ev, onTransformEnd))
      canvas.off('after:render', apply)
    }
  }, [ready, canvas, computeState])

  const handleClone = useCallback(() => {
    // 기존 경로 재사용: ctrl+d 핫키·SidePanel 과 동일 — 무인자 clone() 은 active
    // selection(단일/ActiveSelection)을 그대로 복제하고 내부 보호 가드를 한 번 더 거친다.
    getPlugin<CopyPlugin>('CopyPlugin')?.clone()
  }, [getPlugin])

  const handleDelete = useCallback(() => {
    // 기존 경로 재사용: S2 확인 모달 → ObjectPlugin.del() (삭제잠금·fillImage 가드 내장)
    requestDeleteSelection()
  }, [requestDeleteSelection])

  if (!ENABLE_OBJECT_ACTION_BAR || !ready || !canvas || !bar) return null

  const buttonClass = `${
    isCoarse ? 'h-11 w-11' : 'h-8 w-8'
  } flex items-center justify-center rounded-md text-editor-text-muted hover:bg-editor-hover hover:text-editor-text transition-colors`

  return (
    <div className="absolute inset-0 z-[40] pointer-events-none" role="presentation">
      <div
        data-testid="object-action-bar"
        role="toolbar"
        aria-label="선택 객체 액션"
        className="absolute pointer-events-auto flex items-center gap-1 rounded-lg bg-editor-panel border border-editor-border shadow-md p-1"
        style={{ left: bar.x, top: bar.y, transform: 'translate(-50%, -100%)' }}
      >
        {bar.showClone && (
          <button type="button" aria-label="복제" onClick={handleClone} className={buttonClass}>
            <Copy className={isCoarse ? 'h-5 w-5' : 'h-4 w-4'} />
          </button>
        )}
        {bar.showDelete && (
          <button type="button" aria-label="삭제" onClick={handleDelete} className={buttonClass}>
            <Trash2 className={isCoarse ? 'h-5 w-5' : 'h-4 w-4'} />
          </button>
        )}
      </div>
    </div>
  )
}
