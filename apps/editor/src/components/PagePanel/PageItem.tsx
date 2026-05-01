import { memo } from 'react'
import { cn } from '@/lib/utils'
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
}

const templateTypeLabels: Record<TemplateType, string> = {
  [TemplateType.WING]: '날개',
  [TemplateType.COVER]: '표지',
  [TemplateType.SPINE]: '책등',
  [TemplateType.PAGE]: '내지',
  [TemplateType.SPREAD]: '펼침',
}

const templateTypeColors: Record<TemplateType, string> = {
  [TemplateType.WING]: 'bg-purple-100 text-purple-700',
  [TemplateType.COVER]: 'bg-blue-100 text-blue-700',
  [TemplateType.SPINE]: 'bg-orange-100 text-orange-700',
  [TemplateType.PAGE]: 'bg-gray-100 text-gray-700',
  [TemplateType.SPREAD]: 'bg-violet-100 text-violet-700',
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
}: PageItemProps) {
  const handleClick = () => {
    onSelect(index)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDelete && canDelete) {
      onDelete(page.id)
    }
  }

  return (
    <div
      className={cn(
        'relative flex flex-col items-center p-2 rounded-lg cursor-pointer transition-all',
        'hover:bg-gray-100',
        isActive && 'ring-2 ring-blue-500 bg-blue-50',
        isDragging && 'opacity-50'
      )}
      onClick={handleClick}
    >
      {/* 썸네일 */}
      <div
        className={cn(
          'w-20 h-28 bg-white border rounded shadow-sm overflow-hidden',
          'flex items-center justify-center'
        )}
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
