import { lazy, Suspense } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { X } from 'lucide-react'
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

interface FeatureSidebarProps {
  className?: string
}

export default function FeatureSidebar({ className }: FeatureSidebarProps) {
  const currentMenu = useAppStore((state) => state.currentMenu)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const activeSelection = useAppStore((state) => state.activeSelection)

  // Check if an object is selected (for toggle behavior with ControlBar)
  const hasSelection = activeSelection && Array.isArray(activeSelection) && activeSelection.length > 0
  const isNonBackgroundSelection = hasSelection && activeSelection.some(
    (obj) => obj?.extensionType !== 'background' &&
             obj?.extensionType !== 'clipping' &&
             obj?.id !== 'workspace' &&
             obj?.extensionType !== 'guideline'
  )

  // If no menu selected, or if object is selected (show ControlBar instead), don't render
  if (!currentMenu || isNonBackgroundSelection) {
    return null
  }

  // Close sidebar
  const handleClose = () => {
    tapMenu(null)
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

  return (
    <div
      className={cn(
        'feature-sidebar bg-editor-panel border-r border-editor-border flex flex-col',
        'w-[300px] min-w-[300px] max-w-[300px] h-full overflow-hidden z-[100] scrollbar-hide',
        className
      )}
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border bg-[var(--color-surface-container)]">
        <h2 className="text-sm font-semibold text-editor-text">{currentMenu.label}</h2>
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-editor-hover text-editor-text-muted hover:text-editor-text transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tool panel content */}
      <div className="flex-1 overflow-hidden">
        {renderToolPanel()}
      </div>
    </div>
  )
}
