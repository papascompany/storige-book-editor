/**
 * 내지 PDF 앉히기 기하 — 순수 함수.
 *
 * 워크스페이스는 **재단(trim)** 이다. 블리드는 WorkspacePlugin 이 바깥에 그린다.
 *
 * 펼침면(2-up):
 *  - 좌 trim [0, W], 우 trim [W, 2W]. 접힘선 = W.
 *  - 작업사이즈(W+2B) 페이지를 각 trim 중심에 원본 mm 로 앉히면
 *    왼쪽의 오른쪽 블리드 [W, W+B] 와 오른쪽의 왼쪽 블리드 [W−B, W] 가
 *    접힘선을 넘어 서로 겹친다(겹침 폭 2B). 재단 가장자리는 접힘선에서 만난다.
 *  - 재단사이즈(W×H) 페이지는 같은 trim 칸 중심. 2(W+2B) 캔버스를 반으로 나눈
 *    중심(W/2+B, 1.5W+3B)이 아니라 trim 중심(W/2, 1.5W) — 중첩 블리드를 고려한 영역.
 *
 * 단면: 캔버스 1장 = 페이지 1장. 워크스페이스 중심에 원본 mm, 크롭·축 독립 스케일 없음.
 */

export const DEFAULT_GUIDE_DPI = 110

export type SeatSide = 'full' | 'left' | 'right'

export interface SeatSlot {
  side: SeatSide
  /** 워크스페이스 대비 trim 칸 중심 (0–1) */
  centerFracX: number
  centerFracY: number
  trimWidthMm: number
  trimHeightMm: number
}

export interface WorkBoxMm {
  x: number
  y: number
  width: number
  height: number
}

export function pixelsToMm(px: number, dpi: number): number {
  if (!(dpi > 0) || !Number.isFinite(px)) return 0
  return (px / dpi) * 25.4
}

export function classifyPdfPageKind(
  pdfW: number,
  pdfH: number,
  trimW: number,
  trimH: number,
  bleedMm: number,
  tol = 1,
): 'trim' | 'work' | 'other' {
  if (!(pdfW > 0) || !(pdfH > 0) || !(trimW > 0) || !(trimH > 0)) return 'other'
  const b = Math.max(0, bleedMm)
  const workW = trimW + b * 2
  const workH = trimH + b * 2
  if (Math.abs(pdfW - trimW) <= tol && Math.abs(pdfH - trimH) <= tol) return 'trim'
  if (Math.abs(pdfW - workW) <= tol && Math.abs(pdfH - workH) <= tol) return 'work'
  return 'other'
}

/** 단면: 워크스페이스 전체가 한 면. */
export function sheetSeatSlots(trimWidthMm: number, trimHeightMm: number): SeatSlot[] {
  return [
    {
      side: 'full',
      centerFracX: 0.5,
      centerFracY: 0.5,
      trimWidthMm,
      trimHeightMm,
    },
  ]
}

/**
 * 펼침면: 좌=PDF 짝수(0-index), 우=다음 페이지.
 * 중심은 재단 칸 중심 — 2(W+2B) 를 반으로 나눈 중심보다 B 만큼 접힘선 쪽.
 */
export function spreadSeatSlots(pageWidthMm: number, pageHeightMm: number): SeatSlot[] {
  const totalW = pageWidthMm * 2
  if (!(totalW > 0)) return []
  return [
    {
      side: 'left',
      centerFracX: pageWidthMm / 2 / totalW,
      centerFracY: 0.5,
      trimWidthMm: pageWidthMm,
      trimHeightMm: pageHeightMm,
    },
    {
      side: 'right',
      centerFracX: (pageWidthMm + pageWidthMm / 2) / totalW,
      centerFracY: 0.5,
      trimWidthMm: pageWidthMm,
      trimHeightMm: pageHeightMm,
    },
  ]
}

