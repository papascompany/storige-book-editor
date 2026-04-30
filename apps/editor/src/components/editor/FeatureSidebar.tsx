import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import {
  useUiPrefStore,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
} from '@/stores/useUiPrefStore'
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Feature flag for image processing (OpenCV) features
const ENABLE_IMAGE_PROCESSING = import.meta.env.VITE_ENABLE_IMAGE_PROCESSING !== 'false'

// Tool panels
import AppText from '@/tools/AppText'
import AppImage from '@/tools/AppImage'
import AppElement from '@/tools/AppElement'
import AppBackground from '@/tools/AppBackground'
import AppTemplate from '@/tools/AppTemplate'
import AppFrame from '@/tools/AppFrame'
import SmartCodes from '@/tools/SmartCodes'

// Conditionally import image processing tools (requires OpenCV)
// Using lazy loading for proper ESM compatibility
const AppClipping = ENABLE_IMAGE_PROCESSING
  ? lazy(() => import('@/tools/AppClipping'))
  : () => null
const AppEdit = ENABLE_IMAGE_PROCESSING
  ? lazy(() => import('@/tools/AppEdit'))
  : () => null

// Loading fallback for lazy loaded components
const LazyLoading = () => (
  <div className="p-4 text-editor-text-muted text-sm">로딩 중...</div>
)

// Width when collapsed (just enough room for an "expand" button)
const COLLAPSED_WIDTH = 28

interface FeatureSidebarProps {
  className?: string
  /**
   * 모바일 오버레이 모드 — `true`면 fixed 포지셔닝 + 좁은 폭으로 캔버스 위에 떠있음.
   * 백드롭은 EditorView가 별도로 그린다.
   */
  mobileOverlay?: boolean
}

