/**
 * 알파 기반 '정밀 외곽' 순수 계산 (R7, 2026-08-11)
 *
 * 종전 `createPrecisePathFromObject` / `drawCaseOutlinePrecise` 의 cv 파이프라인
 * (split→threshold→distanceTransform→threshold→findContours→hull)을 순수 JS 로 이식한 코어다.
 * opencv-js 는 이 프로젝트의 어떤 환경에서도 초기화가 끝나지 않는다(→ pureContour.ts 헤더 실측).
 *
 * 보존한 종전 규약:
 *  - 이진화: 알파 > threshold (cv.threshold THRESH_BINARY 의 strict greater)
 *  - 안쪽 오프셋: 배경까지의 거리 > insetPx 인 픽셀만 유지
 *    (cv.distanceTransform(DIST_L2, 3) + threshold — 여기서는 1/√2 chamfer 2-pass 근사)
 *  - 윤곽 선택: 면적>1000 필터·다중이면 convex hull·점 예산 — extractContoursFromMask 공유
 *
 * 의도적 차이: 종전 cv 경로는 CHAIN_APPROX_SIMPLE 원시점을 그대로 썼지만, 여기서는 칼선
 * 정본(pureContour)과 동일하게 둘레 비율 epsilon 의 DP 근사를 적용한다 — 형태는 보존되고
 * d3 path 문자열·fabric.Path 파싱 비용이 크게 줄어든다.
 */

import type { ContourExtractResult } from './contourExtractor'
import { extractContoursFromMask } from './pureContour'

/**
 * RGBA → 알파 임계 이진 마스크. 알파가 threshold 를 **초과**하는 픽셀만 전경(1).
 * (cv.threshold(alpha, bin, threshold, 255, THRESH_BINARY) 와 동치 — RGB 는 보지 않는다)
 */
export function maskFromAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
    if (data[p] > threshold) mask[i] = 1
  }
  return mask
}

/**
 * 이진 마스크 침식 — 배경(0)까지의 chamfer 거리(직교 1, 대각 √2)가 radius **초과**인
 * 전경 픽셀만 남긴다. cv.distanceTransform(DIST_L2, 3) 후 threshold(dist, radius, BINARY)
 * 규약의 순수 JS 근사(3×3 chamfer 오차 ≈4% — 칼선 inset 용도에 충분).
 * 2-pass 라 O(w×h) 이고 입력은 장변 캡 적용본(≤1.6MP)이라 수 ms 수준이다.
 */
export function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return mask.slice()

  const INF = 1e9
  const SQRT2 = Math.SQRT2
  const dist = new Float32Array(width * height)
  for (let i = 0; i < dist.length; i++) {
    dist[i] = mask[i] === 0 ? 0 : INF
  }

  // forward pass — 좌상→우하. 이미 방문한 이웃(W, N, NW, NE)만 본다.
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      let d = dist[i]
      if (d === 0) continue
      if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1
      if (y > 0) {
        if (dist[i - width] + 1 < d) d = dist[i - width] + 1
        if (x > 0 && dist[i - width - 1] + SQRT2 < d) d = dist[i - width - 1] + SQRT2
        if (x < width - 1 && dist[i - width + 1] + SQRT2 < d) d = dist[i - width + 1] + SQRT2
      }
      dist[i] = d
    }
  }

  // backward pass — 우하→좌상. 이웃(E, S, SE, SW).
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x
      let d = dist[i]
      if (d === 0) continue
      if (x < width - 1 && dist[i + 1] + 1 < d) d = dist[i + 1] + 1
      if (y < height - 1) {
        if (dist[i + width] + 1 < d) d = dist[i + width] + 1
        if (x < width - 1 && dist[i + width + 1] + SQRT2 < d) d = dist[i + width + 1] + SQRT2
        if (x > 0 && dist[i + width - 1] + SQRT2 < d) d = dist[i + width - 1] + SQRT2
      }
      dist[i] = d
    }
  }

  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) {
    if (dist[i] > radius) out[i] = 1
  }
  return out
}

export interface PreciseOutlineInput {
  /** 대상 래스터(캡 적용본)의 RGBA 픽셀 */
  data: Uint8ClampedArray
  width: number
  height: number
  /** 알파 임계값 — 초과(>) 픽셀만 전경 (종전 threshold 규약) */
  alphaThreshold: number
  /** 안쪽 오프셋(px, 래스터 좌표계) — 0 이면 침식 생략 */
  insetPx: number
  /** 컨투어 스캔 상한(CONTOUR_SCAN_LIMIT) */
  scanLimit: number
  /** convexHull 입력 점 예산(HULL_MAX_INPUT_POINTS) */
  hullMaxInputPoints: number
  /** DP 근사 epsilon = 둘레 × 이 비율(CONTOUR_APPROX_EPSILON_RATIO) */
  approxEpsilonRatio: number
}

/**
 * 알파 이진화 → (필요 시) 침식 → 윤곽 추출. 결과 좌표는 입력 래스터 좌표계다 —
 * 역보정(캡 배율·객체 변환)은 호출부(ImageProcessingPlugin)가 한다.
 */
export function computePreciseOutline(input: PreciseOutlineInput): ContourExtractResult {
  const { data, width, height } = input
  let mask = maskFromAlpha(data, width, height, input.alphaThreshold)
  if (input.insetPx > 0) {
    mask = erodeMask(mask, width, height, input.insetPx)
  }
  return extractContoursFromMask({
    mask,
    width,
    height,
    scanLimit: input.scanLimit,
    hullMaxInputPoints: input.hullMaxInputPoints,
    approxEpsilonRatio: input.approxEpsilonRatio
  })
}
