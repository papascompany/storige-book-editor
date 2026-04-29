import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Pipette as Eyedropper, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  parseColorValue,
  rgbToHue,
  hslToRgb,
  rgbToHsl,
  hexToRgb,
  rgb2Hex,
  cmykToRgb,
  rgbToCmyk,
  getEyeDropColor,
} from '@storige/canvas-core'
import { useRecentColorsStore } from '@/stores/useRecentColorsStore'

type InputType = 'HEX' | 'RGB' | 'CMYK'

interface ColorPickerModalProps {
  initialValue: string
  initialOpacity?: number
  inputType: InputType
  initialCmyk?: { c: number; m: number; y: number; k: number } | null
  onUpdateValue: (value: string) => void
  onUpdateOpacity?: (value: number) => void
  onUpdateCmyk?: (value: { c: number; m: number; y: number; k: number } | null) => void
}

const PRESET_STORAGE_KEY = 'color-presets'

export default function ColorPickerModal({
  initialValue,
  initialOpacity,
  inputType,
  initialCmyk,
  onUpdateValue,
  onUpdateOpacity,
  onUpdateCmyk,
}: ColorPickerModalProps) {
  // Internal state (RGB based)
  const [rgb, setRgb] = useState({ r: 255, g: 255, b: 255 })
  const [opacity, setOpacity] = useState(100)
  const [hue, setHue] = useState(0)

  // Input field state
  const [hexInput, setHexInput] = useState('FFFFFF')
  const [rgbInput, setRgbInput] = useState({ r: 255, g: 255, b: 255 })
  const [cmykInput, setCmykInput] = useState({ c: 0, m: 0, y: 0, k: 0 })
  const [opacityInput, setOpacityInput] = useState(100)

  // CMYK focus flag
  const [isCMYKFocused, setIsCMYKFocused] = useState(false)

  // Initialization flag
  const [isInitialized, setIsInitialized] = useState(false)

  // EyeDropper support
  const [isEyeDropperSupported, setIsEyeDropperSupported] = useState(false)

  // UI state
  const [currentInputType, setCurrentInputType] = useState<InputType>(inputType)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const [pointerPos, setPointerPos] = useState({ x: 0, y: 0 })

  // Color presets
  const [colorPresets, setColorPresets] = useState<string[]>([])

  // Load presets from localStorage
  const loadPresets = useCallback(() => {
    try {
      const stored = localStorage.getItem(PRESET_STORAGE_KEY)
      if (stored) {
        setColorPresets(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load color presets:', e)
    }
  }, [])

  // Save presets to localStorage
  const savePresets = useCallback((presets: string[]) => {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
    } catch (e) {
      console.error('Failed to save color presets:', e)
    }
  }, [])

  // Recent colors (자동 LRU 큐)
  const recentColors = useRecentColorsStore((s) => s.recent)
  const pushRecentColor = useRecentColorsStore((s) => s.push)

  // Emit color
  const emitColor = useCallback(
    (r: number, g: number, b: number, o: number) => {
      const rgbaString = `rgba(${r}, ${g}, ${b}, ${o / 100})`
      onUpdateValue(rgbaString)
      // 최근 사용 색상에 자동 추가 (opacity는 무시, hex 단위로만 추적)
      pushRecentColor(rgb2Hex(r, g, b))
    },
    [onUpdateValue, pushRecentColor]
  )

  // Sync input fields from RGB
  const syncInputFields = useCallback(
    async (r: number, g: number, b: number, skipCmyk = false) => {
      setHexInput(rgb2Hex(r, g, b).substring(1))
      setRgbInput({ r, g, b })

      if (!skipCmyk && !isCMYKFocused) {
        try {
          const cmyk = await rgbToCmyk(r, g, b, 'JAPAN_COLOR_2001')
          const newCmyk = {
            c: Math.round(cmyk.c * 100),
            m: Math.round(cmyk.m * 100),
            y: Math.round(cmyk.y * 100),
            k: Math.round(cmyk.k * 100),
          }
          setCmykInput(newCmyk)
          onUpdateCmyk?.(newCmyk)
        } catch (error) {
          console.warn('RGB → CMYK conversion failed:', error)
        }
      }
    },
    [isCMYKFocused, onUpdateCmyk]
  )

  // Update RGB and emit
  const updateRGB = useCallback(
    async (r: number, g: number, b: number, updateHueFlag = true) => {
      const newR = Math.max(0, Math.min(255, Math.round(r)))
      const newG = Math.max(0, Math.min(255, Math.round(g)))
      const newB = Math.max(0, Math.min(255, Math.round(b)))

      setRgb({ r: newR, g: newG, b: newB })

      if (updateHueFlag) {
        setHue(rgbToHue(newR, newG, newB))
      }

      await syncInputFields(newR, newG, newB)
      emitColor(newR, newG, newB, opacity)
    },
    [opacity, syncInputFields, emitColor]
  )

  // Draw canvas
  const drawCanvas = useCallback((hueValue: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Hue based base color
    const { r, g, b } = hslToRgb(hueValue, 1, 0.5)
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, 0, width, height)

    // White gradient (left → right)
    const whiteGrad = ctx.createLinearGradient(0, 0, width, 0)
    whiteGrad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    whiteGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = whiteGrad
    ctx.fillRect(0, 0, width, height)

    // Black gradient (top → bottom)
    const blackGrad = ctx.createLinearGradient(0, 0, 0, height)
    blackGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    blackGrad.addColorStop(1, 'rgba(0, 0, 0, 1)')
    ctx.fillStyle = blackGrad
    ctx.fillRect(0, 0, width, height)
  }, [])

  // Update pointer position
  const updatePointerPosition = useCallback((r: number, g: number, b: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { s, l } = rgbToHsl(r, g, b)
    const width = canvas.width - 12
    const height = canvas.height - 12

    // HSL to HSV conversion for position
    const v = l + s * Math.min(l, 1 - l)
    const sv = v === 0 ? 0 : 2 * (1 - l / v)

    setPointerPos({ x: sv * width, y: (1 - v) * height })
  }, [])

  // Initialize
  useEffect(() => {
    setIsEyeDropperSupported('EyeDropper' in window)
    loadPresets()

    const initializeAsync = async () => {
      const parsed = parseColorValue(initialValue)
      if (parsed) {
        setRgb({ r: parsed.r, g: parsed.g, b: parsed.b })
        setOpacity(initialOpacity ?? 100)
        setHue(rgbToHue(parsed.r, parsed.g, parsed.b))
        setOpacityInput(initialOpacity ?? 100)

        // Initialize CMYK
        if (initialCmyk) {
          setCmykInput(initialCmyk)
        } else {
          try {
            const cmyk = await rgbToCmyk(parsed.r, parsed.g, parsed.b, 'JAPAN_COLOR_2001')
            const newCmyk = {
              c: Math.round(cmyk.c * 100),
              m: Math.round(cmyk.m * 100),
              y: Math.round(cmyk.y * 100),
              k: Math.round(cmyk.k * 100),
            }
            setCmykInput(newCmyk)
            onUpdateCmyk?.(newCmyk)
          } catch (error) {
            console.warn('RGB → CMYK conversion failed:', error)
            setCmykInput({ c: 0, m: 0, y: 0, k: 0 })
          }
        }

        // HEX, RGB sync
        setHexInput(rgb2Hex(parsed.r, parsed.g, parsed.b).substring(1))
        setRgbInput({ r: parsed.r, g: parsed.g, b: parsed.b })

        // Draw canvas and update pointer
        setTimeout(() => {
          drawCanvas(rgbToHue(parsed.r, parsed.g, parsed.b))
          updatePointerPosition(parsed.r, parsed.g, parsed.b)
          setIsInitialized(true)
        }, 50)
      }
    }

    initializeAsync()
  }, []) // Only run on mount

  // Draw canvas when hue changes
  useEffect(() => {
    if (isInitialized) {
      drawCanvas(hue)
    }
  }, [hue, isInitialized, drawCanvas])

  // Canvas mouse event
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const updateColor = async (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect()
        const x = Math.max(0, Math.min(canvas.width, clientX - rect.left))
        const y = Math.max(0, Math.min(canvas.height, clientY - rect.top))

        const saturation = x / canvas.width
        const value = 1 - y / canvas.height

        // HSV to RGB
        const lightness = value * (1 - saturation / 2)
        const s = lightness === 0 || lightness === 1 ? 0 : (value - lightness) / Math.min(lightness, 1 - lightness)

        const color = hslToRgb(hue, s, lightness)
        await updateRGB(color.r, color.g, color.b, false)
        updatePointerPosition(color.r, color.g, color.b)
      }

      updateColor(e.clientX, e.clientY)

      const handleMouseMove = (event: MouseEvent) => {
        updateColor(event.clientX, event.clientY)
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [hue, updateRGB, updatePointerPosition]
  )

  // Hue change
  const handleHueChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const newHue = parseInt(e.target.value, 10)
      setHue(newHue)
      drawCanvas(newHue)

      const { s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
      const color = hslToRgb(newHue, s, l)
      await updateRGB(color.r, color.g, color.b, false)
      updatePointerPosition(color.r, color.g, color.b)
    },
    [rgb, drawCanvas, updateRGB, updatePointerPosition]
  )

  // HEX input handler
  const handleHexBlur = useCallback(async () => {
    if (!isInitialized) return

    const parsed = hexToRgb(hexInput)
    if (parsed) {
      await updateRGB(parsed.r, parsed.g, parsed.b)
      drawCanvas(rgbToHue(parsed.r, parsed.g, parsed.b))
      updatePointerPosition(parsed.r, parsed.g, parsed.b)
    }
  }, [hexInput, isInitialized, updateRGB, drawCanvas, updatePointerPosition])

  // RGB input handler
  const handleRGBBlur = useCallback(async () => {
    if (!isInitialized) return

    await updateRGB(rgbInput.r, rgbInput.g, rgbInput.b)
    drawCanvas(rgbToHue(rgbInput.r, rgbInput.g, rgbInput.b))
    updatePointerPosition(rgbInput.r, rgbInput.g, rgbInput.b)
  }, [rgbInput, isInitialized, updateRGB, drawCanvas, updatePointerPosition])

  // CMYK input handler
  const handleCMYKBlur = useCallback(
    async (e?: React.FocusEvent<HTMLInputElement>) => {
      if (!isInitialized) return

      // Skip if focus moves to another CMYK input
      const relatedTarget = e?.relatedTarget as HTMLElement
      if (relatedTarget?.closest('.cmyk-input')) return

      // Normalize values
      const c = isNaN(cmykInput.c) ? 0 : Math.max(0, Math.min(100, cmykInput.c))
      const m = isNaN(cmykInput.m) ? 0 : Math.max(0, Math.min(100, cmykInput.m))
      const y = isNaN(cmykInput.y) ? 0 : Math.max(0, Math.min(100, cmykInput.y))
      const k = isNaN(cmykInput.k) ? 0 : Math.max(0, Math.min(100, cmykInput.k))

      setCmykInput({ c, m, y, k })

      // CMYK → RGB conversion
      // canvas-core 의 cmykToRgb 는 이미 내부에서 legacy 알고리즘으로 안전 fallback.
      // 추가 ICC 정확도가 필요해지면 (보류 목록) `@pf/color-runtime` 도입 시점에
      // canvas-core 만 교체하면 본 컴포넌트 변경 불필요.
      const color = await cmykToRgb(c / 100, m / 100, y / 100, k / 100, 'JAPAN_COLOR_2001')

      const newR = Math.max(0, Math.min(255, Math.round(color.r)))
      const newG = Math.max(0, Math.min(255, Math.round(color.g)))
      const newB = Math.max(0, Math.min(255, Math.round(color.b)))

      setRgb({ r: newR, g: newG, b: newB })
      setHue(rgbToHue(newR, newG, newB))
      setHexInput(rgb2Hex(newR, newG, newB).substring(1))
      setRgbInput({ r: newR, g: newG, b: newB })

      drawCanvas(rgbToHue(newR, newG, newB))
      updatePointerPosition(newR, newG, newB)
      emitColor(newR, newG, newB, opacity)
      onUpdateCmyk?.({ c, m, y, k })

      setTimeout(() => setIsCMYKFocused(false), 200)
    },
    [cmykInput, isInitialized, opacity, drawCanvas, updatePointerPosition, emitColor, onUpdateCmyk]
  )

  // Opacity input handler
  const handleOpacityBlur = useCallback(() => {
    const newOpacity = Math.max(0, Math.min(100, opacityInput))
    setOpacity(newOpacity)
    setOpacityInput(newOpacity)
    onUpdateOpacity?.(newOpacity)
  }, [opacityInput, onUpdateOpacity])

  // Preset click
  const handlePresetClick = useCallback(
    async (color: string) => {
      const parsed = hexToRgb(color)
      if (parsed) {
        await updateRGB(parsed.r, parsed.g, parsed.b)
        drawCanvas(rgbToHue(parsed.r, parsed.g, parsed.b))
        updatePointerPosition(parsed.r, parsed.g, parsed.b)
      }
    },
    [updateRGB, drawCanvas, updatePointerPosition]
  )

  // Add to preset
  const addToPreset = useCallback(() => {
    const hexColor = rgb2Hex(rgb.r, rgb.g, rgb.b)

    if (!colorPresets.includes(hexColor)) {
      const newPresets = [hexColor, ...colorPresets].slice(0, 20)
      setColorPresets(newPresets)
      savePresets(newPresets)
    }
  }, [rgb, colorPresets, savePresets])

  // Eye dropper
  const handleEyeDropper = useCallback(async () => {
    const sRGBHex = await getEyeDropColor()
    if (!sRGBHex) return
    const parsed = hexToRgb(sRGBHex)
    if (!parsed) return
    await updateRGB(parsed.r, parsed.g, parsed.b)
    drawCanvas(rgbToHue(parsed.r, parsed.g, parsed.b))
    updatePointerPosition(parsed.r, parsed.g, parsed.b)
  }, [updateRGB, drawCanvas, updatePointerPosition])

  // Opacity track style
  const opacityTrackStyle = useMemo(
    () => ({
      background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) 100%)`,
    }),
    [rgb]
  )

  return (
    <div className="w-80 p-3 bg-white rounded-xl overflow-visible">
      {/* Color picker area */}
      <div className="relative w-full h-[165px] mb-3 rounded-lg overflow-hidden cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          width={296}
          height={165}
          onMouseDown={handleCanvasMouseDown}
        />
        <div
          ref={pointerRef}
          className="absolute w-3 h-3 border-2 border-white rounded-full pointer-events-none shadow-md"
          style={{
            left: `${pointerPos.x}px`,
            top: `${pointerPos.y}px`,
            transform: 'translate(-6px, -6px)',
            boxShadow: '0 0 4px rgba(0, 0, 0, 0.5)',
          }}
        />
      </div>

      {/* Hue & Opacity sliders */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-2">
          {isEyeDropperSupported ? (
            <Button variant="ghost" size="icon" onClick={handleEyeDropper} title="스포이드로 색상 선택">
              <Eyedropper className="h-5 w-5" />
            </Button>
          ) : (
            <Eyedropper className="h-5 w-5 text-gray-400" />
          )}
          <input
            type="range"
            min="0"
            max="360"
            value={hue}
            onChange={handleHueChange}
            className="flex-1 h-2 rounded appearance-none cursor-pointer"
            style={{
              background:
                'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
            }}
          />
        </div>
        {initialOpacity !== undefined && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded relative" style={opacityTrackStyle}>
              <input
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => {
                  const newOpacity = parseInt(e.target.value, 10)
                  setOpacity(newOpacity)
                  setOpacityInput(newOpacity)
                  onUpdateOpacity?.(newOpacity)
                }}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* Color inputs */}
      <div className="grid gap-1 items-center" style={{ gridTemplateColumns: initialOpacity !== undefined ? 'auto 1fr auto' : 'auto 1fr' }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              {currentInputType}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setCurrentInputType('HEX')}>HEX</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCurrentInputType('RGB')}>RGB</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCurrentInputType('CMYK')}>CMYK</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* HEX input */}
        {currentInputType === 'HEX' && (
          <div className="flex gap-0.5">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleHexBlur()}
              placeholder="FFFFFF"
              className="flex-1 min-w-0 h-8 px-1 text-center text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* RGB input */}
        {currentInputType === 'RGB' && (
          <div className="flex gap-0.5">
            <input
              type="number"
              min="0"
              max="255"
              value={rgbInput.r}
              onChange={(e) => setRgbInput((prev) => ({ ...prev, r: parseInt(e.target.value, 10) || 0 }))}
              onBlur={handleRGBBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleRGBBlur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <input
              type="number"
              min="0"
              max="255"
              value={rgbInput.g}
              onChange={(e) => setRgbInput((prev) => ({ ...prev, g: parseInt(e.target.value, 10) || 0 }))}
              onBlur={handleRGBBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleRGBBlur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <input
              type="number"
              min="0"
              max="255"
              value={rgbInput.b}
              onChange={(e) => setRgbInput((prev) => ({ ...prev, b: parseInt(e.target.value, 10) || 0 }))}
              onBlur={handleRGBBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleRGBBlur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        )}

        {/* CMYK input */}
        {currentInputType === 'CMYK' && (
          <div className="flex gap-0.5 cmyk-input">
            <input
              type="number"
              min="0"
              max="100"
              value={cmykInput.c}
              placeholder="C"
              onChange={(e) => setCmykInput((prev) => ({ ...prev, c: parseInt(e.target.value, 10) || 0 }))}
              onFocus={() => setIsCMYKFocused(true)}
              onBlur={handleCMYKBlur}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={cmykInput.m}
              placeholder="M"
              onChange={(e) => setCmykInput((prev) => ({ ...prev, m: parseInt(e.target.value, 10) || 0 }))}
              onFocus={() => setIsCMYKFocused(true)}
              onBlur={handleCMYKBlur}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={cmykInput.y}
              placeholder="Y"
              onChange={(e) => setCmykInput((prev) => ({ ...prev, y: parseInt(e.target.value, 10) || 0 }))}
              onFocus={() => setIsCMYKFocused(true)}
              onBlur={handleCMYKBlur}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={cmykInput.k}
              placeholder="K"
              onChange={(e) => setCmykInput((prev) => ({ ...prev, k: parseInt(e.target.value, 10) || 0 }))}
              onFocus={() => setIsCMYKFocused(true)}
              onBlur={handleCMYKBlur}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
              className="flex-1 min-w-0 h-8 px-0.5 text-center text-[10px] border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        )}

        {/* Opacity input */}
        {initialOpacity !== undefined && (
          <div className="w-12">
            <input
              type="number"
              min="0"
              max="100"
              value={opacityInput}
              onChange={(e) => setOpacityInput(parseInt(e.target.value, 10) || 0)}
              onBlur={handleOpacityBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleOpacityBlur()}
              className="w-full h-8 px-0.5 text-center text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <hr className="my-2 border-editor-border" />

      {/* Recent colors — 자동 누적 (가장 최근 사용 16개) */}
      {recentColors.length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-editor-text-muted mb-1">최근 사용</div>
          <div className="flex gap-1 flex-wrap">
            {recentColors.map((color, index) => (
              <div
                key={`recent-${color}-${index}`}
                role="button"
                tabIndex={0}
                title={color}
                aria-label={`최근 색상 ${color}`}
                className="w-6 h-6 rounded border border-editor-border cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: color }}
                onClick={() => handlePresetClick(color)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Color presets — 사용자가 명시적으로 저장한 색상 */}
      <div className="flex gap-2 items-start">
        <div className="pt-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6 rounded-full"
            onClick={addToPreset}
            title="현재 색상을 저장 색상에 추가"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1 flex-wrap flex-1">
          {colorPresets.map((color, index) => (
            <div
              key={index}
              role="button"
              tabIndex={0}
              title={color}
              aria-label={`저장 색상 ${color}`}
              className="w-6 h-6 rounded border border-editor-border cursor-pointer transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
              onClick={() => handlePresetClick(color)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
