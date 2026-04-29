import { memo } from 'react'
import { Check, Layers as Stack } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TemplateSetType } from '@storige/types'

interface TemplateSetCardProps {
  id: string
  name: string
  type: TemplateSetType
  thumbnailUrl: string | null
  width: number
  height: number
  templateCount: number
  isSelected?: boolean
  onClick?: () => void
}

const TYPE_LABELS: Record<string, string> = {
  book: '책자',
  leaflet: '리플렛',
}

export const TemplateSetCard = memo(function TemplateSetCard({
  id,
  name,
  type,
  thumbnailUrl,
  width,
  height,
  templateCount,
  isSelected = false,
  onClick,
}: TemplateSetCardProps) {
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
      <div className="aspect-[4/3] bg-gray-100">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Stack className="w-8 h-8" />
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="p-2">
        <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1">
            <span className="text-xs px-1.5 py-0.5 bg-blue-50 rounded text-blue-600">
              {TYPE_LABELS[type] || type}
            </span>
            <span className="text-xs text-gray-500">
              {width}x{height}
            </span>
          </div>
          <span className="text-xs text-gray-500">{templateCount}장</span>
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
