import { useMemo, useState, useEffect } from 'react'
import { useAppStore, useSelectionType } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { AlignPlugin, GroupPlugin, ObjectPlugin, SelectionType } from '@storige/canvas-core'

import {
  Image,
  Type as TextT,
  LayoutGrid as SquaresFour,
  Frame as FrameCorners,
  QrCode,
  Layers as Stack,
  Hexagon,
  Lock as LockSimple,
  Unlock as LockSimpleOpen,
  Eye,
  EyeOff as EyeSlash,
  Trash2 as Trash,
  ShieldX,
  ShieldCheck,
  Pin,
  PinOff,
  Link,
  Unlink as LinkBreak,
  Scissors,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ArrowUp,
  ArrowUpToLine,
  ArrowDown,
  ArrowDownToLine,
} from 'lucide-react'
import { fabric } from 'fabric'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import ObjectSize from '@/controls/ObjectSize'
import ObjectFill from '@/controls/ObjectFill'
import ObjectShadow from '@/controls/ObjectShadow'
import ObjectStroke from '@/controls/ObjectStroke'
import TextAttributes from '@/controls/TextAttributes'
import TextEffect from '@/controls/TextEffect'
import MoveToCoverRegion from '@/controls/MoveToCoverRegion'
// import SpecialEffect from '@/controls/SpecialEffect'

// Icon mapping by selection type
const getIconByType = (type: SelectionType) => {
  switch (type) {
    case SelectionType.background:
      return Image
    case SelectionType.frame:
      return FrameCorners
    case SelectionType.group:
    case SelectionType.multiple:
      return Stack
    case SelectionType.image:
      return Image
    case SelectionType.templateElement:
    case SelectionType.shape:
      return Hexagon
    case SelectionType.text:
      return TextT
    case SelectionType.smartCode:
      return QrCode
    default:
      return SquaresFour
  }
}

