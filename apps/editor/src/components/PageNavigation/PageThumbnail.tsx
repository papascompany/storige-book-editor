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

  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'group relative flex-shrink-0 rounded-md overflow-hidden bg-white border-2 transition-all',
        orientation === 'vertical' ? 'w-[88px] h-[60px]' : 'w-[104px] h-[72px]',
        active
          ? 'border-violet-500 ring-2 ring-violet-200 shadow-md'
          : isCover
            ? 'border-amber-200 hover:border-amber-400'
            : 'border-gray-200 hover:border-gray-400'
      )}
    >
      {/* 썸네일 이미지 */}
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

      {/* 표지 배지 (좌상단) */}
      {isCover && (
        <span className="absolute top-0.5 left-0.5 px-1 py-px text-[9px] font-bold rounded bg-amber-200 text-amber-900">
          {label.includes('표지') ? '표지' : label}
        </span>
      )}

      {/* 라벨 (하단) — 활성 시 violet, 표지 시 표시 안 함(이미 배지) */}
      {!isCover && (
        <span
          className={cn(
            'absolute bottom-0 left-0 right-0 text-[10px] font-semibold py-px px-1 text-center',
            active ? 'bg-violet-100/95 text-violet-700' : 'bg-white/85 text-gray-700'
          )}
        >
          {label}
        </span>
      )}
    </button>
  )
})
