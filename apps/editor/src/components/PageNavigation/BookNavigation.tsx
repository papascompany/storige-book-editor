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
import { showToast } from '@/stores/useToastStore'

// 모바일/터치 환경에서는 native HTML5 drag가 불안정 + long-press와 충돌 → drag 비활성
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
const TOUCH_ENV = isTouchEnv()

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

export interface PageMeta {
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

export function isCoverType(type: TemplateType): boolean {
  return (
    type === TemplateType.COVER ||
    type === TemplateType.SPINE ||
    type === TemplateType.WING ||
    type === TemplateType.SPREAD
  )
}

export function buildPageMeta(details: Array<{ id: string; type?: string }>): PageMeta[] {
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
  const reorderByIndex = useAppStore((s) => s.reorderByIndex)
  const isSpreadMode = useAppStore((s) => s.isSpreadMode)

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

  // DD-5-B-v2: drag-to-reorder 상태 — sourceIdx는 allCanvas 기준 인덱스
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<{ idx: number; before: boolean } | null>(null)

  // 드래그 가능 조건 — 모바일/터치 + 스프레드 모드 + 메타 미동기화 시 비활성
  // (items.length !== allCanvasLength면 reorderByIndex가 length mismatch로 거절하므로 사전 차단)
  const dragEnabled =
    !TOUCH_ENV && !isSpreadMode && allCanvasLength > 1 && pageCount === allCanvasLength

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

  // drag handler 모음 — 내지(non-cover) 카드에만 부여
  const handleDragStart = (idx: number) => (e: React.DragEvent<HTMLButtonElement>) => {
    if (!dragEnabled) return
    setDragSourceIdx(idx)
    // dataTransfer는 일부 브라우저에서 setData 호출 안 하면 dragstart 자체가 무시됨
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
    } catch {
      // 무시
    }
  }

  const handleDragOver = (idx: number) => (e: React.DragEvent<HTMLButtonElement>) => {
    if (!dragEnabled || dragSourceIdx === null) return
    if (idx === dragSourceIdx) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // 포인터 위치로 before/after 결정 (orientation 별로 X 또는 Y 축 사용)
    const rect = e.currentTarget.getBoundingClientRect()
    const before =
      orientation === 'vertical'
        ? e.clientY < rect.top + rect.height / 2
        : e.clientX < rect.left + rect.width / 2
    setDragOver((prev) =>
      prev && prev.idx === idx && prev.before === before ? prev : { idx, before }
    )
  }

  const handleDragLeave = (idx: number) => () => {
    setDragOver((prev) => (prev && prev.idx === idx ? null : prev))
  }

  const handleDrop = (idx: number) => (e: React.DragEvent<HTMLButtonElement>) => {
    if (!dragEnabled || dragSourceIdx === null) return
    e.preventDefault()
    const before =
      orientation === 'vertical'
        ? e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2
        : e.clientX < e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2
    const newIndices = computeInnerReorder(items, dragSourceIdx, idx, before)
    setDragSourceIdx(null)
    setDragOver(null)
    if (!newIndices) return
    reorderByIndex(newIndices)
    showToast('페이지 순서가 변경되었습니다', 'success', 2000)
  }

  const handleDragEnd = () => {
    setDragSourceIdx(null)
    setDragOver(null)
  }

  // 화살표 아이콘 — 가로면 좌/우, 세로면 위/아래
  const PrevIcon = orientation === 'vertical' ? CaretUp : CaretLeft
  const NextIcon = orientation === 'vertical' ? CaretDown : CaretRight

