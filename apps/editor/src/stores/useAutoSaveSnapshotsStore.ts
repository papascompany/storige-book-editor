import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 자동저장 스냅샷 메타 store (트랙 BB — 버전 히스토리 패널 Phase 2 minimal)
 *
 * 자동저장 성공 시점의 메타 정보(시각, 페이지수, sessionId)를 LRU 5개로 보관.
 * 데이터 자체(canvas json)는 보관하지 않음 — 진정한 시점 복원은 백엔드 versions
 * API 연동 후 별도 트랙(Phase 3).
 *
 * 1차 가치: 사용자가 자동저장 빈도/시점을 한눈에 확인. 복원은 향후 활성화.
 */

const MAX_SNAPSHOTS = 5

export interface AutoSaveSnapshot {
  id: string
  savedAt: string  // ISO string
  pageCount: number
  sessionId?: string
}

interface State {
  snapshots: AutoSaveSnapshot[]
  pushSnapshot: (meta: Omit<AutoSaveSnapshot, 'id'>) => void
  clearSnapshots: () => void
}

export const useAutoSaveSnapshotsStore = create<State>()(
  persist(
    (set, get) => ({
      snapshots: [],
      pushSnapshot: (meta) => {
        const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const next: AutoSaveSnapshot = { id, ...meta }
        const list = [next, ...get().snapshots].slice(0, MAX_SNAPSHOTS)
        set({ snapshots: list })
      },
      clearSnapshots: () => set({ snapshots: [] }),
    }),
    {
      name: 'storige-autosave-snapshots',
      version: 1,
    }
  )
)
