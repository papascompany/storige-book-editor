// @ts-nocheck
import { v4 as uuid } from 'uuid'
import { fabric } from 'fabric'
import { PluginOption } from '../plugin'
import { drawLine, drawMask, drawRect, drawText, getZoomGap } from '../utils/ruler'
import { pxToMmDisplay, snapToGrid } from '../utils/math'
import { UNIT_CONVERSIONS, DPI_ADAPTIVE_GAPS, RULER_DEFAULTS } from './constants'

export interface RulerOptions extends PluginOption {
  ruleSize?: number
  fontSize?: number
  enabled?: boolean
  backgroundColor?: string
  textColor?: string
  borderColor?: string
  highlightColor?: string
  unit: 'px' | 'mm' | 'inch' | string
  dpi: number
}

export type Rect = { left: number; top: number; width: number; height: number }

export type HighlightRect = {
  skip?: 'x' | 'y'
} & Rect

class CanvasRuler {
  private _options: Required<RulerOptions>
  private mouseActiveOn: 'down' | 'up' = 'up'
  private readonly _canvas: fabric.Canvas
  private _rulerCanvas: HTMLCanvasElement // 별도 룰러 캔버스
  private _rulerCtx: CanvasRenderingContext2D // 룰러 캔버스 컨텍스트
  private objectRect:
    | undefined
    | {
        x: HighlightRect[]
        y: HighlightRect[]
      }
  private _renderRequested = false
  private _animationFrameId: number | null = null
  private _lastRenderState: string = ''
  private _renderCount = 0
  private _isGuidelineDragging = false // 가이드라인 드래그 상태 추적
  private eventHandler: Record<string, (...args: any) => void> = {
    calcObjectRect: this.calcObjectRect.bind(this),
    clearStatus: this.clearStatus.bind(this),
    canvasMouseDown: this.canvasMouseDown.bind(this),
    canvasMouseMove: this.canvasMouseMove.bind(this),
    canvasMouseUp: this.canvasMouseUp.bind(this),
    render: (e: any) => {
      if (!e.ctx) return
      // 가이드라인 드래그 중이 아닐 때만 룰러 업데이트
      if (!this._isGuidelineDragging) {
        this.scheduleRender()
      }
    },
    forceUpdate: (e?: any) => {
      // 가이드라인 이동 시에는 룰러 업데이트를 건너뛰기
      if (e && e.target && e.target.type === 'GuideLine') {
        return
      }
      
      // 상태 초기화하여 다음 렌더링에서 강제로 그리도록 함
      this._lastRenderState = ''
      this.calcObjectRect()
      
      // 즉시 렌더링 스케줄링
      if (this._animationFrameId) {
        cancelAnimationFrame(this._animationFrameId)
        this._animationFrameId = null
      }
      this._renderRequested = false
      
      // 지연 제거
      this.scheduleRender()
    }
  }
  private lastAttr: {
    status: 'out' | 'horizontal' | 'vertical'
    cursor: string | undefined
    selection: boolean | undefined
  } = {
    status: 'out',
    cursor: undefined,
    selection: undefined
  }
  private tempGuideLine: fabric.GuideLine | undefined

