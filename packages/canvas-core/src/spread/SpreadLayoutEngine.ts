/**
 * SpreadLayoutEngine
 *
 * 순수 함수 기반 스프레드 레이아웃 계산 엔진
 * - 외부 의존성 없음 (Fabric.js 참조 금지)
 * - 모든 좌표는 workspace px 기준
 * - mm → px 변환은 computeLayout()에서만 수행
 */

import type {
  SpreadSpec,
  SpreadLayout,
  SpreadRegion,
  SpreadRegionPosition,
  GuideLineSpec,
  DimensionLabel,
  RepositionResult,
  ObjectAnchor,
  RegionRefResult,
  SpreadInnerSpec,
  SpreadInnerLayout,
  SpreadInnerRegion,
} from '@storige/types'
import { computeSpreadDimensions } from '@storige/types'

// ============================================================================
// Constants
// ============================================================================

const REGION_ORDER: SpreadRegionPosition[] = [
  'back-wing',
  'back-cover',
  'spine',
  'front-cover',
  'front-wing',
]

const PROMOTE_THRESHOLD = 0.9 // 승격 임계치
const DEMOTE_THRESHOLD = 0.7 // 강등 임계치
const ANCHOR_NORM_MIN = -1.0 // xNorm/yNorm 최소값
const ANCHOR_NORM_MAX = 2.0 // xNorm/yNorm 최대값

// ============================================================================
// Core Layout Computation
// ============================================================================

/**
 * mm → workspace px 변환
 */
function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}

/**
 * px → mm 변환
 */
function pxToMm(px: number, dpi: number): number {
  return (px * 25.4) / dpi
}

/**
 * 전체 스프레드 레이아웃 계산
 * 입력: SpreadSpec (mm 단위)
 * 출력: SpreadLayout (workspace px 단위)
 */
export function computeLayout(spec: SpreadSpec): SpreadLayout {
  const { coverWidthMm, coverHeightMm, spineWidthMm, wingEnabled, wingWidthMm, dpi } = spec

  // 1. 영역별 가로 크기 계산 (mm)
  const regionWidths: Record<SpreadRegionPosition, number> = {
    'back-wing': wingEnabled ? wingWidthMm : 0,
    'back-cover': coverWidthMm,
    'spine': spineWidthMm,
    'front-cover': coverWidthMm,
    'front-wing': wingEnabled ? wingWidthMm : 0,
  }

  // 2. 총 폭 계산 (공용 함수 위임)
  const dims = computeSpreadDimensions(spec)
  const totalWidthMm = dims.totalWidthMm
  const totalHeightMm = dims.totalHeightMm
  const totalWidthPx = mmToPx(totalWidthMm, dpi)
  const totalHeightPx = mmToPx(totalHeightMm, dpi)

  // 3. 영역 배치 (좌→우 순서)
  const regions: SpreadRegion[] = []
  let currentX = 0

  for (const position of REGION_ORDER) {
    const widthMm = regionWidths[position]
    if (widthMm <= 0) continue // 비활성화된 영역 skip

    const widthPx = mmToPx(widthMm, dpi)
    const heightPx = totalHeightPx

    const type = position.includes('wing') ? 'wing' : position === 'spine' ? 'spine' : 'cover'
    const label = getRegionLabel(position)

    regions.push({
      type,
      position,
      x: currentX,
      width: widthPx,
      height: heightPx,
      widthMm,
      heightMm: coverHeightMm,
      label,
    })

    currentX += widthPx
  }

  // 4. 가이드라인 생성 (영역 경계)
  const guides: GuideLineSpec[] = []
  for (let i = 0; i < regions.length - 1; i++) {
    const region = regions[i]
    const x = region.x + region.width
    guides.push({
      x,
      y1: 0,
      y2: totalHeightPx,
      type: 'region-border',
    })
  }

  // 5. 치수 라벨 생성
  const labels: DimensionLabel[] = regions.map((region) => ({
    x: region.x + region.width / 2,
    y: 20, // 콘텐츠 영역 상단에서 20px 아래 (workspace clipPath 안쪽)
    text: `${region.widthMm.toFixed(1)}mm`,
    regionPosition: region.position,
  }))

  return {
    regions,
    guides,
    labels,
    totalWidthPx,
    totalHeightPx,
    totalWidthMm,
    totalHeightMm,
  }
}

/**
 * 펼침면 내지(2-up) 레이아웃 계산 — 포토북 (O-2, 2026-06-24).
 *
 * 표지 computeLayout 과 별개. 입력 SpreadInnerSpec(mm), 출력 SpreadInnerLayout(workspace px, trim 기준).
 * - trim = pageWidthMm*2 × pageHeightMm (블리드 제외 — 표지와 동일하게 WorkspacePlugin 이 bleed 처리).
 * - 좌면(left-page) [0, pageWidthPx], 우면(right-page) [pageWidthPx, 2*pageWidthPx].
 * - gutterGuide = 중앙 제본 경계(좌/우 면 경계, x=pageWidthPx). gutterBandPx = 거터 안전 밴드(중앙 ±band/2).
 */
