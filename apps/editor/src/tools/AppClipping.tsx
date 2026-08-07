import { useCallback, useState, useMemo, useEffect } from 'react'
import { Upload as UploadSimple, HelpCircle as Question } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore, checkMobileFileSize } from '@/stores/useImageStore'
import { showToast } from '@/stores/useToastStore'
import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { CUTOUT_SUBJECT_MODELS, type CutoutSubject } from '@/api/cutout'
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
  resetTrace,
  selectFiles,
  traceStep,
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

/** 배경제거 피사체 선택지 — 값은 서버 모델로 매핑된다(`CUTOUT_SUBJECT_MODELS`). */
const SUBJECT_OPTIONS: { value: CutoutSubject; label: string; hint: string }[] = [
  { value: 'person', label: '인물', hint: '사람 사진 — 인물 전용 모델로 몸통까지 정확하게 남깁니다' },
  { value: 'general', label: '일반', hint: '상품·캐릭터·반려동물 등 사람이 아닌 피사체' }
]

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
  // 배경제거 피사체 — 서버 모델을 가른다(인물 전용 모델은 사람에 압도적, 그 외에는 범용이 낫다).
  const cutoutSubject = useUiPrefStore((state) => state.cutoutSubject)
  const setCutoutSubject = useUiPrefStore((state) => state.setCutoutSubject)

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

  /**
   * 배경제거 대상 이미지를 고른다.
   *
   * `currentImage` 는 **모양컷 워크스페이스의 innerItem** 일 때만 채워진다(render/renderWorkspace).
   * 종전에는 이것이 없으면 그대로 return 해서, 모양컷을 거치지 않은 템플릿(BOOK 등)에서는
   * '효과' 클릭이 **아무 반응도 없었다**(2026-08-05 발견, 샤드3 동시 해소 항목).
   * → 활성 선택 이미지 → (모호하지 않은 경우) 캔버스의 단일 이미지 순으로 폴백한다.
   */
  const resolveTargetImage = useCallback((): fabric.Image | fabric.Group | null => {
    if (currentImage) return currentImage
    if (!canvas) return null

    const active = canvas.getActiveObject() as unknown as (fabric.Object & { type?: string }) | null
    if (active && active.type === 'image') return active as unknown as fabric.Image

    // 선택이 없어도 캔버스에 이미지가 하나뿐이면 대상이 모호하지 않다.
    const images = canvas.getObjects().filter(
      (obj: fabric.Object & { id?: string; type?: string }) =>
        obj.type === 'image' && obj.id !== 'workspace'
    )
    return images.length === 1 ? (images[0] as unknown as fabric.Image) : null
  }, [currentImage, canvas])

  /**
   * 모양컷 컨텍스트인지 — 워크스페이스 outline(id='workspace' + extensionType='clipping')이 있는가.
   *
   * ⚠️ `renderWorkspace` 는 `canvasInstance.clear()` 로 시작한다. 모양컷이 아닌 캔버스(BOOK 등)에서
   *    이것을 호출하면 **사용자 디자인이 통째로 지워진다.** 그래서 컨텍스트를 판별해,
   *    일반 캔버스에서는 결과를 원본 자리에 교체만 한다.
   */
  const isClippingWorkspace = useCallback((): boolean => {
    if (!canvas) return false
    return canvas.getObjects().some(
      (obj: fabric.Object & { id?: string; extensionType?: string }) =>
        obj.extensionType === 'clipping' && (obj.id === 'workspace' || obj.id === 'innerItem')
    )
  }, [canvas])

  // Handle segment image (background removal)
  // S-P2A-B 샤드3(2026-08-06): 추론이 서버(rembg)로 오프로드됐다 — 업로드·큐 대기·다운로드가
  // 수 초 걸리므로 진행 중 재클릭 방지(isLoading 가드)는 그대로 유지한다. 진행 표시는
  // useImageStore.segmentImage 가 longTask 이벤트로 발행하고 EditorView 오버레이가 소비한다.
  const handleSegmentImage = useCallback(async () => {
    if (!canvas || isLoading) return

    const target = resolveTargetImage()
    if (!target) {
      showToast('배경을 제거할 이미지를 먼저 선택해 주세요.', 'info')
      return
    }

    setIsLoading(true)
    try {
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      // Simple loading bar for segmentation
      const loadingBar = {
        start: () => setIsLoading(true),
        finish: () => setIsLoading(false)
      }
      // 이번 실행분만 남긴다 — 프리즈가 풀린 뒤 window.__storigeTrace 로 단계별 소요를 읽는다.
      resetTrace()
      const tSeg = performance.now()
      const image = await segmentImage(target, canvas, imagePlugin!, loadingBar, {
        model: CUTOUT_SUBJECT_MODELS[cutoutSubject]
      })
      traceStep('segmentImage(서버왕복+트림)', tSeg)

      if (image) {
        if (isClippingWorkspace()) {
          const tRender = performance.now()
          await renderWorkspace(image, canvas, cutSizeValue)
          traceStep('renderWorkspace(칼선)', tRender)
        } else {
          replaceOnCanvas(target, image, canvas)
        }
      }
    } catch (e) {
      console.error('배경 제거 오류:', e)
      // 서버 오프로드 경로의 실패(기능 비활성·타임아웃·용량)는 사용자에게 알린다 —
      // API 가 무인증 표면용으로 이미 안전한 문구만 내려준다.
      const message = e instanceof Error ? e.message : '배경 제거에 실패했습니다.'
      if (message !== '배경이 이미 제거된 이미지입니다') {
        showToast(message, 'error', 5000)
      }
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, isLoading, getPlugin, segmentImage, cutSizeValue, resolveTargetImage, isClippingWorkspace])

  /**
   * 일반 캔버스(모양컷 아님)에서 원본을 배경제거 결과로 **제자리 교체**한다.
   * 위치·회전은 원본을 따르고, 크기는 store 가 이미 화면 크기에 맞춰 보상해 둔 값을 쓴다.
   */
  const replaceOnCanvas = (
    original: fabric.Image | fabric.Group,
    next: fabric.Image,
    canvasInstance: fabric.Canvas
  ) => {
    const center = original.getCenterPoint()
    next.set({
      originX: 'center',
      originY: 'center',
      left: center.x,
      top: center.y,
      angle: original.angle ?? 0,
      // store 는 모양컷 전제로 비선택 상태를 만든다 — 일반 캔버스에서는 다시 다룰 수 있어야 한다.
      selectable: true,
      evented: true,
      hasControls: true
    })
    next.setCoords()
    canvasInstance.remove(original as unknown as fabric.Object)
    canvasInstance.add(next as unknown as fabric.Object)
    canvasInstance.setActiveObject(next as unknown as fabric.Object)
    canvasInstance.requestRenderAll()
  }

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

      // D-6b② (2026-08-05): 모양컷 업로드 가드 — 이 경로만 모바일 4MB 가드가 없어
      // 대용량 원본이 배경제거 파이프(추론 픽셀 캡 이전 단계)에 직행했다(Wave0 §3).
      if (!checkMobileFileSize(file)) return

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
      // ⚠️ requestRenderAll 만으로는 부족하다(2026-08-07 실적발). 예약은 requestAnimationFrame 이라
      //    직전 구간이 메인 스레드를 오래 잡았거나 탭이 비활성이면 프레임이 오지 않아, 객체·좌표·
      //    뷰포트가 전부 정상인데도 **캔버스가 빈 화면으로 남는다**(사용자에겐 '사진이 사라진' 것).
      //    실제로 renderAll() 을 한 번 강제하면 즉시 나타났다. 여기서는 즉시 그린다.
      canvasInstance.renderAll()

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
      <div className="px-4 pt-4 pb-3">
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
      <div className="sections flex flex-col overflow-y-auto">
        {/* Effects Section */}
        <AppSection title="효과">
          {/* 피사체 선택 — 인물이면 인물 전용 모델이 훨씬 정확하고, 그 외에는 범용이 낫다.
              선택은 localStorage 에 남아 다음 세션에도 유지된다(useUiPrefStore). */}
          <div className="px-4 pb-2">
            <div
              role="group"
              aria-label="배경제거 피사체"
              className="inline-flex w-full rounded-md border border-editor-border overflow-hidden"
            >
              {SUBJECT_OPTIONS.map((opt) => {
                const active = cutoutSubject === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    disabled={isLoading}
                    onClick={() => setCutoutSubject(opt.value)}
                    title={opt.hint}
                    className={`flex-1 h-8 text-sm transition-colors disabled:opacity-50 ${
                      active
                        ? 'bg-editor-accent text-white hover:bg-editor-accent-hover'
                        : 'bg-transparent text-editor-text hover:bg-editor-hover'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="items flex flex-row gap-2 px-4">
            <div className="item">
              <div
                className={`image-box relative transition-all ${
                  isLoading
                    ? 'pointer-events-none opacity-50'
                    : 'cursor-pointer hover:opacity-80'
                }`}
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