  constructor(_canvas: fabric.Canvas, _options: RulerOptions) {
    this._canvas = _canvas
    // D3: RULER_DEFAULTS 단일 소스 참조 (constants.ts에서 색상 토큰 변경 시 자동 반영)
    this._options = Object.assign(
      {
        ruleSize: RULER_DEFAULTS.RULE_SIZE,
        fontSize: RULER_DEFAULTS.FONT_SIZE,
        enabled: false,
        backgroundColor: RULER_DEFAULTS.BACKGROUND_COLOR,
        borderColor: RULER_DEFAULTS.BORDER_COLOR,
        highlightColor: RULER_DEFAULTS.HIGHLIGHT_COLOR,
        textColor: RULER_DEFAULTS.TEXT_COLOR
      },
      _options
    )

    fabric.util.object.extend(this._canvas, {
      ruler: this
    })

    // 별도 룰러 캔버스 생성 및 설정
    this._rulerCanvas = document.createElement('canvas')
    this._rulerCtx = this._rulerCanvas.getContext('2d')!
    
    // 룰러 캔버스를 fabric 캔버스와 같은 크기로 설정
    const fabricCanvas = this._canvas.getElement()
    this._rulerCanvas.width = fabricCanvas.width
    this._rulerCanvas.height = fabricCanvas.height
    
    // 룰러 캔버스를 fabric 캔버스 위에 절대 포지셔닝
    this._rulerCanvas.style.position = 'absolute'
    this._rulerCanvas.style.top = '0'
    this._rulerCanvas.style.left = '0'
    this._rulerCanvas.style.pointerEvents = 'none' // 마우스 이벤트 통과
    this._rulerCanvas.style.zIndex = '1' // fabric 캔버스 위에 표시
    
    // fabric 캔버스 부모에 룰러 캔버스 추가
    const parentElement = fabricCanvas.parentElement
    if (parentElement) {
      parentElement.style.position = 'relative' // 상대 포지셔닝 설정
      parentElement.appendChild(this._rulerCanvas)
    }

    if (this._options.enabled) {
      this.enable()
    }
  }

  get enabled() {
    return this._options.enabled
  }

  get disabled() {
    return !this._options.enabled
  }

  public dispose() {
    this.disable()
    
    // 룰러 캔버스 제거
    if (this._rulerCanvas && this._rulerCanvas.parentElement) {
      this._rulerCanvas.parentElement.removeChild(this._rulerCanvas)
    }
    
    this._canvas = null
    this.objectRect = undefined
    this.tempGuideLine = undefined
    this.eventHandler = {}
  }

