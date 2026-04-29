import { useCallback } from 'react'
import { v4 as uuid } from 'uuid'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import { FontPlugin, ptToPx } from '@storige/canvas-core'

// Default font family - will be loaded from fontManager when available
const DEFAULT_FONT_FAMILY = 'Noto Sans KR'

export default function AppText() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const isCustomer = useIsCustomer()
  const currentSettings = useSettingsStore((state) => state.currentSettings)

  // Convert 120pt to pixels based on current DPI
  const getDefaultFontSizeInPixels = useCallback(() => {
    const defaultFontSizeInPoints = 120
    const currentDPI = currentSettings.dpi || 150
    return ptToPx(defaultFontSizeInPoints, currentDPI)
  }, [currentSettings.dpi])

  const addText = useCallback(async () => {
    if (!canvas) return

    canvas.offHistory()

    // Find workspace
     
    const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
    if (!workspace) {
      alert('workspace를 등록해 주세요')
      return
    }

    // Calculate font size based on workspace (10% of shorter side)
    const workspaceWidth = (workspace.width || 0) * (workspace.scaleX || 1)
    const workspaceHeight = (workspace.height || 0) * (workspace.scaleY || 1)
    const baseLength = Math.min(workspaceWidth, workspaceHeight)
    const ratio = 0.1
    const initialFontSize = Math.max(12, Math.round(baseLength * ratio)) || getDefaultFontSizeInPixels()

    // Dynamic import fabric
     
    const fabricModule = await import('fabric') as any
    const fabric = fabricModule.fabric || fabricModule.default || fabricModule

    const text = new fabric.IText('TEXT', {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: initialFontSize,
      fill: '#000000',
      fillOpacity: 100,
      textAlign: 'center',
      id: uuid(),
      originX: 'center',
      originY: 'center',
      scaleX: 1,
      scaleY: 1,
      lockUniScaling: true,
      centeredScaling: false,
      lockScalingFlip: true,
      lockScalingX: false,
      lockScalingY: false,
      hasControls: true,
    })

    // Position at workspace center
    const center = workspace.getCenterPoint()
    text.set({
      originX: 'center',
      originY: 'center',
      left: center.x,
      top: center.y,
    })

    // Apply font via FontPlugin
    const fontPlugin = getPlugin<FontPlugin>('FontPlugin')
    if (fontPlugin) {
      try {
        console.log(`텍스트 생성 시 폰트 확인 및 적용: ${DEFAULT_FONT_FAMILY}`)
        await fontPlugin.applyFont(DEFAULT_FONT_FAMILY, text)
      } catch (error) {
        console.warn('텍스트 생성 시 폰트 적용 실패, 기본 폰트 사용:', error)
        text.set('fontFamily', 'Arial, sans-serif')
      }
    }

    canvas.onHistory()
    canvas.add(text)
    canvas.setActiveObject(text)
  }, [canvas, getPlugin, getDefaultFontSizeInPixels])

  const showMore = useCallback(() => {
    console.log('showMore')
  }, [])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="tool-header p-4 gap-6 flex flex-col">
        <span className="title text-editor-text font-medium">텍스트</span>
        <Button
          variant="secondary"
          className="w-full h-10"
          onClick={addText}
        >
          <Plus className="h-4 w-4 mr-2" />
          텍스트 추가
        </Button>
      </div>

      <hr className="border-editor-border" />

      <div className="sections flex flex-col overflow-y-auto">
        {isCustomer && (
          <AppSection title="추천 콘텐츠" onDetail={showMore}>
            <div className="px-4 py-8 text-center text-editor-text-muted text-sm">
              추천 콘텐츠가 없습니다.
            </div>
          </AppSection>
        )}

        <div className="h-10 w-1 p-10" />
      </div>
    </div>
  )
}
