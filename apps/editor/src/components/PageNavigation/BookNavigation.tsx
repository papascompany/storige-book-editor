import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useUiPrefStore, type PageNavPosition } from '@/stores/useUiPrefStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { templateSetsApi } from '@/api'
import { TemplateType } from '@storige/types'
import { PageThumbnail } from './PageThumbnail'
import { cn } from '@/lib/utils'

/**
 * 책자(BOOK) 페이지 네비게이션
 * - 표지(COVER/SPREAD/WING) → 내지(PAGE) 1, 2, ... 순서로 라벨링
 * - 위치는 우측(데스크톱 기본) 또는 하단(모바일 기본), 사용자 강제 가능
 *
 * 페이지 정보 우선순위:
 *   1. useEditorStore.pages (spread mode에서 채워짐)
 *   2. ?templateSetId=... 가 있으면 직접 API fetch (single mode)
 *   3. allCanvas 길이로 폴백 (이름 없이 page#)
 *
 * 표지 편집 모드별 view 분기는 후속 작업 (agents/12-cover-edit-modes.md)
 */

interface PageMeta {
  index: number          // useAppStore.setPage 호출 시 사용
  label: string
  isCover: boolean
  id: string
}

function buildPageMetaFromTemplateDetails(details: Array<{ id: string; type?: string }>): PageMeta[] {
  let pageCounter = 0
  return details.map((t, i) => {
    const type = (t.type as TemplateType) || TemplateType.PAGE
    let label = ''
    let isCover = false
    switch (type) {
      case TemplateType.COVER:  label = '표지';        isCover = true; break
      case TemplateType.SPREAD: label = '표지(펼침면)'; isCover = true; break
      case TemplateType.WING:   label = '날개';        isCover = true; break
      case TemplateType.SPINE:  label = '책등';        isCover = true; break
      case TemplateType.PAGE:
      default:
        pageCounter += 1
        label = `${pageCounter}쪽`
    }
    return { index: i, label, isCover, id: `${t.id}-${i}` }
  })
}

function resolvePosition(prefer: PageNavPosition, bp: ReturnType<typeof useBreakpoint>): 'right' | 'bottom' {
  if (prefer === 'auto') return bp === 'desktop' ? 'right' : 'bottom'
  return prefer
}

interface BookNavigationProps {
  className?: string
}

export const BookNavigation = memo(function BookNavigation({ className }: BookNavigationProps) {
  const [params] = useSearchParams()
  const templateSetId = params.get('templateSetId')

  // 1) 우선: useEditorStore.pages (spread/book mode에서 채워짐)
  const editorStorePages = useEditorStore((s) => s.pages)

  // 2) 폴백: templateSetId로 직접 fetch
  const [fetched, setFetched] = useState<Array<{ id: string; type?: string }> | null>(null)
  useEffect(() => {
    if (!templateSetId) return
    if (editorStorePages.length > 0) return
    let cancelled = false
    templateSetsApi
      .getTemplateSetWithTemplates(templateSetId)
      .then((res) => {
        if (cancelled) return
        const list = (res as any)?.templateDetails as Array<{ id: string; type?: string }> | undefined
        if (Array.isArray(list)) setFetched(list)
      })
      .catch(() => {/* silent */})
    return () => { cancelled = true }
  }, [templateSetId, editorStorePages.length])

  // 페이지 메타 결정
  const meta = useMemo<PageMeta[]>(() => {
    if (editorStorePages.length > 0) {
      return buildPageMetaFromTemplateDetails(
        editorStorePages.map((p) => ({ id: p.id, type: p.templateType }))
      )
    }
    if (fetched && fetched.length > 0) {
      return buildPageMetaFromTemplateDetails(fetched)
    }
    return []
  }, [editorStorePages, fetched])

  // 현재 페이지 인덱스 — useAppStore의 canvas 인덱스 (단일 모드 기준)
  // useEditorStore.currentPageIndex와 setPage가 동기화됨
  const allCanvas = useAppStore((s) => s.allCanvas)
  const allCanvasLength = allCanvas.length
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const setPage = useAppStore((s) => s.setPage)
  const goToPage = useEditorStore((s) => s.goToPage)

  // pageCount는 meta 기준 (없으면 allCanvas 폴백)
  const pageCount = meta.length || allCanvasLength

  const handleSelect = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= pageCount) return
      setPage(idx)
      goToPage(idx)
    },
    [pageCount, setPage, goToPage]
  )

  const handlePrev = useCallback(() => {
    if (currentPageIndex > 0) handleSelect(currentPageIndex - 1)
  }, [currentPageIndex, handleSelect])
  const handleNext = useCallback(() => {
    if (currentPageIndex < pageCount - 1) handleSelect(currentPageIndex + 1)
  }, [currentPageIndex, pageCount, handleSelect])

  const prefer = useUiPrefStore((s) => s.pageNavPosition)
  const bp = useBreakpoint()
  const position = resolvePosition(prefer, bp)
  const orientation = position === 'right' ? 'vertical' : 'horizontal'

  if (pageCount === 0) return null

  // meta가 비어있고 allCanvas만 있을 때 — fallback 라벨 (1쪽, 2쪽 …)
  const items: PageMeta[] =
    meta.length > 0
      ? meta
      : Array.from({ length: pageCount }, (_, i) => ({
          index: i,
          label: `${i + 1}쪽`,
          isCover: false,
          id: `canvas-${i}`,
        }))

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
          'flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors h-8 w-8',
          currentPageIndex === 0 && 'opacity-40 cursor-not-allowed'
        )}
        title="이전"
      >
        <CaretLeft className="h-4 w-4" />
      </button>

      <div
        className={cn(
          'flex gap-2 overflow-auto scrollbar-hide',
          orientation === 'vertical' ? 'flex-col py-1' : 'flex-row px-1'
        )}
      >
        {items.map((m) => (
          <PageThumbnail
            key={m.id}
            canvas={allCanvas[m.index]}
            label={m.label}
            active={m.index === currentPageIndex}
            isCover={m.isCover}
            onClick={() => handleSelect(m.index)}
            orientation={orientation}
          />
        ))}
      </div>

      <button
        onClick={handleNext}
        disabled={currentPageIndex >= pageCount - 1}
        className={cn(
          'flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors h-8 w-8',
          currentPageIndex >= pageCount - 1 && 'opacity-40 cursor-not-allowed'
        )}
        title="다음"
      >
        <CaretRight className="h-4 w-4" />
      </button>
    </nav>
  )
})
