import { memo, useCallback, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { SpreadThumbnailItem } from './SpreadThumbnailItem'
import { PageItem } from './PageItem'
import { useEditorStore, useCanAddPage } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'
import type { EditPage } from '@storige/types'

interface SpreadPagePanelProps {
  className?: string
}

/**
 * SpreadPagePanel - 스프레드 모드 전용 하단 수평 페이지 패널
 *
 * 레이아웃:
 * ┌─────────────────────────────────────────────────────────┐
 * │ [스프레드 썸네일 (200x60px)]  |  [내지1][내지2]...[+]   │
 * │    "표지 스프레드"             |   정방형 썸네일 나열      │
 * └─────────────────────────────────────────────────────────┘
 * 높이: 100px 고정, 항상 표시
 */
export const SpreadPagePanel = memo(function SpreadPagePanel({
  className,
}: SpreadPagePanelProps) {
  const pages = useEditorStore((state) => state.pages)
  const currentPageIndex = useEditorStore((state) => state.currentPageIndex)
  const setPage = useAppStore((state) => state.setPage)
  const addPage = useAppStore((state) => state.addPage)
  const deletePage = useAppStore((state) => state.deletePage)
  const allCanvas = useAppStore((state) => state.allCanvas)
  const screenshots = useAppStore((state) => state.screenshots)
  const canAddMore = useCanAddPage()

  // 스프레드 페이지 (항상 첫 번째)
  const spreadPage = pages[0]
  // 내지 페이지들
  const innerPages = pages.slice(1)

  const handleSelectSpread = useCallback(() => {
    setPage(0)
  }, [setPage])

  const handleSelectInnerPage = useCallback((index: number) => {
    // index는 innerPages 기준이므로 +1
    setPage(index + 1)
  }, [setPage])

  const handleAddPage = useCallback(async () => {
    if (!canAddMore) return
    try {
      await addPage()
    } catch (error) {
      console.error('페이지 추가 실패:', error)
    }
  }, [canAddMore, addPage])

  const handleDeletePage = useCallback((pageId: string) => {
    // pageId에 해당하는 캔버스 찾기
    const pageIndex = pages.findIndex((p) => p.id === pageId)
    if (pageIndex === -1) return

    // allCanvas에서 해당 인덱스의 canvasId 가져오기
    const canvas = allCanvas[pageIndex]
    if (!canvas) return

    deletePage(canvas.id)
  }, [pages, allCanvas, deletePage])

  // 활성 페이지 썸네일 ref 맵
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // currentPageIndex 변경 시 해당 썸네일로 스크롤
  useEffect(() => {
    const el = itemRefs.current.get(currentPageIndex)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [currentPageIndex, pages.length])

  return (
    <div
      className={cn(
        'h-[180px] bg-white border-t flex items-center shrink-0',
        className
      )}
    >
      {/* 스크롤 가능 영역 */}
      <div className="flex items-center h-full overflow-x-auto overflow-y-hidden px-4 gap-4 min-w-0 flex-1">
        {/* 스프레드 썸네일 */}
        {spreadPage && (
          <>
            <div ref={(el) => { if (el) itemRefs.current.set(0, el); else itemRefs.current.delete(0) }}>
              <SpreadThumbnailItem
                label="표지 스프레드"
                thumbnailUrl={screenshots[0]}
                isActive={currentPageIndex === 0}
                onClick={handleSelectSpread}
              />
            </div>

            {/* 구분선 */}
            <div className="h-16 w-px bg-gray-300 shrink-0" />
          </>
        )}

        {/* 내지 썸네일들 */}
        <div className="flex items-start gap-2 pt-2">
          {innerPages.map((page, index) => (
            <div
              key={page.id}
              className="shrink-0 group"
              ref={(el) => {
                const pageIdx = index + 1
                if (el) itemRefs.current.set(pageIdx, el)
                else itemRefs.current.delete(pageIdx)
              }}
            >
              <PageItem
                page={page}
                index={index}
                thumbnail={screenshots[index + 1]}
                isActive={currentPageIndex === index + 1}
                onSelect={handleSelectInnerPage}
                onDelete={handleDeletePage}
                canDelete={!page.required && innerPages.length > 1}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 페이지 추가 버튼 - 오른쪽 고정 */}
      <div className="shrink-0 flex items-center px-4 h-full border-l border-gray-100">
        <button
          onClick={handleAddPage}
          disabled={!canAddMore}
          className={cn(
            'flex items-center justify-center',
            'w-20 h-28 rounded-lg border-2 border-dashed',
            'transition-colors',
            canAddMore
              ? 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-400 hover:text-blue-500'
              : 'border-gray-200 text-gray-300 cursor-not-allowed'
          )}
          title={canAddMore ? '내지 페이지 추가' : '최대 페이지 수에 도달했습니다'}
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
})
