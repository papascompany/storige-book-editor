/**
 * 내지 페이지 재정렬(G4) — 순열 계산 + DOM 컨테이너 동기화.
 *
 * BookNavigation(비스프레드) 이 쓰던 `computeInnerReorder` 를 정본으로 두고,
 * SpreadPagePanel(책/포토북 정본 경로) 도 같은 함수를 쓴다.
 *
 * 표지(isCover) 인덱스는 고정, 내지끼리만 source→target 으로 이동한다.
 */

export interface ReorderablePage {
  index: number
  isCover: boolean
}

/**
 * 내지 페이지간 reorder 순열 계산.
 * 표지(isCover)는 원래 인덱스를 유지하고, 내지(PAGE)만 source→target 위치로 이동.
 * 표지를 source/target으로 받으면 null 반환 (drag 막기 위함).
 *
 * @param items 표시 순서의 페이지 배열 (index === allCanvas 인덱스)
 * @param sourceIdx allCanvas 기준 source 인덱스
 * @param targetIdx allCanvas 기준 target(드롭 위치) 인덱스
 * @param insertBefore target의 앞쪽 vs 뒤쪽에 삽입
 * @returns reorderByIndex에 넘길 0..N-1 순열, no-op이거나 invalid면 null
 */
export function computeInnerReorder(
  items: ReorderablePage[],
  sourceIdx: number,
  targetIdx: number,
  insertBefore: boolean,
): number[] | null {
  const innerIndices = items.filter((m) => !m.isCover).map((m) => m.index)
  const srcInner = innerIndices.indexOf(sourceIdx)
  const tgtInner = innerIndices.indexOf(targetIdx)
  if (srcInner < 0 || tgtInner < 0) return null

  let insertAt = insertBefore ? tgtInner : tgtInner + 1
  if (srcInner < insertAt) insertAt -= 1
  if (insertAt === srcInner) return null

  const reordered = [...innerIndices]
  const [moved] = reordered.splice(srcInner, 1)
  reordered.splice(insertAt, 0, moved)

  const newIndices: number[] = items.map((m) => m.index)
  let r = 0
  for (let i = 0; i < items.length; i++) {
    if (!items[i].isCover) {
      newIndices[i] = reordered[r++]
    }
  }
  return newIndices
}

/**
 * 내지 슬롯 → 원본 PDF 페이지 인덱스 매핑을 현재 순열에 맞게 갱신한다.
 *
 * `newIndices` 는 **지금 화면의** allCanvas 기준 순열이다(누적 원본 인덱스가 아님).
 * `currentOrder[k]` = 현재 내지 슬롯 k 가 가리키는 원본 PDF 페이지.
 * 없으면 identity.
 *
 * @param innerStart 내지 시작 캔버스 인덱스 (책=1, 내지 전용 펼침면=0)
 */
export function permuteContentPdfPageOrder(
  currentOrder: number[] | undefined,
  newIndices: number[],
  innerStart: number,
): number[] {
  const start = Math.max(0, Math.floor(innerStart))
  const innerNew = newIndices.filter((i) => i >= start)
  const identity = innerNew.map((_, i) => i)
  const base =
    currentOrder && currentOrder.length === innerNew.length ? currentOrder : identity
  return innerNew.map((oldCanvasIdx) => {
    const slot = oldCanvasIdx - start
    return slot >= 0 && slot < base.length ? base[slot] : slot
  })
}

/**
 * `#canvas-containers` 자식 순서를 allCanvas 새 순서와 맞춘다.
 * `setPage` 가 DOM 인덱스로 표시/숨김을 바꾸므로, 배열만 바꾸고 DOM 을 안 맞추면
 * 재정렬 후 다른 페이지가 보인다.
 */
export function syncCanvasContainerOrder(
  parent: { appendChild: (el: HTMLElement) => unknown } | null,
  canvases: Array<{ wrapperEl?: HTMLElement | null }>,
): void {
  if (!parent) return
  for (const cvs of canvases) {
    const el = cvs.wrapperEl
    if (el) parent.appendChild(el)
  }
}
