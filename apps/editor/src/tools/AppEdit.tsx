import { useCallback, useState, useEffect, useRef } from 'react'
import { Crop, Trash2 as Trash } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useRenderType } from '@/stores/useSettingsStore'
import { Button } from '@/components/ui/button'
import {
  core,
  ImageProcessingPlugin,
  selectFiles,
  SelectionType
} from '@storige/canvas-core'

export default function AppEdit() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)

  const renderType = useRenderType()
  const upload = useImageStore((state) => state.upload)

  const [hasPageOutline, setHasPageOutline] = useState(false)
  const eventCleanupFnsRef = useRef<Array<() => void>>([])

  // Register event listener
   
  const registerEvent = useCallback((target: any, eventName: string, handler: (...args: any[]) => void) => {
    target.on(eventName, handler)
    eventCleanupFnsRef.current.push(() => target.off(eventName, handler))
  }, [])

  // Cleanup event listeners
  const cleanupEventListeners = useCallback(() => {
    eventCleanupFnsRef.current.forEach((cleanup) => cleanup())
    eventCleanupFnsRef.current = []
  }, [])

  // Update outline status
  const updateOutlineStatus = useCallback(() => {
    if (!canvas) {
      setHasPageOutline(false)
      return
    }
     
    const outline = canvas.getObjects().find((obj: any) => obj.id === 'page-outline')
    setHasPageOutline(!!outline)
  }, [canvas])

  // Watch canvas changes
  useEffect(() => {
    cleanupEventListeners()

    if (canvas) {
      registerEvent(canvas, 'object:added', updateOutlineStatus)
      registerEvent(canvas, 'object:removed', updateOutlineStatus)
      updateOutlineStatus()
    } else {
      setHasPageOutline(false)
    }

    return () => {
      cleanupEventListeners()
    }
  }, [canvas, registerEvent, cleanupEventListeners, updateOutlineStatus])

  // Upload mockup image
  const uploadMockup = useCallback(async () => {
    if (!ready || !canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

    const item = await upload(
      canvas,
      imagePlugin!,
      SelectionType.image,
      'image/*'
    )

    if (!item || !canvas) return

    // Remove existing mockup
     
    const prev = canvas.getObjects().find((o: any) => o.id === 'template-mockup')
    if (prev) {
      canvas.remove(prev)
    }

    // Set mockup properties
     
    ;(item as any).set({
      id: 'template-mockup',
      name: 'template-mockup',
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      scaleX: 1,
      scaleY: 1,
      evented: false,
      selectable: false,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      hoverCursor: 'default',
      alwaysTop: true,
      extensionType: 'template-element'
    })

     
    ;(item as any).setCoords()
    canvas.bringToFront(item)
    canvas.requestRenderAll()

    // Create foreground outline
    try {
      // Clone image
       
      const cloned: fabric.Image = await new Promise((resolve) =>
         
        (item as any).clone((c: fabric.Image) => resolve(c))
      )

      // Get foreground image
       
      const img = await imagePlugin!.getForegroundByAlpha(cloned as any)

       
      ;(img as any).set({
        originX: 'center',
        originY: 'center',
        left: 0,
        top: 0,
        extensionType: 'template-element'
      })

      const objectPath = await imagePlugin!.createPrecisePathFromObject(
         
        img as any,
        {
          insetPx: 2,
          threshold: 225,
        }
      )

      if (objectPath) {
         
        (objectPath as any).set({
          id: `${(item as any).id}_objectPath`,
          fill: 'white',
          strokeUniform: true,
          absolutePositioned: true,
          originX: 'center',
          originY: 'center',
          left: 0,
          top: 0,
          extensionType: 'template-element'
        })

        // core API를 사용하여 Point 생성
        objectPath.setPositionByOrigin(core.createPoint(0, 0), 'center', 'center')
         
        canvas.clipPath = objectPath as any
        canvas.requestRenderAll()
      }
    } catch (e) {
      console.error('목업 외곽선 생성 실패:', e)
    }
  }, [ready, canvas, getPlugin, upload])

  // Draw page outline
  const drawOutline = useCallback(async () => {
    if (!ready || !canvas) return

    // Remove existing outline
     
    const existingOutline = canvas.getObjects().find((obj: any) => obj.id === 'page-outline')
    if (existingOutline) {
      canvas.remove(existingOutline)
    }

    // Find workspace
     
    const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
    if (!workspace) return

    // Calculate workspace dimensions
    const workspaceWidth = workspace.width! * workspace.scaleX!
    const workspaceHeight = workspace.height! * workspace.scaleY!

    const halfWidth = workspaceWidth / 2
    const halfHeight = workspaceHeight / 2

    // Create rect path data
    const pathData = [
      ['M', -halfWidth, -halfHeight],
      ['L', halfWidth, -halfHeight],
      ['L', halfWidth, halfHeight],
      ['L', -halfWidth, halfHeight],
      ['Z']
    ]

    // core API를 사용하여 Path 생성
     
    const outlinePath = core.createPath(pathData as any, {
      id: 'page-outline',
      originX: 'center',
      originY: 'center',
      name: 'page-outline',
      left: 0,
      top: 0,
      fill: 'transparent',
      stroke: '#ff6b6b',
      strokeWidth: 4,
      strokeDashArray: [8, 8],
      opacity: 1,
      selectable: true,
      evented: true,
      hasControls: true,
      lockMovementX: false,
      lockMovementY: false,
      excludeFromExport: false,
      extensionType: 'template-element',
      strokeUniform: true,
      alwaysTop: true,
      absolutePositioned: true,
      editable: true
    })

    if (renderType === 'noBounded') {
      outlinePath.set({
        editable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true
      })
    }

    // Clear fillImage from objects
    const allObjects = canvas.getObjects()
     
    const filledObjects = allObjects.filter((obj: any) => obj.extensionType === 'fillImage')
     
    filledObjects.forEach((obj: any) => {
      obj.fillImage = null
      obj.extensionType = null
    })

    canvas.add(outlinePath)
    canvas.renderAll()
  }, [ready, canvas, renderType])

  // Remove page outline
  const removeOutline = useCallback(() => {
    if (!ready || !canvas) return

     
    const existingOutline = canvas.getObjects().find((obj: any) => obj.id === 'page-outline')
    if (existingOutline) {
      canvas.remove(existingOutline)
    }

    canvas.renderAll()
  }, [ready, canvas])

  // Upload template background
  const uploadTemplateBackground = useCallback(async () => {
    if (!ready || !canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

     
    const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
    if (!workspace) {
      alert('workspace를 등록해 주세요')
      return
    }

    const files = await selectFiles({
      accept: 'image/*',
      multiple: false
    })

    if (!files || files.length === 0) return

    const file = files[0]
     
    const item = await core.fileToImage(canvas, file, imagePlugin as any)

    if (!item || !canvas) return

    // Remove existing template-background
     
    const prev = canvas.getObjects().find((o: any) => o.id === 'template-background')
    if (prev) {
      canvas.remove(prev)
    }

    canvas.clipPath = null

     
    ;(item as any).set({
      id: 'template-background',
      name: 'template-background',
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      hoverCursor: 'default',
      absolutePositioned: true,
      preventAutoResize: true,
      extensionType: 'template-element'
    })

    const workspaceWidth = workspace.width! * workspace.scaleX!
    const workspaceHeight = workspace.height! * workspace.scaleY!

    // Scale to fit workspace
    const maxWidth = workspaceWidth * 1.2
    const maxHeight = workspaceHeight * 1.2

     
    const scaleX = maxWidth / (item as any).width!
     
    const scaleY = maxHeight / (item as any).height!
    const scale = Math.max(scaleX, scaleY)
     
    ;(item as any).scale(scale)

    canvas.clipPath = null
    canvas.add(item)

     
    ;(item as any).setCoords()
     
    ;(canvas as any).fire('object:modified', { target: item })

    canvas.requestRenderAll()
  }, [ready, canvas, getPlugin])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="flex flex-col gap-2">
          {renderType !== 'mockup' ? (
            <Button
              variant="default"
              className="w-full h-10"
              onClick={uploadTemplateBackground}
              disabled={!ready}
            >
              <Crop className="h-4 w-4 mr-2" />
              작업배경 업로드
            </Button>
          ) : (
            <Button
              variant="default"
              className="w-full h-10"
              onClick={uploadMockup}
              disabled={!ready}
            >
              <Crop className="h-4 w-4 mr-2" />
              목업 업로드
            </Button>
          )}

          {renderType !== 'mockup' && (
            <Button
              variant="secondary"
              className="w-full h-10"
              onClick={drawOutline}
              disabled={!ready}
            >
              <Crop className="h-4 w-4 mr-2" />
              외곽선 추가
            </Button>
          )}

          {hasPageOutline && (
            <Button
              variant="secondary"
              className="w-full h-10"
              onClick={removeOutline}
              disabled={!ready || !hasPageOutline}
            >
              <Trash className="h-4 w-4 mr-2" />
              외곽선 제거
            </Button>
          )}
        </div>
      </div>
      <div className="sections flex flex-col overflow-y-auto">
        <div className="h-10 w-1 p-10" />
      </div>
    </div>
  )
}
