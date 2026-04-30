import { useMemo } from 'react'
import { useAppStore, useSelectionType } from '@/stores/useAppStore'
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
  Link,
  Unlink as LinkBreak,
  Scissors,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
} from 'lucide-react'
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

export default function ControlBar() {
  const canvas = useAppStore((state) => state.canvas)
  const activeSelection = useAppStore((state) => state.activeSelection)
  const selectionType = useSelectionType()
  const getPlugin = useAppStore((state) => state.getPlugin)
  const updateObjects = useAppStore((state) => state.updateObjects)

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

  const handleDelete = () => {
    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    activeSelection?.forEach((obj) => {
      objectPlugin?.del(obj)
    })
    canvas?.requestRenderAll()
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

  const Icon = selectionType ? getIconByType(selectionType) : SquaresFour

  if (!showBar || !selectionType) {
    return null
  }

  return (
    <div
      id="control-bar"
      className="control-bar bg-editor-panel border-r border-editor-border flex flex-col w-[280px] min-w-[280px] max-w-[280px] h-full overflow-hidden"
    >
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
            </TooltipProvider>
          </div>
        )}

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
