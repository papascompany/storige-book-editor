import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CaretLeft, CaretRight, CaretUp, CaretDown } from '@phosphor-icons/react'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useResolvedPageNavPosition } from '@/hooks/useResolvedPageNavPosition'
import { templateSetsApi } from '@/api'
import { TemplateType } from '@storige/types'
import { PageThumbnail } from './PageThumbnail'
import { cn } from '@/lib/utils'

/**
 * 책자(BOOK) 페이지 네비게이션 — Canva 스타일 썸네일 리스트
 *
 * 레이아웃:
 *   - inline (fixed 아님). 부모 EditorView가 layout에 placement.
 *   - orientation: 'vertical' (우측 패널) | 'horizontal' (하단 패널)
 *   - 가로/세로 모두 동일 카드 컴포넌트(PageThumbnail) 사용
 *
 * 페이지 정보 우선순위:
 *   1. useEditorStore.pages (single/spread mode 모두 setPages 호출됨)
 *   2. ?templateSetId= API fetch (폴백)
 *   3. useAppStore.allCanvas 길이만 (최후 폴백, "1쪽","2쪽"…)
 */

interface PageMeta {
  index: number
  label: string
  isCover: boolean
  id: string
}

function buildPageMeta(details: Array<{ id: string; type?: string }>): PageMeta[] {
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

interface BookNavigationProps {
  orientation?: 'vertical' | 'horizontal'  // caller가 결정. 없으면 hook으로 자체 결정
  className?: string
}

export const BookNavigation = memo(function BookNavigation({
  orientation: forcedOrientation,
  className,
}: BookNavigationProps) {
  const [params] = useSearchParams()
  const templateSetId = params.get('templateSetId')

  const editorStorePages = useEditorStore((s) => s.pages)

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
      .catch((err) => {
        console.warn('[BookNavigation] templateSet fetch failed:', err?.message ?? err)
      })
    return () => { cancelled = true }
  }, [templateSetId, editorStorePages.length])

  const meta = useMemo<PageMeta[]>(() => {
    if (editorStorePages.length > 0) {
      return buildPageMeta(editorStorePages.map((p) => ({ id: p.id, type: p.templateType })))
    }
    if (fetched && fetched.length > 0) {
      return buildPageMeta(fetched)
    }
    return []
  }, [editorStorePages, fetched])

  const allCanvas = useAppStore((s) => s.allCanvas)
  const allCanvasLength = allCanvas.length
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const setPage = useAppStore((s) => s.setPage)
  const goToPage = useEditorStore((s) => s.goToPage)

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

  const autoOrientation = useResolvedPageNavPosition() === 'right' ? 'vertical' : 'horizontal'
  const orientation = forcedOrientation ?? autoOrientation

  if (pageCount === 0) return null

  // meta 없을 때(어디서도 못 받음) — 캔버스 개수만큼 단순 라벨
  const items: PageMeta[] =
    meta.length > 0
      ? meta
      : Array.from({ length: pageCount }, (_, i) => ({
          index: i,
          label: `${i + 1}쪽`,
          isCover: false,
          id: `canvas-${i}`,
        }))

  // 화살표 아이콘 — 가로면 좌/우, 세로면 위/아래
  const PrevIcon = orientation === 'vertical' ? CaretUp : CaretLeft
  const NextIcon = orientation === 'vertical' ? CaretDown : CaretRight

  return (
    <nav
      className={cn(
        'pointer-events-auto bg-white shrink-0',
        orientation === 'vertical'
          ? 'h-full w-[112px] flex flex-col items-center gap-2 py-2 border-l border-editor-border'
          : 'w-full h-[100px] flex flex-row items-center gap-2 px-3 border-t border-editor-border',
        className
      )}
      aria-label="페이지 네비게이션"
    >
      {/* 이전 버튼 */}
      <button
        onClick={handlePrev}
        disabled={currentPageIndex === 0}
        className={cn(
          'flex-shrink-0 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors',
          orientation === 'vertical' ? 'w-10 h-7' : 'w-7 h-10',
          currentPageIndex === 0 && 'opacity-40 cursor-not-allowed'
        )}
        title="이전"
      >
        <PrevIcon className="h-4 w-4" />
      </button>

      {/* 카드 리스트 — 가로/세로 모두 같은 PageThumbnail 사용 */}
      <div
        className={cn(
          'flex-1 flex gap-2 overflow-auto scrollbar-hide',
          orientation === 'vertical'
            ? 'flex-col items-center w-full px-1'
            : 'flex-row items-center px-1'
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

      {/* 다음 버튼 */}
      <button
        onClick={handleNext}
        disabled={currentPageIndex >= pageCount - 1}
        className={cn(
          'flex-shrink-0 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors',
          orientation === 'vertical' ? 'w-10 h-7' : 'w-7 h-10',
          currentPageIndex >= pageCount - 1 && 'opacity-40 cursor-not-allowed'
        )}
        title="다음"
      >
        <NextIcon className="h-4 w-4" />
      </button>
    </nav>
  )
})