  return (
    <nav
      className={cn(
        'pointer-events-auto bg-editor-panel shrink-0',
        orientation === 'vertical'
          ? 'h-full w-[112px] flex flex-col items-center gap-2 py-2 border-l border-editor-border'
          : 'w-full h-[100px] flex flex-row items-center gap-2 px-3 border-t border-editor-border',
        className
      )}
      aria-label="페이지 네비게이션"
    >
      {/* 이전 버튼 — 터치 타겟 44px+ 보장 (반응형 Phase 2) */}
      <button
        onClick={handlePrev}
        disabled={currentPageIndex === 0}
        className={cn(
          'flex-shrink-0 flex items-center justify-center rounded-md hover:bg-editor-hover transition-colors',
          'min-w-[44px] min-h-[44px]',
          orientation === 'vertical' ? 'w-11 h-11' : 'w-11 h-11',
          currentPageIndex === 0 && 'opacity-40 cursor-not-allowed'
        )}
        aria-label="이전 페이지"
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
                    'flex-shrink-0 bg-editor-border',
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
                draggable={dragEnabled && !m.isCover}
                onDragStart={!m.isCover ? handleDragStart(m.index) : undefined}
                onDragOver={!m.isCover ? handleDragOver(m.index) : undefined}
                onDragLeave={!m.isCover ? handleDragLeave(m.index) : undefined}
                onDrop={!m.isCover ? handleDrop(m.index) : undefined}
                onDragEnd={!m.isCover ? handleDragEnd : undefined}
                isDragSource={dragSourceIdx === m.index}
                insertHint={
                  dragOver && dragOver.idx === m.index ? (dragOver.before ? 'before' : 'after') : null
                }
              />
            </Fragment>
          )
        })}
      </div>

      {/* 다음 버튼 — 터치 타겟 44px+ 보장 (반응형 Phase 2) */}
      <button
        onClick={handleNext}
        disabled={currentPageIndex >= pageCount - 1}
        className={cn(
          'flex-shrink-0 flex items-center justify-center rounded-md hover:bg-editor-hover transition-colors',
          'min-w-[44px] min-h-[44px]',
          orientation === 'vertical' ? 'w-11 h-11' : 'w-11 h-11',
          currentPageIndex >= pageCount - 1 && 'opacity-40 cursor-not-allowed'
        )}
        aria-label="다음 페이지"
        title="다음"
      >
        <NextIcon className="h-4 w-4" />
      </button>
    </nav>
  )
})

/**
 * DD-5-B-v2: 내지 페이지간 reorder 순열 계산.
 * 표지(isCover)는 원래 인덱스를 유지하고, 내지(PAGE)만 source→target 위치로 이동.
 * 표지를 source/target으로 받으면 null 반환 (drag 막기 위함).
 *
 * @param items 표시 순서의 PageMeta 배열 (m.index === allCanvas 인덱스)
 * @param sourceIdx allCanvas 기준 source 인덱스
 * @param targetIdx allCanvas 기준 target(드롭 위치) 인덱스
 * @param insertBefore target의 앞쪽 vs 뒤쪽에 삽입
 * @returns reorderByIndex에 넘길 0..N-1 순열, no-op이거나 invalid면 null
 */
export function computeInnerReorder(
  items: PageMeta[],
  sourceIdx: number,
  targetIdx: number,
  insertBefore: boolean
): number[] | null {
  // 내지 인덱스만 추출 (allCanvas 기준)
  const innerIndices = items.filter((m) => !m.isCover).map((m) => m.index)
  const srcInner = innerIndices.indexOf(sourceIdx)
  const tgtInner = innerIndices.indexOf(targetIdx)
  if (srcInner < 0 || tgtInner < 0) return null

  // 삽입 위치 계산 (source 제거에 따른 인덱스 보정)
  let insertAt = insertBefore ? tgtInner : tgtInner + 1
  if (srcInner < insertAt) insertAt -= 1
  if (insertAt === srcInner) return null // no-op

  const reordered = [...innerIndices]
  const [moved] = reordered.splice(srcInner, 1)
  reordered.splice(insertAt, 0, moved)

  // 전체 순열 조립 — 표지 위치는 원본 유지, 내지 위치는 새 순서로
  const newIndices: number[] = items.map((m) => m.index)
  let r = 0
  for (let i = 0; i < items.length; i++) {
    if (!items[i].isCover) {
      newIndices[i] = reordered[r++]
    }
  }
  return newIndices
}
