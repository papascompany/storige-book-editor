import { useMemo, useState, useEffect } from 'react'
import { useAppStore, useSelectionType } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { AlignPlugin, GroupPlugin, LockPlugin, ObjectPlugin, SelectionType } from '@storige/canvas-core'

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
  Printer,
} from 'lucide-react'
import { fabric } from 'fabric'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { showToast } from '@/stores/useToastStore'
import { selectionTypeLabel } from '@/utils/layerDisplay'
import { isAppearanceLocked } from '@/utils/objectPermissions'
import { requiredEditKindOf } from '@/utils/requiredEditCheck'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
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

// L2 §5 용어 동기화: 타입 한국어명 단일 소스(layerDisplay.selectionTypeLabel) 재사용 —
// 레이어 행 이름 규약과 ControlBar 헤더가 같은 명칭을 쓴다(사진/도형/사진틀…).
const getObjectName = (type: SelectionType, selectionCount: number) =>
  selectionTypeLabel(type, selectionCount)

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

  // B1 (2026-07-04): 레이어별 속성 4축 — 선택 객체 전부 기준 판정 (기존 토글 3종 패턴).
  const allContentLocked = useMemo(() => {
    return activeSelection?.every((e) => (e as any).contentEditable === false) ?? false
  }, [activeSelection])

  const allPrintExcluded = useMemo(() => {
    return activeSelection?.every((e) => (e as any).printExclude === true) ?? false
  }, [activeSelection])

  const allOrderLocked = useMemo(() => {
    return activeSelection?.every((e) => (e as any).lockLayerOrder === true) ?? false
  }, [activeSelection])

  // L7 (2026-07-11): 필수 편집(requiredEdit) — 선택 전부 기준 판정 (기존 토글 패턴).
  // 텍스트·사진틀(frame)에만 의미 있으므로 그 외 타입 포함 선택은 항목 비활성.
  const allRequiredEdit = useMemo(() => {
    return activeSelection?.every((e) => (e as any).requiredEdit === true) ?? false
  }, [activeSelection])

  const requiredEditApplicable = useMemo(() => {
    if (!activeSelection || activeSelection.length === 0) return false
    return activeSelection.every((e) => requiredEditKindOf(e) !== null)
  }, [activeSelection])

  // 선택 전부의 lockInfo.lockLevel 이 동일하면 그 값, 혼합/미잠금이면 'none'
  const selectionLockLevel = useMemo(() => {
    if (!activeSelection || activeSelection.length === 0) return 'none'
    const levels = activeSelection.map((e) => {
      const info = (e as any).lockInfo
      return info?.isLocked ? (info.lockLevel as string) : 'none'
    })
    return levels.every((l) => l === levels[0]) ? levels[0] : 'mixed'
  }, [activeSelection])

  // L3 B-2: 보호 드롭다운 트리거 활성 표시 — 축 하나라도 걸려 있으면 amber
  const anyProtection = useMemo(
    () =>
      allMovementLocked ||
      allDeleteLocked ||
      allContentLocked ||
      allOrderLocked ||
      allRequiredEdit ||
      (selectionLockLevel !== 'none' && selectionLockLevel !== 'mixed'),
    [allMovementLocked, allDeleteLocked, allContentLocked, allOrderLocked, allRequiredEdit, selectionLockLevel]
  )

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
  // L1② (2026-07-06): 레이어 패널 진입점 — 객체 선택 중 빠른 접근(헤더 Layers 버튼과 병행)
  const setShowSidePanel = useAppStore((state) => state.setShowSidePanel)
  const showSidePanel = useAppStore((state) => state.showSidePanel)
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

  // B0-② (2026-07-04): 잠금 해제 권한 게이트.
  // - 관리자 지정 위치고정(movable===false)은 비-editMode 에서 해제 불가(버튼도 숨김).
  // - LockPlugin 고급 잠금(lockInfo.isLocked)은 CAN_UNLOCK_MAP 역할 검사 통과 시에만 해제.
  //   (고객이 스스로 건 단순잠금은 legacy 판정이 'user' 레벨이라 현행대로 해제 가능.)
  const handleUnlock = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    const lockPlugin = getPlugin<LockPlugin>('LockPlugin')
    activeSelection?.forEach((obj) => {
      if (!editMode && (obj as any).movable === false) return
      const lockInfo = (obj as any).lockInfo
      if (lockInfo?.isLocked) {
        // LockPlugin 고급 잠금은 플러그인 경유 해제 — 내부 canUnlock(CAN_UNLOCK_MAP) 검사
        // + lockInfo/fabric 속성 정합 해제(ObjectPlugin.unlock 만 쓰면 lockInfo 잔류로
        // handleSelection/handleMoving 가드가 계속 발동하는 이중상태가 남는다).
        lockPlugin?.unlock(obj)
        return
      }
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

  // B1: 관리자 전용 — 내용편집 잠금 토글. contentEditable=false 면 고객 진입 시
  // 텍스트 편집 진입/사진틀 채우기·교체가 차단된다(applyObjectPermissions·useImageStore 가드).
  const handleToggleContentLock = () => {
    const next = !allContentLocked
    activeSelection?.forEach((obj) => {
      ;(obj as any).contentEditable = next ? false : true
    })
    updateObjects()
  }

  // B1: 관리자 전용 — 프린트 제외 토글. printExclude=true 면 PDF 출력에서만 제외
  // (화면·썸네일에는 표시, ServicePlugin 이 excludeFromExport 로 임시 변환).
  const handleTogglePrintExclude = () => {
    const next = !allPrintExcluded
    activeSelection?.forEach((obj) => {
      ;(obj as any).printExclude = next ? true : false
    })
    updateObjects()
  }

  // B1: 관리자 전용 — 순서 잠금 토글. ObjectPlugin z-order 4메서드·reorderObject 에
  // 기능 가드 기존재(lockLayerOrder) — 여기선 플래그 지정만.
  const handleToggleOrderLock = () => {
    const next = !allOrderLocked
    activeSelection?.forEach((obj) => {
      ;(obj as any).lockLayerOrder = next ? true : false
    })
    updateObjects()
  }

  // L7: 관리자 전용 — 필수 편집 토글. requiredEdit=true 면 고객이 안 바꾸고 완료 시
  // 비차단 경고 모달(requiredEditGate). 지정(재지정) 시 requiredEditTouched 를 초기화해
  // 관리자 authoring 중 편집 흔적이 템플릿에 영속되는 것을 막는다(고객 무경고 구멍 방지).
  const handleToggleRequiredEdit = () => {
    const next = !allRequiredEdit
    activeSelection?.forEach((obj) => {
      if (requiredEditKindOf(obj) === null) return
      ;(obj as any).requiredEdit = next
      delete (obj as any).requiredEditTouched
    })
    updateObjects()
  }

  // B1: 관리자 전용 — 잠금 레벨 지정/해제 (LockPlugin 경유, CAN_UNLOCK_MAP 규약).
  const handleLockLevelChange = (level: string) => {
    if (level === 'mixed' || level === 'system') return // 표시용 sentinel — 동작 없음
    // L3(적대 리뷰): system 잠금은 어떤 레벨로도 변경 불가 — 침묵 실패 대신 안내
    if (selectionLockLevel === 'system') {
      showToast('시스템 잠금은 해제할 수 없어요.', 'info')
      return
    }
    const lockPlugin = getPlugin<LockPlugin>('LockPlugin')
    if (!lockPlugin || !activeSelection?.length) return
    const targets = [...activeSelection]
    if (level === 'none') {
      lockPlugin.unlockMultiple(targets)
    } else {
      // 레벨 변경은 해제 후 재잠금 (lock() 이 기존 상위 잠금을 거부하는 규약 준수)
      lockPlugin.unlockMultiple(targets)
      lockPlugin.lockMultiple(targets, level as 'user' | 'designer' | 'admin')
    }
    // lock() 이 discardActiveObject 로 선택을 해제하고 evented=false 라 캔버스 재클릭도
    // 불가 — editMode(admin) 에서는 선택을 복원해 레벨 변경/해제 동선을 유지한다
    // (LockPlugin handleSelection 의 admin 바이패스가 프로그래매틱 선택을 허용).
    if (editMode && canvas && targets.length > 0) {
      if (targets.length === 1) {
        canvas.setActiveObject(targets[0])
      } else {
        canvas.setActiveObject(new fabric.ActiveSelection(targets, { canvas }))
      }
      canvas.requestRenderAll()
    }
    updateObjects()
  }

  const handleInvisible = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    let blocked = false
    activeSelection?.forEach((obj) => {
      // L1④ 대칭 가드(적대 리뷰 major): 보호 객체는 고객이 숨길 수 없다 —
      // visible=false 는 저장 영속 → 필수 요소 미인쇄 사고 벡터. SidePanel 가드와 동일 규약.
      const o = obj as { movable?: boolean; deleteable?: boolean; contentEditable?: boolean }
      if (!editMode && (o.movable === false || o.deleteable === false || o.contentEditable === false)) {
        blocked = true
        return
      }
      objectPlugin?.invisible(obj)
    })
    if (blocked) showToast('관리자가 보호한 요소는 숨길 수 없어요.', 'info')
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

  // L4-④ (CTO 결정): '내용편집 잠금' = 내용+스타일 모두 잠금. 비-editMode 에서
  // contentEditable=false 선택이면 스타일 컨트롤(속성·색·효과·외곽선·그림자)을 감산(미노출).
  // editMode(디자이너)는 면제 — objectPermissions.isAppearanceLocked 단일 판정.
  const appearanceLocked = isAppearanceLocked(activeSelection, editMode)

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
                {/* LockSimple/Unlock — B0-②: 관리자 위치고정은 비-editMode 에서 해제 버튼 숨김 */}
                {allLocked ? (
                  (editMode || !allMovementLocked) && (
                    <Button variant="ghost" size="icon" onClick={handleUnlock}>
                      <LockSimple className="h-5 w-5" />
                    </Button>
                  )
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

                {/* L1②: 레이어 패널 열기 — 선택 컨텍스트에서 즉시 레이어 구조 확인 */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSidePanel(!showSidePanel)}
                  title="레이어 패널"
                  aria-pressed={showSidePanel}
                >
                  <Stack className="h-5 w-5" />
                </Button>

                {/* Phase 1-공유: 레이어 z-order (단일 선택에서만 — ObjectPlugin 이 active 1개만 처리) */}
                {activeSelection?.length === 1 && (
                  <>
                    {/* B1: lockLayerOrder 객체는 UI 도 비활성 (ObjectPlugin 내부 가드와 정합) */}
                    <Button variant="ghost" size="icon" onClick={handleBringToFront} title="맨 앞으로" disabled={allOrderLocked}>
                      <ArrowUpToLine className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleBringForward} title="앞으로" disabled={allOrderLocked}>
                      <ArrowUp className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleSendBackward} title="뒤로" disabled={allOrderLocked}>
                      <ArrowDown className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleSendToBack} title="맨 뒤로" disabled={allOrderLocked}>
                      <ArrowDownToLine className="h-5 w-5" />
                    </Button>
                  </>
                )}

                {/* L3 B-2 (2026-07-06): '보호' 통합 드롭다운 — 보호 수단을 방패 하나로.
                    개별 토글 4종(위치/삭제/내용/순서)+잠금레벨 Select 를 대체. '내 잠금'(자물쇠)
                    과 시각·개념 분리(잠금 2어휘 규약). printExclude 는 보호가 아니라 출력 속성
                    이므로 별도 버튼 유지. */}
                {editMode && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="보호 (고객 편집 제한)"
                        aria-label="보호 설정"
                      >
                        {anyProtection ? (
                          <ShieldCheck className="h-5 w-5 text-amber-500" />
                        ) : (
                          <ShieldX className="h-5 w-5" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="z-[110] w-56">
                      <DropdownMenuLabel className="text-xs">보호 — 고객 편집 제한</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={allMovementLocked}
                        onCheckedChange={() => handleToggleMovementLock()}
                        onSelect={(e) => e.preventDefault()}
                      >
                        위치 고정 (이동·변형 불가)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={allDeleteLocked}
                        onCheckedChange={() => handleToggleDeleteLock()}
                        onSelect={(e) => e.preventDefault()}
                      >
                        삭제 잠금
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={allContentLocked}
                        onCheckedChange={() => handleToggleContentLock()}
                        onSelect={(e) => e.preventDefault()}
                      >
                        내용 잠금 (텍스트·사진 교체 불가)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={allOrderLocked}
                        onCheckedChange={() => handleToggleOrderLock()}
                        onSelect={(e) => e.preventDefault()}
                      >
                        순서 잠금 (레이어 순서 고정)
                      </DropdownMenuCheckboxItem>
                      {/* L7: 필수 편집 — 텍스트·사진틀 전용(그 외 타입은 비활성+툴팁). 보호(제한)가
                          아니라 요구 플래그지만, 고객 편집 규칙 지정이라 같은 방패 드롭다운에 배치. */}
                      <DropdownMenuCheckboxItem
                        checked={allRequiredEdit && requiredEditApplicable}
                        onCheckedChange={() => handleToggleRequiredEdit()}
                        onSelect={(e) => e.preventDefault()}
                        disabled={!requiredEditApplicable}
                        title={
                          requiredEditApplicable
                            ? '고객이 이 요소를 편집하지 않고 완료하면 경고를 표시합니다'
                            : '텍스트·사진틀에만 지정할 수 있어요'
                        }
                      >
                        필수 편집 (미편집 완료 시 경고)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs">
                        보호 레벨 (전체 잠금)
                        {selectionLockLevel === 'mixed' && ' — 혼합 선택'}
                        {selectionLockLevel === 'system' && ' — 시스템(해제 불가)'}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={selectionLockLevel}
                        onValueChange={handleLockLevelChange}
                      >
                        <DropdownMenuRadioItem value="none" onSelect={(e) => e.preventDefault()}>
                          잠금 없음
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="designer" onSelect={(e) => e.preventDefault()}>
                          디자이너 — 고객 해제 불가
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="admin" onSelect={(e) => e.preventDefault()}>
                          관리자 — 관리자만 해제
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="user" onSelect={(e) => e.preventDefault()}>
                          사용자 — 고객 해제 가능
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* B1: 프린트 제외 (관리자 editMode 전용) — 화면 표시, PDF 출력만 제외 */}
                {editMode && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleTogglePrintExclude}
                    title={allPrintExcluded ? '프린트 제외 해제' : '프린트 제외 (PDF 출력 제외, 화면 표시)'}
                    aria-pressed={allPrintExcluded}
                  >
                    <Printer className={allPrintExcluded ? 'h-5 w-5 text-amber-500' : 'h-5 w-5'} />
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

          {/* L4-④: 내용편집 잠금(contentEditable=false) 요소는 스타일 컨트롤 감산(§2 원칙 3)
              — 내용+스타일 모두 잠금(CTO 결정). 사유는 안내 문구 1줄로 설명(감산형+설명 병행). */}
          {appearanceLocked ? (
            <div className="px-4 py-2 text-[11px] text-editor-text-muted">
              내용 잠금 요소 — 내용과 스타일을 변경할 수 없어요.
            </div>
          ) : (
            <>
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
            </>
          )}

          {/* Special effects removed */}
        </div>

        <div className="h-10 w-1 p-10"></div>
      </div>
    </div>
  )
}
