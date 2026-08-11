// 정밀 외곽 순수 계산 회귀 잠금 (R7, 2026-08-11 — cv 정밀 경로 이식)
//
// 종전 cv 규약과의 동등성을 잠근다:
//  - 알파 > threshold (strict greater) 이진화 — RGB 무시
//  - 거리변환 > insetPx 안쪽 오프셋 (chamfer 1/√2 근사)
//  - 마스크 기반 윤곽 코어(extractContoursFromMask)는 extractContoursPure 와 동일 규약
import { describe, it, expect } from 'vitest'
import { maskFromAlpha, erodeMask, computePreciseOutline } from './preciseOutline'
import { extractContoursPure, extractContoursFromMask } from './pureContour'
import type { ContourExtractInput } from './contourExtractor'

/** w×h 투명 래스터에 알파 블록을 채운 RGBA */
function makeRaster(
  w: number,
  h: number,
  blocks: { x: number; y: number; w: number; h: number; alpha?: number; rgb?: [number, number, number] }[]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const b of blocks) {
    const [r, g, bl] = b.rgb ?? [200, 60, 60]
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        const p = (y * w + x) * 4
        data[p] = r
        data[p + 1] = g
        data[p + 2] = bl
        data[p + 3] = b.alpha ?? 255
      }
  }
  return data
}

const CONTOUR_OPTS = {
  scanLimit: 5000,
  hullMaxInputPoints: 20000,
  approxEpsilonRatio: 0.0008
}

describe('maskFromAlpha — 알파 임계 이진화 (cv.threshold BINARY 동치)', () => {
  it('알파가 threshold 를 초과(strict >)하는 픽셀만 전경이다', () => {
    const data = new Uint8ClampedArray(3 * 1 * 4)
    data[3] = 224 // 미만 → 0
    data[7] = 225 // 동일 → 0 (strict greater)
    data[11] = 226 // 초과 → 1

    const mask = maskFromAlpha(data, 3, 1, 225)

    expect(Array.from(mask)).toEqual([0, 0, 1])
  })

  it('RGB 는 판정에 관여하지 않는다 — 완전 검정이라도 알파가 높으면 전경', () => {
    const data = new Uint8ClampedArray(2 * 1 * 4)
    // 픽셀0: RGB 255 이지만 알파 0 → 배경
    data[0] = 255
    data[1] = 255
    data[2] = 255
    // 픽셀1: RGB 0(완전 검정) + 알파 255 → 전경
    data[7] = 255

    const mask = maskFromAlpha(data, 2, 1, 128)

    expect(Array.from(mask)).toEqual([0, 1])
  })
})

describe('erodeMask — 거리변환 기반 침식 (cv.distanceTransform+threshold 동치)', () => {
  /** [x0..x1]×[y0..y1] 블록 마스크 */
  const blockMask = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => {
    const mask = new Uint8Array(w * h)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * w + x] = 1
    return mask
  }

  it('radius 0 이하는 원본과 동일하다(사본 반환)', () => {
    const mask = blockMask(6, 6, 1, 1, 4, 4)

    const out = erodeMask(mask, 6, 6, 0)

    expect(Array.from(out)).toEqual(Array.from(mask))
    expect(out).not.toBe(mask) // 원본 비파괴
  })

  it('radius 2 는 사각 블록의 각 변을 정확히 2px 깎는다', () => {
    // 20×20, 블록 [5..14]² — 경계 인접 픽셀의 chamfer 거리 1, 안쪽으로 +1씩.
    // dist > 2 인 픽셀 = [7..12]² (각 변 2px 침식)
    const mask = blockMask(20, 20, 5, 5, 14, 14)

    const out = erodeMask(mask, 20, 20, 2)

    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const expected = x >= 7 && x <= 12 && y >= 7 && y <= 12 ? 1 : 0
        expect(out[y * 20 + x]).toBe(expected)
      }
  })

  it('블록보다 큰 radius 는 전부 침식한다', () => {
    const mask = blockMask(8, 8, 2, 2, 5, 5) // 4×4 → 중심 거리 최대 2

    const out = erodeMask(mask, 8, 8, 2)

    expect(out.every((v) => v === 0)).toBe(true)
  })

  it('대각 방향 거리는 √2 가중으로 근사된다 — 모서리가 직교 변보다 먼저 깎인다', () => {
    // 10×10 블록 [2..7]², radius 1.2:
    //  - 변 중앙 안쪽 1px(직교 거리 2) → 유지
    //  - 모서리 픽셀 (2,2)는 대각 배경 (1,1)까지 √2≈1.414 > 1.2 지만
    //    직교 배경 (1,2)까지 1 ≤ 1.2 → 침식 (직교가 지배)
    //  - 모서리 안쪽 (3,3)은 최단 배경까지 chamfer 2(직교) 또는 √2+1≈2.41 → 유지
    const mask = blockMask(10, 10, 2, 2, 7, 7)

    const out = erodeMask(mask, 10, 10, 1.2)

    expect(out[2 * 10 + 2]).toBe(0) // 모서리 침식
    expect(out[3 * 10 + 3]).toBe(1) // 모서리 한 칸 안쪽 유지
    expect(out[4 * 10 + 3]).toBe(1) // 변 안쪽 1px 유지
    expect(out[4 * 10 + 2]).toBe(0) // 변 경계 픽셀(거리 1) 침식
  })
})

