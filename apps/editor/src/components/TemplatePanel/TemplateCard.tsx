import { memo } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TemplateType } from '@storige/types'

interface TemplateCardProps {
  id: string
  name: string
  type?: TemplateType
  thumbnailUrl: string | null
  width?: number
  height?: number
  isSelected?: boolean
  onClick?: () => void
}

const TYPE_LABELS: Record<string, string> = {
  wing: '날개',
  cover: '표지',
  spine: '책등',
  page: '내지',
}

export const TemplateCard = memo(function TemplateCard({
  id,
  name,
  type,
  thumbnailUrl,
  width,
  height,
  isSelected = false,
  onClick,
}: TemplateCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative group cursor-pointer rounded-lg border-2 overflow-hidden transition-all',
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-gray-300'
      )}
    >
      {/* 썸네일 */}
      <div className="aspect-[3/4] bg-gray-100">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <span className="text-xs">No Image</span>
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="p-2">
        <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
        <div className="flex items-center gap-1 mt-1">
          {type && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
              {TYPE_LABELS[type] || type}
            </span>
          )}
          {width && height && (
            <span className="text-xs text-gray-500">
              {width}x{height}
            </span>
          )}
        </div>
      </div>

      {/* 선택 표시 */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
          <Check className="w-4 h-4 text-white" />
        </div>
      )}

      {/* 호버 오버레이 */}
      <div
        className={cn(
          'absolute inset-0 bg-black/0 transition-colors',
          !isSelected && 'group-hover:bg-black/5'
        )}
      />
    </div>
  )
})
