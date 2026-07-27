/**
 * SpreadLayout 기반 영역 crop 유틸리티
 *
 * SpreadLayout.regions에서 region별 crop 좌표를 계산합니다.
 * 3D 목업 등에서 스프레드 전체 스크린샷을 영역별로 crop할 때 사용합니다.
 */

import { computeSpreadRegionRangesMm } from '@storige/types'
import type { SpreadLayout, SpreadRegionPosition, SpreadSpec } from '@storige/types'

/**
 * Crop 영역 (픽셀 좌표)
 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 영역별 crop 좌표 맵
 */
export type RegionCropMap = Record<SpreadRegionPosition, CropRect>

/**
 * SpreadLayout에서 영역별 crop 좌표 계산
 *
 * @param layout - SpreadLayout (SpreadLayoutEngine 산출물)
 * @param screenshotWidth - 스크린샷 이미지 폭 (px)
 * @param screenshotHeight - 스크린샷 이미지 높이 (px)
 * @returns 영역별 crop 좌표 맵
 *
 * @example
 * ```ts
 * const layout = SpreadLayoutEngine.computeLayout(spec)
 * const screenshot = canvas.toDataURL()
 * const img = new Image()
 * img.onload = () => {
 *   const crops = calculateRegionCrops(layout, img.width, img.height)
 *   // crops['front-cover'] → { x, y, width, height }
 * }
 * img.src = screenshot
 * ```
 */
export function calculateRegionCrops(
  layout: SpreadLayout,
  screenshotWidth: number,
  screenshotHeight: number
): RegionCropMap {
  const crops: Partial<RegionCropMap> = {}

  // 스크린샷과 layout 크기 비율 계산
  const scaleX = screenshotWidth / layout.totalWidthPx
  const scaleY = screenshotHeight / layout.totalHeightPx

  for (const region of layout.regions) {
    crops[region.position] = {
      x: Math.round(region.x * scaleX),
      y: 0, // SpreadRegion은 전체 높이이므로 y는 항상 0
      width: Math.round(region.width * scaleX),
      height: Math.round(region.height * scaleY),
    }
  }

  return crops as RegionCropMap
}

/**
 * 특정 영역의 crop 좌표 계산
 *
 * @param layout - SpreadLayout
 * @param position - 영역 위치
 * @param screenshotWidth - 스크린샷 이미지 폭 (px)
 * @param screenshotHeight - 스크린샷 이미지 높이 (px)
 * @returns Crop 좌표 또는 null (해당 영역 없음)
 */
export function calculateRegionCrop(
  layout: SpreadLayout,
  position: SpreadRegionPosition,
  screenshotWidth: number,
  screenshotHeight: number
): CropRect | null {
  const region = layout.regions.find((r) => r.position === position)
  if (!region) {
    return null
  }

  const scaleX = screenshotWidth / layout.totalWidthPx
  const scaleY = screenshotHeight / layout.totalHeightPx

  return {
    x: Math.round(region.x * scaleX),
    y: 0,
    width: Math.round(region.width * scaleX),
    height: Math.round(region.height * scaleY),
  }
}

/**
 * Canvas 요소에서 영역별 이미지 추출
 *
 * @param canvas - HTMLCanvasElement (스크린샷)
 * @param layout - SpreadLayout
 * @returns 영역별 Data URL 맵
 */
export function extractRegionImages(
  canvas: HTMLCanvasElement,
  layout: SpreadLayout
): Record<SpreadRegionPosition, string> {
  const crops = calculateRegionCrops(layout, canvas.width, canvas.height)
  const images: Partial<Record<SpreadRegionPosition, string>> = {}

  const tempCanvas = document.createElement('canvas')
  const ctx = tempCanvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create temporary canvas context')
  }

  for (const [position, crop] of Object.entries(crops) as [SpreadRegionPosition, CropRect][]) {
    tempCanvas.width = crop.width
    tempCanvas.height = crop.height

    ctx.drawImage(
      canvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )

    images[position] = tempCanvas.toDataURL('image/png')
  }

  return images as Record<SpreadRegionPosition, string>
}

// ---------------------------------------------------------------------------
// 표지 스프레드 캔버스 → 영역별 트림 이미지 (3D 목업 배선, 2026-07-27)
// ---------------------------------------------------------------------------

/** 3D 목업 표지 목표 폭(px) — 모달 최대 표시폭(≈400px 높이) 대비 retina 여유. */
const MOCKUP_COVER_TARGET_PX = 720

