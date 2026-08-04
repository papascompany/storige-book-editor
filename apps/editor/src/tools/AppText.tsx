import { useCallback } from 'react'
import { v4 as uuid } from 'uuid'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import { FontPlugin, ptToPx } from '@storige/canvas-core'
import {
  TEXT_STYLE_PRESETS,
  CURVE_TEXT_PRESETS,
  type TextStylePresetDef,
  type CurveTextPresetDef,
} from '@/constants/textPresets'
import { insertStylePreset, insertCurvePreset } from '@/utils/insertTextPreset'

// Default font family - will be loaded from fontManager when available
const DEFAULT_FONT_FAMILY = 'Noto Sans KR'

/** 곡선 프리셋 미리보기 패스 (viewBox 0 0 48 28 기준) */
const CURVE_PRESET_ICON_PATH: Record<string, string> = {
  'arc-up': 'M 6 22 A 18 18 0 0 1 42 22',
  'arc-down': 'M 6 6 A 18 18 0 0 0 42 6',
  wave: 'M 4 14 Q 14 2 24 14 Q 34 26 44 14',
  circle: 'M 24 5 A 9 9 0 1 1 23.9 5',
}

export default function AppText() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const currentSettings = useSettingsStore((state) => state.currentSettings)
  const isCoarsePointer = useIsCoarsePointer()

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
    // renderOnAddRemove: false 인 캔버스에서 add 후 명시적 렌더링 필수.
    canvas.requestRenderAll()

    // 터치 디바이스에서는 객체 추가 직후 사이드바를 닫아 캔버스를 노출 — 추가된 객체를 즉시 만질 수 있게.
    if (isCoarsePointer) {
      tapMenu(null)
    }
  }, [canvas, getPlugin, getDefaultFontSizeInPixels, isCoarsePointer, tapMenu])

  // 프리셋 삽입 공통 마무리 — 터치 디바이스에서는 사이드바 닫아 캔버스 노출
  const afterInsert = useCallback((inserted: unknown) => {
    if (!inserted) {
      alert('workspace를 등록해 주세요')
      return
    }
    if (isCoarsePointer) {
      tapMenu(null)
    }
  }, [isCoarsePointer, tapMenu])

  const addStylePreset = useCallback(async (preset: TextStylePresetDef) => {
    if (!canvas) return
    const inserted = await insertStylePreset(preset, {
      canvas,
      fontPlugin: getPlugin<FontPlugin>('FontPlugin'),
      defaultFontFamily: DEFAULT_FONT_FAMILY,
      // 터치 디바이스는 삽입 직후 편집 진입 생략(사이드바 닫힘 + 가상 키보드 간섭)
      enterEditing: !isCoarsePointer,
    })
    afterInsert(inserted)
  }, [canvas, getPlugin, isCoarsePointer, afterInsert])

  const addCurvePreset = useCallback(async (preset: CurveTextPresetDef) => {
    if (!canvas) return
    const inserted = await insertCurvePreset(preset, {
      canvas,
      fontPlugin: getPlugin<FontPlugin>('FontPlugin'),
      defaultFontFamily: DEFAULT_FONT_FAMILY,
    })
    afterInsert(inserted)
  }, [canvas, getPlugin, afterInsert])

  return (
    <div className="w-full h-full flex flex-col">
      {/* Primary action — FeatureSidebar 헤더에 이미 라벨 있음, title 중복 제거 */}
      <div className="px-4 pt-4 pb-3">
        <Button
          variant="default"
          className="w-full h-10 rounded-md shadow-sm"
          onClick={addText}
        >
          <Plus className="h-4 w-4 mr-2" />
          텍스트 추가
        </Button>
      </div>

      <div className="sections flex flex-col">
        {/* S-E3 F5 — 스타일 프리셋 (구 '추천 콘텐츠' 빈 섹션을 프리셋 진입점으로 재사용) */}
        <AppSection id="app-text-style-presets" title="스타일">
          <div className="flex flex-col gap-1 px-4 pb-2">
            {TEXT_STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="w-full rounded-md border border-editor-border bg-editor-surface-lowest px-3 py-2 text-left text-editor-text hover:border-primary transition-colors"
                onClick={() => addStylePreset(preset)}
              >
                <span
                  className={
                    preset.id === 'title'
                      ? 'text-lg font-bold'
                      : preset.id === 'subtitle'
                        ? 'text-base'
                        : 'text-xs'
                  }
                >
                  {preset.label}
                </span>
              </button>
            ))}
          </div>
        </AppSection>

        {/* S-E3 F6 — 곡선 텍스트 프리셋 4종 (위 아치/아래 아치/웨이브/원형) */}
        <AppSection id="app-text-curve-presets" title="곡선 텍스트">
          <div className="grid grid-cols-2 gap-1 px-4 pb-2">
            {CURVE_TEXT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="flex flex-col items-center gap-1 rounded-md border border-editor-border bg-editor-surface-lowest px-2 py-2 text-editor-text hover:border-primary transition-colors"
                onClick={() => addCurvePreset(preset)}
              >
                <svg viewBox="0 0 48 28" className="h-7 w-12" aria-hidden="true">
                  <path
                    d={CURVE_PRESET_ICON_PATH[preset.id]}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-[11px] text-editor-text-muted">{preset.label}</span>
              </button>
            ))}
          </div>
        </AppSection>
      </div>
    </div>
  )
}
