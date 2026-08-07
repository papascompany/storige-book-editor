/**
 * 순수 JS 알파 윤곽 추출 — OpenCV 대체 (2026-08-07)
 *
 * 최종 실측: @techstark/opencv-js(dist/opencv.js)는 **메인 스레드에서도, Web Worker 안에서도
 * 초기화가 끝나지 않았다**(실제 Chrome — 메인: 탭 10분+ 동결 / 워커: 60s 타임아웃까지 미완료).
 * 칼선에 필요한 연산은 전부 고전 알고리즘이라 의존 없이 직접 구현한다:
 *
 *   이진 마스크 → 연결 성분(8-이웃) → Moore 경계 추적 → (다중이면) convex hull
 *   → Douglas-Peucker 근사 — 종전 cv 파이프라인(cvtColor→threshold→findContours→
 *   convexHull→approxPolyDP)과 규약 동등.
 *
 * 의도적으로 보존한 종전 규약:
 *  - 마스크 판정: BGR2GRAY 후 threshold(0, BINARY) 는 결국 "R|G|B 중 하나라도 >0" 이다
 *    (가중치가 전부 양수). 완전 검정(0,0,0)인 불투명 픽셀이 배경으로 빠지는 기존 특성도 그대로다.
 *  - 면적 > 1000 필터, 스캔 상한(scanLimit), hull 입력 점 예산(hullMaxInputPoints),
 *    epsilon = 둘레 × approxEpsilonRatio(최소 0.5).
 *  - 컴포넌트가 2개 이상이면 전체 점의 convex hull(useHull=true), 1개면 그 외곽선.
 *
 * 입력은 장변 캡(CONTOUR_MAX_LONG_EDGE=1280) 적용본이라 최대 ≈1.6MP — 전 단계 합쳐
 * 수십 ms 수준이고, 상한 가드(추적 스텝·점 예산)로 최악에도 유한하다.
 */

import type { ContourExtractInput, ContourExtractResult } from './contourExtractor'

/** 시계방향 8-이웃: E, SE, S, SW, W, NW, N, NE (화면 좌표계 — y 아래가 +) */
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]

interface Component {
  id: number
  area: number
  /** 스캔 순서상 첫 픽셀 = 최상단 행의 최좌측 → Moore 추적 시작점으로 적합 */
  startX: number
  startY: number
}

/** RGBA → 이진 마스크. 종전 cv 규약(그레이 > 0)과 동치인 "R|G|B 비영" 판정. */
function buildMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if ((data[p] | data[p + 1] | data[p + 2]) !== 0) mask[i] = 1
  }
  return mask
}

/** 8-이웃 연결 성분 라벨링(반복 flood fill — 재귀 금지). labels 는 1부터. */
function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number
): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h)
  const components: Component[] = []
  const stack: number[] = []
  let nextId = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (mask[idx] === 0 || labels[idx] !== 0) continue

      const id = ++nextId
      let area = 0
      stack.length = 0
      stack.push(idx)
      labels[idx] = id
      while (stack.length > 0) {
        const cur = stack.pop() as number
        area++
        const cx = cur % w
        const cy = (cur - cx) / w
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d]
          const ny = cy + DY[d]
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const n = ny * w + nx
          if (mask[n] === 1 && labels[n] === 0) {
            labels[n] = id
            stack.push(n)
          }
        }
      }
      components.push({ id, area, startX: x, startY: y })
    }
  }
  return { labels, components }
}

/**
 * Moore 경계 추적(시계방향). 도착 셀 기준, 직전 셀(backtrack) 다음 방향부터 시계방향 탐색.
 * 시작점은 컴포넌트의 최상단-최좌측 픽셀이라 가상 backtrack 은 서(W)쪽이다.
 */
function traceBoundary(labels: Int32Array, w: number, h: number, comp: Component): [number, number][] {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === comp.id

  const { startX: sx, startY: sy } = comp
  const points: [number, number][] = [[sx, sy]]
  let cx = sx
  let cy = sy
  let backtrack = 4 // W

  // 경계 길이는 픽셀 수에 비례하지만, 규약 오차에 대비한 절대 상한을 둔다.
  const maxSteps = Math.min(4 * comp.area + 8, 4 * w * h)
  let firstMove = -1

  const nextDir = (from: number): number => {
    for (let k = 1; k <= 8; k++) {
      const d = (from + k) % 8
      if (inside(cx + DX[d], cy + DY[d])) return d
    }
    return -1
  }

  for (let step = 0; step < maxSteps; step++) {
    const found = nextDir(backtrack)
    if (found < 0) break // 고립 1픽셀 컴포넌트

    cx += DX[found]
    cy += DY[found]
    backtrack = (found + 4) % 8

    if (cx === sx && cy === sy) {
      // Jacob 정지 조건: 시작점 복귀 후 **다음 출발 방향**이 첫 출발 방향과 같으면
      // 한 바퀴가 완성된 것이다. (도착 방향과 비교하면 절대 안 끝난다 —
      // 사각형에서 첫 출발은 E, 복귀 도착은 N 계열이라 조건이 영원히 거짓이었던 실버그)
      if (firstMove < 0) break // 즉시 복귀하는 퇴화 형태
      const departNext = nextDir(backtrack)
      if (departNext < 0 || departNext === firstMove) break
      // 1픽셀 폭 브리지 등으로 시작점을 '통과'하는 경우 — 기록 없이 계속 추적
      continue
    }

    if (firstMove < 0) firstMove = found
    points.push([cx, cy])
  }
  return points
}

