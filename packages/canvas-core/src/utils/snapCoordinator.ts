/**
 * snapCoordinator — 객체 간 정렬 스냅 계산 (E1 §5-1, 순수 로직)
 *
 * SmartGuidesPlugin 의 계산 코어. fabric 비의존 순수 함수로 분리해
 * node 환경에서 스냅 정확성을 직접 검증할 수 있게 한다.
 *
 * 좌표계: 전부 canvas 평면 좌표(절대 좌표, viewportTransform 미적용).
 * threshold 는 화면 px 감각을 유지해야 하므로 호출측(플러그인)이 `/zoom` 으로
 * canvas 좌표로 환산해 넘긴다.
 */

/** 객체의 스냅 후보 경계 — 축별 3선(엣지 2 + 센터 1)의 원천 */
export interface SnapBounds {
  left: number
  top: number
  right: number
  bottom: number
  centerX: number
  centerY: number
}

/** 한 축의 스냅 판정 결과 */
export interface AxisSnapResult {
  /** 스냅 시 이동 객체를 이 축으로 이동시킬 변위(canvas px). null = 스냅 없음 */
  delta: number | null
  /** 가이드라인 표시 좌표(canvas px). null = 표시 없음 */
  guideLine: number | null
}

export interface SnapComputation {
  /** 수직 3선(left/centerX/right) 정렬 — x 축 이동 */
  x: AxisSnapResult
  /** 수평 3선(top/centerY/bottom) 정렬 — y 축 이동 */
  y: AxisSnapResult
}

/** getBoundingRect 형태의 사각형을 SnapBounds 로 변환 */
export function toSnapBounds(rect: {
  left: number
  top: number
  width: number
  height: number
}): SnapBounds {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
  }
}

/** 두 사각 영역의 교차 여부 (뷰포트 컬링용) */
export function boundsIntersect(
  a: SnapBounds,
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

interface BestMatch {
  distance: number
  delta: number
  candidateLine: number
}

/**
 * 한 축에서 이동 객체 3선 × 후보 3선 전 조합 중 최근접 쌍을 찾는다.
 * @param movingLines 이동 객체의 축 3선 (예: x 축이면 [left, centerX, right])
 * @param candidateLines 후보 객체들의 축 3선 평탄 배열
 */
function findBestAxisMatch(movingLines: number[], candidateLines: number[]): BestMatch | null {
  let best: BestMatch | null = null
  for (let c = 0; c < candidateLines.length; c++) {
    const candidateLine = candidateLines[c]
    for (let m = 0; m < movingLines.length; m++) {
      const delta = candidateLine - movingLines[m]
      const distance = Math.abs(delta)
      if (best === null || distance < best.distance) {
        best = { distance, delta, candidateLine }
      }
    }
  }
  return best
}

/**
 * 이동 객체와 후보 경계들 간 축별 스냅/가이드 판정.
 *
 * @param moving 이동 객체 경계 (canvas 좌표)
 * @param candidates 후보 객체 경계 배열 (드래그 시작 시 캐시된 것)
 * @param showThreshold 가이드 표시 임계값 (canvas px — 화면 px / zoom)
 * @param snapThreshold 스냅 임계값 (canvas px — 화면 px / zoom)
 */
export function computeSnap(
  moving: SnapBounds,
  candidates: readonly SnapBounds[],
  showThreshold: number,
  snapThreshold: number
): SnapComputation {
  const result: SnapComputation = {
    x: { delta: null, guideLine: null },
    y: { delta: null, guideLine: null },
  }
  if (candidates.length === 0) return result

  const movingX = [moving.left, moving.centerX, moving.right]
  const movingY = [moving.top, moving.centerY, moving.bottom]
  const candidateX: number[] = []
  const candidateY: number[] = []
  for (const c of candidates) {
    candidateX.push(c.left, c.centerX, c.right)
    candidateY.push(c.top, c.centerY, c.bottom)
  }

  const bestX = findBestAxisMatch(movingX, candidateX)
  const bestY = findBestAxisMatch(movingY, candidateY)

  if (bestX && bestX.distance < showThreshold) {
    result.x.guideLine = bestX.candidateLine
    if (bestX.distance < snapThreshold) {
      result.x.delta = bestX.delta
    }
  }
  if (bestY && bestY.distance < showThreshold) {
    result.y.guideLine = bestY.candidateLine
    if (bestY.distance < snapThreshold) {
      result.y.delta = bestY.delta
    }
  }
  return result
}

/**
 * 회전 각도 스냅 (E1 C7) — step 배수 ±tolerance 이내면 라운딩된 각을 반환.
 * 전역 fabric snapAngle 설정 대신 이벤트 방식에서 호출한다(개별 off 가능).
 *
 * @returns 스냅된 각도 또는 null(허용 오차 밖 — 스냅 없음)
 */
export function snapAngle(angle: number, step: number, tolerance: number): number | null {
  if (step <= 0) return null
  const snapped = Math.round(angle / step) * step
  if (Math.abs(angle - snapped) <= tolerance) {
    return snapped
  }
  return null
}
