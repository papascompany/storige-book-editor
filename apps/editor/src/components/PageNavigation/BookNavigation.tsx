import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft as CaretLeft, ChevronRight as CaretRight, ChevronUp as CaretUp, ChevronDown as CaretDown } from 'lucide-react'
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
  /** 표지 그룹 내 좌→우 순서 (cover.md §5.2). 내지면 undefined */
  coverPosition?: 'back-wing' | 'back-cover' | 'spine' | 'front-cover' | 'front-wing'
}

/**
 * 표지 페이지 라벨링 — cover.md §5.2 위치별 추론 규칙
 *
 * 규칙: cover-related 페이지(WING/COVER/SPINE)만 추출하여 좌→우 순서로:
 *   - N=1: 단독 표지
 *   - N=3 (COVER, SPINE, COVER): 뒷표지 / 책등 / 앞표지
 *   - N=5 (WING, COVER, SPINE, COVER, WING): 뒷날개 / 뒷표지 / 책등 / 앞표지 / 앞날개
 *   - 그 외 혼합: 위치 기반 fallback (첫 WING="뒷날개", 마지막 WING="앞날개" 등)
 */
function inferCoverLabel(
  type: TemplateType,
  coverIndex: number,
  totalCovers: number
): { label: string; position: PageMeta['coverPosition'] } {
  if (type === TemplateType.SPREAD) {
    return { label: '표지(펼침면)', position: undefined }
  }

  // N=1 단독 표지
  if (totalCovers === 1) {
    if (type === TemplateType.SPINE) return { label: '책등', position: 'spine' }
    if (type === TemplateType.WING) return { label: '날개', position: undefined }
    return { label: '표지', position: undefined }
  }

  // N=3 패턴: COVER / SPINE / COVER → 뒷표지 / 책등 / 앞표지
  if (totalCovers === 3) {
    if (type === TemplateType.SPINE) return { label: '책등', position: 'spine' }
    return coverIndex === 0
      ? { label: '뒷표지', position: 'back-cover' }
      : { label: '앞표지', position: 'front-cover' }
  }

  // N=5 패턴: WING / COVER / SPINE / COVER / WING → 뒷날개 / 뒷표지 / 책등 / 앞표지 / 앞날개
  if (totalCovers === 5) {
    if (type === TemplateType.SPINE) return { label: '책등', position: 'spine' }
    if (type === TemplateType.WING) {
      return coverIndex === 0
        ? { label: '뒷날개', position: 'back-wing' }
        : { label: '앞날개', position: 'front-wing' }
    }
    // COVER (= 뒷표지 또는 앞표지)
    return coverIndex < totalCovers / 2
      ? { label: '뒷표지', position: 'back-cover' }
      : { label: '앞표지', position: 'front-cover' }
  }

  // Fallback (혼합/비표준): 단순 type 기반 + 좌/우 위치
  const isLeftHalf = coverIndex < totalCovers / 2
  if (type === TemplateType.SPINE) return { label: '책등', position: 'spine' }
  if (type === TemplateType.WING) {
    return isLeftHalf
      ? { label: '뒷날개', position: 'back-wing' }
      : { label: '앞날개', position: 'front-wing' }
  }
  return isLeftHalf
    ? { label: '뒷표지', position: 'back-cover' }
    : { label: '앞표지', position: 'front-cover' }
}

function isCoverType(type: TemplateType): boolean {
  return (
    type === TemplateType.COVER ||
    type === TemplateType.SPINE ||
    type === TemplateType.WING ||
    type === TemplateType.SPREAD
  )
}

function buildPageMeta(details: Array<{ id: string; type?: string }>): PageMeta[] {
  // 1차 패스: 표지 관련 페이지 개수 계산 (SPREAD는 단독 1개로 취급)
  const coverIndices: number[] = []
  details.forEach((t, i) => {
    const type = (t.type as TemplateType) || TemplateType.PAGE
    if (isCoverType(type)) coverIndices.push(i)
  })
  const totalCovers = coverIndices.length

  // 2차 패스: 라벨링
  let pageCounter = 0
  let coverCounter = 0
  return details.map((t, i) => {
    const type = (t.type as TemplateType) || TemplateType.PAGE

    if (type === TemplateType.PAGE) {
      pageCounter += 1
      return { index: i, label: `${pageCounter}쪽`, isCover: false, id: `${t.id}-${i}` }
    }

    if (isCoverType(type)) {
      const { label, position } = inferCoverLabel(type, coverCounter, totalCovers)
      coverCounter += 1
      return {
        index: i,
        label,
        isCover: true,
        id: `${t.id}-${i}`,
        coverPosition: position,
      }
    }

    // unknown type — 안전한 fallback
    pageCounter += 1
    return { index: i, label: `${pageCounter}쪽`, isCover: false, id: `${t.id}-${i}` }
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

      {/* 카드 리스트 — 가로/세로 모두 같은 PageThumbnail 사용
          표지 그룹과 내지 사이에 시각 구분선 삽입 (cover.md §5.3) */}
      <div
        className={cn(
          'flex-1 flex gap-2 overflow-auto scrollbar-hide',
          orientation === 'vertical'
            ? 'flex-col items-center w-full px-1'
            : 'flex-row items-center px-1'
        )}
      >
        {items.map((m, i) => {
          const prev = items[i - 1]
          const showCoverNonCoverDivider = prev && prev.isCover && !m.isCover
          return (
            <Fragment key={m.id}>
              {showCoverNonCoverDivider && (
                <span
                  aria-hidden
                  className={cn(
                    'flex-shrink-0 bg-gray-300',
                    orientation === 'vertical'
                      ? 'h-px w-12 my-1'
                      : 'w-px h-12 mx-1'
                  )}
                />
              )}
              <PageThumbnail
                canvas={allCanvas[m.index]}
                label={m.label}
                active={m.index === currentPageIndex}
                isCover={m.isCover}
                onClick={() => handleSelect(m.index)}
                orientation={orientation}
              />
            </Fragment>
          )
        })}
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
