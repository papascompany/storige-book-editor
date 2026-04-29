import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import ControlInput from '@/components/ControlInput'
import { Button } from '@/components/ui/button'
import { parseColorValue, rgbaToHex8 } from '@storige/canvas-core'
import { Minus } from 'lucide-react'

export default function ObjectStroke() {
  const [expanded, setExpanded] = useState(true)
  const [selectionTick, setSelectionTick] = useState(0)
  const activeSelection = useActiveSelection()
  const canvas = useAppStore((state) => state.canvas)
  const updateObjects = useAppStore((state) => state.updateObjects)

  // Reference to bound object for cleanup
   
  const boundObjectRef = useRef<any>(null)

  // Bump selection tick to trigger re-computation
  const bumpSelectionTick = useCallback(() => {
    setSelectionTick((prev) => prev + 1)
  }, [])

  // Bind selection events for text objects
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
       
      const it = obj as any
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

  // Check if has stroke
  const hasStroke = useMemo(() => {
    void selectionTick
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return false

    if (obj.type === 'i-text') {
       
      const it = obj as any
      const textLen = it.text?.length ?? 0
      const hasRange = it.selectionStart !== it.selectionEnd
      const start = hasRange ? it.selectionStart ?? 0 : 0
      const end = hasRange ? it.selectionEnd ?? 0 : textLen
      const arr = it.getSelectionStyles(start, end) as Array<Record<string, unknown>>
      const count = Math.max(0, end - start)

      if (count === 0) {
        const all = it.getSelectionStyles(0, textLen) as Array<Record<string, unknown>>
        for (let i = 0; i < textLen; i++) {
           
          const s = all[i] || {} as any
          const v = s.stroke ?? obj.stroke
          if (v != null && v !== '') return true
        }
        return obj.stroke != null && obj.stroke !== ''
      }

      for (let i = 0; i < count; i++) {
         
        const s = arr[i] || {} as any
        const v = s.stroke ?? obj.stroke
        if (v != null && v !== '') return true
      }
      return false
    }

    return obj.stroke != null && obj.stroke !== ''
  }, [activeSelection, selectionTick])

  // Calculate effective stroke color
  const effectiveStrokeValue = useMemo(() => {
    void selectionTick
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return '#000000'
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return '#000000'

    if (obj.type === 'i-text') {
       
      const it = obj as any
      const textLen = it.text?.length ?? 0
      const hasRange = it.selectionStart !== it.selectionEnd
      const start = hasRange ? it.selectionStart ?? 0 : 0
      const end = hasRange ? it.selectionEnd ?? 0 : textLen
      const arr = it.getSelectionStyles(start, end) as Array<Record<string, unknown>>
      const rangeLen = Math.max(0, end - start)
      const values = new Set<string>()
      const text = it.text || ''

      for (let i = 0; i < rangeLen; i++) {
        if (text[start + i] === '\n') continue
         
        const style = arr[i] || {} as any
        const base = style.stroke ?? obj.stroke
        if (!base || base === '' || base === 'transparent') continue
        const parsed = parseColorValue(typeof base === 'string' ? base : base?.toString?.() || '')
        if (parsed) values.add(rgbaToHex8(parsed.r, parsed.g, parsed.b, parsed.a).slice(0, 7))
      }

      if (rangeLen === 0) {
        const arrAll = it.getSelectionStyles(0, textLen) as Array<Record<string, unknown>>
        const temp = new Set<string>()
        for (let i = 0; i < textLen; i++) {
          if (text[i] === '\n') continue
           
          const style = arrAll[i] || {} as any
          const base = style.stroke ?? obj.stroke
          if (!base || base === '' || base === 'transparent') continue
          const parsed = parseColorValue(typeof base === 'string' ? base : base?.toString?.() || '')
          if (parsed) temp.add(rgbaToHex8(parsed.r, parsed.g, parsed.b, parsed.a).slice(0, 7))
        }
        if (temp.size > 1) return '#000000'
        if (temp.size === 1) return Array.from(temp)[0]
        const parsed = parseColorValue(obj.stroke ?? '#000000')
        const rgba = parsed ?? { r: 0, g: 0, b: 0, a: 1 }
        return rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7)
      }

      if (values.size > 1) return '#000000'
      if (values.size === 1) return Array.from(values)[0]
      return '#000000'
    }

    const parsed = parseColorValue(obj.stroke ?? '#000000')
    const rgba = parsed ?? { r: 0, g: 0, b: 0, a: 1 }
    return rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7)
  }, [activeSelection, selectionTick])

  // Calculate stroke opacity
  const effectiveStrokeOpacity = useMemo(() => {
    void selectionTick
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 100
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return 100

    if (obj.type === 'i-text') {
       
      const it = obj as any
      const textLen = it.text?.length ?? 0
      const hasRange = it.selectionStart !== it.selectionEnd
      const start = hasRange ? it.selectionStart ?? 0 : 0
      const end = hasRange ? it.selectionEnd ?? 0 : textLen
      const styles = it.getSelectionStyles(start, end) as Array<Record<string, unknown>>
      const count = Math.max(0, end - start)
      const text = it.text || ''

      const readAlpha = (src: unknown): number => {
        if (!src || src === '' || src === 'transparent') return 1
        const parsed = parseColorValue(typeof src === 'string' ? src : String(src))
        if (!parsed) return 1
        return typeof parsed.a === 'number' ? parsed.a : 1
      }

      const alphas = new Set<number>()
      for (let i = 0; i < count; i++) {
        if (text[start + i] === '\n') continue
         
        const s = styles[i] || {} as any
        const strokeSrc = s.stroke ?? obj.stroke
        if (strokeSrc && strokeSrc !== '' && strokeSrc !== 'transparent') {
          alphas.add(readAlpha(strokeSrc))
        }
      }

      if (count === 0) {
        return obj.strokeOpacity ?? 100
      }

      if (alphas.size > 1) return 100 // mixed
      const [only] = Array.from(alphas)
      return Math.round((only ?? 1) * 100)
    }

    if (typeof obj.strokeOpacity === 'number') return obj.strokeOpacity
    const parsed = parseColorValue(obj.stroke ?? '#000000')
    return Math.round(((parsed?.a ?? 1) * 100))
  }, [activeSelection, selectionTick])

  // Calculate stroke width
  const currentStrokeWidth = useMemo(() => {
    void selectionTick
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 0
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return 0

    if (obj.type !== 'i-text') {
      return obj.strokeWidth ?? 0
    }

     
    const it = obj as any
    const textLen = it.text?.length ?? 0
    const hasRange = it.selectionStart !== it.selectionEnd
    const start = hasRange ? it.selectionStart ?? 0 : 0
    const end = hasRange ? it.selectionEnd ?? 0 : textLen
    const arr = it.getSelectionStyles(start, end) as Array<Record<string, unknown>>
    const count = Math.max(0, end - start)
    const values = new Set<number>()

    const getWidthForChar = (style: Record<string, unknown>): number => {
       
      const s = style as any
      const strokeValue = s.stroke ?? obj.stroke
      if (strokeValue == null || strokeValue === '') return 0
      const w = s.strokeWidth ?? obj.strokeWidth ?? 0
      return Number(w) || 0
    }

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        values.add(getWidthForChar(arr[i] || {}))
      }
    } else {
      const arrAll = it.getSelectionStyles(0, textLen) as Array<Record<string, unknown>>
      for (let i = 0; i < textLen; i++) {
        values.add(getWidthForChar(arrAll[i] || {}))
      }
    }

    if (values.size > 1) return 0 // mixed
    const [only] = Array.from(values)
    return only ?? 0
  }, [activeSelection, selectionTick])

  // Add stroke
  const addStroke = useCallback(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return

    if (obj.type === 'i-text') {
       
      const it = obj as any
      const hasRange = it.selectionStart !== it.selectionEnd
      const color = '#000000'

      if (hasRange) {
        const start = it.selectionStart ?? 0
        const end = it.selectionEnd ?? start
        it.setSelectionStyles({ stroke: color, strokeWidth: 1 }, start, end)
      } else {
        const total = it.text?.length ?? 0
        if (total > 0) it.setSelectionStyles({ stroke: color, strokeWidth: 1 }, 0, total)
        it.set('stroke', color)
        it.set('strokeWidth', 1)
        it.setCoords()
      }
      obj.cmykStroke = null
      it.dirty = true
    } else {
      obj.stroke = '#000000'
      obj.strokeWidth = 1
      obj.strokeOpacity = 100
      obj.cmykStroke = null
      obj.dirty = true
    }

    canvas?.requestRenderAll()
    updateObjects()
    bumpSelectionTick()
  }, [activeSelection, canvas, updateObjects, bumpSelectionTick])

  // Remove stroke
  const removeStroke = useCallback(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return
    }

     
    const obj = activeSelection[0] as any
    if (!obj) return

    if (obj.type === 'i-text') {
       
      const it = obj as any
      const hasRange = it.selectionStart !== it.selectionEnd

      if (hasRange) {
        it.setSelectionStyles({ stroke: undefined, strokeWidth: undefined })
      } else {
        const total = it.text?.length ?? 0
        if (total > 0) it.setSelectionStyles({ stroke: undefined, strokeWidth: undefined }, 0, total)
         
        it.set('stroke', null as any)
         
        it.set('strokeWidth', null as any)
        it.setCoords()
      }
      obj.cmykStroke = null
      it.dirty = true
    } else {
      obj.stroke = null
      obj.strokeWidth = null
      obj.strokeOpacity = null
      obj.cmykStroke = null
      obj.dirty = true
    }

    canvas?.requestRenderAll()
    updateObjects()
    bumpSelectionTick()
  }, [activeSelection, canvas, updateObjects, bumpSelectionTick])

  // Handle color change
  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj) return

      const parsed = parseColorValue(value ?? '#000000')
      if (!parsed) return

      const alpha = effectiveStrokeOpacity / 100
      const rgbaString = `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`

      if (obj.type === 'i-text') {
         
        const it = obj as any
        const hasRange = it.selectionStart !== it.selectionEnd

        if (hasRange) {
          it.setSelectionStyles({ stroke: rgbaString })
        } else {
          const textLen = it.text?.length ?? 0
          if (textLen > 0) {
            it.setSelectionStyles({ stroke: rgbaString }, 0, textLen)
          }
          it.set('stroke', rgbaString)
          it.setCoords()
        }
        it.dirty = true
      } else {
        obj.stroke = rgbaString
        obj.strokeOpacity = Math.round(alpha * 100)
        obj.dirty = true
      }

      canvas?.requestRenderAll()
      bumpSelectionTick()
    },
    [activeSelection, effectiveStrokeOpacity, canvas, bumpSelectionTick]
  )

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
      if (!obj) return

      const newAlpha = value / 100

      const applyAlphaToColor = (src: string, alphaPercent: number): string => {
        const rgba = parseColorValue(src) ?? { r: 0, g: 0, b: 0, a: 1 }
        return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alphaPercent / 100})`
      }

      if (obj.type === 'i-text') {
         
        const it = obj as any
        const hasRange = it.selectionStart !== it.selectionEnd

        if (hasRange) {
          const start = it.selectionStart ?? 0
          const end = it.selectionEnd ?? start
          const arr = it.getSelectionStyles(start, end) as Array<Record<string, unknown>>
          const count = Math.max(0, end - start)

          for (let i = 0; i < count; i++) {
             
            const style = arr[i] || {} as any
            const base = style.stroke ?? obj.stroke
            if (base == null || base === '') continue
            const parsed = parseColorValue(typeof base === 'string' ? base : String(base))
            const r = parsed ? parsed.r : 0
            const g = parsed ? parsed.g : 0
            const b = parsed ? parsed.b : 0
            it.setSelectionStyles({ stroke: `rgba(${r}, ${g}, ${b}, ${newAlpha})` }, start + i, start + i + 1)
          }
        } else {
          const textLen = it.text?.length ?? 0
          const arrAll = it.getSelectionStyles(0, textLen) as Array<Record<string, unknown>>

          for (let i = 0; i < textLen; i++) {
             
            const style = arrAll[i] || {} as any
            const base = style.stroke ?? obj.stroke
            if (base == null || base === '') continue
            const parsed = parseColorValue(typeof base === 'string' ? base : String(base))
            const r = parsed ? parsed.r : 0
            const g = parsed ? parsed.g : 0
            const b = parsed ? parsed.b : 0
            it.setSelectionStyles({ stroke: `rgba(${r}, ${g}, ${b}, ${newAlpha})` }, i, i + 1)
          }

          const base = obj.stroke ?? '#000000'
          const updated = applyAlphaToColor(base, value)
          it.set('stroke', updated)
          it.setCoords()
        }
        obj.strokeOpacity = value
        it.dirty = true
      } else {
        const updated = applyAlphaToColor(obj.stroke ?? '#000000', value)
        obj.stroke = updated
        obj.strokeOpacity = value
        obj.dirty = true
      }

      canvas?.requestRenderAll()
      updateObjects()
      bumpSelectionTick()
    },
    [activeSelection, canvas, updateObjects, bumpSelectionTick]
  )

  // Handle stroke width change
  const handleStrokeWidthChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      const target = e.target as HTMLInputElement
      const num = Number(target?.value)

      if (!isFinite(num) || num < 0) return

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

       
      const obj = activeSelection[0] as any
      if (!obj) return

      if (obj.type === 'i-text') {
         
        const it = obj as any
        const hasRange = it.selectionStart !== it.selectionEnd

        if (hasRange) {
          it.setSelectionStyles({ strokeWidth: num })
        } else {
          const total = it.text?.length ?? 0
          if (total > 0) {
            it.setSelectionStyles({ strokeWidth: num }, 0, total)
          }
          it.set('strokeWidth', num)
          it.setCoords()
        }
        it.dirty = true
      } else {
        obj.strokeWidth = num
        obj.dirty = true
      }

      canvas?.requestRenderAll()
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
      id="stroke-control"
      title="선"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
      onDelete={hasStroke ? removeStroke : undefined}
    >
      {expanded && (
        <div className="w-full px-4">
          {!hasStroke ? (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={addStroke}
            >
              추가
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* Color Picker */}
              <div className="flex-1 min-w-[50%] flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                <input
                  type="color"
                  value={effectiveStrokeValue}
                  onChange={handleColorChange}
                  className="w-8 h-8 rounded cursor-pointer border-0"
                />
                <input
                  type="text"
                  value={effectiveStrokeValue.toUpperCase()}
                  onChange={(e) => {
                    const val = e.target.value
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                      const syntheticEvent = {
                        target: { value: val },
                      } as React.ChangeEvent<HTMLInputElement>
                      handleColorChange(syntheticEvent)
                    }
                  }}
                  className="flex-1 bg-transparent text-sm text-editor-text outline-none uppercase"
                />
              </div>

              {/* Opacity */}
              <div className="max-w-16 flex items-center gap-1 h-10 px-2 rounded bg-editor-surface-lowest">
                <input
                  type="number"
                  defaultValue={effectiveStrokeOpacity}
                  key={effectiveStrokeOpacity}
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

              {/* Stroke Width */}
              <div className="w-full">
                <ControlInput
                  value={currentStrokeWidth}
                  onChange={handleStrokeWidthChange}
                  type="number"
                  min={0}
                  step={1}
                >
                  <Minus className="h-5 w-5" />
                </ControlInput>
              </div>
            </div>
          )}
        </div>
      )}
    </AppSection>
  )
}