/** 업스케일 상한 — 축소 캡처는 허용, 확대는 2배까지(메모리 폭발 방지, layerThumbnails 와 동일 규약). */
const MOCKUP_MAX_MULTIPLIER = 2

/**
 * fabric.Canvas 서브셋 — 영역 캡처에 필요한 최소 표면.
 * (단위테스트에서 fabric 인스턴스 없이 캡처 좌표 계산을 검증하기 위한 구조적 타입)
 */
export interface SpreadCaptureCanvas {
  disposed?: boolean
  getObjects(): ReadonlyArray<{
    id?: string
    getBoundingRect(): { left: number; top: number; width: number; height: number }
  }>
  toDataURL(options: {
    format?: 'png' | 'jpeg'
    quality?: number
    left?: number
    top?: number
    width?: number
    height?: number
    multiplier?: number
  }): string
}

export interface SpreadRegionCaptureOptions {
  /** 표지 1면 목표 폭(px). 기본 720. */
  targetCoverWidthPx?: number
  /** 인코딩 포맷. 기본 'jpeg'(3D 목업은 러프 시각화 — PNG 대비 메모리 1/5 수준). */
  format?: 'png' | 'jpeg'
  /** 인코딩 품질(0~1). 기본 0.9. */
  quality?: number
}

/**
 * 표지 스프레드 캔버스에서 영역별(뒷표지/책등/앞표지/날개) **트림** 이미지를 추출한다.
 *
 * 좌표 규약:
 * - workspace Rect = 트림 + 블리드(각 변 cutSizeMm/2) — WorkspacePlugin.reset() 참조.
 *   따라서 인쇄 결과(트림)만 보이도록 사방 블리드를 인셋한다.
 * - crop 좌표계는 workspace.getBoundingRect() 와 동일한 뷰포트 px — fabric 의
 *   toDataURL 은 픽셀 복사가 아니라 오프스크린 **재렌더**라, 화면 밖으로 나간
 *   확대/패닝 상태에서도 잘리지 않는다(썸네일 캡처와 동일 경로).
 * - 배율은 현재 줌과 무관하게 표지 1면이 targetCoverWidthPx 가 되도록 정규화.
 *
 * @returns 영역별 Data URL (캡처 불가 시 빈 객체 — 호출부는 placeholder 로 폴백)
 */
export function extractSpreadRegionImagesFromCanvas(
  canvas: SpreadCaptureCanvas | null | undefined,
  spec: SpreadSpec,
  options: SpreadRegionCaptureOptions = {}
): Partial<Record<SpreadRegionPosition, string>> {
  const images: Partial<Record<SpreadRegionPosition, string>> = {}
  if (!canvas || canvas.disposed) return images

  const workspace = canvas.getObjects().find((obj) => obj.id === 'workspace')
  if (!workspace) return images

  const bound = workspace.getBoundingRect()
  if (!(bound.width > 0) || !(bound.height > 0)) return images

  const ranges = computeSpreadRegionRangesMm(spec)
  if (ranges.length === 0) return images

  const trimWidthMm = ranges[ranges.length - 1].x1Mm
  const trimHeightMm = spec.coverHeightMm
  if (!(trimWidthMm > 0) || !(trimHeightMm > 0)) return images

  // 블리드는 사방 cutSizeMm/2 (WorkspacePlugin: workspace = size + cutSize)
  const bleedMm = Math.max(0, spec.cutSizeMm ?? 0) / 2
  const pxPerMmX = bound.width / (trimWidthMm + bleedMm * 2)
  const pxPerMmY = bound.height / (trimHeightMm + bleedMm * 2)

  const coverWidthPx = spec.coverWidthMm * pxPerMmX
  const targetPx = options.targetCoverWidthPx ?? MOCKUP_COVER_TARGET_PX
  const multiplier =
    coverWidthPx > 0 ? Math.min(MOCKUP_MAX_MULTIPLIER, targetPx / coverWidthPx) : 1

  const format = options.format ?? 'jpeg'
  const quality = options.quality ?? 0.9
  const top = bound.top + bleedMm * pxPerMmY
  const height = trimHeightMm * pxPerMmY

  for (const range of ranges) {
    const width = range.widthMm * pxPerMmX
    if (!(width > 0)) continue
    try {
      images[range.position] = canvas.toDataURL({
        format,
        quality,
        left: bound.left + (bleedMm + range.x0Mm) * pxPerMmX,
        top,
        width,
        height,
        multiplier,
      })
    } catch {
      // 외부 이미지로 오염(taint)된 캔버스 등 — 해당 영역만 건너뛰고 placeholder 로 폴백
    }
  }

  return images
}
