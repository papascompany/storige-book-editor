import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { useAppStore, useActiveSelection, useSelectionType } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  SelectionType,
  applyCurveToText,
  removeCurveFromText,
  type CurvePathType,
} from '@storige/canvas-core'
import { cn } from '@/lib/utils'
import { FlipHorizontal2 } from 'lucide-react'

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
  // S-E3: 패스 모양(아치|웨이브) + Flip(패스 반대편 — fabric pathSide)
  const [pathType, setPathType] = useState<CurvePathType>('arc')
  const [flipped, setFlipped] = useState(false)

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

  const isWave = pathType === 'wave'

  // Calculate radius based on text length
  const calcRadius = useCallback((count: number) => {
    if (!activeSelection || activeSelection.length === 0) return 200


    const obj = activeSelection[0] as any
    const effectiveSize = (obj?.fontSize || 0) + gap / 2
    const textLength = effectiveSize * count
    return textLength / Math.PI
  }, [activeSelection, gap])

  // 곡선 적용(공유 유틸) — offHistory→적용→onHistory 로 곡률 변경이 히스토리 1엔트리가 되게 한다
  // (onHistory 가 상태 diff 를 스냅샷하므로 set 이 onHistory 앞이어야 엔트리에 잡힘)
  const applyCurve = useCallback(async (overrides: {
    radius?: number
    direction?: CurveDirectionType
    arcDeg?: number
    pathType?: CurvePathType
    gap?: number
    flipped?: boolean
  } = {}) => {
    if (!activeSelection || activeSelection.length === 0 || !canvas) return


    const obj = activeSelection[0] as any
    if (!obj) return

    const effType = overrides.pathType ?? pathType
    const effRadius = overrides.radius ?? radius
    const effDirection = overrides.direction ?? curveDirection
    const effArcDeg = overrides.arcDeg ?? arcDeg
    const effGap = overrides.gap ?? gap
    const effFlipped = overrides.flipped ?? flipped

    canvas.offHistory?.()

    await applyCurveToText(
      obj,
      {
        pathType: effType,
        radius: effRadius,
        direction: effDirection,
        arcDeg: effArcDeg,
        width: (obj.width || 0) * (obj.scaleX || 1),
      },
      { charSpacing: effGap, flip: effFlipped ? 'right' : 'left' }
    )

    canvas.onHistory?.()
    canvas.renderAll()
  }, [activeSelection, canvas, radius, gap, curveDirection, arcDeg, pathType, flipped])

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

    await applyCurve({ radius: newRadius })
    forceRefresh()
  }, [activeSelection, canvas, radius, calcRadius, applyCurve])

  // Remove curve
  const removeCurve = useCallback(() => {
    if (!activeSelection || activeSelection.length === 0 || !canvas) return


    const obj = activeSelection[0] as any
    if (!obj) return

    removeCurveFromText(obj)

    canvas.requestRenderAll()

    setRadius(0)
    setAverageRadius(0)
    setGap(0)
    setArcDeg(180)
    setPathType('arc')
    setFlipped(false)
    forceRefresh()
  }, [activeSelection, canvas])

  // Change curve direction
  const changeCurveDirection = useCallback((direction: CurveDirectionType) => {
    setCurveDirection(direction)
  }, [])

  // Change path shape (아치 ↔ 웨이브)
  const changePathType = useCallback((type: CurvePathType) => {
    setPathType(type)
  }, [])

  // Flip — 텍스트를 패스 반대편으로 (읽는 방향 유지)
  const toggleFlip = useCallback(() => {
    setFlipped((prev) => !prev)
  }, [])

  // Handle radius change (while dragging - only update state)
  const handleRadiusChange = useCallback((value: number[]) => {
    setRadius(value[0])
  }, [])

  // Handle radius change commit (when slider released - apply curve)
  const handleRadiusCommit = useCallback((value: number[]) => {
    setRadius(value[0])
    if (hasPath && value[0] > 0) {
      applyCurve({ radius: value[0] })
    }
  }, [hasPath, applyCurve])

  // Handle gap change (while dragging - only update state)
  const handleGapChange = useCallback((value: number[]) => {
    setGap(value[0])
  }, [])

  // Handle gap change commit (when slider released - apply curve)
  const handleGapCommit = useCallback((value: number[]) => {
    setGap(value[0])
    if (hasPath) {
      applyCurve({ gap: value[0] })
    }
  }, [hasPath, applyCurve])

  // Handle arc angle change — drag 중 라이브 반영 (아래 useEffect가 재적용)
  const handleAngleChange = useCallback((value: number[]) => {
    setArcDeg(value[0])
  }, [])

  // Apply curve when direction/shape/flip changes only
  useEffect(() => {
    // Skip during initialization to prevent infinite loop
    if (isInitializingRef.current) {
      return
    }
    // Apply when direction, arc angle, shape or flip changes (radius and gap use onValueCommit)
    if (hasPath && radius > 0) {
      applyCurve()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curveDirection, arcDeg, pathType, flipped])

  // Initialize values when selection changes
  useEffect(() => {
    if (!activeSelection || activeSelection.length === 0) return


    const obj = activeSelection[0] as any
    if (obj?.path && obj?.extensionType === 'curveText') {
      const objRadius = obj.curveRadius || 200
      const objGap = obj.charSpacing || 0

      // Set initializing flag to prevent applyCurve from being called
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
      setPathType(obj.curvePathType === 'wave' ? 'wave' : 'arc')
      setFlipped(obj.pathSide === 'right')

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
      setPathType('arc')
      setFlipped(false)
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
        obj?.extensionType === 'curveText' &&
        // 웨이브는 radius=진폭이라 글자 수 기반 재계산 대상이 아님 (아치 전용 보정)
        obj?.curvePathType !== 'wave'
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
              {/* Shape (아치/웨이브) + Flip */}
              <div className="flex flex-col gap-3">
                <label className="text-xs text-editor-text-muted">모양</label>
                <div className="flex gap-1">
                  {([
                    { type: 'arc' as CurvePathType, label: '아치' },
                    { type: 'wave' as CurvePathType, label: '웨이브' },
                  ]).map((s) => (
                    <Button
                      key={s.type}
                      variant="ghost"
                      size="sm"
                      aria-pressed={pathType === s.type}
                      className={`flex-1 h-7 text-[11px] bg-editor-surface-lowest ${pathType === s.type ? 'text-primary' : 'text-editor-text-muted'}`}
                      onClick={() => changePathType(s.type)}
                    >
                      {s.label}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    title="뒤집기 — 텍스트를 곡선 반대편으로"
                    aria-pressed={flipped}
                    className={`flex-1 h-7 text-[11px] bg-editor-surface-lowest ${flipped ? 'text-primary' : 'text-editor-text-muted'}`}
                    onClick={toggleFlip}
                  >
                    <FlipHorizontal2 className="h-3 w-3 mr-1" />
                    뒤집기
                  </Button>
                </div>
              </div>

              {/* Radius (아치) / 진폭 (웨이브) */}
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-editor-text-muted">{isWave ? '진폭' : '반지름'}</label>
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

              {/* Arc angle — 원 둘레를 감싸는 정도 (180=반원, 키우면 원형/배지) — 아치 전용 */}
              {!isWave && (
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
              )}

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

              {/* Curve direction — 아치: 위/아래 호, 웨이브: 위상(산/골 먼저) */}
              <div className="flex flex-col gap-3">
                <label className="text-xs text-editor-text-muted">방향</label>
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
