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
  /** 'horizontal'(하단 스트립) | 'vertical'(우측 패널). 기본 horizontal */
  orientation?: 'horizontal' | 'vertical'
}

/**
 * SpreadPagePanel - 스프레드 모드 페이지 패널 (표지 스프레드 + 내지 전환)
 *
 * orientation:
 *  - 'horizontal' (하단): [스프레드 썸네일] | [내지1][내지2]…[+]  — 모바일/하단 기본
 *  - 'vertical' (우측):  세로로 [스프레드]→[내지…]→[+] 스택
 *  네비 위치 옵션(우측/하단)에 따라 EditorView/embed 가 orientation 을 전달.
 */
export const SpreadPagePanel = memo(function SpreadPagePanel({
  className,
  orientation = 'horizontal',
}: SpreadPagePanelProps) {
  const isVertical = orientation === 'vertical'
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
        'bg-white flex shrink-0',
        isVertical
          // 우측 세로 패널
          ? 'w-[150px] h-full border-l flex-col items-stretch'
          // 하단 가로 스트립 (모바일에서 높이 축소)
          : 'w-full h-[132px] sm:h-[180px] border-t flex-row items-center',
        className
      )}
    >
      {/* 스크롤 가능 영역 */}
      <div
        className={cn(
          'flex gap-4 min-w-0 flex-1',
          isVertical
            ? 'flex-col items-center overflow-y-auto overflow-x-hidden py-4 px-2'
            : 'flex-row items-center overflow-x-auto overflow-y-hidden px-4'
        )}
      >
        {/* 스프레드 썸네일 */}
        {spreadPage && (
          <>
            <div ref={(el) => { if (el) itemRefs.current.set(0, el); else itemRefs.current.delete(0) }}>
              <SpreadThumbnailItem
                label="표지 스프레드"
                thumbnailUrl={screenshots[0]}
                isActive={currentPageIndex === 0}
                onClick={handleSelectSpread}
                compact={isVertical}
              />
            </div>

            {/* 구분선 (방향에 따라) */}
            <div className={cn('bg-gray-300 shrink-0', isVertical ? 'w-16 h-px' : 'h-16 w-px')} />
          </>
        )}

        {/* 내지 썸네일들 */}
        <div className={cn('flex gap-2', isVertical ? 'flex-col items-center' : 'flex-row items-start pt-2')}>
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

      {/* 페이지 추가 버튼 - 가로면 오른쪽 / 세로면 하단 고정 */}
      <div
        className={cn(
          'shrink-0 flex items-center justify-center border-gray-100',
          isVertical ? 'w-full py-3 border-t' : 'h-full px-4 border-l'
        )}
      >
        <button
          onClick={handleAddPage}
          disabled={!canAddMore}
          className={cn(
            'flex items-center justify-center rounded-lg border-2 border-dashed transition-colors',
            isVertical ? 'w-16 h-16' : 'w-20 h-28',
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
