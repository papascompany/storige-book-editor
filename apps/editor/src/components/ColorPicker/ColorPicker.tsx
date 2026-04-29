import { useState, useMemo, useCallback } from 'react'
import { Square } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import ColorPickerModal from './ColorPickerModal'
import { useColorMode } from '@/stores/useSettingsStore'

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

  return (
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
  )
}
