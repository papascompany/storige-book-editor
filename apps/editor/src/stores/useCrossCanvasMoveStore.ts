import { create } from 'zustand'

/**
 * cross-canvas 객체 이동 추적 store (cover.md §7 / D5 Phase 3b-v Phase 2-B).
 *
 * MoveToCoverRegion이 이동을 수행한 후 마지막 이동 정보를 보관해서
 * "방금 이동 되돌리기" 액션이 양쪽 캔버스에 동기 undo를 트리거할 수 있게 한다.
 *
 * 정책
 * - 최근 1개만 보관 (마지막 이동만 되돌리기 가능 — 단순화)
 * - timestamp 기반 자동 만료 (default 30초) — UI 클릭 가능 윈도우 한정
 * - 다른 액션이 일어나도 별도 invalidate는 안 함 (사용자가 명시 클릭만)
 *
 * 양 캔버스 history 분리 정책(CC-1)은 그대로 유지 — Cmd+Z는 단일 캔버스 동작.
 * 이 store는 명시 "되돌리기" 액션의 보조 로그 역할.
 */

const TTL_MS = 30_000

export interface CrossCanvasMoveRecord {
  id: string
  /** source page index (allCanvas 배열 기준) */
  sourceIdx: number
  /** target page index */
  targetIdx: number
  /** 이동 시각 (Date.now()) */
  ts: number
  /** 이동된 객체의 라벨/이름 (toast 등에 사용) */
  targetLabel?: string
  /** 이동된 객체 수 — 되돌리기 시 undo 횟수 결정 */
  count?: number
}

interface State {
  last: CrossCanvasMoveRecord | null
  pushMove: (record: Omit<CrossCanvasMoveRecord, 'ts'>) => void
  /** 만료 검사 + last 반환 (만료면 null) */
  getActive: () => CrossCanvasMoveRecord | null
  clearLast: () => void
}

export const useCrossCanvasMoveStore = create<State>((set, get) => ({
  last: null,
  pushMove: (record) => {
    set({ last: { ...record, ts: Date.now() } })
  },
  getActive: () => {
    const { last } = get()
    if (!last) return null
    if (Date.now() - last.ts > TTL_MS) {
      set({ last: null })
      return null
    }
    return last
  },
  clearLast: () => set({ last: null }),
}))
