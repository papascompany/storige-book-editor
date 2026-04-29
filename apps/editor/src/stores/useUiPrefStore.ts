import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * UI 사용자 선호 — 페이지 네비 위치, 패널 토글 등
 * localStorage에 영속.
 */

export type PageNavPosition = 'auto' | 'right' | 'bottom'

interface UiPrefState {
  /** 페이지 네비게이션 위치 (auto = 화면 크기에 따라 자동) */
  pageNavPosition: PageNavPosition
  setPageNavPosition: (pos: PageNavPosition) => void
  /** 룰러 표시 여부 (기본 OFF, 사용자 토글) */
  showRuler: boolean
  setShowRuler: (show: boolean) => void
  toggleRuler: () => void
}

export const useUiPrefStore = create<UiPrefState>()(
  persist(
    (set, get) => ({
      pageNavPosition: 'auto',
      setPageNavPosition: (pageNavPosition) => set({ pageNavPosition }),
      showRuler: false,
      setShowRuler: (showRuler) => set({ showRuler }),
      toggleRuler: () => set({ showRuler: !get().showRuler }),
    }),
    {
      name: 'storige-ui-pref',
      storage: createJSONStorage(() => localStorage),
      version: 2,
    }
  )
)
