import { useCallback, useState, useMemo, useRef, useEffect } from 'react'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import ControlInput from '@/components/ControlInput'
import { Button } from '@/components/ui/button'
import { parseColorValue, rgbaToHex8 } from '@storige/canvas-core'
import { MoveHorizontal as ArrowsHorizontal, MoveVertical as ArrowsVertical, Circle as RadioButton } from 'lucide-react'

// Debounce helper
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

export default function ObjectShadow() {
  const [expanded, setExpanded] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const activeSelection = useActiveSelection()
  const canvas = useAppStore((state) => state.canvas)
  const updateObjects = useAppStore((state) => state.updateObjects)

  // Force re-render
  const forceRefresh = () => setRefreshTick((prev) => prev + 1)

  // Check if text has emboss effect (shadow is hidden when emboss is applied)
  const hasTextEmboss = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

     
    const obj = activeSelection[0] as any
    return obj?.effects?.includes('emboss') ?? false
  }, [activeSelection, refreshTick])

  // Check if has shadow
  const hasShadow = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

     
    const obj = activeSelection[0] as any
    return obj?.shadow != null
  }, [activeSelection, refreshTick])

  // Get shadow color
  const effectiveValue = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return '#000000'
    }

     
    const obj = activeSelection[0] as any
    const rgba = parseColorValue(obj?.shadow?.color ?? '#000000')
    if (!rgba) return '#000000'
    return rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7)
  }, [activeSelection, refreshTick])

  // Get shadow opacity
  const shadowOpacity = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 20
    }

     
    const obj = activeSelection[0] as any
    return Math.round((obj?.shadow?.opacity ?? 0.2) * 100)
  }, [activeSelection, refreshTick])

  // Get shadow offset X
  const offsetX = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 0
    }

     
    const obj = activeSelection[0] as any
    return obj?.shadow?.offsetX ?? 0
  }, [activeSelection, refreshTick])

  // Get shadow offset Y
  const offsetY = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 0
    }

     
    const obj = activeSelection[0] as any
    return obj?.shadow?.offsetY ?? 0
  }, [activeSelection, refreshTick])

  // Get shadow blur
  const blur = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 0
    }

     
    const obj = activeSelection[0] as any
    return obj?.shadow?.blur ?? 0
  }, [activeSelection, refreshTick])

  // Add shadow
  const addShadow = useCallback(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return

    obj.shadow = {
      color: '#000000',
      offsetX: 1,
      offsetY: 2,
      blur: 4,
      opacity: 0.2,
    }
    obj.dirty = true

    canvas?.renderAll()
    updateObjects()
    forceRefresh()
  }, [activeSelection, canvas, updateObjects])

  // Remove shadow
  const removeShadow = useCallback(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return

    obj.shadow = null
    obj.dirty = true

    canvas?.renderAll()
    updateObjects()
    forceRefresh()
  }, [activeSelection, canvas, updateObjects])

  // Local color state for smooth UI updates
  const [localColor, setLocalColor] = useState(effectiveValue)

  // Sync local color when effectiveValue changes (selection changed)
  useEffect(() => {
    setLocalColor(effectiveValue)
  }, [effectiveValue])

  // Debounced canvas render
  const debouncedRenderRef = useRef(
    debounce((canvasRef: typeof canvas, value: string, activeObj: (typeof activeSelection)[number]) => {
      if (!canvasRef || !activeObj) return
       
      const obj = activeObj as any
      if (!obj?.shadow) return

      const rgba = parseColorValue(value || '#000000')
      if (!rgba) return

      const alpha = obj.shadow.opacity ?? 0.2
      obj.shadow.color = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`
      obj.dirty = true
      canvasRef.requestRenderAll()
    }, 50)
  )

  // Handle color change with debounce for canvas render
  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setLocalColor(value) // Update local state immediately for UI responsiveness

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

      const obj = activeSelection[0]
      debouncedRenderRef.current(canvas, value, obj)
    },
    [activeSelection, canvas]
  )

  // Handle color change complete (on blur)
  const handleColorChangeComplete = useCallback(() => {
    updateObjects()
  }, [updateObjects])

  // Handle opacity change
  const handleOpacityChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      let value = parseInt(target.value, 10)

      if (isNaN(value)) return
      if (value < 0) value = 0
      if (value > 100) value = 100

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj?.shadow) return

      const parsedOpacity = value / 100
      const rgba = parseColorValue(obj.shadow.color ?? '#000000')
      if (!rgba) return

      obj.shadow.opacity = parsedOpacity
      obj.shadow.color = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${parsedOpacity})`
      obj.dirty = true

      canvas?.requestRenderAll()
      updateObjects()
    },
    [activeSelection, canvas, updateObjects]
  )

  // Handle offset X change
  const handleOffsetXChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      const value = parseFloat(target.value)

      if (isNaN(value)) return

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj?.shadow) return

      obj.shadow.offsetX = value
      obj.dirty = true

      canvas?.requestRenderAll()
    },
    [activeSelection, canvas]
  )

  // Handle offset Y change
  const handleOffsetYChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      const value = parseFloat(target.value)

      if (isNaN(value)) return

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj?.shadow) return

      obj.shadow.offsetY = value
      obj.dirty = true

      canvas?.requestRenderAll()
    },
    [activeSelection, canvas]
  )

  // Handle blur change
  const handleBlurChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      let value = parseFloat(target.value)

      if (isNaN(value)) return
      if (value < 0) value = 0

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj?.shadow) return

      obj.shadow.blur = value
      obj.dirty = true

      canvas?.requestRenderAll()
    },
    [activeSelection, canvas]
  )

  // Don't render if no selection
  if (!activeSelection || activeSelection.length === 0) {
    return null
  }

  return (
    <AppSection
      id="shadow-control"
      title="그림자"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
      onDelete={hasShadow && !hasTextEmboss ? removeShadow : undefined}
    >
      {expanded && (
        <div className="w-full px-4">
          {!hasShadow ? (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={addShadow}
            >
              추가
            </Button>
          ) : hasTextEmboss ? (
            <p className="text-xs text-editor-text-muted mb-2">
              엠보싱 효과가 적용된 경우 그림자를 사용할 수 없습니다.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* Color Picker */}
              <div className="flex-1 min-w-[50%] flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                <div
                  className="w-7 h-7 rounded cursor-pointer border border-gray-300 flex-shrink-0"
                  style={{ backgroundColor: localColor || effectiveValue }}
                  onClick={() => {
                    const input = document.getElementById('shadow-color-input') as HTMLInputElement
                    input?.click()
                  }}
                />
                <input
                  id="shadow-color-input"
                  type="color"
                  value={localColor || effectiveValue}
                  onChange={handleColorChange}
                  onBlur={handleColorChangeComplete}
                  className="sr-only"
                />
                <input
                  type="text"
                  value={(localColor || effectiveValue).toUpperCase()}
                  onChange={(e) => {
                    const val = e.target.value
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                      setLocalColor(val)
                      const syntheticEvent = {
                        target: { value: val },
                      } as React.ChangeEvent<HTMLInputElement>
                      handleColorChange(syntheticEvent)
                    }
                  }}
                  onBlur={handleColorChangeComplete}
                  className="flex-1 bg-transparent text-sm text-editor-text outline-none uppercase"
                />
              </div>

              {/* Opacity */}
              <div className="max-w-16 flex items-center gap-1 h-10 px-2 rounded bg-editor-surface-lowest">
                <input
                  type="number"
                  defaultValue={shadowOpacity}
                  key={shadowOpacity}
                  min={0}
                  max={100}
                  onBlur={handleOpacityChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleOpacityChange(e)
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                  className="w-full bg-transparent text-sm text-editor-text outline-none text-center appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>

              {/* Options: X, Y, Blur */}
              <div className="flex flex-row w-full gap-2">
                <ControlInput
                  value={offsetX}
                  onChange={handleOffsetXChange}
                  type="number"
                  step={1}
                >
                  <ArrowsHorizontal className="h-4 w-4" />
                </ControlInput>
                <ControlInput
                  value={offsetY}
                  onChange={handleOffsetYChange}
                  type="number"
                  step={1}
                >
                  <ArrowsVertical className="h-4 w-4" />
                </ControlInput>
                <ControlInput
                  value={blur}
                  onChange={handleBlurChange}
                  type="number"
                  min={0}
                  step={1}
                  className="max-w-16"
                >
                  <RadioButton className="h-4 w-4" />
                </ControlInput>
              </div>
            </div>
          )}
        </div>
      )}
    </AppSection>
  )
}
