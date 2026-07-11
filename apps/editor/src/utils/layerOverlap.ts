/**
 * L5-① (2026-07-11): 레이어 패널 '겹침만 보기' 필터 — AABB 교차 판정 순수 로직.
 *
 * Canva 'Overlapping' 패턴(LAYER_UX_REDESIGN_2026-07-06.md §0 보너스·§5 2차) —
 * 포토북 펼침면처럼 요소가 수십 개 겹치는 화면에서 "지금 선택한 요소와 겹치는
 * 요소만" 목록을 좁힌다. 순수 뷰 상태 — 직렬화/저장/canvas-core 무접촉(§8 불변).
 *
 * 교차 판정은 fabric getBoundingRect(true, true) 절대좌표 AABB 기준.
 * 다중선택(ActiveSelection)은 합집합(union) 박스 기준으로 판정한다.
 */

/** fabric getBoundingRect 반환 형태와 동일한 축정렬 박스 */
export interface AABB {
  left: number
  top: number
  width: number
  height: number
}

/** getBoundingRect 를 가진 최소 구조 (fabric.Object 서브셋 — fabric 비의존 테스트용) */
export interface BoundingRectSource {
  getBoundingRect?: (absolute?: boolean, calculate?: boolean) => AABB
}

/**
 * 두 AABB 의 교차 여부. 경계가 정확히 맞닿기만 한 경우(모서리 접촉)는
 * 시각적으로 "겹침"이 아니므로 strict overlap 으로 판정한다.
 */
export function rectsIntersect(a: AABB, b: AABB): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** AABB 목록의 합집합 박스. 빈 목록이면 null. */
export function unionRect(rects: readonly AABB[]): AABB | null {
  if (rects.length === 0) return null
  let minLeft = Infinity
  let minTop = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity
  for (const r of rects) {
    if (r.left < minLeft) minLeft = r.left
    if (r.top < minTop) minTop = r.top
    if (r.left + r.width > maxRight) maxRight = r.left + r.width
    if (r.top + r.height > maxBottom) maxBottom = r.top + r.height
  }
  return { left: minLeft, top: minTop, width: maxRight - minLeft, height: maxBottom - minTop }
}

/**
 * 선택 박스(union)와 교차하는 행 id 집합.
 * - selectedIds 는 항상 포함(자기 자신은 결과에서 빠지면 목록이 텅 비어 혼동).
 * - rect 를 구할 수 없는 행(null)은 선택 행이 아닌 한 제외(과다 표시보다 안전).
 */
export function overlappingIdSet(
  selectionRects: readonly AABB[],
  selectedIds: ReadonlySet<string>,
  rows: ReadonlyArray<{ id: string; rect: AABB | null }>
): Set<string> {
  const result = new Set<string>()
  const union = unionRect(selectionRects)
  for (const row of rows) {
    if (selectedIds.has(row.id)) {
      result.add(row.id)
      continue
    }
    if (union && row.rect && rectsIntersect(union, row.rect)) {
      result.add(row.id)
    }
  }
  return result
}

/**
 * fabric 객체의 절대좌표 AABB 안전 취득.
 * getBoundingRect(true, true) — absolute(뷰포트 변환 무시)+calculate(aCoords 재계산,
 * ActiveSelection 자식도 그룹 행렬 포함 절대좌표) — 실패 시 null(방어적).
 */
export function getAbsoluteAABB(obj: BoundingRectSource | null | undefined): AABB | null {
  if (!obj || typeof obj.getBoundingRect !== 'function') return null
  try {
    const rect = obj.getBoundingRect(true, true)
    if (
      !rect ||
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      return null
    }
    return rect
  } catch {
    return null
  }
}
