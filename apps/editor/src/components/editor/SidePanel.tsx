import { useState, useRef, useEffect, useCallback } from 'react'
import { fabric } from 'fabric'
import { useAppStore, useCurrentIndex } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { type CanvasObject, CopyPlugin, LockPlugin, ObjectPlugin, SelectionType } from '@storige/canvas-core'
import { Image, Type as TextT, Hexagon, Frame as FrameCorners, QrCode, Layers as Stack, X, Trash2 as Trash, Lock as LockSimple, Unlock as LockSimpleOpen, Eye, EyeOff as EyeSlash, GripVertical as DotsSixVertical, Plus, Pin, ShieldX, PencilOff, Printer, ArrowUpDown, Copy as CopyIcon, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { buildNextMultiSelection, layerStepReorderArgs } from '@/utils/layerPanelSelection'

// S3 (공유 계층, 2026-06-23): 레이어 패널 DnD 재정렬.
// 모바일/터치 환경에서는 native HTML5 drag 가 long-press·터치 스크롤과 충돌하므로 비활성
// (BookNavigation 페이지 DnD 와 동일한 가드 — 데스크톱 전용).
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
const TOUCH_ENV = isTouchEnv()

// Icon mapping by selection type
const getIconByType = (type: SelectionType) => {
  switch (type) {
    case SelectionType.background:
      return Image
    case SelectionType.frame:
      return FrameCorners
    case SelectionType.group:
      return Stack
    case SelectionType.image:
      return Image
    case SelectionType.shape:
      return Hexagon
    case SelectionType.text:
      return TextT
    case SelectionType.smartCode:
      return QrCode
    default:
      return Hexagon
  }
}

interface SidePanelProps {
  show: boolean
  onClose?: () => void
}

export default function SidePanel({ show, onClose }: SidePanelProps) {
  const canvas = useAppStore((state) => state.canvas)
  const allCanvas = useAppStore((state) => state.allCanvas)
  const objects = useAppStore((state) => state.objects)
  const screenshots = useAppStore((state) => state.screenshots)
  const currentIndex = useCurrentIndex()
  const setPage = useAppStore((state) => state.setPage)
  const deletePage = useAppStore((state) => state.deletePage)
  const addPage = useAppStore((state) => state.addPage)
  const updateObjects = useAppStore((state) => state.updateObjects)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const reorderObject = useAppStore((state) => state.reorderObject)
  // A1-1: 레이어 행 삭제 — S2 확인 모달 공통 경로(ControlBar 휴지통·DEL 핫키와 동일)
  const requestDeleteSelection = useAppStore((state) => state.requestDeleteSelection)

  const pageInfo = useSettingsStore((state) => state.currentSettings.page)
  // B0-② (2026-07-04): 잠금 해제 권한 게이트용 — 관리자 위치고정은 비-editMode 에서 해제 불가
  const editMode = useSettingsStore((state) => state.currentSettings.editMode)

  const [editingObject, setEditingObject] = useState<CanvasObject | null>(null)
  const [editName, setEditName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // S3: 레이어 패널 DnD 재정렬 상태 (데스크톱 전용)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ id: string; above: boolean } | null>(null)

  // Focus input when editing
  useEffect(() => {
    if (editingObject && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingObject])

  // Object actions
  const handleLock = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)

    if (object && objectPlugin) {
      objectPlugin.lock(object)
      updateObjects()
    }
  }, [canvas, getPlugin, updateObjects])

  const handleUnlock = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    const lockPlugin = getPlugin<LockPlugin>('LockPlugin')
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)

    if (object && objectPlugin) {
      // B0-②: 관리자 위치고정(movable===false)은 비-editMode 에서 해제 차단.
      if (!editMode && (object as any).movable === false) return
      const lockInfo = (object as any).lockInfo
      if (lockInfo?.isLocked) {
        // LockPlugin 고급 잠금은 플러그인 경유 해제(내부 canUnlock 검사 + lockInfo 정합 해제).
        lockPlugin?.unlock(object)
      } else {
        objectPlugin.unlock(object)
      }
      updateObjects()
    }
  }, [canvas, getPlugin, updateObjects, editMode])

  const handleVisible = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)

    if (object && objectPlugin) {
      objectPlugin.visible(object)
      canvas?.requestRenderAll()
    }
  }, [canvas, getPlugin])

  const handleInvisible = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const objectPlugin = getPlugin<ObjectPlugin>('ObjectPlugin')
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)

    if (object && objectPlugin) {
      objectPlugin.invisible(object)
      canvas?.requestRenderAll()
    }
  }, [canvas, getPlugin])

  const selectObject = useCallback((objectId: string, e?: React.MouseEvent) => {
    if (!canvas) return
    const object = canvas.getObjects().find((obj: any) => obj.id === objectId)
    if (!object) return

    // A1-2: shift/ctrl(⌘) 클릭 → fabric ActiveSelection 다중선택.
    // ⚠️ fabric 5.5.2 ActiveSelection 드래그는 자식 lockMovementX/Y 를 존중하지 않는다
    //   (layerPanelSelection.test.ts 재현) → 비-editMode 에서 잠긴 객체는 제외
    //   (buildNextMultiSelection 내 가드 — LockPlugin.handleSelection 선례).
    if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      const prev = (canvas.getActiveObjects?.() ?? []) as fabric.Object[]
      // 기존 ActiveSelection 을 먼저 해제해 자식 좌표(그룹 상대)를 절대좌표로 원복한 뒤 재구성
      canvas.discardActiveObject()
      const next = buildNextMultiSelection(prev, object, editMode)
      if (next.length === 1) {
        canvas.setActiveObject(next[0])
      } else if (next.length > 1) {
        canvas.setActiveObject(new fabric.ActiveSelection(next, { canvas }))
      }
      canvas.requestRenderAll()
      return
    }

    canvas.setActiveObject(object)
    canvas.renderAll()
  }, [canvas, editMode])

  // A1-1: 레이어 행 삭제 버튼 — 대상 객체를 먼저 선택한 뒤 공통 경로(requestDeleteSelection)
  // 호출 → S2 확인 모달 → ObjectPlugin.del() (삭제잠금·lid·fillImage 동반제거 가드 그대로).
  const handleDeleteObject = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)
    if (!object) return
    // 삭제잠금(deleteable===false)은 고객(비-editMode) 진입 시 차단 — 버튼 disabled 와 이중 방어
    if (!editMode && (object as any).deleteable === false) return

    canvas?.setActiveObject(object)
    canvas?.requestRenderAll()
    requestDeleteSelection()
  }, [canvas, editMode, requestDeleteSelection])

  // A1-1: 레이어 행 복제 버튼 — CopyPlugin.clone(기존 ctrl+d 핫키 로직) 재사용, 시그니처 불변.
  // 복제 후 목록 갱신은 canvas 'object:added' → _updateObjectsHandler 가 처리(직접 호출 불필요).
  const handleDuplicateObject = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)
    if (!object) return
    getPlugin<CopyPlugin>('CopyPlugin')?.clone(object)
  }, [canvas, getPlugin])

  // A1-3: 모바일(TOUCH_ENV) ↑↓ 순서변경 — reorderObject 재사용(fabric 라이브 스택 기준,
  // reverse 방향 함정·fillImage 동반이동·setUnchangeable 재고정·updateObjects 전부 내장).
  const handleStepReorder = useCallback((e: React.MouseEvent, index: number, dir: 'up' | 'down') => {
    e.preventDefault()
    e.stopPropagation()

    const args = layerStepReorderArgs(objects, index, dir)
    if (!args) return
    reorderObject(objects[index].id, args.targetId, args.placeAbove)
  }, [objects, reorderObject])

  const startEditing = (obj: CanvasObject) => {
    setEditingObject(obj)
    setEditName(obj.name || '')
  }

  const finishEditing = () => {
    if (editingObject && editName.trim()) {
      const fabricObject = canvas?.getObjects().find((obj: any) => obj.id === editingObject.id)
      if (fabricObject) {
        fabricObject.set('name', editName.trim())
      }
    }
    setEditingObject(null)
    updateObjects()
  }

  const cancelEditing = () => {
    setEditingObject(null)
  }

  // Page actions
  const handleAddPage = useCallback(() => {
    const maxPages = pageInfo?.max || 100
    if (allCanvas.length >= maxPages) {
      alert(`페이지는 최대 ${maxPages}개까지 생성할 수 있습니다.`)
      return
    }
    addPage()
  }, [pageInfo, allCanvas.length, addPage])

  const handleDeletePage = useCallback((e: React.MouseEvent, canvasId: string) => {
    e.preventDefault()
    e.stopPropagation()

    const minPages = pageInfo?.min || 1
    if (allCanvas.length <= minPages) {
      return
    }

    try {
      deletePage(canvasId)
    } catch (error) {
      console.error('페이지 삭제 오류:', error)
    }
  }, [pageInfo, allCanvas.length, deletePage])

  const handleSetPage = useCallback((index: number) => {
    if (currentIndex !== index) {
      setPage(index)
    }
  }, [currentIndex, setPage])

  // S3: 레이어 DnD 핸들러 (데스크톱 전용 — 모바일은 dragEnabled=false 로 미부여)
  // ⚠️ 단일 진실원(R2): 목록은 z-order reverse 라 "위 = 맨앞". 따라서 target 카드 상단 절반에
  //    드롭 = source 를 그 위(앞/front)로 → reorderObject(.., placeAbove=true). 하단 절반 = 뒤.
  const dragEnabled = !TOUCH_ENV

  const handleObjDragStart = (objectId: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragEnabled) return
    setDragSourceId(objectId)
    try {
      e.dataTransfer.effectAllowed = 'move'
      // 일부 브라우저는 setData 없으면 dragstart 가 무시됨
      e.dataTransfer.setData('text/plain', objectId)
    } catch {
      // 무시
    }
  }

  const handleObjDragOver = (objectId: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragEnabled || dragSourceId === null || objectId === dragSourceId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < rect.top + rect.height / 2
    setDragOver((prev) =>
      prev && prev.id === objectId && prev.above === above ? prev : { id: objectId, above }
    )
  }

  const handleObjDragLeave = (objectId: string) => () => {
    setDragOver((prev) => (prev && prev.id === objectId ? null : prev))
  }

  const handleObjDrop = (objectId: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragEnabled || dragSourceId === null) {
      setDragSourceId(null)
      setDragOver(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const source = dragSourceId
    setDragSourceId(null)
    setDragOver(null)
    if (source === objectId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < rect.top + rect.height / 2
    reorderObject(source, objectId, above)
  }

  const handleObjDragEnd = () => {
    setDragSourceId(null)
    setDragOver(null)
  }

  return (
    <div
      className={cn(
        'sidePanel w-[220px] h-[calc(100%-80px)] flex flex-col gap-2 bg-editor-panel',
        'fixed right-[-220px] transition-all duration-300 ease-in-out z-[99]',
        'shadow-[-2.2px_0_3.2px_0_rgba(0,0,0,0.02)] overflow-hidden',
        show && 'right-0'
      )}
    >
      {/* Close button (mobile) */}
      <div className="top flex items-center justify-start p-3 w-full lg:hidden border-b border-editor-border">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Pages Section */}
      {canvas && pageInfo && (
        <div id="pages" className="overflow-y-auto max-h-[440px]">
          <div className="section-header flex items-center justify-between px-4 py-2">
            <h3 className="text-sm font-semibold text-editor-text">페이지</h3>
            <Button variant="ghost" size="icon" onClick={handleAddPage}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="items px-4 pb-2">
            {allCanvas.map((c, index) => (
              <div
                key={c.id || `page-${index}`}
                className={cn(
                  'page w-full flex flex-col items-center cursor-pointer relative mb-2',
                  c.id === canvas.id && 'selected'
                )}
                onClick={() => handleSetPage(index)}
              >
                <div className="page-drag-handle absolute top-1 left-1 cursor-move opacity-0 hover:opacity-100">
                  <DotsSixVertical className="h-4 w-4 text-editor-text-muted" />
                </div>
                <div
                  className={cn(
                    'screenshot-box w-full h-[120px] flex items-center justify-center',
                    'bg-white rounded-xl border-2 overflow-hidden relative',
                    c.id === canvas.id ? 'border-editor-accent/60' : 'border-editor-border/10'
                  )}
                >
                  {(pageInfo.min || 1) < allCanvas.length && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="delete-btn absolute top-1 right-1 opacity-0 hover:opacity-100 h-8 w-8"
                      onClick={(e) => handleDeletePage(e, c.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                  {screenshots[index] ? (
                    <img
                      src={screenshots[index]}
                      alt={`Page ${index + 1}`}
                      className="screenshot w-full h-full object-cover"
                    />
                  ) : (
                    <div className="screenshot w-full h-full bg-white" />
                  )}
                </div>
                <div className="name text-xs text-editor-text mt-1 truncate w-full text-center">
                  {(c as any).name || `Page ${index + 1}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <hr className="border-editor-border mx-4" />

      {/* Objects Section */}
      {canvas && (
        <div id="objects" className="flex-1 overflow-y-auto pb-4">
          <div className="section-header flex items-center justify-between px-4 py-2">
            <h3 className="text-sm font-semibold text-editor-text">객체</h3>
          </div>

          {objects.length === 0 ? (
            <div className="px-4 py-8 text-center text-editor-text-muted text-sm">
              객체가 없습니다.
            </div>
          ) : (
            <div className="items px-3">
              {objects.map((obj, index) => {
                const Icon = getIconByType(obj.type)
                return (
                  <div
                    key={obj.id}
                    draggable={dragEnabled && editingObject?.id !== obj.id}
                    onDragStart={dragEnabled ? handleObjDragStart(obj.id) : undefined}
                    onDragOver={dragEnabled ? handleObjDragOver(obj.id) : undefined}
                    onDragLeave={dragEnabled ? handleObjDragLeave(obj.id) : undefined}
                    onDrop={dragEnabled ? handleObjDrop(obj.id) : undefined}
                    onDragEnd={dragEnabled ? handleObjDragEnd : undefined}
                    className={cn(
                      'object-item w-full flex flex-row items-center gap-1 p-1 justify-between',
                      'rounded-lg mb-2 cursor-pointer border border-transparent',
                      'hover:bg-editor-hover group',
                      obj.selected && 'bg-editor-accent/10 border-editor-accent/10',
                      // S3: 드래그 중 source 흐리게 + 드롭 위치 힌트(위/아래 경계선)
                      dragSourceId === obj.id && 'opacity-40',
                      dragOver?.id === obj.id && dragOver.above && 'border-t-2 border-t-editor-accent',
                      dragOver?.id === obj.id && !dragOver.above && 'border-b-2 border-b-editor-accent'
                    )}
                    onClick={(e) => selectObject(obj.id, e)}
                    onDoubleClick={() => startEditing(obj)}
                  >
                    <div className="left flex flex-row gap-2 flex-1 items-center overflow-hidden">
                      <div className="drag-handle flex items-center cursor-move opacity-50">
                        <DotsSixVertical className="h-4 w-4 text-editor-text-muted" />
                      </div>
                      <Icon className="h-5 w-5 text-editor-text flex-shrink-0" />
                      <div className="flex-1 overflow-hidden">
                        {editingObject?.id === obj.id ? (
                          <input
                            ref={nameInputRef}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={finishEditing}
                            onKeyUp={(e) => {
                              if (e.key === 'Enter') finishEditing()
                              if (e.key === 'Escape') cancelEditing()
                            }}
                            className="object-name-input w-full text-xs bg-transparent border-none outline-none"
                          />
                        ) : (
                          <span className="name text-xs text-editor-text truncate block">
                            {obj.name}
                          </span>
                        )}
                      </div>
                      {/* B1: 속성 배지 — 잠김 종류 구분(고급잠금 레벨/위치고정/삭제·내용·프린트·순서) */}
                      <div className="badges flex items-center gap-0.5 shrink-0">
                        {obj.lockLevel && (
                          <span
                            title={`잠금 레벨: ${obj.lockLevel}`}
                            className="text-[9px] leading-none px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 font-semibold"
                          >
                            {obj.lockLevel}
                          </span>
                        )}
                        {obj.movable === false && (
                          <Pin className="h-3 w-3 text-amber-500" aria-label="위치 고정" />
                        )}
                        {obj.deleteable === false && (
                          <ShieldX className="h-3 w-3 text-amber-500" aria-label="삭제 잠금" />
                        )}
                        {obj.contentEditable === false && (
                          <PencilOff className="h-3 w-3 text-amber-500" aria-label="내용편집 잠금" />
                        )}
                        {obj.printExclude === true && (
                          <Printer className="h-3 w-3 text-amber-500" aria-label="프린트 제외" />
                        )}
                        {obj.lockLayerOrder === true && (
                          <ArrowUpDown className="h-3 w-3 text-amber-500" aria-label="순서 잠금" />
                        )}
                      </div>
                    </div>
                    {/* A1-3: 모바일(TOUCH_ENV) ↑↓ 순서변경 — hover 가 없는 터치 환경이라 상시 표시 */}
                    {TOUCH_ENV && obj.editable && (
                      <div className="mobile-reorder flex flex-col items-center shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-6"
                          disabled={index === 0 || obj.lockLayerOrder === true}
                          onClick={(e) => handleStepReorder(e, index, 'up')}
                          aria-label="앞으로 가져오기"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-6"
                          disabled={index === objects.length - 1 || obj.lockLayerOrder === true}
                          onClick={(e) => handleStepReorder(e, index, 'down')}
                          aria-label="뒤로 보내기"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="right w-16 h-[30px] relative shrink-0">
                      {obj.editable && (
                        /* A1-1: 4버튼(복제·삭제·잠금·표시)이 w-16 을 넘어 왼쪽으로 확장되므로
                           행 hover 배경과 같은 색을 깔아 이름/배지 위에 겹쳐도 읽히게 한다 */
                        <div className="actions absolute right-0 top-0 bottom-0 m-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-editor-hover rounded-lg">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="복제"
                            onClick={(e) => handleDuplicateObject(e, obj.id)}
                          >
                            <CopyIcon className="h-4 w-4" />
                          </Button>
                          {/* A1-1: 삭제잠금(deleteable===false)은 비-editMode 에서 disabled — B1 배지(ShieldX)와 일관 */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={!editMode && obj.deleteable === false ? '삭제 잠금된 객체입니다' : '삭제'}
                            disabled={!editMode && obj.deleteable === false}
                            onClick={(e) => handleDeleteObject(e, obj.id)}
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                          {obj.locked ? (
                            /* B0-②: 관리자 위치고정(movable===false)은 비-editMode 에서 해제 버튼 숨김 */
                            (editMode || obj.movable !== false) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => handleUnlock(e, obj.id)}
                              >
                                <LockSimple className="h-4 w-4" />
                              </Button>
                            )
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => handleLock(e, obj.id)}
                            >
                              <LockSimpleOpen className="h-4 w-4" />
                            </Button>
                          )}
                          {obj.visible ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => handleInvisible(e, obj.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => handleVisible(e, obj.id)}
                            >
                              <EyeSlash className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
