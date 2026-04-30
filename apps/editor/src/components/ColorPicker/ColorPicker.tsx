import { useState, useMemo, useCallback } from 'react'
import { Square } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import ColorPickerModal from './ColorPickerModal'
import { useColorMode } from '@/stores/useSettingsStore'
import { useRecentColorsStore } from '@/stores/useRecentColorsStore'

interface ColorPickerProps {
  value: string
  opacityValue?: number
  display?: string
  cmykValue?: { c: number; m: number; y: number; k: number } | null
  onUpdateValue: (value: string, event?: Event) => void
  onUpdateOpacityValue?: (value: number, event?: Event) => void
  onUpdateCmykValue?: (value: { c: number; m: number; y: number; k: number } | null) => void
}

export default function ColorPicker({
  value,
  opacityValue,
  display,
  cmykValue,
  onUpdateValue,
  onUpdateOpacityValue,
  onUpdateCmykValue,
}: ColorPickerProps) {
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorMode = useColorMode()

  // Determine input type based on color mode
  const inputType = useMemo(() => (colorMode === 'CMYK' ? 'CMYK' : 'HEX'), [colorMode])

  // Button color for preview
  const buttonColor = useMemo(() => {
    if (!value || value.toLowerCase?.() === 'mixed') {
      return '#888888'
    }
    return value
  }, [value])

  // Input text value
  const inputTextValue = useMemo(() => {
    if (value && value.toLowerCase?.() === 'mixed') return ''
    return value
  }, [value])

  // Handlers
  const handleUpdateValue = useCallback(
    (newValue: string) => {
      onUpdateValue(newValue)
    },
    [onUpdateValue]
  )

  const handleUpdateOpacity = useCallback(
    (newValue: number) => {
      onUpdateOpacityValue?.(newValue)
    },
    [onUpdateOpacityValue]
  )

  const handleUpdateCMYK = useCallback(
    (newValue: { c: number; m: number; y: number; k: number } | null) => {
      onUpdateCmykValue?.(newValue)
    },
    [onUpdateCmykValue]
  )

  const handleInputBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const target = e.target
      if (target?.value) {
        onUpdateValue(target.value)
        // Reset CMYK when color is changed via input
        onUpdateCmykValue?.(null)
      }
    },
    [onUpdateValue, onUpdateCmykValue]
  )

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLInputElement
        if (target?.value) {
          onUpdateValue(target.value)
          // Reset CMYK when color is changed via input
          onUpdateCmykValue?.(null)
        }
      }
    },
    [onUpdateValue, onUpdateCmykValue]
  )

  // 빠른 색상 팔레트 — 최근 사용 8개 (트랙 R)
  const recentColors = useRecentColorsStore((s) => s.recent).slice(0, 8)
  const pushRecentColor = useRecentColorsStore((s) => s.push)

  const applyQuickColor = useCallback(
    (hex: string) => {
      // hex → rgba (alpha는 현재 opacity 유지)
      const o = opacityValue ?? 100
      const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
      if (!m) return
      const r = parseInt(m[1], 16)
      const g = parseInt(m[2], 16)
      const b = parseInt(m[3], 16)
      onUpdateValue(`rgba(${r}, ${g}, ${b}, ${o / 100})`)
      onUpdateCmykValue?.(null)
      pushRecentColor(hex)
    },
    [onUpdateValue, onUpdateCmykValue, opacityValue, pushRecentColor]
  )

  return (
    <div className="w-full box-border">
      {/* 빠른 색상 swatch row — 최근 사용 0~8개 */}
      {recentColors.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 px-1">
          {recentColors.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => applyQuickColor(hex)}
              title={hex}
              aria-label={`최근 색상 ${hex}`}
              className="w-5 h-5 rounded border border-editor-border cursor-pointer transition-transform hover:scale-110"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      )}

      <div className="w-full h-10 box-border bg-editor-surface-lowest rounded relative">
      <div className="flex-1 h-full rounded border-0 w-full relative flex flex-row items-center justify-between px-3 gap-4">
        <Popover open={showColorPicker} onOpenChange={setShowColorPicker}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="flex-1 flex justify-center items-center">
              <Square className="h-5 w-5 rounded" style={{ fill: buttonColor, stroke: '#ececec', strokeWidth: 1 }} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-0 border-0"
            side="right"
            align="end"
            sideOffset={12}
          >
            {showColorPicker && (
              <ColorPickerModal
                initialValue={value}
                initialOpacity={opacityValue}
                inputType={inputType}
                initialCmyk={cmykValue}
                onUpdateValue={handleUpdateValue}
                onUpdateOpacity={handleUpdateOpacity}
                onUpdateCmyk={handleUpdateCMYK}
              />
            )}
          </PopoverContent>
        </Popover>

        <input
          type="text"
          value={inputTextValue}
          placeholder={display}
          onChange={() => {}}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          className="flex-[3] text-center w-full bg-transparent text-sm text-editor-text outline-none"
        />
      </div>
      </div>
    </div>
  )
}
