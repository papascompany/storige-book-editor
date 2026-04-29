import { useCallback, useState, useMemo, useEffect } from 'react'
import { Upload as UploadSimple, HelpCircle as Question } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useSettingsStore, useSettingsSize, useSettingsUnit } from '@/stores/useSettingsStore'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import AppSection from '@/components/AppSection'
import {
  AccessoryPlugin,
  type ClippingAccessory,
  core,
  ImageProcessingPlugin,
  selectFiles,
  WorkspacePlugin
} from '@storige/canvas-core'
import removeBgImage from '@/assets/image/remove_bg.png'

// SVG data URIs for accessories
const gripUrl =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDMwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjE1MCIgY3k9IjE1MCIgcj0iMTQ1IiBmaWxsPSJ3aGl0ZSIgZmlsbC1vcGFjaXR5PSIwLjY2IiBzdHJva2U9IiNENEUyQzciIHN0cm9rZS13aWR0aD0iMTAiLz4KPC9zdmc+Cg=='
const ringUrl =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjYwIiBjeT0iNjAiIHI9IjU1IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEwIi8+CjxjaXJjbGUgY3g9IjYwIiBjeT0iNjAiIHI9IjIxIiBmaWxsPSJ3aGl0ZSIgc3Ryb2tlPSIjRDRFMkM3IiBzdHJva2Utd2lkdGg9IjEwIi8+Cjwvc3ZnPgo='
const standUrl =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDQwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjUiIHk9IjUiIHdpZHRoPSIzOTAiIGhlaWdodD0iMTkwIiBmaWxsPSJ3aGl0ZSIgc3Ryb2tlPSIjRDRFMkM3IiBzdHJva2Utd2lkdGg9IjEwIi8+Cjwvc3ZnPgo='

const accessories: ClippingAccessory[] = [
  {
    label: '키링',
    value: 'keyring',
    svg: ringUrl,
    position: 'topCenter',
    movingArea: 'outline',
    keyholePosition: 'outside',
    size: { width: 120, height: 120 }
  },
  {
    label: '스탠드',
    value: 'stand',
    svg: standUrl,
    position: 'bottomCenter',
    movingArea: 'bottomLine',
    size: { width: 400, height: 200 }
  },
  {
    label: '그립톡',
    value: 'grip',
    svg: gripUrl,
    position: 'center',
    movingArea: 'inner',
    size: { width: 300, height: 300 }
  }
]

