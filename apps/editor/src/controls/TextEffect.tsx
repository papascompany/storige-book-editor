import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { useAppStore, useActiveSelection, useSelectionType } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SelectionType, createPath } from '@storige/canvas-core'
import { cn } from '@/lib/utils'

// Import curve images
import curvedTextImage from '@/assets/image/curvedText.png'
import curvedTextReverseImage from '@/assets/image/curvedTextReverse.png'

type CurveDirectionType = 'upward' | 'downward'

export default function TextEffect() {
  const [expanded, setExpanded] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const activeSelection = useActiveSelection()
  const selectionType = useSelectionType()
  const canvas = useAppStore((state) => state.canvas)

  const [radius, setRadius] = useState(0)
  const [averageRadius, setAverageRadius] = useState(0)
  const [gap, setGap] = useState(0)
  const [curveDirection, setCurveDirection] = useState<CurveDirectionType>('upward')
  // 호 각도(도) — 180=반원(기본), 키우면 원 둘레를 더 감쌈 (배지/병뚜껑/라벨)
  const [arcDeg, setArcDeg] = useState(180)

  const prevTextCountRef = useRef<number | undefined>(undefined)
  const isInitializingRef = useRef(false)

  // Force re-render
  const forceRefresh = () => setRefreshTick((prev) => prev + 1)

  // Check if current selection is i-text
  const isText = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }
    return activeSelection[0]?.type === 'i-text'
  }, [activeSelection])

  // Check if has path (curved text)
  const hasPath = useMemo(() => {
    void refreshTick // dependency for re-render
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return false
    }
     
    const obj = activeSelection[0] as any
    return obj?.path != null
  }, [activeSelection, refreshTick])

  // Generate path data for curved text
  // deg = 호 각도(도). 180=반원(기존 동작과 동일). 키우면 원을 더 감싼다.
  // 상단(upward)은 sweep 1, 하단(downward)은 sweep 0 로 기존 방향성 유지.
  const generatePathData = useCallback((r: number, reverse: boolean = false, deg: number = 180) => {
    const d = Math.max(10, Math.min(deg, 350))
    const h = (d / 2) * (Math.PI / 180)
    const sx = r * Math.sin(h)
    const cy = r * Math.cos(h)
    const largeArc = d > 180 ? 1 : 0
    if (!reverse) {
      // 위쪽 호 (상단 중심)
      return `M ${-sx}, ${-cy} A ${r} ${r} 0 ${largeArc} 1 ${sx}, ${-cy}`
    }
    // 아래쪽 호 (하단 중심)
    return `M ${-sx}, ${cy} A ${r} ${r} 0 ${largeArc} 0 ${sx}, ${cy}`
  }, [])

  // Calculate radius based on text length
  const calcRadius = useCallback((count: number) => {
    if (!activeSelection || activeSelection.length === 0) return 200

     
    const obj = activeSelection[0] as any
    const effectiveSize = (obj?.fontSize || 0) + gap / 2
    const textLength = effectiveSize * count
    return textLength / Math.PI
  }, [activeSelection, gap])

  // Apply curve to text
  const curveText = useCallback(async () => {
    if (!activeSelection || activeSelection.length === 0 || !canvas) return

     
    const obj = activeSelection[0] as any
    if (!obj) return

    canvas.offHistory?.()

    const pathData = generatePathData(radius, curveDirection === 'downward', arcDeg)
    const path = await createPath(pathData, {
      id: 'curveText',
      stroke: '#000',
      strokeWidth: 0,
      fill: '',
      selectable: false,
      scaleX: 1,
      scaleY: 1,
      width: (obj.width || 0) * (obj.scaleX || 1),
    })

    // Get path segments info

    const fabric = (window as any).fabric
    if (fabric?.util?.getPathSegmentsInfo) {

      (path as any).segmentsInfo = fabric.util.getPathSegmentsInfo((path as any).path)
    }

    canvas.onHistory?.()

    obj.set({
      path,
      extensionType: 'curveText',
      curveRadius: radius,
      charSpacing: gap,
      curveDirection: curveDirection,
      curveArcDeg: arcDeg,
    })

    canvas.renderAll()
  }, [activeSelection, canvas, radius, gap, curveDirection, arcDeg, generatePathData])

  // Add curve
  const addCurve = useCallback(async () => {
    if (!activeSelection || activeSelection.length === 0 || !canvas) return

     
    const obj = activeSelection[0] as any
    if (!obj) return

    const textLength = obj?.text?.length || 0
    const r = calcRadius(textLength)
    // Use calculated average as initial radius (slightly smaller for visual appeal)
    const newRadius = radius === 0 ? Math.max(r - 20, 50) : radius

    // Update state - averageRadius is for slider range, radius is actual value
    setRadius(newRadius)
    setAverageRadius(r)

    // Apply curve directly with new values
    canvas.offHistory?.()

    const pathData = generatePathData(newRadius, curveDirection === 'downward', arcDeg)
    const path = await createPath(pathData, {
      id: 'curveText',
      stroke: '#000',
      strokeWidth: 0,
      fill: '',
      selectable: false,
      scaleX: 1,
      scaleY: 1,
      width: (obj.width || 0) * (obj.scaleX || 1),
    })


    const fabric = (window as any).fabric
    if (fabric?.util?.getPathSegmentsInfo) {

      (path as any).segmentsInfo = fabric.util.getPathSegmentsInfo((path as any).path)
    }

    canvas.onHistory?.()

    obj.set({
      path,
      extensionType: 'curveText',
      curveRadius: newRadius,
      charSpacing: gap,
      curveDirection: curveDirection,
      curveArcDeg: arcDeg,
    })

    canvas.renderAll()
    forceRefresh()
  }, [activeSelection, canvas, radius, gap, curveDirection, arcDeg, calcRadius, generatePathData])

  // Remove curve
  const removeCurve = useCallback(() => {
    if (!activeSelection || activeSelection.length === 0 || !canvas) return

     
    const obj = activeSelection[0] as any
    if (!obj) return

    obj.set({
      path: null,
      charSpacing: 0,
      extensionType: undefined,
    })

    canvas.requestRenderAll()

    setRadius(0)
    setAverageRadius(0)
    setGap(0)
    setArcDeg(180)
    forceRefresh()
  }, [activeSelection, canvas])

  // Change curve direction
  const changeCurveDirection = useCallback((direction: CurveDirectionType) => {
    setCurveDirection(direction)
  }, [])

  // Handle radius change (while dragging - only update state)
  const handleRadiusChange = useCallback((value: number[]) => {
    setRadius(value[0])
  }, [])

  // Handle radius change commit (when slider released - apply curve)
  const handleRadiusCommit = useCallback((value: number[]) => {
    setRadius(value[0])
    if (hasPath && value[0] > 0) {
      curveText()
    }
  }, [hasPath, curveText])

  // Handle gap change (while dragging - only update state)
  const handleGapChange = useCallback((value: number[]) => {
    setGap(value[0])
  }, [])

  // Handle gap change commit (when slider released - apply curve)
  const handleGapCommit = useCallback((value: number[]) => {
    setGap(value[0])
    if (hasPath) {
      curveText()
    }
  }, [hasPath, curveText])

  // Handle arc angle change — drag 중 라이브 반영 (아래 useEffect가 재적용)
  const handleAngleChange = useCallback((value: number[]) => {
    setArcDeg(value[0])
  }, [])

  // Apply curve when direction changes only
  useEffect(() => {
    // Skip during initialization to prevent infinite loop
    if (isInitializingRef.current) {
      return
    }
    // Apply when direction or arc angle changes (radius and gap are handled by onValueCommit)
    if (hasPath && radius > 0) {
      curveText()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curveDirection, arcDeg])

  // Initialize values when selection changes
  useEffect(() => {
    if (!activeSelection || activeSelection.length === 0) return

     
    const obj = activeSelection[0] as any
    if (obj?.path && obj?.extensionType === 'curveText') {
      const objRadius = obj.curveRadius || 200
      const objGap = obj.charSpacing || 0

      // Set initializing flag to prevent curveText from being called
      isInitializingRef.current = true

      // Set averageRadius so that the current radius is within slider range
      // Slider range is [averageRadius - 20, averageRadius + 100]
      // So averageRadius should be objRadius + 20 to place objRadius at the start of range
      // Or we can center it: averageRadius = objRadius + 40 (so radius is near the middle)
      const baseAverage = objRadius + 20

      // Set radius to the actual stored value, and averageRadius for slider range
      setRadius(objRadius)
      setAverageRadius(baseAverage)
      setGap(objGap)
      setCurveDirection(obj.curveDirection || 'upward')
      setArcDeg(obj.curveArcDeg || 180)

      // Reset flag after state updates are applied
      requestAnimationFrame(() => {
        isInitializingRef.current = false
      })
    } else {
      // Reset values when no curve
      setRadius(0)
      setAverageRadius(0)
      setGap(0)
      setArcDeg(180)
    }
  }, [activeSelection])

  // Listen for keydown to update curve when text changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeSelection || activeSelection.length === 0) return

       
      const obj = activeSelection[0] as any
      const target = e.target as HTMLTextAreaElement

      if (
        obj?.type === 'i-text' &&
        target?.value &&
        target?.tagName === 'TEXTAREA' &&
        obj?.extensionType === 'curveText'
      ) {
        const count = target.value.length
        prevTextCountRef.current ??= count

        if (count > 0 && count !== prevTextCountRef.current) {
          prevTextCountRef.current = count

          setGap(0)
          const r = calcRadius(count)

          setRadius(r - 20)
          setAverageRadius(r)
          obj.curveRadius = r
          obj.charSpacing = 0
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeSelection, calcRadius])

  // Don't render if not text type
  if (selectionType !== SelectionType.text || !isText) {
    return null
  }

  return (
    <AppSection
      id="text-effect-control"
      title="곡선"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
      onDelete={hasPath ? removeCurve : undefined}
    >
      {expanded && (
        <div className="w-full px-4">
          {!hasPath ? (
            <Button
              variant="secondary"
              className="w-full h-10 mb-2"
              onClick={addCurve}
            >
              추가
            </Button>
          ) : (
            <div className="flex flex-col gap-5 mt-2">
              {/* Radius */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-editor-text-muted">반지름</label>
                  <span className="text-xs text-editor-text">{Math.round(radius)}</span>
                </div>
                <Slider
                  value={[radius]}
                  onValueChange={handleRadiusChange}
                  onValueCommit={handleRadiusCommit}
                  min={0}
                  max={averageRadius + 100}
                  step={1}
                />
              </div>

              {/* Arc angle — 원 둘레를 감싸는 정도 (180=반원, 키우면 원형/배지) */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-editor-text-muted">각도</label>
                  <span className="text-xs text-editor-text">{Math.round(arcDeg)}°</span>
                </div>
                <Slider
                  value={[arcDeg]}
                  onValueChange={handleAngleChange}
                  min={30}
                  max={340}
                  step={1}
                />
                {/* 빠른 각도 프리셋 (배지/라벨/병뚜껑) — 일반 버튼이라 한 번에 적용 */}
                <div className="flex gap-1">
                  {[
                    { label: '반원', deg: 180 },
                    { label: '¾', deg: 270 },
                    { label: '원형', deg: 320 },
                  ].map((p) => (
                    <Button
                      key={p.deg}
                      variant="ghost"
                      size="sm"
                      title={`${p.deg}°`}
                      aria-pressed={Math.round(arcDeg) === p.deg}
                      className={`flex-1 h-7 text-[11px] bg-editor-surface-lowest ${Math.round(arcDeg) === p.deg ? 'text-primary' : 'text-editor-text-muted'}`}
                      onClick={() => setArcDeg(p.deg)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Gap */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-editor-text-muted">간격</label>
                  <span className="text-xs text-editor-text">{Math.round(gap)}</span>
                </div>
                <Slider
                  value={[gap]}
                  onValueChange={handleGapChange}
                  onValueCommit={handleGapCommit}
                  min={0}
                  max={500}
                  step={1}
                />
              </div>

              {/* Curve direction */}
              <div className="flex flex-col gap-3">
                <label className="text-xs text-editor-text-muted">곡선</label>
                <div className="flex flex-row w-full gap-2">
                  <div
                    className={cn(
                      'flex-1 cursor-pointer border rounded-lg overflow-hidden transition-colors',
                      curveDirection === 'upward'
                        ? 'border-primary'
                        : 'border-transparent hover:border-editor-text-muted'
                    )}
                    onClick={() => changeCurveDirection('upward')}
                  >
                    <img src={curvedTextImage} alt="curve upward" className="w-full" />
                  </div>
                  <div
                    className={cn(
                      'flex-1 cursor-pointer border rounded-lg overflow-hidden transition-colors',
                      curveDirection === 'downward'
                        ? 'border-primary'
                        : 'border-transparent hover:border-editor-text-muted'
                    )}
                    onClick={() => changeCurveDirection('downward')}
                  >
                    <img src={curvedTextReverseImage} alt="curve downward" className="w-full" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AppSection>
  )
}
