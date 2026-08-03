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

/** 캔버스의 워크스페이스(=판형) 객체. 없으면 뷰포트 전체가 대상이 된다. */
function getWorkspaceRect(canvas: fabric.Canvas): { left: number; top: number; width: number; height: number } | null {
  const ws = canvas.getObjects().find((o) => (o as { id?: string }).id === 'workspace')
  if (!ws) return null
  const b = ws.getBoundingRect()
  return b.width > 0 && b.height > 0 ? b : null
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
  // 워크스페이스(판형) 가로세로비 — 카드 박스 높이를 여기서 유도한다.
  const [aspect, setAspect] = useState<number | null>(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!canvas) {
      setDataUrl(null)
      setAspect(null)
      return
    }

    const update = () => {
      const now = Date.now()
      if (now - lastUpdateRef.current < 250) return // throttle ~4fps
      lastUpdateRef.current = now
      try {
        // 워크스페이스(판형) 영역만 캡처한다. 크롭 없이 찍으면 에디터 '뷰포트' 비율의
        // 이미지가 나와, 박스 비율을 고쳐도 페이지가 안쪽에 작게 떠 보인다.
        // (선례: useAppStore 스크린샷 경로가 동일하게 workspace bbox 로 크롭)
        const rect = getWorkspaceRect(canvas)
        const url = rect
          ? canvas.toDataURL({
              format: 'png',
              quality: 0.7,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              // 목표 폭 ~176px(카드 88px @2x). 업스케일은 하지 않는다.
              multiplier: Math.min(1, 176 / rect.width),
            })
          : canvas.toDataURL({ format: 'png', multiplier: 0.15, quality: 0.7 })
        setDataUrl(url)
        setAspect(rect ? rect.width / rect.height : null)
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

  // 카드 박스 — 판형 비율로 유도하되 **클램프 축이 방향별로 반대**다.
  //   세로 패널(w-[112px]): 폭이 예산 → 폭 고정 88px, 높이 유도
  //   가로 스트립(h-[100px]): 높이가 예산 → 높이 고정 76px, 폭 유도
  // (가로에서 폭을 고정하면 세로형 판형 카드가 스트립 높이를 넘쳐 잘린다)
  // 비율 미상(캡처 전/워크스페이스 부재)이면 종전 고정값을 그대로 쓴다.
  const CARD_W = 88
  const STRIP_H = 76
  const isVertical = orientation === 'vertical'
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))
  const legacyH = isCover ? 64 : isVertical ? 60 : 72
  const boxStyle =
    !aspect || aspect <= 0
      ? { width: CARD_W, height: legacyH }
      : isVertical
        ? { width: CARD_W, height: clamp(CARD_W / aspect, 36, 120) }
        : { width: clamp(STRIP_H * aspect, 44, 168), height: STRIP_H }

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
        className="group flex-shrink-0 flex flex-col items-center gap-1 transition-all"
        style={{ width: boxStyle.width }}
      >
        <div
          className={cn(
            'relative w-full overflow-hidden rounded-lg bg-editor-surface-low border-2 transition-colors',
            active
              ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md bg-editor-panel'
              : 'border-editor-border hover:border-editor-text-muted hover:bg-editor-panel'
          )}
          style={{ height: boxStyle.height }}
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
        active
          ? 'border-editor-accent ring-2 ring-editor-accent/30 shadow-md'
          : 'border-editor-border hover:border-editor-text-muted',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragSource && 'opacity-40 ring-2 ring-editor-accent/40'
      )}
      style={boxStyle}
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