export default function FeatureSidebar({ className, mobileOverlay = false }: FeatureSidebarProps) {
  const currentMenu = useAppStore((state) => state.currentMenu)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const activeSelection = useAppStore((state) => state.activeSelection)

  const sidebarWidth = useUiPrefStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiPrefStore((s) => s.setSidebarWidth)
  const sidebarCollapsed = useUiPrefStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiPrefStore((s) => s.toggleSidebarCollapsed)
  const setSidebarCollapsed = useUiPrefStore((s) => s.setSidebarCollapsed)

  // 드래그 중에는 store에 매번 set하면 zustand persist가 과도하게 호출되므로
  // local state로 임시 폭을 보관하고 mouseup 시점에 한 번만 store에 반영한다.
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const draftWidthRef = useRef<number | null>(null)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  // Check if an object is selected (for toggle behavior with ControlBar)
  const hasSelection = activeSelection && Array.isArray(activeSelection) && activeSelection.length > 0
  const isNonBackgroundSelection = hasSelection && activeSelection.some(
    (obj) => obj?.extensionType !== 'background' &&
             obj?.extensionType !== 'clipping' &&
             obj?.id !== 'workspace' &&
             obj?.extensionType !== 'guideline'
  )

  // 드래그 핸들 시작 (Pointer Events로 마우스/터치/펜 통합)
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return
      e.preventDefault()
      // 핸들 element가 포인터 캡처를 가져 viewport 밖으로 나가도 move/up 수신
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {}
      isResizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = sidebarWidth
      draftWidthRef.current = sidebarWidth
      setDraftWidth(sidebarWidth)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.body.style.touchAction = 'none'
    },
    [sidebarWidth, sidebarCollapsed]
  )

  // 드래그 핸들 더블클릭 → 기본 폭 복원
  const handleResizeDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return
      e.preventDefault()
      e.stopPropagation()
      // 진행 중이던 드래그 상태가 있으면 정리
      if (isResizingRef.current) {
        isResizingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      draftWidthRef.current = null
      setDraftWidth(null)
      setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    },
    [sidebarCollapsed, setSidebarWidth]
  )

  // 글로벌 pointermove/pointerup/pointercancel 리스너 (드래그 중에만 부착)
  // Pointer Events가 마우스/터치/펜 모두 처리. 핸들 element의 setPointerCapture로
  // viewport 밖 이동도 수신.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizingRef.current) return
      const delta = e.clientX - startXRef.current
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, startWidthRef.current + delta)
      )
      draftWidthRef.current = next
      setDraftWidth(next)
    }
    const onUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.style.touchAction = ''
      const finalWidth = draftWidthRef.current
      draftWidthRef.current = null
      setDraftWidth(null)
      if (finalWidth != null) setSidebarWidth(finalWidth)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setSidebarWidth])

  // 키보드 단축키: Cmd/Ctrl+\ 로 사이드바 collapse 토글
  // 입력 요소(input/textarea/contenteditable) 포커스 중에는 무시
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== '\\') return

      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }

      e.preventDefault()
      toggleSidebarCollapsed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebarCollapsed])

  // If no menu selected, or if object is selected (show ControlBar instead), don't render
  if (!currentMenu || isNonBackgroundSelection) {
    return null
  }

  // Close sidebar
  const handleClose = () => {
    tapMenu(null)
    // 닫으면 collapsed 상태도 해제 (다음 도구 열 때 펼친 상태로 시작)
    setSidebarCollapsed(false)
  }

  // Render the appropriate tool panel based on current menu
  const renderToolPanel = () => {
    switch (currentMenu.type) {
      case 'TEXT':
        return <AppText />
      case 'IMAGE':
        return <AppImage />
      case 'SHAPE':
        return <AppElement />
      case 'BACKGROUND':
        return <AppBackground />
      case 'TEMPLATE':
        return <AppTemplate />
      case 'FRAME':
        return <AppFrame />
      case 'CLIPPING':
        return ENABLE_IMAGE_PROCESSING ? (
          <Suspense fallback={<LazyLoading />}>
            <AppClipping />
          </Suspense>
        ) : null
      case 'SMART_CODE':
        return <SmartCodes />
      case 'EDIT':
        return ENABLE_IMAGE_PROCESSING ? (
          <Suspense fallback={<LazyLoading />}>
            <AppEdit />
          </Suspense>
        ) : null
      default:
        return (
          <div className="p-4 text-editor-text-muted text-sm">
            {currentMenu.label} 패널
          </div>
        )
    }
  }

  // 실제 렌더 폭 (드래그 중이면 draft 사용, collapsed면 좁은 폭, 모바일 오버레이는 고정 폭)
  const MOBILE_OVERLAY_WIDTH = 280
  const effectiveWidth = mobileOverlay
    ? MOBILE_OVERLAY_WIDTH
    : sidebarCollapsed
    ? COLLAPSED_WIDTH
    : (draftWidth ?? sidebarWidth)
  const widthStyle = { width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth }

  // 모바일 오버레이 모드 클래스 (fixed positioning, 캔버스 위에 떠있음, 백드롭은 EditorView가 그림)
  const overlayPositioning = mobileOverlay
    ? 'fixed top-0 bottom-0 left-0 z-[110] shadow-2xl'
    : 'relative h-full z-[100] shadow-sm'

  // Collapsed view: 얇은 세로 바 + 펼치기 버튼 (모바일 오버레이일 땐 collapsed 없음 — 그냥 닫기)
  if (sidebarCollapsed && !mobileOverlay) {
    return (
      <div
        className={cn(
          'feature-sidebar bg-editor-panel border-r border-editor-border flex flex-col items-center overflow-hidden',
          'relative h-full z-[100] shadow-sm',
          className
        )}
        style={widthStyle}
      >
        <button
          onClick={toggleSidebarCollapsed}
          aria-label="사이드바 펼치기"
          title="사이드바 펼치기 (⌘\\)"
          className="mt-2 p-1 rounded-md hover:bg-editor-hover text-editor-text-muted hover:text-editor-text transition-colors"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'feature-sidebar bg-editor-panel border-r border-editor-border flex flex-col',
        'overflow-hidden scrollbar-hide',
        overlayPositioning,
        // 드래그 중에는 transition 끄기 (성능 + 즉시 반응)
        !mobileOverlay && draftWidth == null && 'transition-[width,min-width,max-width] duration-150',
        className
      )}
      style={widthStyle}
    >
      {/* Header with collapse + close buttons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border bg-editor-surface-low/50">
        <h2 className="text-[13px] font-semibold tracking-tight text-editor-text truncate">
          {currentMenu.label}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleSidebarCollapsed}
            aria-label="사이드바 접기"
            title="사이드바 접기 (⌘\\)"
            className="p-1 rounded-md hover:bg-editor-hover text-editor-text-muted hover:text-editor-text transition-colors"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleClose}
            aria-label="닫기"
            className="p-1 rounded-md hover:bg-editor-hover text-editor-text-muted hover:text-editor-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tool panel content */}
      <div className="flex-1 overflow-y-auto">
        {renderToolPanel()}
      </div>

      {/* Resize handle (right edge) — 모바일 오버레이에선 숨김 */}
      {!mobileOverlay && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 크기 조절"
          title="드래그하여 너비 조절 · 더블클릭으로 기본값 복원"
          onPointerDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          style={{ touchAction: 'none' }}
          className={cn(
            'absolute top-0 right-0 h-full w-1 cursor-col-resize select-none group',
            'hover:bg-editor-accent/30 active:bg-editor-accent/50 transition-colors'
          )}
        >
          {/* 터치 친화 hit area 확장 — 보이는 핸들은 1px이지만 5px 폭으로 잡힘 */}
          <span className="absolute top-0 -right-2 w-5 h-full" />
        </div>
      )}
    </div>
  )
}
