import { memo, type DragEvent, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { computeThumbBox } from '@/utils/thumbnailAspect'
import { TemplateType } from '@storige/types'
import type { EditPage } from '@storige/types'

interface PageItemProps {
  page: EditPage
  index: number
  isActive: boolean
  thumbnail?: string
  onSelect: (index: number) => void
  onDelete?: (pageId: string) => void
  canDelete: boolean
  isDragging?: boolean
  draggable?: boolean
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  insertHint?: 'before' | 'after' | null
}

const templateTypeLabels: Record<TemplateType, string> = {
  [TemplateType.WING]: '날개',
  [TemplateType.COVER]: '표지',
  [TemplateType.SPINE]: '책등',
  [TemplateType.PAGE]: '내지',
  [TemplateType.SPREAD]: '펼침',
  [TemplateType.ENDPAPER]: '면지',
}

const templateTypeColors: Record<TemplateType, string> = {
  [TemplateType.WING]: 'bg-purple-100 text-purple-700',
  [TemplateType.COVER]: 'bg-blue-100 text-blue-700',
  [TemplateType.SPINE]: 'bg-orange-100 text-orange-700',
  [TemplateType.PAGE]: 'bg-gray-100 text-gray-700',
  [TemplateType.SPREAD]: 'bg-violet-100 text-violet-700',
  [TemplateType.ENDPAPER]: 'bg-amber-100 text-amber-700',
}

export const PageItem = memo(function PageItem({
  page,
  index,
  isActive,
  thumbnail,
  onSelect,
  onDelete,
  canDelete,
  isDragging,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  insertHint,
}: PageItemProps) {
  // 판형 비율 썸네일 박스 — canvasData.width/height(mm)가 권위.
  // 펼침면 내지는 여기서 자동으로 가로 긴 카드가 된다(폭 예산 고정 → 높이 유도).
  const thumbBox = computeThumbBox(page.canvasData?.width, page.canvasData?.height)

  const handleClick = () => {
    onSelect(index)
  }

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation()
    if (onDelete && canDelete) {
      onDelete(page.id)
    }
  }

  const insertBarClass = cn(
    'pointer-events-none absolute z-10 bg-blue-500',
    insertHint === 'before' && 'left-0 right-0 top-0 h-[3px]',
    insertHint === 'after' && 'left-0 right-0 bottom-0 h-[3px]',
  )

  return (
    <div
      className={cn(
        'relative flex flex-col items-center p-2 rounded-lg cursor-pointer transition-all',
        'hover:bg-gray-100',
        isActive && 'ring-2 ring-blue-500 bg-blue-50',
        isDragging && 'opacity-50',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      onClick={handleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-roledescription={draggable ? '드래그하여 페이지 순서 변경 가능' : undefined}
    >
      {insertHint && <span aria-hidden className={insertBarClass} />}
      {/* 썸네일 — 박스 크기를 판형 비율로 유도(고정 w-20 h-28 제거).
          낱장 내지는 낱장 비율로, 펼침면 내지는 펼침면(가로 긴) 비율로 보인다. */}
      <div
        className={cn(
          'bg-white border rounded shadow-sm overflow-hidden',
          'flex items-center justify-center'
        )}
        style={{ width: thumbBox.width, height: thumbBox.height }}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={`Page ${index + 1}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-gray-400 text-xs">미리보기</div>
        )}
      </div>

      {/* 페이지 번호 */}
      <div className="mt-1 text-center">
        <div className="text-xs font-medium text-gray-700">
          {index + 1}
        </div>
      </div>


      {/* 삭제 버튼 */}
      {canDelete && onDelete && (
        <button
          className={cn(
            'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full',
            'bg-gray-400 text-white text-[10px] leading-none',
            'flex items-center justify-center',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-gray-600',
            'shadow-sm'
          )}
          onClick={handleDelete}
          title="페이지 삭제"
        >
          ✕
        </button>
      )}
    </div>
  )
})
