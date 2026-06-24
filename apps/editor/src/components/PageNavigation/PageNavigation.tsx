import { memo, useCallback, useMemo } from 'react'
import { ChevronLeft as CaretLeft, ChevronRight as CaretRight } from 'lucide-react'
import { useEditorStore, usePageCount } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { deriveSpreadPairs, formatPairLabel } from '@/utils/photobookSpread'
import { cn } from '@/lib/utils'

interface PageNavigationProps {
  className?: string
  showCounter?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export const PageNavigation = memo(function PageNavigation({
  className,
  showCounter = true,
  size = 'md',
}: PageNavigationProps) {
  const currentPageIndex = useEditorStore((state) => state.currentPageIndex)
  const goToNextPage = useEditorStore((state) => state.goToNextPage)
  const goToPrevPage = useEditorStore((state) => state.goToPrevPage)
  const goToPage = useEditorStore((state) => state.goToPage)
  const pageCount = usePageCount()

  const setPage = useAppStore((state) => state.setPage)
  // 포토북 내지(O-2): 펼침면 모드면 현재 펼침면의 좌/우 페이지 번호 라벨(예: 'p.1–2')을 표시.
  // 한 캔버스=한 펼침면이라 currentPageIndex 가 곧 펼침면 인덱스. 비-내지면 null(기존 표시 불변).
  const isInnerSpread = useSettingsStore((s) => s.spreadConfig?.regionScope === 'inner')
  const pairLabel = useMemo(() => {
    if (!isInnerSpread) return null
    const pair = deriveSpreadPairs(pageCount)[currentPageIndex]
    return pair ? formatPairLabel(pair) : null
  }, [isInnerSpread, pageCount, currentPageIndex])

  const canGoPrev = currentPageIndex > 0
  const canGoNext = currentPageIndex < pageCount - 1

  const handlePrev = useCallback(() => {
    if (canGoPrev) {
      goToPrevPage()
      setPage(currentPageIndex - 1)
    }
  }, [canGoPrev, goToPrevPage, setPage, currentPageIndex])

  const handleNext = useCallback(() => {
    if (canGoNext) {
      goToNextPage()
      setPage(currentPageIndex + 1)
    }
  }, [canGoNext, goToNextPage, setPage, currentPageIndex])

  const handlePageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10)
      if (!isNaN(value) && value >= 1 && value <= pageCount) {
        const index = value - 1
        goToPage(index)
        setPage(index)
      }
    },
    [pageCount, goToPage, setPage]
  )

  const sizeClasses = {
    sm: {
      button: 'p-1',
      icon: 'w-4 h-4',
      input: 'w-8 text-xs',
      text: 'text-xs',
    },
    md: {
      button: 'p-1.5',
      icon: 'w-5 h-5',
      input: 'w-10 text-sm',
      text: 'text-sm',
    },
    lg: {
      button: 'p-2',
      icon: 'w-6 h-6',
      input: 'w-12 text-base',
      text: 'text-base',
    },
  }

  const sizes = sizeClasses[size]

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* 이전 버튼 */}
      <button
        onClick={handlePrev}
        disabled={!canGoPrev}
        className={cn(
          sizes.button,
          'rounded hover:bg-gray-100 transition-colors',
          !canGoPrev && 'opacity-50 cursor-not-allowed'
        )}
        title="이전 페이지"
      >
        <CaretLeft className={sizes.icon} />
      </button>

      {/* 페이지 카운터 */}
      {showCounter && (
        <div className={cn('flex items-center gap-1', sizes.text)}>
          <input
            type="number"
            min={1}
            max={pageCount}
            value={currentPageIndex + 1}
            onChange={handlePageChange}
            className={cn(
              sizes.input,
              'text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-500'
            )}
          />
          <span className="text-gray-500">/</span>
          <span className="text-gray-700">{pageCount}</span>
          {pairLabel && (
            <span className="ml-1 text-gray-400" title="현재 펼침면의 좌/우 페이지">
              ({pairLabel})
            </span>
          )}
        </div>
      )}

      {/* 다음 버튼 */}
      <button
        onClick={handleNext}
        disabled={!canGoNext}
        className={cn(
          sizes.button,
          'rounded hover:bg-gray-100 transition-colors',
          !canGoNext && 'opacity-50 cursor-not-allowed'
        )}
        title="다음 페이지"
      >
        <CaretRight className={sizes.icon} />
      </button>
    </div>
  )
})
