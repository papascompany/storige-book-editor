import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * UI 사용자 선호 — 페이지 네비 위치, 패널 토글 등
 * localStorage에 영속.
 */

export type PageNavPosition = 'auto' | 'right' | 'bottom'

export const SIDEBAR_WIDTH_MIN = 240
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 300

const clampSidebarWidth = (w: number) =>
  Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(w)))

interface UiPrefState {
  /** 페이지 네비게이션 위치 (auto = 화면 크기에 따라 자동) */
  pageNavPosition: PageNavPosition
  setPageNavPosition: (pos: PageNavPosition) => void
  /** 룰러 표시 여부 (기본 OFF, 사용자 토글) */
  showRuler: boolean
  setShowRuler: (show: boolean) => void
  toggleRuler: () => void
  /** FeatureSidebar 너비 (px). MIN/MAX 사이로 clamp 됨 */
  sidebarWidth: number
  setSidebarWidth: (w: number) => void
  /** FeatureSidebar 접힘 여부 (collapsed = 폭 0, 헤더만 좁게 노출) */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebarCollapsed: () => void
}

export const useUiPrefStore = create<UiPrefState>()(
  persist(
    (set, get) => ({
      pageNavPosition: 'auto',
      setPageNavPosition: (pageNavPosition) => set({ pageNavPosition }),
      showRuler: false,
      setShowRuler: (showRuler) => set({ showRuler }),
      toggleRuler: () => set({ showRuler: !get().showRuler }),
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      setSidebarWidth: (w) => set({ sidebarWidth: clampSidebarWidth(w) }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebarCollapsed: () =>
        set({ sidebarCollapsed: !get().sidebarCollapsed }),
    }),
    {
      name: 'storige-ui-pref',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<UiPrefState>
        if (version < 3) {
          state.sidebarWidth = SIDEBAR_WIDTH_DEFAULT
          state.sidebarCollapsed = false
        }
        // sidebarWidth가 범위를 벗어난 경우 보정
        if (typeof state.sidebarWidth === 'number') {
          state.sidebarWidth = clampSidebarWidth(state.sidebarWidth)
        }
        return state as UiPrefState
      },
    }
  )
)
