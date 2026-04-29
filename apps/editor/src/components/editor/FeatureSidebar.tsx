import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import {
  useUiPrefStore,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
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
}

export default function FeatureSidebar({ className }: FeatureSidebarProps) {
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

  // 드래그 핸들 mousedown
  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return
      e.preventDefault()
      isResizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = sidebarWidth
      draftWidthRef.current = sidebarWidth
      setDraftWidth(sidebarWidth)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth, sidebarCollapsed]
  )

  // 글로벌 mousemove/mouseup 리스너 (드래그 중에만 부착)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
      const finalWidth = draftWidthRef.current
      draftWidthRef.current = null
      setDraftWidth(null)
      if (finalWidth != null) setSidebarWidth(finalWidth)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setSidebarWidth])

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

  // 실제 렌더 폭 (드래그 중이면 draft 사용, collapsed면 좁은 폭)
  const effectiveWidth = sidebarCollapsed
    ? COLLAPSED_WIDTH
    : (draftWidth ?? sidebarWidth)
  const widthStyle = { width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth }

  // Collapsed view: 얇은 세로 바 + 펼치기 버튼
  if (sidebarCollapsed) {
    return (
      <div
        className={cn(
          'feature-sidebar relative bg-white border-r border-gray-200 flex flex-col items-center shadow-sm h-full overflow-hidden z-[100]',
          className
        )}
        style={widthStyle}
      >
        <button
          onClick={toggleSidebarCollapsed}
          aria-label="사이드바 펼치기"
          title="사이드바 펼치기"
          className="mt-2 p-1 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'feature-sidebar relative bg-white border-r border-gray-200 flex flex-col shadow-sm',
        'h-full overflow-hidden z-[100] scrollbar-hide',
        // 드래그 중에는 transition 끄기 (성능 + 즉시 반응)
        draftWidth == null && 'transition-[width,min-width,max-width] duration-150',
        className
      )}
      style={widthStyle}
    >
      {/* Header with collapse + close buttons */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <h2 className="text-[13px] font-semibold tracking-tight text-gray-700 truncate">
          {currentMenu.label}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleSidebarCollapsed}
            aria-label="사이드바 접기"
            title="사이드바 접기"
            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleClose}
            aria-label="닫기"
            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tool panel content */}
      <div className="flex-1 overflow-y-auto">
        {renderToolPanel()}
      </div>

      {/* Resize handle (right edge) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="사이드바 크기 조절"
        onMouseDown={handleResizeStart}
        className={cn(
          'absolute top-0 right-0 h-full w-1 cursor-col-resize select-none group',
          'hover:bg-editor-accent/30 active:bg-editor-accent/50 transition-colors'
        )}
      >
        {/* 드래그 영역을 좀 더 넓게 잡기 위한 invisible hit area */}
        <span className="absolute top-0 -right-1 w-3 h-full" />
      </div>
    </div>
  )
}
