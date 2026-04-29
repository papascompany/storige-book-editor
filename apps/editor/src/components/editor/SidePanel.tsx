import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore, useCurrentIndex } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { type CanvasObject, ObjectPlugin, SelectionType } from '@storige/canvas-core'
import { Image, Type as TextT, Hexagon, Frame as FrameCorners, QrCode, Layers as Stack, X, Trash2 as Trash, Lock as LockSimple, Unlock as LockSimpleOpen, Eye, EyeOff as EyeSlash, GripVertical as DotsSixVertical, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

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

  const pageInfo = useSettingsStore((state) => state.currentSettings.page)

  const [editingObject, setEditingObject] = useState<CanvasObject | null>(null)
  const [editName, setEditName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

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
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)

    if (object && objectPlugin) {
      objectPlugin.unlock(object)
      updateObjects()
    }
  }, [canvas, getPlugin, updateObjects])

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

  const selectObject = useCallback((objectId: string) => {
    const object = canvas?.getObjects().find((obj: any) => obj.id === objectId)
    if (object) {
      canvas?.setActiveObject(object)
      canvas?.renderAll()
    }
  }, [canvas])

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
              {objects.map((obj) => {
                const Icon = getIconByType(obj.type)
                return (
                  <div
                    key={obj.id}
                    className={cn(
                      'object-item w-full flex flex-row items-center gap-1 p-1 justify-between',
                      'rounded-lg mb-2 cursor-pointer border border-transparent',
                      'hover:bg-editor-hover group',
                      obj.selected && 'bg-editor-accent/10 border-editor-accent/10'
                    )}
                    onClick={() => selectObject(obj.id)}
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
                    </div>
                    <div className="right w-16 h-[30px] relative">
                      {obj.editable && (
                        <div className="actions absolute right-0 top-0 bottom-0 m-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {obj.locked ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => handleUnlock(e, obj.id)}
                            >
                              <LockSimple className="h-4 w-4" />
                            </Button>
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
