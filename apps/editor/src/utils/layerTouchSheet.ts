import { cn } from '@/lib/utils'

// L6 (2026-07-11): 모바일 레이어 UX — 바텀시트 렌더 분기 + 롱프레스 재정렬 판정 유틸.
// 업계 패턴 5(LAYER_UX_REDESIGN §0): Canva '페이지 탭→Layers 시트', 미리캔버스
// 바텀시트+long-press, Polotno isMobile 드래그핸들 — hover·사이드패널 이식 금지.
// 순수 판정 로직만 이 모듈에 두고 DOM 배선은 SidePanel 이 담당한다(테스트 용이성).

/** 터치 환경 판정 — S3 DnD 가드와 동일 기준(pointer: coarse). SSR/미지원 브라우저는 false. */
export function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * SidePanel 컨테이너 클래스 — 렌더 분기 단일 진실원.
 * 데스크톱(비터치)은 기존 우측 220px 슬라이드 패널 문자열을 그대로 유지(스냅샷 무변경),
 * 터치는 하단에서 올라오는 바텀시트(~55vh, translate-y 전환).
 */
export function sidePanelContainerClass(touchEnv: boolean, show: boolean): string {
  if (touchEnv) {
    return cn(
      'sidePanel w-full h-[55vh] flex flex-col gap-2 bg-editor-panel',
      'fixed left-0 right-0 bottom-0 rounded-t-2xl z-[99]',
      'transition-transform duration-300 ease-in-out',
      'shadow-[0_-4px_16px_0_rgba(0,0,0,0.12)] overflow-hidden',
      show ? 'translate-y-0' : 'translate-y-full pointer-events-none'
    )
  }
  return cn(
    'sidePanel w-[220px] h-[calc(100%-80px)] flex flex-col gap-2 bg-editor-panel',
    'fixed right-[-220px] transition-all duration-300 ease-in-out z-[99]',
    'shadow-[-2.2px_0_3.2px_0_rgba(0,0,0,0.02)] overflow-hidden',
    show && 'right-0'
  )
}

/** 롱프레스 활성 임계 — 미리캔버스/iOS 관행 계열(~350ms) */
export const LONG_PRESS_MS = 350
/** 활성 전 이동 허용 반경 — 초과 시 스크롤 의도로 보고 취소 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 8
/** 시트 핸들 스와이프 다운 닫힘 임계(px) */
export const SHEET_SWIPE_CLOSE_PX = 48

export type LongPressMoveResult = 'idle' | 'pending' | 'cancelled' | 'active'

export interface LongPressTrackerOptions {
  /** 임계 시간 경과(이동 취소 없이) 시 1회 호출 — 드래그 모드 진입점 */
  onActivate: () => void
  delayMs?: number
  tolerancePx?: number
}

export interface LongPressTracker {
  /** touchstart — 이전 추적을 리셋하고 타이머 시작 */
  start(x: number, y: number): void
  /** touchmove — 활성 전 허용 반경 초과 시 타이머 취소('cancelled') */
  move(x: number, y: number): LongPressMoveResult
  /** touchend/touchcancel — 타이머·상태 정리(활성 여부 무관) */
  cancel(): void
  isActive(): boolean
  isPending(): boolean
}

/**
 * 롱프레스 판정 상태기 — 타이머(setTimeout) 1개 + 이동 반경 검사.
 * 스크롤 충돌 방지의 핵심: 활성 전 이동은 즉시 취소(스크롤 양보),
 * 활성 후에만 호출측이 드래그 모드로 전환(preventDefault + 시트 스크롤 잠금).
 */
export function createLongPressTracker(options: LongPressTrackerOptions): LongPressTracker {
  const delayMs = options.delayMs ?? LONG_PRESS_MS
  const tolerancePx = options.tolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let pending = false
  let active = false

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    start(x: number, y: number) {
      clearTimer()
      startX = x
      startY = y
      active = false
      pending = true
      timer = setTimeout(() => {
        timer = null
        pending = false
        active = true
        options.onActivate()
      }, delayMs)
    },
    move(x: number, y: number): LongPressMoveResult {
      if (active) return 'active'
      if (!pending) return 'idle'
      if (Math.hypot(x - startX, y - startY) > tolerancePx) {
        clearTimer()
        pending = false
        return 'cancelled'
      }
      return 'pending'
    },
    cancel() {
      clearTimer()
      pending = false
      active = false
    },
    isActive: () => active,
    isPending: () => pending,
  }
}

export interface RowRect {
  id: string
  top: number
  height: number
}

export interface TouchDropTarget {
  targetId: string
  above: boolean
}

/**
 * 손가락 Y 좌표 → 삽입 대상 행 판정.
 * S3 데스크톱 드롭과 동일 시맨틱(단일 진실원 R2): 목록은 z-order reverse 라 "위 = 맨앞".
 * target 행 상단 절반 = above(앞/front), 하단 절반 = 뒤. source 행 자신은 대상에서 제외하고,
 * 행 밖(목록 위/아래 여백)이면 가장 가까운 행 기준으로 판정한다.
 */
export function resolveTouchDropTarget(
  clientY: number,
  rows: readonly RowRect[],
  sourceId: string
): TouchDropTarget | null {
  let best: { row: RowRect; dist: number } | null = null
  for (const row of rows) {
    if (row.id === sourceId) continue
    const center = row.top + row.height / 2
    if (clientY >= row.top && clientY < row.top + row.height) {
      return { targetId: row.id, above: clientY < center }
    }
    const dist = Math.abs(clientY - center)
    if (!best || dist < best.dist) best = { row, dist }
  }
  if (!best) return null
  return { targetId: best.row.id, above: clientY < best.row.top + best.row.height / 2 }
}
