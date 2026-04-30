import { useCallback, useState, useMemo } from 'react'
import { fabric } from 'fabric'
import { useAppStore, useActiveSelection, useSelectionType } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import { Button } from '@/components/ui/button'
import { parseColorValue, rgbaToHex8, SelectionType } from '@storige/canvas-core'

// 그라디언트 프리셋 (트랙 AA, DD-3에서 angle/radial 확장)
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

// 각도 프리셋 (CSS 표준: 0deg = bottom→top, 90deg = left→right). DD-3
const ANGLE_PRESETS = [0, 45, 90, 135] as const
type GradientAngle = typeof ANGLE_PRESETS[number]

// 각도 → fabric linear coords (객체 width/height 기반)
function angleToLinearCoords(angle: GradientAngle, w: number, h: number) {
  switch (angle) {
    case 0:
      // 아래→위 (CSS 0deg)
      return { x1: w / 2, y1: h, x2: w / 2, y2: 0 }
    case 45:
      // 좌하→우상
      return { x1: 0, y1: h, x2: w, y2: 0 }
    case 90:
      // 좌→우 (트랙 AA의 기본)
      return { x1: 0, y1: h / 2, x2: w, y2: h / 2 }
    case 135:
      // 좌상→우하
      return { x1: 0, y1: 0, x2: w, y2: h }
  }
}

export default function ObjectFill() {
  const [expanded, setExpanded] = useState(true)
  const [gradientAngle, setGradientAngle] = useState<GradientAngle>(90)
  const [gradientRadial, setGradientRadial] = useState(false)
  const [lastGradient, setLastGradient] = useState<{ from: string; to: string } | null>(null)
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

  // 그라디언트 적용 — angle 4개 프리셋 + linear/radial 모드 (DD-3)
  // 텍스트 객체는 fabric의 setSelectionStyles가 string fill만 받으므로 미지원
  const isTextSelection = selectionType === SelectionType.text
  const applyGradient = useCallback(
    (from: string, to: string, opts?: { angle?: GradientAngle; radial?: boolean }) => {
      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) return
      const obj = activeSelection[0] as any
      if (!obj) return
      if (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') return
      const angle = opts?.angle ?? gradientAngle
      const radial = opts?.radial ?? gradientRadial
      const w = (obj.width ?? 100) * (obj.scaleX ?? 1)
      const h = (obj.height ?? 100) * (obj.scaleY ?? 1)
      const grad = radial
        ? new fabric.Gradient({
            type: 'radial',
            coords: {
              x1: w / 2,
              y1: h / 2,
              r1: 0,
              x2: w / 2,
              y2: h / 2,
              r2: Math.max(w, h) / 2,
            },
            colorStops: [
              { offset: 0, color: from },
              { offset: 1, color: to },
            ],
          })
        : new fabric.Gradient({
            type: 'linear',
            coords: angleToLinearCoords(angle, w, h),
            colorStops: [
              { offset: 0, color: from },
              { offset: 1, color: to },
            ],
          })
      obj.set('fill', grad)
      obj.dirty = true
      canvas?.requestRenderAll()
      try {
        canvas?.fire?.('object:modified', { target: obj })
      } catch {}
      setLastGradient({ from, to })
    },
    [activeSelection, selectionType, canvas, gradientAngle, gradientRadial]
  )

  // angle/radial 변경 시 마지막 그라디언트가 적용된 객체에 즉시 재적용
  // (사용자가 다시 swatch 클릭하지 않아도 옵션 변화가 시각적으로 반영됨)
  const reapplyIfActive = useCallback(
    (nextAngle: GradientAngle, nextRadial: boolean) => {
      if (!lastGradient) return
      if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) return
      const obj = activeSelection[0] as any
      if (!obj) return
      // 현재 fill이 그라디언트 객체인 경우만 재적용 (단색으로 변경된 객체는 건들지 않음)
      const fill = obj.fill
      if (!fill || typeof fill !== 'object' || !fill.colorStops) return
      applyGradient(lastGradient.from, lastGradient.to, { angle: nextAngle, radial: nextRadial })
    },
    [lastGradient, activeSelection, applyGradient]
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

          {/* 그라디언트 프리셋 row (트랙 AA + DD-3 angle/radial 옵션) — 비-텍스트 객체에서만 노출 */}
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
                    style={{
                      background: gradientRadial
                        ? `radial-gradient(circle, ${p.from}, ${p.to})`
                        : `linear-gradient(${gradientAngle === 0 ? 0 : gradientAngle === 45 ? 45 : gradientAngle === 90 ? 90 : 135}deg, ${p.from}, ${p.to})`,
                    }}
                  />
                ))}
              </div>

              {/* DD-3: angle 프리셋 + radial 토글 */}
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-editor-text-muted mr-0.5">방향</span>
                  {ANGLE_PRESETS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => {
                        setGradientAngle(a)
                        reapplyIfActive(a, gradientRadial)
                      }}
                      disabled={gradientRadial}
                      aria-pressed={!gradientRadial && gradientAngle === a}
                      aria-label={`각도 ${a}도`}
                      className={
                        'text-[10px] w-7 h-6 rounded border transition-colors ' +
                        (gradientRadial
                          ? 'opacity-40 cursor-not-allowed border-editor-border text-editor-text-muted'
                          : !gradientRadial && gradientAngle === a
                          ? 'border-editor-accent bg-editor-accent/10 text-editor-accent font-semibold'
                          : 'border-editor-border bg-editor-surface-low hover:bg-editor-hover text-editor-text-muted')
                      }
                    >
                      {a}°
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !gradientRadial
                    setGradientRadial(next)
                    reapplyIfActive(gradientAngle, next)
                  }}
                  aria-pressed={gradientRadial}
                  aria-label="원형 그라디언트 토글"
                  title="원형 그라디언트 (radial)"
                  className={
                    'text-[10px] px-2 h-6 rounded border transition-colors ' +
                    (gradientRadial
                      ? 'border-editor-accent bg-editor-accent/10 text-editor-accent font-semibold'
                      : 'border-editor-border bg-editor-surface-low hover:bg-editor-hover text-editor-text-muted')
                  }
                >
                  원형
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AppSection>
  )
}