/** Andrew monotone chain convex hull — 시계/반시계 무관하게 닫힌 다각형 점을 돌려준다. */
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 3) return points.slice()
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** 점-선분 수직 거리 제곱(정밀도·속도용 — DP 는 대소 비교만 한다). */
function distSqToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return apx * apx + apy * apy
  let t = (apx * abx + apy * aby) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = apx - t * abx
  const dy = apy - t * aby
  return dx * dx + dy * dy
}

/** Douglas-Peucker(반복형 — 재귀 깊이 폭발 방지). 열린 폴리라인 기준. */
function douglasPeuckerOpen(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points.slice()
  const epsSq = epsilon * epsilon
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number]
    let maxD = -1
    let maxI = -1
    for (let i = s + 1; i < e; i++) {
      const d = distSqToSegment(points[i], points[s], points[e])
      if (d > maxD) {
        maxD = d
        maxI = i
      }
    }
    if (maxD > epsSq && maxI > 0) {
      keep[maxI] = 1
      stack.push([s, maxI], [maxI, e])
    }
  }
  const out: [number, number][] = []
  for (let i = 0; i < points.length; i++) if (keep[i] === 1) out.push(points[i])
  return out
}

/** 닫힌 다각형 DP — 최원점 둘로 쪼개 각각 근사(고정 끝점 편향 제거). */
function simplifyClosed(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 4) return points.slice()
  // 기준점(0)에서 가장 먼 점을 분할점으로
  let far = 1
  let maxD = -1
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[0][0]
    const dy = points[i][1] - points[0][1]
    const d = dx * dx + dy * dy
    if (d > maxD) {
      maxD = d
      far = i
    }
  }
  const a = douglasPeuckerOpen(points.slice(0, far + 1), epsilon)
  const b = douglasPeuckerOpen(points.slice(far).concat([points[0]]), epsilon)
  // 이음새 중복점 제거(a 의 끝 = b 의 처음, b 의 끝 = a 의 처음)
  return a.concat(b.slice(1, -1))
}

function perimeterOf(points: [number, number][]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += Math.hypot(x2 - x1, y2 - y1)
  }
  return sum
}

/** 균등 샘플링(예산 초과 시) — 앞뒤를 자르면 도형이 열리므로 반드시 균등 간격. */
function samplePoints(points: [number, number][], budget: number): [number, number][] {
  if (points.length <= budget) return points
  const step = points.length / budget
  const out: [number, number][] = []
  for (let i = 0; i < budget; i++) out.push(points[Math.floor(i * step)])
  return out
}

/**
 * 기본 윤곽 추출기 — `ContourExtractor` 계약의 순수 JS 구현.
 * 종전 cv 파이프라인의 면적 필터·스캔 상한·hull 규칙·근사 규약을 그대로 따른다.
 */
export function extractContoursPure(input: ContourExtractInput): ContourExtractResult {
  const { data, width: w, height: h } = input
  const mask = buildMask(data, w, h)
  const { labels, components } = labelComponents(mask, w, h)

  // 면적 내림차순 → 필터(>1000) → 스캔 상한
  const sorted = components.slice().sort((a, b) => b.area - a.area)
  const considered = sorted.slice(0, Math.max(1, input.scanLimit))
  let kept = considered.filter((c) => c.area > 1000)
  let keptFallback = 0

  // 전부 필터에 걸리면(작은 피사체·잘게 쪼개진 컷아웃) 큰 순서대로라도 쓴다 —
  // 빈 칼선은 renderWorkspace 가 캔버스를 비운 채 조용히 끝나 '사진이 사라진' UX 가 된다
  // (2026-08-07 최악 케이스 실측: 104 컴포넌트 전부 ≤1000 → kept 0 → 빈 화면).
  // 종전 cv 경로도 같은 필터라 동일하게 비었을 것 — 이것은 의도적 동작 개선이다.
  if (kept.length === 0 && considered.length > 0) {
    kept = considered.slice(0, 50)
    keptFallback = 1
  }

  if (kept.length === 0) {
    return { points: [], useHull: false, meta: { totalContours: components.length, kept: 0 } }
  }

  const useHull = kept.length > 1
  const perComp = Math.max(64, Math.floor(input.hullMaxInputPoints / kept.length))
  let pool: [number, number][] = []
  for (const comp of kept) {
    if (pool.length >= input.hullMaxInputPoints) break
    const boundary = traceBoundary(labels, w, h, comp)
    pool = pool.concat(samplePoints(boundary, perComp))
  }

  let outline = useHull ? convexHull(pool) : pool
  const epsilon = Math.max(0.5, perimeterOf(outline) * input.approxEpsilonRatio)
  outline = simplifyClosed(outline, epsilon)

  return {
    points: outline,
    useHull,
    meta: {
      totalContours: components.length,
      kept: kept.length,
      keptFallback,
      pooled: pool.length,
      simplified: outline.length
    }
  }
}