describe('computePreciseOutline — 이진화→침식→윤곽 파이프라인', () => {
  it('불투명 사각형의 외곽 bounding 이 블록과 일치한다 (inset 0)', () => {
    // 64×64, 블록 [8..55]² (48² = 2304 > 1000 → 면적 필터 통과)
    const data = makeRaster(64, 64, [{ x: 8, y: 8, w: 48, h: 48 }])

    const result = computePreciseOutline({
      data,
      width: 64,
      height: 64,
      alphaThreshold: 128,
      insetPx: 0,
      ...CONTOUR_OPTS
    })

    expect(result.points.length).toBeGreaterThanOrEqual(4)
    expect(result.useHull).toBe(false)
    const xs = result.points.map((p) => p[0])
    const ys = result.points.map((p) => p[1])
    expect(Math.min(...xs)).toBe(8)
    expect(Math.max(...xs)).toBe(55)
    expect(Math.min(...ys)).toBe(8)
    expect(Math.max(...ys)).toBe(55)
  })

  it('insetPx 는 외곽을 안쪽으로 정확히 당긴다', () => {
    const data = makeRaster(64, 64, [{ x: 8, y: 8, w: 48, h: 48 }])

    const result = computePreciseOutline({
      data,
      width: 64,
      height: 64,
      alphaThreshold: 128,
      insetPx: 4,
      ...CONTOUR_OPTS
    })

    const xs = result.points.map((p) => p[0])
    const ys = result.points.map((p) => p[1])
    expect(Math.min(...xs)).toBe(12)
    expect(Math.max(...xs)).toBe(51)
    expect(Math.min(...ys)).toBe(12)
    expect(Math.max(...ys)).toBe(51)
  })

  it('임계값 이하 알파(반투명)는 배경으로 본다 → 빈 결과', () => {
    const data = makeRaster(32, 32, [{ x: 4, y: 4, w: 24, h: 24, alpha: 100 }])

    const result = computePreciseOutline({
      data,
      width: 32,
      height: 32,
      alphaThreshold: 128,
      insetPx: 0,
      ...CONTOUR_OPTS
    })

    expect(result.points).toEqual([])
  })

  it('분리된 두 블록은 convex hull 로 합친다 (종전 useHull 규약)', () => {
    const data = makeRaster(128, 64, [
      { x: 4, y: 4, w: 40, h: 40 },
      { x: 80, y: 10, w: 40, h: 40 }
    ])

    const result = computePreciseOutline({
      data,
      width: 128,
      height: 64,
      alphaThreshold: 128,
      insetPx: 0,
      ...CONTOUR_OPTS
    })

    expect(result.useHull).toBe(true)
    const xs = result.points.map((p) => p[0])
    expect(Math.min(...xs)).toBe(4)
    expect(Math.max(...xs)).toBe(119)
  })
})

describe('extractContoursFromMask — extractContoursPure 와의 코어 공유 정합', () => {
  it('동일 형상에 대해 RGBA 경로(extractContoursPure)와 결과가 일치한다', () => {
    const w = 64
    const h = 64
    const data = makeRaster(w, h, [{ x: 10, y: 10, w: 40, h: 40 }])
    const input: ContourExtractInput = {
      data,
      width: w,
      height: h,
      kSize: 1,
      ...CONTOUR_OPTS
    }
    // pureContour 마스크 규약(R|G|B 비영)과 동치인 마스크를 직접 구성
    const mask = new Uint8Array(w * h)
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if ((data[p] | data[p + 1] | data[p + 2]) !== 0) mask[i] = 1
    }

    const viaRgba = extractContoursPure(input)
    const viaMask = extractContoursFromMask({ mask, width: w, height: h, ...CONTOUR_OPTS })

    expect(viaMask.points).toEqual(viaRgba.points)
    expect(viaMask.useHull).toBe(viaRgba.useHull)
  })
})