// 정렬 버튼 헬퍼 (Tooltip + 작은 icon-only 버튼)
function AlignBtn({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="h-8 w-full flex items-center justify-center rounded-md text-editor-text-muted hover:bg-editor-hover hover:text-editor-text transition-colors"
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// Object name mapping
const getObjectName = (type: SelectionType, selectionCount: number) => {
  switch (type) {
    case SelectionType.text:
      return '텍스트'
    case SelectionType.image:
      return '이미지'
    case SelectionType.shape:
      return '요소'
    case SelectionType.frame:
      return '프레임'
    case SelectionType.background:
      return '배경'
    case SelectionType.smartCode:
      return 'QR/바코드'
    case SelectionType.group:
      return '그룹'
    case SelectionType.multiple:
      return `${selectionCount}개의 아이템`
    case SelectionType.templateElement:
      return '템플릿 요소'
    default:
      return '요소'
  }
}

export default function ControlBar({ mobileOverlay = false }: { mobileOverlay?: boolean } = {}) {
  const canvas = useAppStore((state) => state.canvas)
  const activeSelection = useAppStore((state) => state.activeSelection)
  const selectionType = useSelectionType()
  const getPlugin = useAppStore((state) => state.getPlugin)
  const updateObjects = useAppStore((state) => state.updateObjects)
  // P1-5: 관리자(editMode) 전용 "삭제 잠금" 토글 노출용
  const editMode = useSettingsStore((state) => state.currentSettings.editMode)
  const isCoarsePointer = useIsCoarsePointer()
  // 폭 기반 mobileOverlay (EditorView 가 screenMode 로 결정) 또는 coarse pointer 감지 —
  // 어느 한쪽이라도 true 면 모바일 레이아웃. 두 신호를 모두 보아야 외장 키보드/마우스가
  // 연결된 태블릿 + 작은 viewport 같은 케이스에도 안전.
  const isMobile = mobileOverlay || isCoarsePointer

  // 모바일 시트는 기본 collapsed (헤더만 표시) — 캔버스 가림 최소화.
  // 사용자가 헤더 / 드래그 핸들 탭하면 expand. 새 객체 선택 시마다 collapsed 로 리셋.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [activeSelection])

  // Check if bar should be shown
  const showBar = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

    const firstItem = activeSelection[0]
    return (
      firstItem?.extensionType !== 'background' &&
      firstItem?.extensionType !== 'clipping' &&
      firstItem?.id !== 'workspace' &&
      firstItem?.extensionType !== 'guideline'
    )
  }, [activeSelection])

  // Check if any selection has clip path
  const hasClipPath = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection)) return false
    return activeSelection.some(
      (obj) => obj?.clipPath != null && obj?.clipPath?.id !== 'page-outline-clip'
    )
  }, [activeSelection])

  // Check if all items are locked
  const allLocked = useMemo(() => {
    return activeSelection?.every((e) => !e.hasControls) ?? false
  }, [activeSelection])

  // Check if all items are visible
  const allVisible = useMemo(() => {
    return activeSelection?.every((e) => e.visible) ?? false
  }, [activeSelection])

  // P1-5: 선택 객체 전부가 삭제잠금(deleteable===false)인지
  const allDeleteLocked = useMemo(() => {
    return activeSelection?.every((e) => (e as any).deleteable === false) ?? false
  }, [activeSelection])

  // Part B (2026-06-16): 선택 객체 전부가 위치고정(movable===false)인지
  const allMovementLocked = useMemo(() => {
    return activeSelection?.every((e) => (e as any).movable === false) ?? false
  }, [activeSelection])

  // Actions
  const handleGroup = () => {
    const groupPlugin = getPlugin<GroupPlugin>('GroupPlugin')
    groupPlugin?.group()
    canvas?.requestRenderAll()
  }

  const handleUngroup = () => {
    const groupPlugin = getPlugin<GroupPlugin>('GroupPlugin')
    groupPlugin?.unGroup()
    canvas?.requestRenderAll()
  }

  const handleRemoveClipPath = () => {
    activeSelection?.forEach((obj) => {
      if (obj.clipPath) {
        obj.set({ clipPath: null })
        obj.setCoords()
      }
    })
    canvas?.requestRenderAll()
  }

  // S2 (공유): 즉시 삭제 대신 확인 모달을 거친다(휴지통 버튼·DEL 핫키 공통 경로).
  // 실제 삭제는 store.confirmDeleteSelection → ObjectPlugin.del() 재사용.
  const requestDeleteSelection = useAppStore((state) => state.requestDeleteSelection)
  const handleDelete = () => {
    requestDeleteSelection()
  }

  const handleLock = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    activeSelection?.forEach((obj) => {
      objectPlugin?.lock(obj)
    })
    updateObjects()
  }

  const handleUnlock = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    activeSelection?.forEach((obj) => {
      objectPlugin?.unlock(obj)
    })
    updateObjects()
  }

  const handleVisible = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    activeSelection?.forEach((obj) => {
      objectPlugin?.visible(obj)
    })
    canvas?.requestRenderAll()
  }

  // Phase 1-공유(2026-06-23): 레이어 z-order 4버튼 — 전 상품 공유 ObjectPlugin 로직 재사용.
  // up/upTop/down/downTop 은 단일 선택(active 1개)에서만 동작하고 내부에서 lockLayerOrder 가드 +
  // fillImage(사진틀 채움) 동반 이동 + layerChanged emit 을 처리하므로 forEach/인자 불필요.
  // 우클릭 컨텍스트 메뉴(ObjectPlugin 등록)와 동일 동작을 툴바에 노출할 뿐 — 신규 로직 없음.
  const handleBringForward = () => getPlugin<ObjectPlugin>('ObjectPlugin')?.up()
  const handleBringToFront = () => getPlugin<ObjectPlugin>('ObjectPlugin')?.upTop()
  const handleSendBackward = () => getPlugin<ObjectPlugin>('ObjectPlugin')?.down()
  const handleSendToBack = () => getPlugin<ObjectPlugin>('ObjectPlugin')?.downTop()

  // P1-5: 관리자 전용 — 삭제 잠금 토글. deleteable=false 면 고객 진입 시 삭제 차단(ObjectPlugin.del).
  const handleToggleDeleteLock = () => {
    const next = !allDeleteLocked
    activeSelection?.forEach((obj) => {
      ;(obj as any).deleteable = next ? false : true
    })
    updateObjects()
  }

  // Part B (2026-06-16): 관리자 전용 — 위치 고정 토글. movable=false 면 고객 진입 시
  // 이동/스케일/회전 차단(applyObjectPermissions 가 로드 시 lockMovement/Scaling/Rotation 적용).
  // 관리자 자신은 editMode 라 잠금 미적용 — 자유 편집(deleteable 패턴과 동일).
  const handleToggleMovementLock = () => {
    const next = !allMovementLocked
    activeSelection?.forEach((obj) => {
      ;(obj as any).movable = next ? false : true
    })
    updateObjects()
  }

  const handleInvisible = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    activeSelection?.forEach((obj) => {
      objectPlugin?.invisible(obj)
    })
    canvas?.requestRenderAll()
  }

  // 정렬 — 단일: workspace 기준, 다중: 객체 그룹 자체 기준 (AlignPlugin 동작)
  const alignH = (type: 'left' | 'center' | 'right') => {
    getPlugin<AlignPlugin>('AlignPlugin')?.setH(type)
  }
  const alignV = (type: 'top' | 'center' | 'bottom') => {
    getPlugin<AlignPlugin>('AlignPlugin')?.setV(type)
  }

  // 분포 (트랙 T) — 3개 이상의 객체를 axis 기준으로 균등 분포 (canvas-core에 없어서 editor에서 구현)
  const distribute = (axis: 'horizontal' | 'vertical') => {
    if (!canvas || !activeSelection || activeSelection.length < 3) return
    canvas.offHistory()
    try {
      const objs = [...activeSelection]
      const bounds = objs.map((o) => o.getBoundingRect(true))
      if (axis === 'horizontal') {
        // x축 기준으로 정렬 후 좌우 끝 사이에 균등 분포
        const indexed = objs.map((o, i) => ({ o, b: bounds[i] }))
        indexed.sort((a, b) => (a.b.left + a.b.width / 2) - (b.b.left + b.b.width / 2))
        const first = indexed[0]
        const last = indexed[indexed.length - 1]
        const startX = first.b.left + first.b.width / 2
        const endX = last.b.left + last.b.width / 2
        const step = (endX - startX) / (indexed.length - 1)
        indexed.forEach((entry, idx) => {
          if (idx === 0 || idx === indexed.length - 1) return
          const newCenterX = startX + step * idx
          const cy = entry.o.getCenterPoint().y
          canvas._centerObject(entry.o, new fabric.Point(newCenterX, cy))
          entry.o.setCoords()
          entry.o.dirty = true
        })
      } else {
        const indexed = objs.map((o, i) => ({ o, b: bounds[i] }))
        indexed.sort((a, b) => (a.b.top + a.b.height / 2) - (b.b.top + b.b.height / 2))
        const first = indexed[0]
        const last = indexed[indexed.length - 1]
        const startY = first.b.top + first.b.height / 2
        const endY = last.b.top + last.b.height / 2
        const step = (endY - startY) / (indexed.length - 1)
        indexed.forEach((entry, idx) => {
          if (idx === 0 || idx === indexed.length - 1) return
          const newCenterY = startY + step * idx
          const cx = entry.o.getCenterPoint().x
          canvas._centerObject(entry.o, new fabric.Point(cx, newCenterY))
          entry.o.setCoords()
          entry.o.dirty = true
        })
      }
      canvas.discardActiveObject()
      const newSel = new fabric.ActiveSelection(objs, { canvas })
      canvas.setActiveObject(newSel)
      newSel.setCoords()
      canvas.requestRenderAll()
      canvas.fire('object:modified', { target: newSel })
    } finally {
      canvas.onHistory()
    }
  }

  const Icon = selectionType ? getIconByType(selectionType) : SquaresFour

  if (!showBar || !selectionType) {
    return null
  }

  // 모바일에서는 ControlBar 를 하단 시트(bottom sheet) 로 렌더링.
  // - collapsed: 헤더만 (~80px) — 캔버스 거의 풀로 보임
  // - expanded: 70vh — 사용자가 헤더/핸들 탭해서 펼침
  // - 좌우 폭 100% / 하단 고정 / 자체 스크롤
  // - z-[102] 로 토스트(z-200) 보다 낮고 헤더(z-101)보다 높게
  // - paddingBottom 으로 iOS 홈 인디케이터 영역 회피
  const containerClassName = isMobile
    ? `control-bar control-bar--mobile fixed left-0 right-0 bottom-0 z-[102] bg-editor-panel border-t border-editor-border flex flex-col overflow-hidden shadow-[0_-2px_12px_rgba(0,0,0,0.08)] transition-[height,max-height] duration-200 ${
        expanded ? 'h-[70vh] max-h-[70vh]' : 'h-[88px] max-h-[88px]'
      }`
    : 'control-bar bg-editor-panel border-r border-editor-border flex flex-col w-[280px] min-w-[280px] max-w-[280px] h-full overflow-hidden'
  const containerStyle = isMobile
    ? { paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
    : undefined

  return (
    <div id="control-bar" className={containerClassName} style={containerStyle}>
      {/* 모바일: 드래그 핸들 — 탭으로 collapsed/expanded 토글 */}
      {isMobile && (
        <button
          type="button"
          aria-label={expanded ? '컨트롤 접기' : '컨트롤 펼치기'}
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-col items-center pt-2 pb-1 shrink-0 cursor-pointer hover:bg-editor-hover/50 transition-colors"
        >
          <div className="h-1 w-10 rounded-full bg-editor-border" />
          <span className="text-[10px] text-editor-text-muted mt-1">
            {expanded ? '접기' : '펼치기'}
          </span>
        </button>
      )}
      <div className="control-inner w-full h-full flex flex-col gap-1 overflow-y-auto">
        {/* Header */}
        <div className="control-header flex flex-row p-4 gap-3">
          <div className="icon-box w-16 h-16 bg-editor-hover rounded-lg flex items-center justify-center">
            <Icon className="w-10 h-10 text-editor-text" />
          </div>
          <div className="right flex-1 flex flex-col justify-between py-0.5">
            <div className="type-text text-base font-medium text-editor-text px-1">
              {getObjectName(selectionType, activeSelection?.length ?? 0)}
            </div>
            <div className="actions flex flex-row justify-between">
              <div className="actions-left flex items-center gap-2">
                {/* LockSimple/Unlock */}
                {allLocked ? (
                  <Button variant="ghost" size="icon" onClick={handleUnlock}>
                    <LockSimple className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={handleLock}>
                    <LockSimpleOpen className="h-5 w-5" />
                  </Button>
                )}

                {/* Visible/Invisible */}
                {allVisible ? (
                  <Button variant="ghost" size="icon" onClick={handleInvisible}>
                    <Eye className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={handleVisible}>
                    <EyeSlash className="h-5 w-5" />
                  </Button>
                )}

                {/* Phase 1-공유: 레이어 z-order (단일 선택에서만 — ObjectPlugin 이 active 1개만 처리) */}
                {activeSelection?.length === 1 && (
                  <>
                    <Button variant="ghost" size="icon" onClick={handleBringToFront} title="맨 앞으로">
                      <ArrowUpToLine className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleBringForward} title="앞으로">
                      <ArrowUp className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleSendBackward} title="뒤로">
                      <ArrowDown className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleSendToBack} title="맨 뒤로">
                      <ArrowDownToLine className="h-5 w-5" />
                    </Button>
                  </>
                )}

                {/* Part B: 위치 고정 (관리자 editMode 전용) — 고객이 이 객체를 이동/변형 못하게 보호 */}
                {editMode && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleMovementLock}
                    title={allMovementLocked ? '위치 고정 해제' : '위치 고정 (고객 이동·변형 불가)'}
                    aria-pressed={allMovementLocked}
                  >
                    {allMovementLocked ? (
                      <Pin className="h-5 w-5 text-amber-500" />
                    ) : (
                      <PinOff className="h-5 w-5" />
                    )}
                  </Button>
                )}

                {/* P1-5: 삭제 잠금 (관리자 editMode 전용) — 고객이 이 객체를 삭제 못하게 보호 */}
                {editMode && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleDeleteLock}
                    title={allDeleteLocked ? '삭제 잠금 해제' : '삭제 잠금 (고객 삭제 불가)'}
                    aria-pressed={allDeleteLocked}
                  >
                    {allDeleteLocked ? (
                      <ShieldCheck className="h-5 w-5 text-amber-500" />
                    ) : (
                      <ShieldX className="h-5 w-5" />
                    )}
                  </Button>
                )}
              </div>
              <div className="actions-right">
                <Button variant="ghost" size="icon" onClick={handleDelete}>
                  <Trash className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <hr className="border-editor-border" />

        {/* 정렬 도구 — workspace 기준 (단일) 또는 그룹 자체 기준 (다중) */}
        {selectionType !== SelectionType.background && (
          <div className="align-tools px-3 pb-2">
            <div className="text-[11px] font-semibold text-editor-text-muted mb-1.5 px-1">
              {(activeSelection?.length ?? 0) > 1 ? '그룹 정렬' : '워크스페이스 기준 정렬'}
            </div>
            <TooltipProvider>
              <div className="grid grid-cols-6 gap-1">
                <AlignBtn label="왼쪽" icon={AlignStartVertical} onClick={() => alignH('left')} />
                <AlignBtn label="가로 가운데" icon={AlignCenterVertical} onClick={() => alignH('center')} />
                <AlignBtn label="오른쪽" icon={AlignEndVertical} onClick={() => alignH('right')} />
                <AlignBtn label="위" icon={AlignStartHorizontal} onClick={() => alignV('top')} />
                <AlignBtn label="세로 가운데" icon={AlignCenterHorizontal} onClick={() => alignV('center')} />
                <AlignBtn label="아래" icon={AlignEndHorizontal} onClick={() => alignV('bottom')} />
              </div>

              {/* 분포 (트랙 T) — 3개 이상 선택 시만 표시 */}
              {(activeSelection?.length ?? 0) >= 3 && (
                <>
                  <div className="text-[11px] font-semibold text-editor-text-muted mt-2 mb-1.5 px-1">
                    균등 분포
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <AlignBtn
                      label="가로 균등 분포"
                      icon={AlignHorizontalDistributeCenter}
                      onClick={() => distribute('horizontal')}
                    />
                    <AlignBtn
                      label="세로 균등 분포"
                      icon={AlignVerticalDistributeCenter}
                      onClick={() => distribute('vertical')}
                    />
                  </div>
                </>
              )}
            </TooltipProvider>
          </div>
        )}

        {/* 다른 표지 영역으로 이동 (cover.md §7 / D5 Phase 3b-v) */}
        <MoveToCoverRegion />

        {/* Actions */}
        <div className="actions px-3">
          {/* Group button for multiple selection */}
          {selectionType === SelectionType.multiple && (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={handleGroup}
            >
              <Link className="h-4 w-4 mr-2" />
              그룹화
            </Button>
          )}

          {/* Ungroup button for group selection */}
          {selectionType === SelectionType.group && (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={handleUngroup}
            >
              <LinkBreak className="h-4 w-4 mr-2" />
              그룹해제
            </Button>
          )}

          {/* Remove clip path */}
          {hasClipPath && (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={handleRemoveClipPath}
            >
              <Scissors className="h-4 w-4 mr-2" />
              클립패스 제거
            </Button>
          )}
        </div>

        {/* Control panels */}
        <div className="controls">
          {/* Size control - for all types except background */}
          {selectionType !== SelectionType.background && <ObjectSize />}

          {/* Text attributes - for text only */}
          {selectionType === SelectionType.text && <TextAttributes />}

          {/* Fill control - for text, shapes, images */}
          {(selectionType === SelectionType.text ||
            selectionType === SelectionType.shape ||
            selectionType === SelectionType.image ||
            selectionType === SelectionType.templateElement) && <ObjectFill />}

          {/* Text curve effect - for text only */}
          {selectionType === SelectionType.text && <TextEffect />}

          {/* Stroke control - for all types except background, multiple */}
          {selectionType !== SelectionType.background &&
            selectionType !== SelectionType.multiple && <ObjectStroke />}

          {/* Shadow control - for all types except background, multiple */}
          {selectionType !== SelectionType.background &&
            selectionType !== SelectionType.multiple && <ObjectShadow />}

          {/* Special effects removed */}
        </div>

        <div className="h-10 w-1 p-10"></div>
      </div>
    </div>
  )
}
