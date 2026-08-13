import { memo, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { SpreadThumbnailItem } from './SpreadThumbnailItem'
import { PageItem } from './PageItem'
import { useEditorStore, useCanAddPage } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useGuestStore } from '@/stores/useGuestStore'
import { cn } from '@/lib/utils'
import { showToast } from '@/stores/useToastStore'
import { BindingType } from '@storige/types'

import { computeInnerReorder } from '@/utils/innerPageReorder'
import { persistContentPdfPageOrderAfterReorder } from '@/utils/contentPdfGuide'

function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
const TOUCH_ENV = isTouchEnv()

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
  const [params] = useSearchParams()
  const sessionId = params.get('sessionId')
  const guestToken = useGuestStore((s) => s.guestToken)
  const pages = useEditorStore((state) => state.pages)
  const currentPageIndex = useEditorStore((state) => state.currentPageIndex)
  const setPage = useAppStore((state) => state.setPage)
  const addPage = useAppStore((state) => state.addPage)
  const deletePage = useAppStore((state) => state.deletePage)
  const reorderByIndex = useAppStore((state) => state.reorderByIndex)
  const allCanvas = useAppStore((state) => state.allCanvas)
  const screenshots = useAppStore((state) => state.screenshots)
  const canAddMore = useCanAddPage()
  const canDeletePage = useEditorStore((state) => state.canDeletePage)
  const bindingType = useEditorStore((state) => state.bindingType)
  const isInnerSpread = useSettingsStore((s) => s.spreadConfig?.regionScope === 'inner')
  const hasCoverSlot = useSettingsStore((s) => s.hasCoverSlot)
  const treatAllAsInners = isInnerSpread || !hasCoverSlot

  // 스프레드 페이지 (항상 첫 번째)
  const spreadPage = pages[0]
  // 내지 페이지들
  const innerPages = pages.slice(1)

  // 스프레드 썸네일도 판형 비율을 따르게 한다(종전 2:1 고정).
  // 표지 스프레드는 대개 2:1 근처라 시각 변화가 거의 없고, 정방형·가로형 판형에서만 교정된다.
  const spreadAspectRatio =
    spreadPage?.canvasData?.width && spreadPage?.canvasData?.height
      ? spreadPage.canvasData.width / spreadPage.canvasData.height
      : undefined

  const handleSelectSpread = useCallback(() => {
    setPage(0)
  }, [setPage])

  const handleSelectInnerPage = useCallback((index: number) => {
    // index는 innerPages 기준이므로 +1
    setPage(index + 1)
  }, [setPage])

  const handleAddPage = useCallback(async () => {
    if (!canAddMore) {
      // A13: 제본 최대페이지(예: 중철 64p) 초과 — 안내
      showToast(
        bindingType === BindingType.SADDLE
          ? '중철제본은 최대 64페이지까지 추가할 수 있습니다.'
          : '더 이상 페이지를 추가할 수 없습니다.',
        'warning',
        2500,
      )
      return
    }
    try {
      await addPage()
    } catch (error) {
      console.error('페이지 추가 실패:', error)
    }
  }, [canAddMore, addPage, bindingType])

  const handleDeletePage = useCallback((pageId: string) => {
    // A13: 제본 최소페이지(예: 무선 32p) 미만으로 삭제 차단
    if (!canDeletePage(pageId)) {
      showToast(
        bindingType === BindingType.PERFECT
          ? '무선제본은 최소 32페이지가 필요해 더 삭제할 수 없습니다.'
          : '최소 페이지 수 제한으로 삭제할 수 없습니다.',
        'warning',
        2500,
      )
      return
    }
    // pageId에 해당하는 캔버스 찾기
    const pageIndex = pages.findIndex((p) => p.id === pageId)
    if (pageIndex === -1) return

    // allCanvas에서 해당 인덱스의 canvasId 가져오기
    const canvas = allCanvas[pageIndex]
    if (!canvas) return

    deletePage(canvas.id)
  }, [pages, allCanvas, deletePage, canDeletePage, bindingType])

  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<{ idx: number; before: boolean } | null>(null)

  const reorderItems = pages.map((page, i) => ({
    index: i,
    isCover: treatAllAsInners ? false : i === 0,
    id: page.id,
  }))
  const dragEnabled =
    !TOUCH_ENV && allCanvas.length > 1 && pages.length === allCanvas.length

  const handleDragStart = (idx: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!dragEnabled) return
    setDragSourceIdx(idx)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
    } catch {
      /* 일부 브라우저는 setData 없이 dragstart 를 무시한다 */
    }
  }

  const resolveInsertBefore = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return isVertical
      ? e.clientY < rect.top + rect.height / 2
      : e.clientX < rect.left + rect.width / 2
  }

  const handleDragOver = (idx: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!dragEnabled || dragSourceIdx === null) return
    if (idx === dragSourceIdx) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const before = resolveInsertBefore(e)
    setDragOver((prev) =>
      prev && prev.idx === idx && prev.before === before ? prev : { idx, before },
    )
  }

  const handleDragLeave = (idx: number) => () => {
    setDragOver((prev) => (prev && prev.idx === idx ? null : prev))
  }

  const handleDrop = (idx: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!dragEnabled || dragSourceIdx === null) return
    e.preventDefault()
    const before = resolveInsertBefore(e)
    const newIndices = computeInnerReorder(reorderItems, dragSourceIdx, idx, before)
    setDragSourceIdx(null)
    setDragOver(null)
    if (!newIndices) return
    reorderByIndex(newIndices)
    const hasUnderlay = allCanvas.some((c) => {
      try {
        return (c.getObjects?.() ?? []).some(
          (o: { meta?: { system?: string } }) => o?.meta?.system === 'innerPdfGuide',
        )
      } catch {
        return false
      }
    })
    if (hasUnderlay) {
      void persistContentPdfPageOrderAfterReorder({
        newIndices,
        innerStart: treatAllAsInners ? 0 : 1,
        sessionId,
        guestToken,
      })
      showToast(
        '화면 순서만 바뀝니다. 인쇄는 첨부한 내지 PDF 원본 순서입니다.',
        'info',
        3500,
      )
    } else {
      showToast('페이지 순서가 변경되었습니다', 'success', 2000)
    }
  }

  const handleDragEnd = () => {
    setDragSourceIdx(null)
    setDragOver(null)
  }

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
        {treatAllAsInners ? (
          <div className={cn('flex gap-2', isVertical ? 'flex-col items-center' : 'flex-row items-start pt-2')}>
            {pages.map((page, index) => (
              <div
                key={page.id}
                className="shrink-0 group"
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
              >
                <PageItem
                  page={page}
                  index={index}
                  thumbnail={screenshots[index]}
                  isActive={currentPageIndex === index}
                  onSelect={(i) => setPage(i)}
                  onDelete={handleDeletePage}
                  canDelete={!page.required && pages.length > 1}
                  isDragging={dragSourceIdx === index}
                  draggable={dragEnabled}
                  onDragStart={handleDragStart(index)}
                  onDragOver={handleDragOver(index)}
                  onDragLeave={handleDragLeave(index)}
                  onDrop={handleDrop(index)}
                  onDragEnd={handleDragEnd}
                  insertHint={
                    dragOver && dragOver.idx === index
                      ? dragOver.before
                        ? 'before'
                        : 'after'
                      : null
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            {spreadPage && (
              <>
                <div ref={(el) => { if (el) itemRefs.current.set(0, el); else itemRefs.current.delete(0) }}>
                  <SpreadThumbnailItem
                    label="표지 스프레드"
                    thumbnailUrl={screenshots[0]}
                    isActive={currentPageIndex === 0}
                    onClick={handleSelectSpread}
                    compact={isVertical}
                    aspectRatio={spreadAspectRatio}
                    isDragSource={false}
                    insertHint={null}
                  />
                </div>
                <div className={cn('bg-gray-300 shrink-0', isVertical ? 'w-16 h-px' : 'h-16 w-px')} />
              </>
            )}
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
                    isDragging={dragSourceIdx === index + 1}
                    draggable={dragEnabled}
                    onDragStart={handleDragStart(index + 1)}
                    onDragOver={handleDragOver(index + 1)}
                    onDragLeave={handleDragLeave(index + 1)}
                    onDrop={handleDrop(index + 1)}
                    onDragEnd={handleDragEnd}
                    insertHint={
                      dragOver && dragOver.idx === index + 1
                        ? dragOver.before
                          ? 'before'
                          : 'after'
                        : null
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}
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