export function computeInnerSpreadLayout(spec: SpreadInnerSpec): SpreadInnerLayout {
  const { pageWidthMm, pageHeightMm, gutterMm, dpi } = spec

  const totalWidthMm = pageWidthMm * 2
  const totalHeightMm = pageHeightMm
  const pageWidthPx = mmToPx(pageWidthMm, dpi)
  const totalWidthPx = mmToPx(totalWidthMm, dpi)
  const totalHeightPx = mmToPx(totalHeightMm, dpi)

  const regions: SpreadInnerRegion[] = [
    {
      position: 'left-page',
      x: 0,
      width: pageWidthPx,
      height: totalHeightPx,
      widthMm: pageWidthMm,
      heightMm: pageHeightMm,
      label: '좌면',
    },
    {
      position: 'right-page',
      x: pageWidthPx,
      width: pageWidthPx,
      height: totalHeightPx,
      widthMm: pageWidthMm,
      heightMm: pageHeightMm,
      label: '우면',
    },
  ]

  // 중앙 제본 경계선(좌/우 면 경계)
  const gutterGuide: GuideLineSpec = {
    x: pageWidthPx,
    y1: 0,
    y2: totalHeightPx,
    type: 'region-border',
  }

  // 거터 안전 밴드(px) — 제본 손실 회피 영역(중앙 ±gutterBandPx/2)
  const gutterBandPx = Math.max(0, mmToPx(gutterMm, dpi))

  return {
    regions,
    gutterGuide,
    gutterBandPx,
    totalWidthPx,
    totalHeightPx,
    totalWidthMm,
    totalHeightMm,
  }
}

/**
 * 책등 폭 변경 시 새 레이아웃 계산
 */
export function computeResizedLayout(
  currentLayout: SpreadLayout,
  spec: SpreadSpec,
  newSpineWidthMm: number
): SpreadLayout {
  // 새 스펙으로 레이아웃 재계산
  const newSpec: SpreadSpec = {
    ...spec,
    spineWidthMm: newSpineWidthMm,
  }

  return computeLayout(newSpec)
}

/**
 * x 좌표 → 영역 판정 (단순 x-range 비교)
 */
export function resolveRegionAtX(
  regions: SpreadRegion[],
  x: number
): SpreadRegion | null {
  for (const region of regions) {
    if (x >= region.x && x < region.x + region.width) {
      return region
    }
  }
  return null
}

// ============================================================================
// Object Repositioning
// ============================================================================

/**
 * 객체 재배치 계산
 *
 * @param objectMeta - 객체 메타데이터 (regionRef, anchor)
 * @param boundingRect - 객체 바운딩 박스 { left, top, width, height }
 * @param oldLayout - 이전 레이아웃
 * @param newLayout - 새 레이아웃
 * @returns 새 위치/스케일 + 갱신된 anchor
 */
export function computeObjectReposition(
  objectMeta: {
    regionRef: SpreadRegionPosition | null
    anchor: ObjectAnchor
  },
  boundingRect: { left: number; top: number; width: number; height: number },
  oldLayout: SpreadLayout,
  newLayout: SpreadLayout
): RepositionResult {
  const { regionRef, anchor } = objectMeta

  // 자유 객체 (regionRef=null): 절대좌표 유지
  if (regionRef === null) {
    if (anchor.kind === 'canvas') {
      return {
        x: anchor.x,
        y: anchor.y,
        regionRef: null,
        anchor,
      }
    }
    // fallback: 현재 중심점 유지
    const centerX = boundingRect.left + boundingRect.width / 2
    const centerY = boundingRect.top + boundingRect.height / 2
    return {
      x: centerX,
      y: centerY,
      regionRef: null,
      anchor: { kind: 'canvas', x: centerX, y: centerY },
    }
  }

  // 영역 객체: 영역 기준 재배치
  const oldRegion = oldLayout.regions.find((r) => r.position === regionRef)
  const newRegion = newLayout.regions.find((r) => r.position === regionRef)

  if (!oldRegion || !newRegion) {
    // 영역이 없어진 경우 (예: 날개 비활성화) → 자유 객체로 강등
    const centerX = boundingRect.left + boundingRect.width / 2
    const centerY = boundingRect.top + boundingRect.height / 2
    return {
      x: centerX,
      y: centerY,
      regionRef: null,
      anchor: { kind: 'canvas', x: centerX, y: centerY },
    }
  }

  if (anchor.kind === 'region') {
    // 정규화 좌표로 새 위치 계산
    const clampedXNorm = clamp(anchor.xNorm, ANCHOR_NORM_MIN, ANCHOR_NORM_MAX)
    const clampedYNorm = clamp(anchor.yNorm, ANCHOR_NORM_MIN, ANCHOR_NORM_MAX)

    const newX = newRegion.x + clampedXNorm * newRegion.width
    const newY = clampedYNorm * newRegion.height

    return {
      x: newX,
      y: newY,
      regionRef,
      anchor: {
        kind: 'region',
        xNorm: clampedXNorm,
        yNorm: clampedYNorm,
      },
    }
  }

  // fallback: 영역 중앙
  return {
    x: newRegion.x + newRegion.width / 2,
    y: newRegion.height / 2,
    regionRef,
    anchor: {
      kind: 'region',
      xNorm: 0.5,
      yNorm: 0.5,
    },
  }
}

