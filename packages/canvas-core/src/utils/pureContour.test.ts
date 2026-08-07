// 순수 JS 윤곽 추출 회귀 잠금 (2026-08-07 — OpenCV 대체)
//
// 배경: dist/opencv.js 는 메인 스레드에서도 워커에서도 초기화가 끝나지 않아(실측)
// 칼선 파이프라인에서 cv 를 제거했다. 이 스위트가 종전 cv 규약과의 동등성을 잠근다:
// 마스크 판정(R|G|B>0) · 면적>1000 필터 · 다중 컴포넌트 → convex hull · DP 근사 · 상한 가드.
import { describe, it, expect } from 'vitest'
import { extractContoursPure } from './pureContour'
import type { ContourExtractInput } from './contourExtractor'

/** w×h 투명 캔버스에 사각형들을 채운 RGBA 를 만든다. */
function makeInput(
  w: number,
  h: number,
  rects: { x: number; y: number; w: number; h: number; rgb?: [number, number, number] }[],
  overrides: Partial<ContourExtractInput> = {}
): ContourExtractInput {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const r of rects) {
    const [cr, cg, cb] = r.rgb ?? [200, 60, 60]
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = (y * w + x) * 4
        data[p] = cr
        data[p + 1] = cg
        data[p + 2] = cb
        data[p + 3] = 255
      }
    }
  }
  return {
    data,
    width: w,
    height: h,
    kSize: 1,
    scanLimit: 5000,
    hullMaxInputPoints: 20000,
    approxEpsilonRatio: 0.0008,
    ...overrides
  }
}

const bounds = (pts: [number, number][]) => ({
  minX: Math.min(...pts.map((p) => p[0])),
  maxX: Math.max(...pts.map((p) => p[0])),
  minY: Math.min(...pts.map((p) => p[1])),
  maxY: Math.max(...pts.map((p) => p[1]))
})

describe('extractContoursPure — 종전 cv 규약 동등성', () => {
  it('단일 사각형: useHull=false, 외곽 경계를 정확히 감싼다(DP 후에도 형태 보존)', () => {
    const input = makeInput(200, 160, [{ x: 40, y: 30, w: 100, h: 80 }])

    const res = extractContoursPure(input)

    expect(res.useHull).toBe(false)
    expect(res.points.length).toBeGreaterThanOrEqual(4)
    const b = bounds(res.points)
    expect(b.minX).toBe(40)
    expect(b.minY).toBe(30)
    expect(b.maxX).toBe(139) // 픽셀 경계(포함 좌표)
    expect(b.maxY).toBe(109)
    // DP 근사가 실제로 작동한다 — 사각형은 소수 점으로 줄어든다
    expect(res.points.length).toBeLessThan(60)
  })

  it('면적 ≤1000 컴포넌트는 걸러진다(종전 area>1000 필터)', () => {
    // 31×31=961 ≤ 1000 → 제외, 60×60=3600 → 유지
    const input = makeInput(200, 200, [
      { x: 5, y: 5, w: 31, h: 31 },
      { x: 100, y: 100, w: 60, h: 60 }
    ])

    const res = extractContoursPure(input)

    expect(res.useHull).toBe(false) // 큰 것 하나만 남는다
    const b = bounds(res.points)
    expect(b.minX).toBeGreaterThanOrEqual(100)
    expect(b.minY).toBeGreaterThanOrEqual(100)
  })

  it('컴포넌트 2개 이상이면 convex hull 로 합친다(useHull=true) — 두 블롭을 모두 포함', () => {
    const input = makeInput(300, 200, [
      { x: 10, y: 10, w: 60, h: 60 },
      { x: 220, y: 120, w: 60, h: 60 }
    ])

    const res = extractContoursPure(input)

    expect(res.useHull).toBe(true)
    const b = bounds(res.points)
    expect(b.minX).toBeLessThanOrEqual(10)
    expect(b.maxX).toBeGreaterThanOrEqual(279)
    expect(b.minY).toBeLessThanOrEqual(10)
    expect(b.maxY).toBeGreaterThanOrEqual(179)
    // hull 은 볼록 — 점 수가 과도하지 않다
    expect(res.points.length).toBeLessThan(40)
  })

  it('완전 투명 입력: 빈 결과(다운스트림이 오류 경로로 처리)', () => {
    const input = makeInput(64, 64, [])
    const res = extractContoursPure(input)
    expect(res.points).toEqual([])
    expect(res.useHull).toBe(false)
  })

  it('검정(0,0,0) 불투명 픽셀은 배경으로 판정된다 — 종전 그레이>0 규약 보존', () => {
    const input = makeInput(120, 120, [
      { x: 10, y: 10, w: 50, h: 50, rgb: [0, 0, 0] }, // 종전 규약상 배경
      { x: 70, y: 70, w: 40, h: 40, rgb: [10, 0, 0] } // 유지
    ])

    const res = extractContoursPure(input)

    expect(res.useHull).toBe(false)
    const b = bounds(res.points)
    expect(b.minX).toBeGreaterThanOrEqual(70)
  })

  it('점 예산: 아주 많은 경계점도 hullMaxInputPoints 안으로 샘플링된다', () => {
    const input = makeInput(400, 300, [{ x: 2, y: 2, w: 396, h: 296 }], {
      hullMaxInputPoints: 128,
      approxEpsilonRatio: 0 // 근사 없이 예산만 검증(엣지: epsilon 최소 0.5 적용)
    })

    const res = extractContoursPure(input)

    expect(res.points.length).toBeLessThanOrEqual(128)
    const b = bounds(res.points)
    expect(b.maxX - b.minX).toBeGreaterThan(380) // 샘플링이 형태를 보존한다
  })

  it('경계 추적은 이미지 가장자리에 닿은 도형에서도 유한하다(상한 가드)', () => {
    const input = makeInput(64, 64, [{ x: 0, y: 0, w: 64, h: 64 }])
    const res = extractContoursPure(input)
    const b = bounds(res.points)
    expect(b.minX).toBe(0)
    expect(b.maxX).toBe(63)
  })
})
