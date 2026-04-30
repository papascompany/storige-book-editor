import { useEffect } from 'react'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * UI 사용자 선호 — 페이지 네비 위치, 패널 토글 등
 * localStorage에 영속.
 */

export type PageNavPosition = 'auto' | 'right' | 'bottom'

/**
 * 표지 편집 모드 (cover.md §3 / §5.1)
 * - auto: 시스템이 템플릿 메타로 결정 (default — 안전)
 * - separated: 분리 캔버스로 편집 (현재 동작 강제)
 * - composite: 페이지 네비 그룹화 + 향후 합쳐진 미니맵 (Phase 1: 그룹화만)
 */
export type CoverEditMode = 'auto' | 'separated' | 'composite'

/**
 * UI 테마 (트랙 D)
 * - light: 명시적 라이트 (default)
 * - dark: 명시적 다크
 * - system: prefers-color-scheme 따라 자동
 */
export type Theme = 'light' | 'dark' | 'system'

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
  /** 표지 편집 모드 (cover.md §3) — 기본 'auto' */
  coverEditMode: CoverEditMode
  setCoverEditMode: (mode: CoverEditMode) => void
  /**
   * AppSection 펼침 상태 (id별).
   * - undefined = 기본값(true) 사용
   * - true/false = 사용자가 명시적으로 토글한 상태
   * 새로고침 후에도 유지됨.
   */
  expandedSections: Record<string, boolean>
  setSectionExpanded: (id: string, expanded: boolean) => void
  toggleSectionExpanded: (id: string) => void
  /** UI 테마 (light/dark/system). 기본 'light' */
  theme: Theme
  setTheme: (theme: Theme) => void
  /** 자동저장 성공 시 짧은 토스트 표시 여부. 기본 false (인디케이터로 충분, 노이즈 방지) */
  autoSaveToastEnabled: boolean
  setAutoSaveToastEnabled: (enabled: boolean) => void
  toggleAutoSaveToast: () => void
}

/**
 * theme 값을 실제 적용 모드(light/dark)로 해석.
 * - 'system'이면 prefers-color-scheme 매체 쿼리 따름
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }
  return theme
}

/**
 * 테마를 <html data-theme> 속성에 동기화하는 hook.
 * - 사용자 토글 시 즉시 반영
 * - 'system' 모드일 땐 OS 테마 변경 자동 반영
 * App 루트에서 한 번만 호출.
 */
export function useThemeSync() {
  const theme = useUiPrefStore((s) => s.theme)
  useEffect(() => {
    const apply = () => {
      const mode = resolveTheme(theme)
      document.documentElement.setAttribute('data-theme', mode)
    }
    apply()
    // 'system'이면 OS 변경 감지
    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])
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
      coverEditMode: 'auto',
      setCoverEditMode: (coverEditMode) => set({ coverEditMode }),
      expandedSections: {},
      setSectionExpanded: (id, expanded) =>
        set((s) => ({ expandedSections: { ...s.expandedSections, [id]: expanded } })),
      toggleSectionExpanded: (id) =>
        set((s) => {
          const current = s.expandedSections[id]
          // undefined → 기본값 true에서 첫 토글이므로 false로
          const next = current === undefined ? false : !current
          return { expandedSections: { ...s.expandedSections, [id]: next } }
        }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      autoSaveToastEnabled: false,
      setAutoSaveToastEnabled: (autoSaveToastEnabled) => set({ autoSaveToastEnabled }),
      toggleAutoSaveToast: () =>
        set((s) => ({ autoSaveToastEnabled: !s.autoSaveToastEnabled })),
    }),
    {
      name: 'storige-ui-pref',
      storage: createJSONStorage(() => localStorage),
      version: 7,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<UiPrefState>
        if (version < 3) {
          state.sidebarWidth = SIDEBAR_WIDTH_DEFAULT
          state.sidebarCollapsed = false
        }
        if (version < 4) {
          state.coverEditMode = 'auto'
        }
        if (version < 5) {
          state.expandedSections = {}
        }
        if (version < 6) {
          state.theme = 'light'
        }
        if (version < 7) {
          state.autoSaveToastEnabled = false
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