/** 재단 캔버스(0..2W × 0..H) 위에서 작업사이즈 박스. */
export function workBoxOnTrimSpread(
  side: 'left' | 'right',
  pageWidthMm: number,
  pageHeightMm: number,
  bleedMm: number,
): WorkBoxMm {
  const b = Math.max(0, bleedMm)
  const width = pageWidthMm + b * 2
  const height = pageHeightMm + b * 2
  const y = -b
  if (side === 'left') return { x: -b, y, width, height }
  return { x: pageWidthMm - b, y, width, height }
}

/** 좌 작업박스 ∩ 우 작업박스 폭(mm). 재단을 접힘선에 맞추면 2B. */
export function innerBleedOverlapMm(bleedMm: number): number {
  return Math.max(0, bleedMm) * 2
}

export function boxesOverlapX(a: WorkBoxMm, b: WorkBoxMm): number {
  const left = Math.max(a.x, b.x)
  const right = Math.min(a.x + a.width, b.x + b.width)
  return Math.max(0, right - left)
}

/**
 * 2(W+2B) 캔버스를 반으로 나눈 중심 vs trim 칸 중심.
 * 재단본을 앉힐 때 전자를 쓰면 바깥 블리드만큼 접힘선에서 멀어진다.
 */
export function naiveWorkHalfCentersMm(
  pageWidthMm: number,
  bleedMm: number,
): { left: number; right: number } {
  const half = pageWidthMm + bleedMm * 2
  return { left: half / 2, right: half + half / 2 }
}

export function trimSlotCentersMm(pageWidthMm: number): { left: number; right: number } {
  return { left: pageWidthMm / 2, right: pageWidthMm + pageWidthMm / 2 }
}

export interface WorkspaceBox {
  left: number
  top: number
  width: number
  height: number
  scaleX?: number
  scaleY?: number
  originX?: string
  originY?: string
  angle?: number
}

export function workspacePoint(
  ws: WorkspaceBox,
  fracX: number,
  fracY: number,
): { x: number; y: number } {
  const w = (ws.width || 0) * (ws.scaleX || 1)
  const h = (ws.height || 0) * (ws.scaleY || 1)
  const ox = ws.originX || 'left'
  const oy = ws.originY || 'top'
  const left0 = ox === 'center' ? ws.left - w / 2 : ox === 'right' ? ws.left - w : ws.left
  const top0 = oy === 'center' ? ws.top - h / 2 : oy === 'bottom' ? ws.top - h : ws.top
  return { x: left0 + fracX * w, y: top0 + fracY * h }
}

/**
 * 원본 mm 을 유지하는 균일 스케일.
 * 가로를 기준으로 하고 세로는 같은 배율 — 축 독립 늘리기 금지.
 */
export function uniformMmScale(
  imgWidthPx: number,
  pdfWidthMm: number,
  workspaceWidthPx: number,
  workspaceWidthMm: number,
): number {
  if (!(imgWidthPx > 0) || !(workspaceWidthMm > 0) || !(workspaceWidthPx > 0) || !(pdfWidthMm > 0)) {
    return 1
  }
  return (pdfWidthMm / workspaceWidthMm) * (workspaceWidthPx / imgWidthPx)
}

export function pdfSizeMmFromRaster(
  imgWidthPx: number,
  imgHeightPx: number,
  dpi: number,
): { width: number; height: number } {
  return {
    width: pixelsToMm(imgWidthPx, dpi),
    height: pixelsToMm(imgHeightPx, dpi),
  }
}

/** 펼침면 캔버스 c 의 좌/우에 대응하는 PDF 페이지 인덱스(0-based). */
export function spreadPdfIndices(
  spreadIndex: number,
  pageOrder?: number[],
): { left: number; right: number } {
  const leftSlot = spreadIndex * 2
  const rightSlot = leftSlot + 1
  return {
    left: pageOrder?.[leftSlot] ?? leftSlot,
    right: pageOrder?.[rightSlot] ?? rightSlot,
  }
}

export function neededInnerCanvases(pdfPageCount: number, pairOnSpread: boolean): number {
  const n = Math.floor(Number(pdfPageCount))
  if (!Number.isFinite(n) || n <= 0) return 0
  return pairOnSpread ? Math.ceil(n / 2) : n
}