// ============================================================================
// Region Ref Resolution (Hysteresis)
// ============================================================================

/**
 * RegionRef 판정 (히스테리시스 적용)
 *
 * @param regions - 영역 리스트
 * @param boundingRect - 객체 바운딩 박스 (stroke 포함)
 * @param currentRegionRef - 현재 regionRef (히스테리시스 기준점)
 * @returns 새 regionRef + primaryRegionHint + anchor
 */
export function resolveRegionRef(
  regions: SpreadRegion[],
  boundingRect: { left: number; top: number; width: number; height: number },
  currentRegionRef: SpreadRegionPosition | null
): RegionRefResult {
  const { left, top, width, height } = boundingRect

  // 객체 중심점
  const centerX = left + width / 2
  const centerY = top + height / 2

  // 각 영역과의 교차 면적 계산
  const overlaps: Array<{
    region: SpreadRegion
    area: number
    ratio: number
  }> = []

  const objectArea = width * height

  for (const region of regions) {
    const overlapLeft = Math.max(left, region.x)
    const overlapRight = Math.min(left + width, region.x + region.width)
    const overlapTop = Math.max(top, 0)
    const overlapBottom = Math.min(top + height, region.height)

    const overlapWidth = Math.max(0, overlapRight - overlapLeft)
    const overlapHeight = Math.max(0, overlapBottom - overlapTop)
    const overlapArea = overlapWidth * overlapHeight

    const ratio = objectArea > 0 ? overlapArea / objectArea : 0

    if (ratio > 0) {
      overlaps.push({ region, area: overlapArea, ratio })
    }
  }

  // 겹치는 영역이 없으면 자유 객체
  if (overlaps.length === 0) {
    return {
      regionRef: null,
      primaryRegionHint: null,
      anchor: { kind: 'canvas', x: centerX, y: centerY },
    }
  }

  // 가장 많이 겹치는 영역 찾기
  overlaps.sort((a, b) => b.ratio - a.ratio)
  const primaryOverlap = overlaps[0]

  // 히스테리시스 적용
  let newRegionRef: SpreadRegionPosition | null = null

  if (currentRegionRef === null) {
    // 승격: 90% 이상 포함 시
    if (primaryOverlap.ratio >= PROMOTE_THRESHOLD) {
      newRegionRef = primaryOverlap.region.position
    }
  } else {
    // 현재 소속 영역과의 겹침 확인
    const currentOverlap = overlaps.find(
      (o) => o.region.position === currentRegionRef
    )

    if (currentOverlap && currentOverlap.ratio >= DEMOTE_THRESHOLD) {
      // 유지: 70% 이상이면 현재 regionRef 유지
      newRegionRef = currentRegionRef
    } else {
      // 강등: 70% 미만이면 자유 객체로
      newRegionRef = null
    }
  }

  // primaryRegionHint는 항상 가장 많이 겹치는 영역
  const primaryRegionHint = primaryOverlap.region.position

  // anchor 계산
  let anchor: ObjectAnchor

  if (newRegionRef !== null) {
    // 영역 객체: region anchor
    const region = regions.find((r) => r.position === newRegionRef)!
    const xNorm = (centerX - region.x) / region.width
    const yNorm = centerY / region.height

    anchor = {
      kind: 'region',
      xNorm: clamp(xNorm, ANCHOR_NORM_MIN, ANCHOR_NORM_MAX),
      yNorm: clamp(yNorm, ANCHOR_NORM_MIN, ANCHOR_NORM_MAX),
    }
  } else {
    // 자유 객체: canvas anchor
    anchor = { kind: 'canvas', x: centerX, y: centerY }
  }

  return {
    regionRef: newRegionRef,
    primaryRegionHint,
    anchor,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * 영역 라벨 텍스트
 */
function getRegionLabel(position: SpreadRegionPosition): string {
  const labels: Record<SpreadRegionPosition, string> = {
    'back-wing': '뒷날개',
    'back-cover': '뒷표지',
    'spine': '책등',
    'front-cover': '앞표지',
    'front-wing': '앞날개',
  }
  return labels[position]
}

/**
 * 값 클램핑
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
