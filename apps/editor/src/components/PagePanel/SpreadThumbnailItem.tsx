import { memo, type DragEvent } from 'react'
import { cn } from '@/lib/utils'

interface SpreadThumbnailItemProps {
  thumbnailUrl?: string
  label: string
  isActive: boolean
  onClick: () => void
  className?: string
  /** 우측 세로 패널 등 좁은 공간용 축소 썸네일 */
  compact?: boolean
  /**
   * 판형 가로세로비(width/height). 전달 시 폭 예산 × 1/ratio 로 높이를 유도한다.
   * 미전달 시 종전 2:1 고정을 유지한다(비파괴) — 표지 스프레드 기본 형태.
   */
  aspectRatio?: number
  draggable?: boolean
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  isDragSource?: boolean
  insertHint?: 'before' | 'after' | null
}

export const SpreadThumbnailItem = memo(function SpreadThumbnailItem({
  thumbnailUrl,
  label,
  isActive,
  onClick,
  className,
  compact = false,
  aspectRatio,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragSource,
  insertHint,
}: SpreadThumbnailItemProps) {
  // 폭은 종전 예산 그대로(패널 레이아웃 불변), 높이만 판형 비율로 유도.
  // aspectRatio 미전달 = 레거시 2:1 (표지 스프레드 호출부 무회귀).
  const thumbWidth = compact ? 128 : 200
  const thumbSize =
    aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? { width: thumbWidth, height: Math.round(thumbWidth / aspectRatio) }
      : { width: thumbWidth, height: thumbWidth / 2 }
  const insertBarClass = cn(
    'pointer-events-none absolute z-10 bg-blue-500',
    insertHint === 'before' && 'left-0 right-0 top-0 h-[3px]',
    insertHint === 'after' && 'left-0 right-0 bottom-0 h-[3px]',
  )

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1 cursor-pointer transition-all',
        className,
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragSource && 'opacity-50',
      )}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-roledescription={draggable ? '드래그하여 페이지 순서 변경 가능' : undefined}
    >
      {insertHint && <span aria-hidden className={insertBarClass} />}
      {/* 썸네일 - 스프레드는 가로로 넓은 형태 */}
      <div
        className={cn(
          'relative rounded overflow-hidden bg-gray-100 border-2 transition-colors',
          'hover:border-blue-400',
          isActive ? 'border-blue-500 shadow-md' : 'border-gray-300'
        )}
        style={thumbSize}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={label}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
            {label}
          </div>
        )}
        {isActive && (
          <div className="absolute inset-0 border-2 border-blue-500 pointer-events-none" />
        )}
      </div>

      {/* 라벨 */}
      <div
        className={cn(
          'text-xs text-center px-2 py-0.5 rounded',
          isActive ? 'text-blue-600 font-medium' : 'text-gray-600'
        )}
      >
        {label}
      </div>
    </div>
  )
})
