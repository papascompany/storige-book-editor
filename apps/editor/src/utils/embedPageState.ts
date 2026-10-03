/**
 * getState(editor.state)·IIFE getState 의 쪽수·현재 화면 순번 계산.
 *
 * - pageCount: 회원 세션의 editor.complete·editor.pricingChange 와 같은 산식(computeLivePageCount)의
 *   물리 쪽수. 인자 파생(표지 캔버스 제외·내지 캔버스당 쪽수)도 embed.tsx 의 세 호출처와 같다.
 * - currentPage: allCanvas 안에서 편집 대상 캔버스(useAppStore.canvas)의 위치 + 1.
 *   펼침면 세트는 펼침면 단위, 표지+내지 세트는 1 = 표지. 위치를 모르면 null.
 * 두 값은 단위가 다르다(currentPage 는 캔버스 수 이하, pageCount 는 물리 쪽수).
 */
import { computeLivePageCount } from './photobookSpread'

export interface EmbedPageStateInput {
  canvasCount: number
  /** allCanvas 안의 편집 대상 캔버스 위치(0부터). 모르면 -1 */
  currentCanvasIndex: number
  isSpreadMode: boolean
  regionScope: string | null | undefined
  pagesPerCanvas: number
  fallbackPages: number
}

export interface EmbedPageState {
  /** 물리 쪽수 — 회원 세션의 editor.complete pageCount 와 같은 산식 */
  pageCount: number
  /** 1부터 센 편집 대상 캔버스 순번(펼침면 세트는 펼침면 단위). 위치를 모르면 null */
  currentPage: number | null
}

export function computeEmbedPageState(input: EmbedPageStateInput): EmbedPageState {
  const n = Number.isFinite(input.canvasCount) && input.canvasCount > 0 ? Math.floor(input.canvasCount) : 0
  const isInnerSpread = input.regionScope === 'inner'
  const pageCount = computeLivePageCount(
    n,
    isInnerSpread,
    input.fallbackPages,
    input.isSpreadMode && !isInnerSpread && n > 1 ? 1 : 0,
    input.isSpreadMode ? input.pagesPerCanvas : 1,
  )
  const idx = input.currentCanvasIndex
  const currentPage = Number.isInteger(idx) && idx >= 0 && idx < n ? idx + 1 : null
  return { pageCount, currentPage }
}
