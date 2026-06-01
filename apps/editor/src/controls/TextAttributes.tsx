import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import AppSection from '@/components/AppSection'
import ControlInput from '@/components/ControlInput'
import FontPreviewDropdown from '@/components/FontPreviewDropdown'
import { Button } from '@/components/ui/button'
import {
  Bold as TextB,
  Italic as TextItalic,
  Underline as TextUnderline,
  AlignLeft as TextAlignLeft,
  AlignCenter as TextAlignCenter,
  AlignRight as TextAlignRight,
  CaseSensitive as TextAa,
  MoveVertical as ArrowsVertical,
  MoveHorizontal as ArrowsHorizontal,
  ChevronDown,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { FontPlugin, ptToPx, pxToPt } from '@storige/canvas-core'
import { getFontListAsSource, findFontByName, type FontSource } from '@/utils/fontManager'

// 글자 크기 프리셋 (pt) — 선택 드롭다운용
const PRESET_FONT_SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96]

// Fabric.js IText 타입 정의 (런타임에 로드됨)
 
type FabricIText = any

export default function TextAttributes() {
  const [expanded, setExpanded] = useState(true)
  const [selectionTick, setSelectionTick] = useState(0)
  const activeSelection = useActiveSelection()
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const currentSettings = useSettingsStore((state) => state.currentSettings)

  // Reference to bound object for cleanup
  const boundObjectRef = useRef<FabricIText | null>(null)

  // Bump selection tick to trigger re-computation
  const bumpSelectionTick = useCallback(() => {
    setSelectionTick((prev) => prev + 1)
  }, [])

  // Bind selection events
  useEffect(() => {
    const obj = activeSelection?.[0]

    // Cleanup previous binding
    if (boundObjectRef.current) {
      boundObjectRef.current.off('selection:changed', bumpSelectionTick)
      boundObjectRef.current.off('changed', bumpSelectionTick)
      boundObjectRef.current.off('editing:entered', bumpSelectionTick)
      boundObjectRef.current.off('editing:exited', bumpSelectionTick)
      boundObjectRef.current = null
    }

    // Bind new object
    if (obj && obj.type === 'i-text') {
      const it = obj as FabricIText
      it.on('selection:changed', bumpSelectionTick)
      it.on('changed', bumpSelectionTick)
      it.on('editing:entered', bumpSelectionTick)
      it.on('editing:exited', bumpSelectionTick)
      boundObjectRef.current = it
    }

    bumpSelectionTick()

    return () => {
      if (boundObjectRef.current) {
        boundObjectRef.current.off('selection:changed', bumpSelectionTick)
        boundObjectRef.current.off('changed', bumpSelectionTick)
        boundObjectRef.current.off('editing:entered', bumpSelectionTick)
        boundObjectRef.current.off('editing:exited', bumpSelectionTick)
      }
    }
  }, [activeSelection, bumpSelectionTick])

  // Helper to collect range values
  const collectRangeValues = useCallback(
    <T,>(obj: FabricIText, prop: keyof FabricIText, start?: number, end?: number): Set<T> => {
      const values = new Set<T>()
      const textLen = obj.text?.length ?? 0
      const s = Math.max(0, start ?? 0)
      const e = Math.min(textLen, end ?? textLen)
      const arr = obj.getSelectionStyles(s, e) as Array<Record<string, unknown>>
      const text = obj.text || ''

      const explicitValues = new Set<T>()
      for (let i = 0; i < e - s; i++) {
        if (text[s + i] === '\n') continue
        const style = arr[i] || {}
        if (Object.prototype.hasOwnProperty.call(style, prop)) {
          explicitValues.add(style[prop as string] as T)
        }
      }

      if (explicitValues.size > 0) {
        return explicitValues
      }

       
      const objValue = (obj as any)[prop]
      if (objValue !== undefined) {
        values.add(objValue as T)
      }

      return values
    },
    []
  )

  // Helper to compute current value
  const computeCurrentValue = useCallback(
    <T,>(obj: FabricIText, prop: keyof FabricIText): { mixed: boolean; value: T } => {
      const hasRange = obj.selectionStart !== obj.selectionEnd
      const start = hasRange ? obj.selectionStart ?? 0 : 0
      const end = hasRange ? obj.selectionEnd ?? 0 : (obj.text?.length ?? 0)
      const values = collectRangeValues<T>(obj, prop, start, end)
      if (values.size > 1) {
        return { mixed: true, value: 'mixed' as unknown as T }
      }
      const [only] = Array.from(values)
      return { mixed: false, value: only }
    },
    [collectRangeValues]
  )

  // Current font
  const currentFont = useMemo(() => {
    void selectionTick // dependency
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return undefined
    const { mixed, value } = computeCurrentValue<string>(obj, 'fontFamily')
    if (mixed) return 'mixed'
    if (!value) return undefined
    const matchedFont = findFontByName(value)
    return matchedFont?.name || value
  }, [activeSelection, selectionTick, computeCurrentValue])

  // Current font size
  const currentFontSize = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return 0
    const { mixed, value } = computeCurrentValue<number>(obj, 'fontSize')
    const currentDPI = currentSettings.dpi || 150
    const scale = obj.scaleX || 1
    const scaledValue = value * scale
    return mixed ? 'mixed' : Math.round(pxToPt(scaledValue, currentDPI) * 10) / 10 || 0
  }, [activeSelection, selectionTick, computeCurrentValue, currentSettings.dpi])

  const isFontSizeMixed = currentFontSize === 'mixed'

  // TextB selected
  const isBoldSelected = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return false
    const { mixed, value } = computeCurrentValue<string>(obj, 'fontWeight')
    return !mixed && value === 'bold'
  }, [activeSelection, selectionTick, computeCurrentValue])

  // TextUnderline selected
  const isUnderlineSelected = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return false
    const { mixed, value } = computeCurrentValue<boolean>(obj, 'underline')
    return !mixed && value === true
  }, [activeSelection, selectionTick, computeCurrentValue])

  // Italic selected (fontStyle)
  const isItalicSelected = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return false
    const { mixed, value } = computeCurrentValue<string>(obj, 'fontStyle')
    return !mixed && value === 'italic'
  }, [activeSelection, selectionTick, computeCurrentValue])

  // Line height
  const currentLineHeight = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return 0
    const { mixed, value } = computeCurrentValue<number>(obj, 'lineHeight')
    return mixed ? 'mixed' : value || 0
  }, [activeSelection, selectionTick, computeCurrentValue])

  const isLineHeightMixed = currentLineHeight === 'mixed'

  // Char spacing
  const currentCharSpacing = useMemo(() => {
    void selectionTick
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return 0
    const { mixed, value } = computeCurrentValue<number>(obj, 'charSpacing')
    return mixed ? 'mixed' : value || 0
  }, [activeSelection, selectionTick, computeCurrentValue])

  const isCharSpacingMixed = currentCharSpacing === 'mixed'

  // Current text align
  const currentTextAlign = useMemo(() => {
    const obj = activeSelection?.[0] as FabricIText | undefined
    return obj?.textAlign || 'left'
  }, [activeSelection])

  // Font selection handler
  const handleFontSelect = useCallback(
    async (font: FontSource) => {
      const obj = activeSelection?.[0] as FabricIText | undefined
      if (!obj) return

      const fontName = font.name

      try {
        const fontPlugin = getPlugin<FontPlugin>('FontPlugin')
        if (fontPlugin) {
          await fontPlugin.ensureFontLoaded(fontName)
        }

        const matched = findFontByName(fontName)
        const applyName = matched?.name || fontName

        const hasRange = obj.selectionStart !== obj.selectionEnd
        if (hasRange) {
          obj.setSelectionStyles({ fontFamily: applyName })
        } else {
          const total = obj.text?.length ?? 0
          if (total > 0) {
            obj.setSelectionStyles({ fontFamily: applyName }, 0, total)
          }
          obj.set('fontFamily', applyName)
        }

        await new Promise((resolve) => requestAnimationFrame(resolve))
        await new Promise((resolve) => requestAnimationFrame(resolve))

        obj.initDimensions()
        obj.dirty = true
        obj.setCoords()
        canvas?.requestRenderAll()
        bumpSelectionTick()
      } catch (error) {
        console.error('Failed to apply font:', fontName, error)
      }
    },
    [activeSelection, canvas, getPlugin, bumpSelectionTick]
  )

  // TextB toggle
  const handleBold = useCallback(() => {
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return

    const hasRange = obj.selectionStart !== obj.selectionEnd
    if (hasRange) {
      const styles = obj.getSelectionStyles() as Array<Record<string, unknown>>
      const allBold = styles.length > 0 && styles.every((s) => s.fontWeight === 'bold')
      obj.setSelectionStyles({ fontWeight: allBold ? 'normal' : 'bold' })
    } else {
      const { mixed, value } = computeCurrentValue<string>(obj, 'fontWeight')
      const toBold = !(value === 'bold' && !mixed)
      const total = obj.text?.length ?? 0
      if (total > 0) {
        obj.setSelectionStyles({ fontWeight: toBold ? 'bold' : 'normal' }, 0, total)
      }
      obj.fontWeight = toBold ? 'bold' : 'normal'
    }

    obj.dirty = true
    canvas?.renderAll()
    bumpSelectionTick()
  }, [activeSelection, canvas, computeCurrentValue, bumpSelectionTick])

  // TextUnderline toggle
  const handleUnderline = useCallback(() => {
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return

    const hasRange = obj.selectionStart !== obj.selectionEnd
    if (hasRange) {
      const styles = obj.getSelectionStyles() as Array<Record<string, unknown>>
      const allOn = styles.length > 0 && styles.every((s) => s.underline === true)
      obj.setSelectionStyles({ underline: !allOn })
    } else {
      const { mixed, value } = computeCurrentValue<boolean>(obj, 'underline')
      const toOn = !(value === true && !mixed)
      const total = obj.text?.length ?? 0
      if (total > 0) {
        obj.setSelectionStyles({ underline: toOn }, 0, total)
      }
      obj.underline = toOn
    }

    obj.dirty = true
    canvas?.renderAll()
    bumpSelectionTick()
  }, [activeSelection, canvas, computeCurrentValue, bumpSelectionTick])

  // Italic toggle (fontStyle)
  const handleItalic = useCallback(() => {
    const obj = activeSelection?.[0] as FabricIText | undefined
    if (!obj) return

    const hasRange = obj.selectionStart !== obj.selectionEnd
    if (hasRange) {
      const styles = obj.getSelectionStyles() as Array<Record<string, unknown>>
      const allItalic = styles.length > 0 && styles.every((s) => s.fontStyle === 'italic')
      obj.setSelectionStyles({ fontStyle: allItalic ? 'normal' : 'italic' })
    } else {
      const { mixed, value } = computeCurrentValue<string>(obj, 'fontStyle')
      const toItalic = !(value === 'italic' && !mixed)
      const total = obj.text?.length ?? 0
      if (total > 0) {
        obj.setSelectionStyles({ fontStyle: toItalic ? 'italic' : 'normal' }, 0, total)
      }
      obj.fontStyle = toItalic ? 'italic' : 'normal'
    }

    obj.dirty = true
    canvas?.renderAll()
    bumpSelectionTick()
  }, [activeSelection, canvas, computeCurrentValue, bumpSelectionTick])

  // Text align
  const handleAlign = useCallback(
    (type: 'left' | 'center' | 'right') => {
      const obj = activeSelection?.[0] as FabricIText | undefined
      if (!obj) return

      const newOriginX = type
      const refPoint = obj.getPointByOrigin(newOriginX, (obj.originY as string) || 'center')

      obj.textAlign = type
      obj.set({ originX: newOriginX })
      obj.setPositionByOrigin(refPoint, newOriginX, (obj.originY as string) || 'center')
      obj.setCoords()

      obj.dirty = true
      canvas?.renderAll()
      bumpSelectionTick()
    },
    [activeSelection, canvas, bumpSelectionTick]
  )

  // Font size 적용 (pt 값) — 입력과 프리셋 선택이 공유
  const applyFontSizePt = useCallback(
    (num: number) => {
      const obj = activeSelection?.[0] as FabricIText | undefined
      if (!obj) return
      if (!isFinite(num) || num <= 0) return

      const currentDPI = currentSettings.dpi || 150
      const numInPixels = ptToPx(num, currentDPI)
      const scale = obj.scaleX || 1
      const adjustedFontSize = numInPixels / scale

      const hasRange = obj.selectionStart !== obj.selectionEnd
      if (hasRange) {
        obj.setSelectionStyles({ fontSize: adjustedFontSize })
      } else {
        const total = obj.text?.length ?? 0
        if (total > 0) {
          obj.setSelectionStyles({ fontSize: adjustedFontSize }, 0, total)
        }
        obj.set('fontSize', adjustedFontSize)
        obj.setCoords()
      }
      obj.dirty = true
      canvas?.renderAll()
      bumpSelectionTick()
    },
    [activeSelection, canvas, currentSettings.dpi, bumpSelectionTick]
  )

  // Font size change (입력 필드)
  const handleFontSizeChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      applyFontSizePt(Number(target?.value))
    },
    [applyFontSizePt]
  )

  // Line height change
  const handleLineHeightChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const obj = activeSelection?.[0] as FabricIText | undefined
      if (!obj) return

      const target = e.target as HTMLInputElement
      const num = Number(target?.value)
      if (!isFinite(num) || num <= 0) return

      obj.set('lineHeight', num)
      obj.setCoords()
      obj.dirty = true
      canvas?.renderAll()
      bumpSelectionTick()
    },
    [activeSelection, canvas, bumpSelectionTick]
  )

  // Char spacing change
  const handleCharSpacingChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const obj = activeSelection?.[0] as FabricIText | undefined
      if (!obj) return

      const target = e.target as HTMLInputElement
      const num = Number(target?.value)
      if (!isFinite(num)) return

      obj.set('charSpacing', num)
      obj.setCoords()
      obj.dirty = true
      canvas?.renderAll()
      bumpSelectionTick()
    },
    [activeSelection, canvas, bumpSelectionTick]
  )

  // Don't render if no selection
  if (!activeSelection || activeSelection.length === 0) {
    return null
  }

  return (
    <AppSection
      id="text-attributes-control"
      title="속성"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
    >
      {expanded && (
        <div className="grid grid-cols-2 gap-2 px-4">
          {/* Font selector */}
          <div className="col-span-2">
            <FontPreviewDropdown
              value={currentFont === 'mixed' ? undefined : currentFont}
              options={getFontListAsSource()}
              placeholder={currentFont === 'mixed' ? '혼합' : '폰트 선택'}
              onSelect={handleFontSelect}
            />
          </div>

          {/* Font size — 직접 입력 + 프리셋 선택(pt) */}
          <div className="flex items-center gap-1" title="글자 크기 (pt)">
            <ControlInput
              value={typeof currentFontSize === 'number' ? currentFontSize : 0}
              display={isFontSizeMixed ? 'mixed' : undefined}
              onChange={handleFontSizeChange}
              type="number"
              min={1}
              step={1}
              className="flex-1"
            >
              <TextAa className="h-5 w-5" />
            </ControlInput>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-6 shrink-0 bg-editor-surface-lowest rounded"
                  title="크기 선택"
                  aria-label="글자 크기 선택"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 min-w-[4.5rem] overflow-y-auto">
                {PRESET_FONT_SIZES.map((sz) => (
                  <DropdownMenuItem
                    key={sz}
                    onSelect={() => applyFontSizePt(sz)}
                    className="justify-between text-sm"
                  >
                    <span>{sz}</span>
                    <span className="text-editor-text-muted text-xs">pt</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 굵게 / 기울임 / 밑줄 — 아이콘 자체가 스타일을 직관적으로 표현 */}
          <div className="flex items-center h-10 bg-editor-surface-lowest rounded overflow-hidden">
            <Button
              variant="ghost"
              size="icon"
              title="굵게"
              aria-label="굵게"
              aria-pressed={isBoldSelected}
              className={`flex-1 h-full rounded-none border-r border-editor-border ${isBoldSelected ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={handleBold}
            >
              <TextB className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="기울임 (이탤릭)"
              aria-label="기울임"
              aria-pressed={isItalicSelected}
              className={`flex-1 h-full rounded-none border-r border-editor-border ${isItalicSelected ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={handleItalic}
            >
              <TextItalic className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="밑줄"
              aria-label="밑줄"
              aria-pressed={isUnderlineSelected}
              className={`flex-1 h-full rounded-none ${isUnderlineSelected ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={handleUnderline}
            >
              <TextUnderline className="h-5 w-5" />
            </Button>
          </div>

          {/* Line height */}
          <ControlInput
            value={typeof currentLineHeight === 'number' ? currentLineHeight : 0}
            display={isLineHeightMixed ? 'mixed' : undefined}
            onChange={handleLineHeightChange}
            type="number"
            min={0.1}
            step={0.1}
          >
            <ArrowsVertical className="h-4 w-4" />
          </ControlInput>

          {/* Char spacing */}
          <ControlInput
            value={typeof currentCharSpacing === 'number' ? currentCharSpacing : 0}
            display={isCharSpacingMixed ? 'mixed' : undefined}
            onChange={handleCharSpacingChange}
            type="number"
            step={10}
          >
            <ArrowsHorizontal className="h-4 w-4" />
          </ControlInput>

          {/* Text align */}
          <div className="flex items-center h-10 bg-editor-surface-lowest rounded overflow-hidden">
            <Button
              variant="ghost"
              size="icon"
              className={`flex-1 h-full rounded-none border-r border-editor-border ${currentTextAlign === 'left' ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={() => handleAlign('left')}
            >
              <TextAlignLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`flex-1 h-full rounded-none border-r border-editor-border ${currentTextAlign === 'center' ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={() => handleAlign('center')}
            >
              <TextAlignCenter className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`flex-1 h-full rounded-none ${currentTextAlign === 'right' ? 'bg-editor-surface-high text-primary' : ''}`}
              onClick={() => handleAlign('right')}
            >
              <TextAlignRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1" />
        </div>
      )}
    </AppSection>
  )
}
