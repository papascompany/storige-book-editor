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
}

export const PageThumbnail = memo(function PageThumbnail({
  canvas,
  label,
  active,
  isCover,
  onClick,
  orientation,
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
            'relative w-full overflow-hidden rounded-lg bg-gray-100 border-2 transition-colors',
            orientation === 'vertical' ? 'h-[64px]' : 'h-[64px]',
            active
              ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md bg-white'
              : 'border-gray-200 hover:border-gray-400 hover:bg-white'
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
            active ? 'text-editor-accent font-semibold' : 'text-gray-600'
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
      className={cn(
        'group relative flex-shrink-0 rounded-md overflow-hidden bg-white border-2 transition-all',
        orientation === 'vertical' ? 'w-[88px] h-[60px]' : 'w-[88px] h-[72px]',
        active
          ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md'
          : 'border-gray-200 hover:border-gray-400'
      )}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={label}
          className="w-full h-full object-contain bg-gray-50"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-gray-50 to-gray-100" />
      )}
      <span
        className={cn(
          'absolute bottom-0 left-0 right-0 text-[10px] font-semibold py-px px-1 text-center',
          active ? 'bg-editor-accent/10 text-editor-accent' : 'bg-white/85 text-gray-700'
        )}
      >
        {label}
      </span>
    </button>
  )
})
