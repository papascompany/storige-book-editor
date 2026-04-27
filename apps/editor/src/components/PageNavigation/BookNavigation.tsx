import { memo, useCallback, useMemo } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useEditorStore, usePageCount } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useUiPrefStore, type PageNavPosition } from '@/stores/useUiPrefStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { TemplateType, type EditPage } from '@storige/types'
import { cn } from '@/lib/utils'

/**
 * 책자(BOOK) 페이지 네비게이션
 * - 표지(COVER/SPREAD/WING) → 내지(PAGE) 1, 2, ... 순서
 * - 위치는 우측(데스크톱 기본) 또는 하단(모바일 기본)
 * - 우/하단 사용자 토글 가능 (헤더에서 변경)
 *
 * 표지 편집 모드별 view 분기는 후속 작업 (agents/12-cover-edit-modes.md)
 */

interface PageMeta {
  page: EditPage
  index: number          // 전체 pages 배열에서의 index
  label: string
  isCover: boolean
}

function buildPageMeta(pages: EditPage[]): PageMeta[] {
  // sortOrder 기준 정렬 (안전)
  const sorted = [...pages].sort((a, b) => a.sortOrder - b.sortOrder)
  // PAGE 카운터: 표지·날개·책등은 카운트에서 제외, "1쪽"은 첫 PAGE 부터
  let pageCounter = 0
  return sorted.map((p, i) => {
    let label = ''
    let isCover = false
    switch (p.templateType) {
      case TemplateType.COVER:
        label = '표지'
        isCover = true
        break
      case TemplateType.SPREAD:
        label = '표지(펼침면)'
        isCover = true
        break
      case TemplateType.WING:
        label = '날개'
        isCover = true
        break
      case TemplateType.SPINE:
        label = '책등'
        isCover = true
        break
      case TemplateType.PAGE:
      default:
        pageCounter += 1
        label = `${pageCounter}쪽`
        break
    }
    return { page: p, index: i, label, isCover }
  })
}

function resolvePosition(prefer: PageNavPosition, bp: ReturnType<typeof useBreakpoint>): 'right' | 'bottom' {
  if (prefer === 'auto') {
    // 데스크톱: 우측, 태블릿/모바일: 하단
    return bp === 'desktop' ? 'right' : 'bottom'
  }
  return prefer
}

interface BookNavigationProps {
  className?: string
}

export const BookNavigation = memo(function BookNavigation({ className }: BookNavigationProps) {
  const pages = useEditorStore((s) => s.pages)
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const goToPage = useEditorStore((s) => s.goToPage)
  const setPage = useAppStore((s) => s.setPage)
  const pageCount = usePageCount()

  const prefer = useUiPrefStore((s) => s.pageNavPosition)
  const bp = useBreakpoint()
  const position = resolvePosition(prefer, bp)

  const meta = useMemo(() => buildPageMeta(pages), [pages])

  const handleSelect = useCallback(
    (idx: number) => {
      goToPage(idx)
      setPage(idx)
    },
    [goToPage, setPage]
  )
  const handlePrev = useCallback(() => {
    if (currentPageIndex > 0) handleSelect(currentPageIndex - 1)
  }, [currentPageIndex, handleSelect])
  const handleNext = useCallback(() => {
    if (currentPageIndex < pageCount - 1) handleSelect(currentPageIndex + 1)
  }, [currentPageIndex, pageCount, handleSelect])

  if (pageCount === 0) return null

  // 위치별 래퍼 스타일
  const orientation = position === 'right' ? 'vertical' : 'horizontal'

  return (
    <nav
      className={cn(
        'pointer-events-auto bg-white/95 backdrop-blur border border-editor-border shadow-md rounded-xl',
        orientation === 'vertical'
          ? 'fixed right-3 top-1/2 -translate-y-1/2 z-[90] flex flex-col items-stretch gap-2 p-2 max-h-[80vh]'
          : 'fixed left-1/2 -translate-x-1/2 bottom-3 z-[90] flex flex-row items-center gap-2 p-2 max-w-[92vw] overflow-x-auto',
        className
      )}
      aria-label="페이지 네비게이션"
    >
      <button
        onClick={handlePrev}
        disabled={currentPageIndex === 0}
        className={cn(
          'flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors',
          'h-8 w-8',
          currentPageIndex === 0 && 'opacity-40 cursor-not-allowed'
        )}
        title="이전"
      >
        <CaretLeft className="h-4 w-4" />
      </button>

      <div
        className={cn(
          'flex gap-1.5 overflow-auto scrollbar-hide',
          orientation === 'vertical' ? 'flex-col py-1' : 'flex-row px-1'
        )}
      >
        {meta.map((m) => {
          const active = m.index === currentPageIndex
          return (
            <button
              key={m.page.id}
              onClick={() => handleSelect(m.index)}
              title={m.label}
              className={cn(
                'flex-shrink-0 rounded-md text-xs font-medium px-2 py-1 transition-all border',
                orientation === 'vertical' ? 'min-w-[72px]' : 'min-w-[56px]',
                active
                  ? 'bg-violet-100 border-violet-300 text-violet-700'
                  : m.isCover
                    ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              )}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      <button
        onClick={handleNext}
        disabled={currentPageIndex >= pageCount - 1}
        className={cn(
          'flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors',
          'h-8 w-8',
          currentPageIndex >= pageCount - 1 && 'opacity-40 cursor-not-allowed'
        )}
        title="다음"
      >
        <CaretRight className="h-4 w-4" />
      </button>
    </nav>
  )
})