  public forceReset() {
    this._lastRenderState = ''
    this._renderCount = 0
    this.objectRect = undefined
    
    // 기존 애니메이션 프레임 취소
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId)
      this._animationFrameId = null
    }
    this._renderRequested = false
    
    // 즉시 렌더링 스케줄링
    setTimeout(() => {
      this.scheduleRender()
    }, 0)
  }

  public enable() {
    this._options.enabled = true

    this._canvas.on('after:render', this.eventHandler.calcObjectRect)
    this._canvas.on('after:render', this.eventHandler.render)
    this._canvas.on('mouse:down', this.eventHandler.canvasMouseDown)
    this._canvas.on('mouse:move', this.eventHandler.canvasMouseMove)
    this._canvas.on('mouse:up', this.eventHandler.canvasMouseUp)
    this._canvas.on('selection:cleared', this.eventHandler.clearStatus)
    
    // 객체 이동/변형 이벤트 - 즉시 업데이트
    this._canvas.on('object:moving', this.eventHandler.forceUpdate)
    this._canvas.on('object:scaling', this.eventHandler.forceUpdate)
    this._canvas.on('object:rotating', this.eventHandler.forceUpdate)
    this._canvas.on('object:modified', this.eventHandler.calcObjectRect)
    this._canvas.on('selection:created', this.eventHandler.calcObjectRect)
    this._canvas.on('selection:updated', this.eventHandler.calcObjectRect)
    
    // 객체 제거 관련 이벤트
    this._canvas.on('object:removed', this.eventHandler.calcObjectRect)
    this._canvas.on('path:created', this.eventHandler.calcObjectRect)
    
    // 줌 및 캔버스 상태 변경 이벤트 - 룰러 강제 렌더링
    this._canvas.on('viewport:changed', this.eventHandler.forceUpdate)
    this._canvas.on('canvas:cleared', this.eventHandler.forceUpdate)
    this._canvas.on('mouse:up:before', this.eventHandler.forceUpdate)
    
    // 가이드라인 드래그 상태 추적
    this._canvas.on('object:moving', (e) => {
      if (e.target && e.target.type === 'GuideLine') {
        this._isGuidelineDragging = true
      }
    })
    
    this._canvas.on('object:modified', (e) => {
      if (e.target && e.target.type === 'GuideLine') {
        this._isGuidelineDragging = false
        // 드래그 종료 후 룰러 즉시 업데이트
        this.scheduleRender()
      }
    })
    
    // 전역 마우스업으로 확실한 드래그 상태 해제
    this._canvas.on('mouse:up', () => {
      if (this._isGuidelineDragging) {
        this._isGuidelineDragging = false
        this.scheduleRender()
      }
    })

    this.scheduleRender()
  }

  public disable() {
    this._canvas.off('after:render', this.eventHandler.calcObjectRect)
    this._canvas.off('after:render', this.eventHandler.render)
    this._canvas.off('mouse:down', this.eventHandler.canvasMouseDown)
    this._canvas.off('mouse:move', this.eventHandler.canvasMouseMove)
    this._canvas.off('mouse:up', this.eventHandler.canvasMouseUp)
    this._canvas.off('selection:cleared', this.eventHandler.clearStatus)
    
    // 객체 이동/변형 이벤트 제거
    this._canvas.off('object:moving', this.eventHandler.forceUpdate)
    this._canvas.off('object:scaling', this.eventHandler.forceUpdate)
    this._canvas.off('object:rotating', this.eventHandler.forceUpdate)
    this._canvas.off('object:modified', this.eventHandler.calcObjectRect)
    this._canvas.off('selection:created', this.eventHandler.calcObjectRect)
    this._canvas.off('selection:updated', this.eventHandler.calcObjectRect)
    
    // 객체 제거 관련 이벤트 제거
    this._canvas.off('object:removed', this.eventHandler.calcObjectRect)
    this._canvas.off('path:created', this.eventHandler.calcObjectRect)
    
    // 줌 및 캔버스 상태 변경 이벤트 제거
    this._canvas.off('viewport:changed', this.eventHandler.forceUpdate)
    this._canvas.off('canvas:cleared', this.eventHandler.forceUpdate)
    this._canvas.off('mouse:up:before', this.eventHandler.forceUpdate)

    this._options.enabled = false
    this._isGuidelineDragging = false // 상태 초기화
    
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId)
      this._animationFrameId = null
    }
  }

  private scheduleRender() {
    if (this._renderRequested || !this._options.enabled) return
    
    this._renderRequested = true
    
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId)
    }
    
    this._animationFrameId = requestAnimationFrame(() => {
      this._renderRequested = false
      this._animationFrameId = null
      this.render()
    })
  }

  public render() {
    if (!this._options.enabled || !this._rulerCtx) return
    
    const vpt = this._canvas.viewportTransform
    if (!vpt) return

    // 렌더링 상태가 변경되었는지 확인 (objectRect 내용도 포함)
    let objectRectHash = 'NONE'
    if (this.objectRect) {
      const xRects = this.objectRect.x.map(r => `${r.left.toFixed(2)},${r.top.toFixed(2)},${r.width.toFixed(2)},${r.height.toFixed(2)}`).join('|')
      const yRects = this.objectRect.y.map(r => `${r.left.toFixed(2)},${r.top.toFixed(2)},${r.width.toFixed(2)},${r.height.toFixed(2)}`).join('|')
      objectRectHash = `HAS_OBJECTS:${xRects};${yRects}`
    }
    
    const currentState = `${vpt[0]},${vpt[3]},${vpt[4]},${vpt[5]},${this._canvas.width},${this._canvas.height},${objectRectHash}`
    
    // 상태가 동일하면 렌더링 건너뛰기
    if (currentState === this._lastRenderState) {
      return
    }
    
    this._renderCount++
    this._lastRenderState = currentState

    // 별도 룰러 캔버스 사용
    const ctx = this._rulerCtx
    
    // 캔버스 크기 업데이트
    this._rulerCanvas.width = this._canvas.width || 0
    this._rulerCanvas.height = this._canvas.height || 0
    
    // 전체 캔버스 클리어
    ctx.clearRect(0, 0, this._rulerCanvas.width, this._rulerCanvas.height)

    /// 가로 세로 Ruler 그리기
    this.draw({
      direction: 'horizontal',
      totalSize: this._canvas.width || 0,
      startCalibration: -(vpt[4] / vpt[0]),
      ctx: ctx
    })
    this.draw({
      direction: 'vertical',
      totalSize: this._canvas.height || 0,
      startCalibration: -(vpt[5] / vpt[3]),
      ctx: ctx
    })

    /// 가로 세로 Ruler 마스크 그리기
    drawMask(ctx, {
      isHorizontal: true,
      left: -10,
      top: -10,
      width: this._options.ruleSize * 2 + 10,
      height: this._options.ruleSize + 10,
      backgroundColor: this._options.backgroundColor
    })
    drawMask(ctx, {
      isHorizontal: false,
      left: -10,
      top: -10,
      width: this._options.ruleSize + 10,
      height: this._options.ruleSize * 2 + 10,
      backgroundColor: this._options.backgroundColor
    })
  }

  isPointOnRuler = (point: fabric.Point) => {
    if (
      new fabric.Rect({
        left: 0,
        top: 0,
        width: this._options.ruleSize,
        height: this._canvas.height,
        id: uuid()
      }).containsPoint(point)
    ) {
      return 'vertical'
    } else if (
      new fabric.Rect({
        left: 0,
        top: 0,
        width: this._canvas.width,
        height: this._options.ruleSize,
        id: uuid()
      }).containsPoint(point)
    ) {
      return 'horizontal'
    }
    return false
  }

  // mm 단위일 때 적절한 간격을 결정하는 함수 (DPI 적응형)
  private getZoomGapForMm(zoom: number): number {
    // 현재 DPI 값 가져오기
    const currentDpi = UNIT_CONVERSIONS.DEFAULT_DPI
    
    // DPI에 따른 적응형 간격 사용
    let gapConfig = DPI_ADAPTIVE_GAPS[currentDpi as keyof typeof DPI_ADAPTIVE_GAPS]
    
    // 현재 DPI에 해당하는 설정이 없으면 가장 가까운 DPI 사용
    if (!gapConfig) {
      const availableDpis = Object.keys(DPI_ADAPTIVE_GAPS).map(Number).sort((a, b) => a - b)
      const closestDpi = availableDpis.reduce((prev, curr) => 
        Math.abs(curr - currentDpi) < Math.abs(prev - currentDpi) ? curr : prev
      )
      gapConfig = DPI_ADAPTIVE_GAPS[closestDpi as keyof typeof DPI_ADAPTIVE_GAPS]
    }
    
    // 줌 레벨에 따라 적절한 간격 찾기
    for (let i = 0; i < gapConfig.ZOOMS.length; i++) {
      if (zoom <= gapConfig.ZOOMS[i]) {
        return gapConfig.GAPS[i]
      }
    }
    
    // 가장 큰 줌 레벨보다 크면 가장 작은 간격 반환
    return gapConfig.GAPS[gapConfig.GAPS.length - 1]
  }

  /// 가로, 세로 Ruler 그리기 (96 DPI 기준)
  private draw(option: {
    direction: 'horizontal' | 'vertical'
    totalSize: number
    startCalibration: number
    ctx: CanvasRenderingContext2D
  }) {
    const { direction, totalSize, startCalibration, ctx } = option
    const zoom = this._canvas.getZoom()

    // 배경 그리기
    const bgRect = {
      left: 0,
      top: 0,
      width: direction === 'horizontal' ? this._canvas.width : this._options.ruleSize,
      height: direction === 'horizontal' ? this._options.ruleSize : this._canvas.height,
      fill: this._options.backgroundColor,
      stroke: this._options.borderColor
    }
    drawRect(ctx, bgRect)

    const textColor = new fabric.Color(this._options.textColor)

    if (this._options.unit === 'mm') {
      // MM 단위 눈금 그리기 (96 DPI 기준)
      const mmGap = this.getZoomGapForMm(zoom)

      // 시작 위치를 mm로 변환 (96 DPI 기준)
      const startMm = pxToMmDisplay(startCalibration)

      // 시작 mm 값을 간격에 맞게 조정
      const startMmValue = Math.floor(startMm / mmGap) * mmGap

      // mm → px 변환 (96 DPI 기준: 96 / 25.4 ≈ 3.78)
      const MM_PER_INCH = 25.4
      const pixelsPerMm = UNIT_CONVERSIONS.DEFAULT_DPI / MM_PER_INCH
      const startOffsetPx = (startMmValue - startMm) * pixelsPerMm

      // 픽셀 단위 간격
      const gapPx = mmGap * pixelsPerMm

      // 필요한 눈금 수 계산
      const totalSizeMm = totalSize / zoom / pixelsPerMm
      const numTicks = Math.ceil(totalSizeMm / mmGap) + 2 // 여유분 추가

      for (let i = 0; i < numTicks; i++) {
        const mmValue = startMmValue + i * mmGap
        const position = (startOffsetPx + i * gapPx) * zoom

        // 화면 영역을 벗어나면 스킵
        if (position < -50 || position > totalSize + 50) {
          continue
        }

        // 눈금 값 그리기 (소수점 제거)
        const graduationString = mmValue % 1 === 0 ? mmValue.toString() : mmValue.toFixed(1)
        const textLength = (8 * graduationString.length) / 2
        const basePosition = this._options.ruleSize / 2 - this._options.fontSize / 2 - 3
        const textX = direction === 'horizontal' ? position - textLength : basePosition
        const textY = direction === 'vertical' ? position + textLength : basePosition

        drawText(ctx, {
          text: graduationString,
          left: textX,
          top: textY,
          fill: textColor.toRgb(),
          angle: direction === 'horizontal' ? 0 : -90,
          fontSize: this._options.fontSize
        })

        // 눈금 선 그리기
        const linePosition = Math.round(position)
        const baseLinePosition = this._options.ruleSize - 8
        const left = direction === 'horizontal' ? linePosition : baseLinePosition
        const top = direction === 'vertical' ? linePosition : baseLinePosition
        const width = direction === 'horizontal' ? 0 : 8
        const height = direction === 'horizontal' ? 8 : 0

        drawLine(ctx, {
          left,
          top,
          width,
          height,
          stroke: textColor.toRgb()
        })
      }
    } else {
      // 픽셀 기반 눈금 그리기 (DPI 무관하게 고정 간격)
      const gap = getZoomGap(zoom)
      const sizePerUnit = totalSize / zoom
      const startValue = Math[startCalibration > 0 ? 'floor' : 'ceil'](startCalibration / gap) * gap
      const startOffset = startValue - startCalibration

      let tickCount = 0
      for (let i = 0; i + startOffset <= Math.ceil(sizePerUnit); i += gap) {
        const position = (startOffset + i) * zoom
        const graduationString = (startValue + i).toString()

        // 눈금 값 그리기
        const textLength = (10 * graduationString.length) / 4
        const basePosition = this._options.ruleSize / 2 - this._options.fontSize / 2 - 4
        const textX = direction === 'horizontal' ? position - textLength - 1 : basePosition
        const textY = direction === 'vertical' ? position + textLength : basePosition

        drawText(ctx, {
          text: graduationString,
          left: textX,
          top: textY,
          fill: textColor.toRgb(),
          angle: direction === 'horizontal' ? 0 : -90
        })

        // 눈금 선 그리기
        const linePosition = Math.round((startOffset + i) * zoom)
        const baseLinePosition = this._options.ruleSize - 8
        const left = direction === 'horizontal' ? linePosition : baseLinePosition
        const top = direction === 'vertical' ? linePosition : baseLinePosition
        const width = direction === 'horizontal' ? 0 : 8
        const height = direction === 'horizontal' ? 8 : 0

        drawLine(ctx, {
          left,
          top,
          width,
          height,
          stroke: textColor.toRgb()
        })

        tickCount++
      }
    }

    // 선택된 객체에 대한 치수 표시 (96 DPI 기준)
    if (this.objectRect) {
      const axis = direction === 'horizontal' ? 'x' : 'y'
      
      this.objectRect[axis].forEach((rect) => {
        if (rect.skip === axis) {
          return
        }

        // mm 단위 변환 및 표시 (96 DPI 기준)
        let leftTextVal, rightTextVal

        if (this._options.unit === 'mm') {
          // 96 DPI 기준 변환비를 사용한 mm 변환
          const leftMm = pxToMmDisplay(
            direction === 'horizontal'
              ? rect.left / zoom + startCalibration
              : rect.top / zoom + startCalibration
          )
          const rightMm = pxToMmDisplay(
            direction === 'horizontal'
              ? (rect.left + rect.width) / zoom + startCalibration
              : (rect.top + rect.height) / zoom + startCalibration
          )

          // 정밀도 유지를 위해 소수점 한 자리까지 표시
          leftTextVal = leftMm % 1 === 0 ? Math.round(leftMm).toString() : leftMm.toFixed(1)
          rightTextVal = rightMm % 1 === 0 ? Math.round(rightMm).toString() : rightMm.toFixed(1)
        } else {
          // 픽셀 단위 표시
          const roundFactor = (x: number) => Math.round(x / zoom + startCalibration).toString()
          leftTextVal = roundFactor(direction === 'horizontal' ? rect.left : rect.top)
          rightTextVal = roundFactor(
            direction === 'horizontal' ? rect.left + rect.width : rect.top + rect.height
          )
        }

        const isSameText = leftTextVal === rightTextVal

        // 마스크 처리
        const maskOpt = {
          isHorizontal: direction === 'horizontal',
          width: direction === 'horizontal' ? 160 : this._options.ruleSize - 8,
          height: direction === 'horizontal' ? this._options.ruleSize - 8 : 160,
          backgroundColor: this._options.backgroundColor
        }

        drawMask(ctx, {
          ...maskOpt,
          left: direction === 'horizontal' ? rect.left - 80 : 0,
          top: direction === 'horizontal' ? 0 : rect.top - 80
        })

        if (!isSameText) {
          drawMask(ctx, {
            ...maskOpt,
            left: direction === 'horizontal' ? rect.width + rect.left - 80 : 0,
            top: direction === 'horizontal' ? 0 : rect.height + rect.top - 80
          })
        }

        // 하이라이트 표시
        const highlightColor = new fabric.Color(this._options.highlightColor)
        highlightColor.setAlpha(0.5)

        drawRect(ctx, {
          left: direction === 'horizontal' ? rect.left : this._options.ruleSize - 8,
          top: direction === 'horizontal' ? this._options.ruleSize - 8 : rect.top,
          width: direction === 'horizontal' ? rect.width : 8,
          height: direction === 'horizontal' ? 8 : rect.height,
          fill: highlightColor.toRgba()
        })

        // 텍스트 표시
        const pad = this._options.ruleSize / 2 - this._options.fontSize / 2 - 4
        const textOpt = {
          fill: highlightColor.toRgba(),
          angle: direction === 'horizontal' ? 0 : -90
        }

        drawText(ctx, {
          ...textOpt,
          text: leftTextVal,
          left: direction === 'horizontal' ? rect.left - 2 : pad,
          top: direction === 'horizontal' ? pad : rect.top - 2,
          align: isSameText ? 'center' : direction === 'horizontal' ? 'right' : 'left'
        })

        if (!isSameText) {
          drawText(ctx, {
            ...textOpt,
            text: rightTextVal,
            left: direction === 'horizontal' ? rect.left + rect.width + 2 : pad,
            top: direction === 'horizontal' ? pad : rect.top + rect.height + 2,
            align: direction === 'horizontal' ? 'left' : 'right'
          })
        }

        // 선 표시
        const lineSize = isSameText ? 8 : 14
        highlightColor.setAlpha(1)

        const lineOpt = {
          width: direction === 'horizontal' ? 0 : lineSize,
          height: direction === 'horizontal' ? lineSize : 0,
          stroke: highlightColor.toRgba()
        }

        drawLine(ctx, {
          ...lineOpt,
          left: direction === 'horizontal' ? rect.left : this._options.ruleSize - lineSize,
          top: direction === 'horizontal' ? this._options.ruleSize - lineSize : rect.top
        })
        
        if (!isSameText) {
          drawLine(ctx, {
            ...lineOpt,
            left:
              direction === 'horizontal'
                ? rect.left + rect.width
                : this._options.ruleSize - lineSize,
            top:
              direction === 'horizontal'
                ? this._options.ruleSize - lineSize
                : rect.top + rect.height
          })
        }
      })
    }
  }

  private calcObjectRect() {
    const activeObject = this._canvas.getActiveObject()
    
    if (!activeObject) {
      // 객체가 없으면 명확히 undefined로 설정
      if (this.objectRect !== undefined) {
        this.objectRect = undefined
        this.scheduleRender() // 하이라이트 제거를 위해 렌더링 트리거
      }
      return
    }

    // 가이드라인인 경우 하이라이트 제거
    if (activeObject instanceof fabric.GuideLine) {
      if (this.objectRect !== undefined) {
        this.objectRect = undefined
        this.scheduleRender()
      }
      return
    }

    // ActiveSelection(복수 선택)인 경우 전체 바운딩 박스를 직접 사용
    if (activeObject.type === 'activeSelection') {
      const activeSelection = activeObject as fabric.ActiveSelection
      
      // 가이드라인이 아닌 객체만 필터링
      const nonGuidelineObjects = activeSelection.getObjects().filter(obj => !(obj instanceof fabric.GuideLine))
      
      if (nonGuidelineObjects.length === 0) {
        if (this.objectRect !== undefined) {
          this.objectRect = undefined
          this.scheduleRender()
        }
        return
      }

      // ActiveSelection 전체의 바운딩 박스를 사용 (더 정확함)
      const rect: HighlightRect = activeSelection.getBoundingRect(false, false)
      
      this.objectRect = {
        x: [rect],
        y: [rect]
      }
      return
    }

    // 개별 객체인 경우 기존 로직 사용
    const activeObjects = [activeObject]
    
    // 가이드라인이 아닌 객체만 필터링
    const nonGuidelineObjects = activeObjects.filter(obj => !(obj instanceof fabric.GuideLine))
     
    if (nonGuidelineObjects.length === 0) {
      // 가이드라인만 선택된 경우 하이라이트 제거
      if (this.objectRect !== undefined) {
        this.objectRect = undefined
        this.scheduleRender()
      }
      return
    }

    this.objectRect = { x: [], y: [] }

    const allRect = nonGuidelineObjects.reduce((rects, obj) => {
      const rect: HighlightRect = obj.getBoundingRect(false, false)
      
      if (obj.group) {
        const group = {
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          scaleX: 1,
          scaleY: 1,
          ...obj.group
        }

        rect.width *= group.scaleX
        rect.height *= group.scaleY
        const groupCenterX = group.width / 2 + group.left
        const objectOffsetFromCenterX = (group.width / 2 + (obj.left ?? 0)) * (1 - group.scaleX)
        rect.left += (groupCenterX - objectOffsetFromCenterX) * this._canvas.getZoom()
        const groupCenterY = group.height / 2 + group.top
        const objectOffsetFromCenterY = (group.height / 2 + (obj.top ?? 0)) * (1 - group.scaleY)
        rect.top += (groupCenterY - objectOffsetFromCenterY) * this._canvas.getZoom()
      }
      rects.push(rect)
      return rects
    }, [] as HighlightRect[])
    
    if (allRect.length === 0) {
      this.objectRect = undefined
      return
    }
    
    const newObjectRect = {
      x: this.mergeLines(allRect, true),
      y: this.mergeLines(allRect, false)
    }
  
    
    this.objectRect = newObjectRect
  }

  private mergeLines = (rect: Rect[], isHorizontal: boolean) => {
    const axis = isHorizontal ? 'left' : 'top'
    const length = isHorizontal ? 'width' : 'height'

    rect.sort((a, b) => a[axis] - b[axis])
    const mergedLines = []
    let currentLine = Object.assign({}, rect[0])
    for (const item of rect) {
      const line = Object.assign({}, item)
      if (currentLine[axis] + currentLine[length] >= line[axis]) {
        currentLine[length] =
          Math.max(currentLine[axis] + currentLine[length], line[axis] + line[length]) -
          currentLine[axis]
      } else {
        mergedLines.push(currentLine)
        currentLine = Object.assign({}, line)
      }
    }
    mergedLines.push(currentLine)
    return mergedLines
  }

  private clearStatus() {
    if (this.objectRect !== undefined) {
      console.log('clearStatus: clearing objectRect')
      this.objectRect = undefined
      this.scheduleRender() // 하이라이트 제거를 위해 렌더링 트리거
    }
  }

  private canvasMouseDown(e: fabric.IEvent<MouseEvent>) {
    if (!e.pointer || !e.absolutePointer) return
    const hoveredRuler = this.isPointOnRuler(e.pointer)
    if (hoveredRuler && this.mouseActiveOn === 'up') {
      this.lastAttr.selection = this._canvas.selection
      this._canvas.selection = false
      this.mouseActiveOn = 'down'

      this.tempGuideLine = new fabric.GuideLine(
        hoveredRuler === 'horizontal' ? e.absolutePointer.y : e.absolutePointer.x,
        {
          axis: hoveredRuler,
          visible: false
        }
      )

      const prev = this._canvas.getActiveObject()
      this._canvas.add(this.tempGuideLine)
      this._canvas.setActiveObject(prev)

      this._canvas._setupCurrentTransform(e.e, this.tempGuideLine, true)
    }
  }

  private canvasMouseMove(e: fabric.IEvent<MouseEvent>) {
    if (!e.pointer) return

    if (this.tempGuideLine && e.absolutePointer) {
      const pos: Partial<fabric.IGuideLineOptions> = {}
      if (this.tempGuideLine.axis === 'horizontal') {
        pos.top = snapToGrid(e.absolutePointer.y)
      } else {
        pos.left = snapToGrid(e.absolutePointer.x)
      }
      this.tempGuideLine.set({ ...pos, visible: true })

      // 즉시 렌더링
      this._canvas.requestRenderAll()
    }

    const hoveredRuler = this.isPointOnRuler(e.pointer)
    if (!hoveredRuler) {
      if (this.lastAttr.status !== 'out') {
        this._canvas.defaultCursor = this.lastAttr.cursor
        this.lastAttr.status = 'out'
      }
      return
    }

    if (this.lastAttr.status === 'out' || hoveredRuler !== this.lastAttr.status) {
      this.lastAttr.cursor = this._canvas.defaultCursor
      this._canvas.defaultCursor = hoveredRuler === 'horizontal' ? 'ns-resize' : 'ew-resize'
      this.lastAttr.status = hoveredRuler
    }
  }

  private canvasMouseUp(e: fabric.IEvent<MouseEvent>) {
    if (this.mouseActiveOn !== 'down') return

    this._canvas.selection = this.lastAttr.selection
    this.mouseActiveOn = 'up'

    this.tempGuideLine = undefined
    
    // 가이드라인 드래그 상태 해제
    if (this._isGuidelineDragging) {
      this._isGuidelineDragging = false
    }
    
    // 룰러 업데이트
    this.scheduleRender()
  }
}

export default CanvasRuler
