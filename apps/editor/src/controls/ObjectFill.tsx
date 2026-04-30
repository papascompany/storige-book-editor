import { useCallback, useState, useMemo } from 'react'
import { fabric } from 'fabric'
import { useAppStore, useActiveSelection, useSelectionType } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import { Button } from '@/components/ui/button'
import { parseColorValue, rgbaToHex8, SelectionType } from '@storige/canvas-core'

// 그라디언트 프리셋 (좌→우 90도 linear). 트랙 AA — ObjectFill 빠른 적용
const GRADIENT_PRESETS: ReadonlyArray<{ name: string; from: string; to: string }> = [
  { name: 'Brand', from: '#7fbf34', to: '#6ba82d' },
  { name: 'Sunset', from: '#f093fb', to: '#f5576c' },
  { name: 'Ocean', from: '#4facfe', to: '#00f2fe' },
  { name: 'Mint', from: '#84fab0', to: '#8fd3f4' },
  { name: 'Sunrise', from: '#ff9a9e', to: '#fecfef' },
  { name: 'Lush', from: '#56ab2f', to: '#a8e063' },
  { name: 'Mono', from: '#2c3e50', to: '#4a5568' },
  { name: 'Cherry', from: '#ff7e5f', to: '#feb47b' },
] as const

export default function ObjectFill() {
  const [expanded, setExpanded] = useState(true)
  const activeSelection = useActiveSelection()
  const selectionType = useSelectionType()
  const canvas = useAppStore((state) => state.canvas)

  // Calculate effective fill color
  const effectiveValue = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return '#FFFFFF'
    }

    const selection = activeSelection[0]
    if (!selection) {
      return '#FFFFFF'
    }

     
    let fillValue = (selection as any).fill

    if (!fillValue || fillValue === '' || fillValue === 'transparent') {
      fillValue = '#FFFFFF'
    }

    if (typeof fillValue !== 'string') {
      return '#FFFFFF'
    }

    const rgba = parseColorValue(fillValue)
    if (!rgba) {
      return '#FFFFFF'
    }

    return rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7)
  }, [activeSelection])

  // Calculate opacity
  const effectiveOpacity = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return 100
    }

    const selection = activeSelection[0]
     
    return (selection as any)?.fillOpacity ?? 100
  }, [activeSelection])

  // Check if has fill
  const hasFill = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

    const selection = activeSelection[0]
     
    const fillValue = (selection as any)?.fill
    return fillValue && fillValue !== '' && fillValue !== 'transparent'
  }, [activeSelection])

  // Check if using effect that hides fill
  const hideFill = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

    const selection = activeSelection[0]
     
    const effects = (selection as any)?.effects
    if (!effects) return false

    return effects.includes('gold') || effects.includes('cutting')
  }, [activeSelection])

  // Add fill color
  const addFillColor = useCallback(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return
    }

    const firstSelection = activeSelection[0]
    if (!firstSelection) return

     
    const obj = firstSelection as any
    obj.fill = '#FFFFFF'
    obj.fillOpacity = 100
    obj.dirty = true

    canvas?.requestRenderAll()
  }, [activeSelection, canvas])

  // Handle color change
  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value

      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
        return
      }

      const firstSelection = activeSelection[0]
      if (!firstSelection) return

      const rgba = parseColorValue(value)
      if (!rgba) return

      const alpha = effectiveOpacity / 100
      const rgbaString = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha})`

       
      const obj = firstSelection as any

      if (obj.type === 'i-text') {
        // Text object - apply to all characters
        const it = obj
        const textLen = it.text?.length ?? 0
        if (textLen > 0) {
          it.setSelectionStyles({ fill: rgbaString }, 0, textLen)
        }
        it.set('fill', rgbaString)
        it.dirty = true
      } else {
        obj.fill = rgbaString
        obj.dirty = true
      }

      canvas?.requestRenderAll()
    },
    [activeSelection, effectiveOpacity, canvas]
  )

  // 그라디언트 프리셋 적용 (linear 90deg, 좌→우)
  // 텍스트 객체는 fabric의 setSelectionStyles가 string fill만 받으므로 미지원
  const isTextSelection = selectionType === SelectionType.text
  const applyGradient = useCallback(
    (from: string, to: string) => {
      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) return
      const obj = activeSelection[0] as any
      if (!obj) return
      if (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') return
      const w = (obj.width ?? 100) * (obj.scaleX ?? 1)
      const grad = new fabric.Gradient({
        type: 'linear',
        coords: { x1: 0, y1: 0, x2: w, y2: 0 },
        colorStops: [
          { offset: 0, color: from },
          { offset: 1, color: to },
        ],
      })
      obj.set('fill', grad)
      obj.dirty = true
      canvas?.requestRenderAll()
      // 일관성을 위해 modified 이벤트 발행 (history 등록)
      try {
        canvas?.fire?.('object:modified', { target: obj })
      } catch {}
    },
    [activeSelection, selectionType, canvas]
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

      const firstSelection = activeSelection[0]
      if (!firstSelection) return

       
      const obj = firstSelection as any
      obj.fillOpacity = value

      // Update fill with new alpha
      const rgba = parseColorValue(obj.fill || '#000000')
      if (rgba) {
        obj.fill = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${value / 100})`
      }

      obj.dirty = true
      canvas?.requestRenderAll()
    },
    [activeSelection, canvas]
  )

  // Don't render if no selection
  if (!activeSelection || activeSelection.length === 0) {
    return null
  }

  // Don't render if using certain effects
  const usingEffect = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }

    const firstSelection = activeSelection[0]
     
    const effects = (firstSelection as any)?.effects
    if (!effects) return false

    return (
      effects.includes('gold') ||
      (selectionType === SelectionType.text && effects.includes('emboss'))
    )
  }, [activeSelection, selectionType])

  if (usingEffect) {
    return null
  }

  return (
    <AppSection
      id="fill-control"
      title="채우기"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
    >
      {expanded && (
        <div className="items flex flex-wrap gap-2 px-4">
          {!hideFill && (
            <div className="w-full flex flex-row gap-2">
              {!hasFill ? (
                <Button
                  variant="secondary"
                  className="w-full h-10"
                  onClick={addFillColor}
                >
                  색상 채우기
                </Button>
              ) : (
                <>
                  {/* Color Picker */}
                  <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                    <input
                      type="color"
                      value={effectiveValue}
                      onChange={handleColorChange}
                      className="w-8 h-8 rounded cursor-pointer border-0"
                    />
                    <input
                      type="text"
                      value={effectiveValue.toUpperCase()}
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
                      defaultValue={effectiveOpacity}
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
                </>
              )}
            </div>
          )}

          {/* 그라디언트 프리셋 row (트랙 AA) — 비-텍스트 객체에서만 노출 */}
          {!hideFill && hasFill && !isTextSelection && (
            <div className="w-full flex flex-col gap-1.5">
              <span className="text-[11px] text-editor-text-muted leading-none">그라디언트</span>
              <div className="flex flex-wrap gap-1.5">
                {GRADIENT_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyGradient(p.from, p.to)}
                    title={`${p.name} (${p.from} → ${p.to})`}
                    aria-label={`그라디언트 적용: ${p.name}`}
                    className="w-7 h-7 rounded border border-editor-border hover:ring-2 hover:ring-editor-accent/50 transition-all"
                    style={{ background: `linear-gradient(90deg, ${p.from}, ${p.to})` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AppSection>
  )
}