export default function AppClipping() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const hideSidePanel = useAppStore((state) => state.hideSidePanel)
  const editor = useAppStore((state) => state.editor)

  const pxSize = useSettingsStore((state) => state.pxSize)
  const setSize = useSettingsSize()
  const unit = useSettingsUnit()
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  // These are not currently used but kept for future functionality
  // const showCutBorder = useShowCutBorder()
  // const showSafeBorder = useShowSafeBorder()

  const segmentImage = useImageStore((state) => state.segmentImage)

  const [currentImage, setCurrentImage] = useState<fabric.Group | fabric.Image | null>(null)
  const [selectedAccessory, setSelectedAccessory] = useState<ClippingAccessory | null>(null)
  const [cutSizeValue, setCutSizeValue] = useState(setSize?.cutSize ?? 0)
  const [isLoading, setIsLoading] = useState(false)

  // Sync cutSize with settings
  useEffect(() => {
    if (setSize?.cutSize !== undefined) {
      setCutSizeValue(setSize.cutSize)
    }
  }, [setSize?.cutSize])

  const selectedAccessoryOption = useMemo(() => {
    return selectedAccessory ? selectedAccessory.value : ''
  }, [selectedAccessory])

  // Handle segment image (background removal)
  const handleSegmentImage = useCallback(async () => {
    if (!currentImage || !canvas) return

    setIsLoading(true)
    try {
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      // Simple loading bar for segmentation
      const loadingBar = {
        start: () => setIsLoading(true),
        finish: () => setIsLoading(false)
      }
      const image = await segmentImage(currentImage, canvas, imagePlugin!, loadingBar)

      if (image) {
        await renderWorkspace(image, canvas, cutSizeValue)
      }
    } catch (e) {
      console.error('배경 제거 오류:', e)
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage, canvas, getPlugin, segmentImage, cutSizeValue])

  // Handle accessory selection
  const handleSetAccessory = useCallback((value: string) => {
    const accessory = accessories.find((item) => item.value === value) || null
    setSelectedAccessory(accessory)

    // Trigger workspace re-render
    if (currentImage && canvas) {
      renderWorkspace(currentImage, canvas, cutSizeValue)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage, canvas, cutSizeValue])

  // Handle cut size change
  const handleCutSizeChange = useCallback((value: number[]) => {
    const newValue = value[0]
    setCutSizeValue(newValue)

    // Update settings store
    if (setSize) {
      updateSettings({ size: { ...setSize, cutSize: newValue } })
    }

    // Re-render workspace with debounce
    if (currentImage && canvas) {
      renderWorkspace(currentImage, canvas, newValue)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage, canvas, setSize, updateSettings])

  // UploadSimple and set workspace
  const handleSetWorkspace = useCallback(async () => {
    if (!canvas) return

    canvas.offHistory()
    hideSidePanel()

    try {
      const files = await selectFiles({ accept: 'image/*', multiple: false })
      if (!files || files.length === 0) return

      const file = files[0]
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
       
      const fabricImage = await core.fileToImage(canvas, file, imagePlugin as any)

      if (!fabricImage) {
        console.error('이미지 로드 실패')
        return
      }

      setIsLoading(true)
      await render(fabricImage, canvas)
      canvas.onHistory()
    } catch (e) {
      console.error('업로드 오류:', e)
      canvas.onHistory()
    } finally {
      setIsLoading(false)
    }
  }, [canvas, hideSidePanel, getPlugin])

  // Render image to canvas
   
  const render = async (item: any, canvasInstance: fabric.Canvas) => {
    // Clear canvas
    canvasInstance.clipPath = undefined
    canvasInstance.clear()

    if (!item) {
      console.error('No item')
      return
    }

    await renderWorkspace(item, canvasInstance, cutSizeValue)
    setCurrentImage(item)
  }

  // Render workspace with outline and accessories
   
  const renderWorkspace = async (item: any, canvasInstance: fabric.Canvas, distance: number) => {
    try {
      if (!item) {
        console.error('No item')
        return
      }

      const pxDistance = pxSize(distance)
      const pxWidth = pxSize(setSize?.width ?? 0)
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      const workspacePlugin = getPlugin<WorkspacePlugin>('WorkspacePlugin')

      // Hide borders
      updateSettings({ showCutBorder: false, showSafeBorder: false })

      canvasInstance.clipPath = undefined
      canvasInstance.clear()
      canvasInstance.selection = false

      const itemScale = (pxWidth - pxDistance) / item.height!
      item.set({
        top: 0,
        left: 0,
        originX: 'center',
        originY: 'center',
        scaleX: itemScale,
        scaleY: itemScale,
        hasControls: false,
        evented: false,
        selectable: false,
        strokeWidth: 0
      })

      let hasAlpha = false
       
      let outline: any = null

      if ('getElement' in item) {
        const element = item.getElement()
         
        hasAlpha = imagePlugin!.tellHasAlpha(element as any)
      }

      const objectPath = await imagePlugin!.getObjectPath(item)
      if (!objectPath) return undefined

      objectPath.set({
        originX: 'center',
        originY: 'center',
        centeredRotation: true,
        fill: 'blue',
        left: 0,
        top: 0,
        strokeLineJoin: 'round',
        strokeLineCap: 'round',
        strokeWidth: pxDistance
      })
      objectPath.setCoords()

      if (hasAlpha) {
        const outerScale = (pxWidth - pxDistance) / objectPath.height!

        // core API를 사용하여 Path 생성
        const tempPathOutline = core.createPath(objectPath.path, {
          id: 'tempPathOutline',
          top: 0,
          left: 0,
          originX: 'center',
          originY: 'center',
          stroke: 'blue',
          fill: 'blue',
          strokeUniform: true,
          strokeWidth: pxDistance,
          scaleY: outerScale
        })

         
        const targetItem = await imagePlugin!.objAsImage(tempPathOutline as any, pxDistance)
         
        outline = await imagePlugin!.getObjectPath(targetItem as any)
      } else {
         
        outline = imagePlugin!.createExpandedPath(item as any, pxDistance)
      }

      if (!outline) {
        console.error('No outer path')
        return
      }

      outline.setOptions({
        id: 'workspace',
        top: 0,
        left: 0,
        originX: 'center',
        originY: 'center',
        fill: 'white',
        stroke: 'transparent',
        strokeWidth: 2,
        strokeUniform: true,
        editable: false,
        selectable: false,
        evented: false,
        extensionType: 'clipping'
      })
      outline.setCoords()

      item.setOptions({
        id: 'innerItem',
        top: 0,
        left: 0,
        originX: 'center',
        originY: 'center',
         
        clipPath: objectPath as any,
        selectable: false,
        editable: false,
        extensionType: 'clipping'
      })

       
      canvasInstance.add(outline as any)
       
      canvasInstance.add(item as any)

      if (!hasAlpha) {
        const modifiedScaleX = (item.width! * item.scaleX! + pxDistance) / outline.width!
        outline.set({ scaleX: modifiedScaleX })
      }

      outline.dirty = true
      outline.sendBackwards()
      outline.setCoords()
      item.setCoords()
      item.bringToFront()

      setCurrentImage(item)
      canvasInstance.renderAll()

      // Add accessory if selected
      if (selectedAccessory) {
        const accessoryPlugin = getPlugin<AccessoryPlugin>('AccessoryPlugin')
         
        const ac = await accessoryPlugin?.addAccessory(
          outline as any,
          item,
          objectPath as any,
          selectedAccessory,
          cutSizeValue
        )

        if (ac) {
          canvasInstance.add(ac)
           
          if ((ac as any).accessory?.movingArea !== 'inner') {
            await accessoryPlugin?.drawMergedWorkspace()
          } else {
            outline.set({ stroke: 'black', strokeWidth: 1 })
          }
        }
      } else {
        outline.set({ stroke: 'black', strokeWidth: 1 })
      }

      // Set zoom
      workspacePlugin?.setZoomAuto(0.7)
      canvasInstance.requestRenderAll()

      editor?.emit('sizeChange')
      canvasInstance.clearHistory()
    } catch (e) {
      console.error('워크스페이스 렌더링 오류:', e)
      throw e
    }
  }

  // Initialize on mount - check for existing accessory and innerItem
  useEffect(() => {
    if (!canvas) return

     
    const accessoryObj = canvas.getObjects().find((obj: any) =>
      obj.id === 'accessory' && obj.extensionType === 'clipping'
    )

     
    const innerItem = canvas.getObjects().find((obj: any) =>
      obj.id === 'innerItem' && obj.extensionType === 'clipping'
    )

    if (accessoryObj && (accessoryObj as { accessory?: ClippingAccessory }).accessory) {
      setSelectedAccessory((accessoryObj as { accessory: ClippingAccessory }).accessory)
    }

    if (innerItem) {
       
      setCurrentImage(innerItem as any)
    }
  }, [canvas])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="tool-header p-4 gap-6 flex flex-col">
        <span className="title text-editor-text font-medium">모양컷</span>
        <Button
          variant="secondary"
          className="w-full h-10"
          onClick={handleSetWorkspace}
          disabled={isLoading}
        >
          <UploadSimple className="h-4 w-4 mr-2" />
          {isLoading ? '처리 중...' : '업로드'}
        </Button>
      </div>

      <hr className="border-editor-border" />

      <div className="sections flex flex-col overflow-y-auto">
        {/* Effects Section */}
        <AppSection title="효과">
          <div className="items flex flex-row gap-2 px-4">
            <div className="item">
              <div
                className="image-box relative cursor-pointer transition-all hover:opacity-80"
                onClick={handleSegmentImage}
              >
                <img
                  alt="remove_bg"
                  src={removeBgImage}
                  className="w-full h-auto rounded-lg aspect-square"
                />
              </div>
            </div>
          </div>
        </AppSection>

        {/* Accessories Section */}
        <AppSection title="악세사리">
          <div className="items flex flex-row px-4">
            <Select
              value={selectedAccessoryOption}
              onValueChange={handleSetAccessory}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="테스트 악세사리를 선택해주세요" />
              </SelectTrigger>
              <SelectContent>
                {accessories.map((accessory) => (
                  <SelectItem key={accessory.value} value={accessory.value}>
                    {accessory.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </AppSection>

        {/* Settings Section */}
        <AppSection title="설정">
          <div className="items flex flex-col gap-2 px-4">
            <div className="top flex flex-row justify-start items-center w-full gap-2">
              <label className="text-sm text-editor-text">외곽여백</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-5 w-5">
                    <Question className="h-4 w-4 text-editor-text-muted" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="right" className="text-sm">
                  칼선과의 거리를 조절할 수 있습니다.
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-4">
              <Slider
                value={[cutSizeValue]}
                onValueChange={handleCutSizeChange}
                disabled={!currentImage}
                max={50}
                min={0}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-editor-text min-w-[40px] text-right">
                {cutSizeValue}{unit}
              </span>
            </div>
          </div>
        </AppSection>

        <div className="h-10 w-1 p-10" />
      </div>
    </div>
  )
}
