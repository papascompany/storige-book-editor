import { memo, useEffect, useRef, useState } from 'react'
import type { fabric } from 'fabric'
import { cn } from '@/lib/utils'

/**
 * 페이지 썸네일 카드.
 * - fabric.Canvas → toDataURL(0.15x) 로 실시간 미리보기 생성
 * - 캔버스가 그려질 때(after:render) throttle 갱신
 * - 활성/표지 시각 강조
 */

interface PageThumbnailProps {
  canvas?: fabric.Canvas
  label: string
  active: boolean
  isCover: boolean
  onClick: () => void
  orientation: 'vertical' | 'horizontal'
  // DD-5-B-v2: drag-to-reorder (BookNavigation에서만 주입; 표지/모바일은 미주입)
  draggable?: boolean
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragLeave?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (e: React.DragEvent<HTMLButtonElement>) => void
  /** 자기 자신이 drag source일 때 (반투명 처리) */
  isDragSource?: boolean
  /** drop hover 중일 때 삽입선 위치 (orientation에 따라 좌/우 또는 상/하) */
  insertHint?: 'before' | 'after' | null
}

export const PageThumbnail = memo(function PageThumbnail({
  canvas,
  label,
  active,
  isCover,
  onClick,
  orientation,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragSource,
  insertHint,
}: PageThumbnailProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!canvas) {
      setDataUrl(null)
      return
    }

    const update = () => {
      const now = Date.now()
      if (now - lastUpdateRef.current < 250) return // throttle ~4fps
      lastUpdateRef.current = now
      try {
        const url = canvas.toDataURL({
          format: 'png',
          multiplier: 0.15,
          quality: 0.7,
        })
        setDataUrl(url)
      } catch {
        // 캔버스 비활성/제거된 경우 무시
      }
    }

    // 초기 1회
    update()
    // 이후 변경 감지
    canvas.on('after:render', update)
    return () => {
      canvas.off('after:render', update)
    }
  }, [canvas])

  // 삽입선 (orientation 별로 좌/우 또는 상/하 가장자리에 표시 — overflow-hidden 카드 내부)
  const showInsertBar = !!insertHint
  const insertBarClass = cn(
    'pointer-events-none absolute z-10 bg-editor-accent',
    orientation === 'vertical'
      ? 'left-0 right-0 h-[4px]'
      : 'top-0 bottom-0 w-[4px]',
    insertHint === 'before' &&
      (orientation === 'vertical' ? 'top-0' : 'left-0'),
    insertHint === 'after' &&
      (orientation === 'vertical' ? 'bottom-0' : 'right-0')
  )

  // PDF 시안 매칭 (cover.md §5.4):
  //   - 표지 카드는 둥근 그레이 박스 외곽 (라벨은 카드 외부 하단)
  //   - 내지 카드는 흰 배경 + 카드 내부 하단 라벨 (기존 유지)
  //   - 활성 카드는 editor-accent 강조 (브랜드 일관성, 기존 violet 대체)
  if (isCover) {
    return (
      <button
        onClick={onClick}
        title={label}
        className={cn(
          'group flex-shrink-0 flex flex-col items-center gap-1 transition-all',
          orientation === 'vertical' ? 'w-[88px]' : 'w-[88px]'
        )}
      >
        <div
          className={cn(
            'relative w-full overflow-hidden rounded-lg bg-editor-surface-low border-2 transition-colors',
            orientation === 'vertical' ? 'h-[64px]' : 'h-[64px]',
            active
              ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md bg-editor-panel'
              : 'border-editor-border hover:border-editor-text-muted hover:bg-editor-panel'
          )}
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={label}
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full" />
          )}
        </div>
        <span
          className={cn(
            'text-[10px] font-medium leading-none truncate w-full text-center',
            active ? 'text-editor-accent font-semibold' : 'text-editor-text-muted'
          )}
        >
          {label}
        </span>
      </button>
    )
  }

  // 내지 카드 — 기존 디자인 유지 + 활성 강조만 editor-accent로 통일
  return (
    <button
      onClick={onClick}
      title={label}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      aria-roledescription={draggable ? '드래그하여 페이지 순서 변경 가능' : undefined}
      className={cn(
        'group relative flex-shrink-0 rounded-md overflow-hidden bg-editor-panel border-2 transition-all',
        orientation === 'vertical' ? 'w-[88px] h-[60px]' : 'w-[88px] h-[72px]',
        active
          ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md'
          : 'border-editor-border hover:border-editor-text-muted',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragSource && 'opacity-40 ring-2 ring-editor-accent/40'
      )}
    >
      {showInsertBar && <span aria-hidden className={insertBarClass} />}
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={label}
          className="w-full h-full object-contain bg-editor-surface-low"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-editor-surface-low to-editor-surface" />
      )}
      <span
        className={cn(
          'absolute bottom-0 left-0 right-0 text-[10px] font-semibold py-px px-1 text-center',
          active ? 'bg-editor-accent/10 text-editor-accent' : 'bg-editor-panel/85 text-editor-text'
        )}
      >
        {label}
      </span>
    </button>
  )
})
