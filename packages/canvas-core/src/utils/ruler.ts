/// zoom 단위 설정
import { fabric } from 'fabric'

export const getZoomGap = (zoom: number) => {
  const zooms = [0.02, 0.03, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 18]
  const gaps = [5000, 2500, 1000, 500, 250, 100, 50, 25, 10, 5, 2]

  let i = 0
  while (i < zooms.length && zooms[i] < zoom) {
    i++
  }

  return gaps[i - 1] || 5000
}

// DPI 적응형 픽셀 눈금 간격 계산
export const getZoomGapAdaptive = (zoom: number, dpi: number = 96) => {
  // DPI 비율 계산 (기본 96 DPI 대비)
  const dpiRatio = dpi / 96
  
  // 72 DPI에서는 간격을 더 넓게
  let gapMultiplier = 1
  if (dpi <= 72) {
    gapMultiplier = 1.5 // 1.5배 더 넓은 간격
  } else if (dpi <= 96) {
    gapMultiplier = 1.2 // 1.2배 더 넓은 간격
  }
  
  const zooms = [0.02, 0.03, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 18]
  const baseGaps = [5000, 2500, 1000, 500, 250, 100, 50, 25, 10, 5, 2]
  
  // DPI와 multiplier를 적용한 간격
  const adaptiveGaps = baseGaps.map(gap => Math.round(gap * gapMultiplier))

  let i = 0
  while (i < zooms.length && zooms[i] < zoom) {
    i++
  }

  return adaptiveGaps[i - 1] || adaptiveGaps[0]
}

/// 눈금 값 그리기
export const drawText = (
  ctx: CanvasRenderingContext2D,
  options: {
    left: number
    top: number
    text: string
    fill?: string | CanvasGradient | CanvasPattern
    align?: CanvasTextAlign
    angle?: number
    fontSize?: number
  }
) => {
  ctx.save()
  const { left, top, text, fill, align, angle, fontSize } = options
  fill && (ctx.fillStyle = fill)
  ctx.textAlign = align ?? 'left'
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize ?? 9}px sans-serif`
  if (angle) {
    ctx.translate(left, top)
    ctx.rotate((Math.PI / 180) * angle)
    ctx.translate(-left, -top)
  }
  ctx.fillText(text, left, top)
  ctx.restore()
}

/// 눈금 선 그리기
export const drawLine = (
  ctx: CanvasRenderingContext2D,
  opt: {
    left: number
    top: number
    width: number
    height: number
    stroke?: string | CanvasGradient | CanvasPattern
    lineWidth?: number
  }
) => {
  ctx.save()
  ctx.beginPath()
  opt.stroke && (ctx.strokeStyle = opt.stroke)
  ctx.lineWidth = opt.lineWidth ?? 1
  ctx.moveTo(opt.left, opt.top)
  ctx.lineTo(opt.left + opt.width, opt.top + opt.height)
  ctx.stroke()
  ctx.restore()
}

export const drawRect = (
  ctx: CanvasRenderingContext2D,
  opt: {
    left: number
    top: number
    width: number
    height: number
    fill?: string | CanvasGradient | CanvasPattern
    stroke?: string
    strokeWidth?: number
  }
) => {
  ctx.save()
  ctx.beginPath()
  opt.fill && (ctx.fillStyle = opt.fill)
  ctx.rect(opt.left, opt.top, opt.width, opt.height)
  ctx.fill()
  if (opt.stroke) {
    ctx.strokeStyle = opt.stroke
    ctx.lineWidth = opt.strokeWidth ?? 1
    ctx.stroke()
  }
  ctx.restore()
}

export const drawMask = (
  ctx: CanvasRenderingContext2D,
  options: {
    isHorizontal: boolean
    left: number
    top: number
    width: number
    height: number
    backgroundColor: string
  }
) => {
  ctx.save()
  const { isHorizontal, left, top, width, height, backgroundColor } = options

  const gradient = isHorizontal
    ? ctx.createLinearGradient(left, height / 2, left + width, height / 2)
    : ctx.createLinearGradient(width / 2, top, width / 2, height + top)
  const transparentColor = new fabric.Color(backgroundColor)
  transparentColor.setAlpha(0)
  gradient.addColorStop(0, transparentColor.toRgba())
  gradient.addColorStop(0.33, backgroundColor)
  gradient.addColorStop(0.67, backgroundColor)
  gradient.addColorStop(1, transparentColor.toRgba())
  drawRect(ctx, {
    left,
    top,
    width,
    height,
    fill: gradient
  })
  ctx.restore()
}

export const drawImg = (
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  img: HTMLImageElement,
  wSize: number,
  hSize: number,
  angle: number | undefined
) => {
  if (angle === undefined) return
  ctx.save()
  ctx.translate(left, top)
  ctx.rotate(angle)
  ctx.drawImage(img, -wSize / 2, -hSize / 2, wSize, hSize)
  ctx.restore()
}

export default {
  drawText,
  drawLine,
  drawRect,
  getZoomGap,
  getZoomGapAdaptive,
  drawMask,
  drawImg
}
