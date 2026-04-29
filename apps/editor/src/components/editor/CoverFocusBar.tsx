import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { buildPageMeta, type PageMeta } from '@/components/PageNavigation/BookNavigation'
import { cn } from '@/lib/utils'

/**
 * CoverFocusBar — 표지 편집 포커스 바 (cover.md §6 / Phase 2)
 *
 * 활성 페이지가 표지 그룹(WING/COVER/SPINE/SPREAD)일 때만 EditorHeader 바로 아래에 표시.
 * 표지 영역들의 합쳐진 미니맵을 보여주고 박스 클릭으로 해당 캔버스에 포커싱.
 *
 * 박스 width: 캔버스 width 비례 분배 (책등 가변폭 자동 반영)
 * 활성 region: editor-accent 강조
 *
 * 표지 페이지가 아닐 때(내지) 또는 표지가 1개 이하면 hide.
 */

const BAR_HEIGHT = 56 // px

interface CoverThumbProps {
  canvas: fabric.Canvas | undefined
  flexBasis: number
  active: boolean
  label: string
  onClick: () => void
}

const CoverThumb = memo(function CoverThumb({
  canvas,
  flexBasis,
  active,
  label,
  onClick,
}: CoverThumbProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!canvas) {
      setDataUrl(null)
      return
    }
    const update = () => {
      const now = Date.now()
      if (now - lastUpdateRef.current < 250) return
      lastUpdateRef.current = now
      try {
        const url = canvas.toDataURL({
          format: 'png',
          multiplier: 0.1,
          quality: 0.6,
        })
        setDataUrl(url)
      } catch {
        // 캔버스 dispose 등 무시
      }
    }
    update()
    canvas.on('after:render', update)
    return () => {
      canvas.off('after:render', update)
    }
  }, [canvas])

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'group relative h-full overflow-hidden rounded-md border transition-all',
        active
          ? 'border-editor-accent ring-2 ring-editor-accent/30 bg-editor-panel z-[1]'
          : 'border-editor-border bg-editor-surface-low hover:bg-editor-panel hover:border-editor-border'
      )}
      style={{ flex: `${flexBasis} ${flexBasis} 0%`, minWidth: 16 }}
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
      {/* 라벨 (호버 시 + 활성 시 상단 표시) */}
      <span
        className={cn(
          'absolute top-0 left-0 right-0 text-[9px] font-semibold text-center py-px px-1 truncate transition-opacity',
          active
            ? 'bg-editor-accent/10 text-editor-accent opacity-100'
            : 'bg-editor-panel/85 text-editor-text-muted opacity-0 group-hover:opacity-100'
        )}
      >
        {label}
      </span>
    </button>
  )
})

export const CoverFocusBar = memo(function CoverFocusBar() {
  const pages = useEditorStore((s) => s.pages)
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)
  const goToPage = useEditorStore((s) => s.goToPage)
  const setPage = useAppStore((s) => s.setPage)
  const allCanvas = useAppStore((s) => s.allCanvas)

  // 페이지 메타 (표지/내지 분류 + 위치별 라벨)
  const meta = useMemo<PageMeta[]>(() => {
    if (pages.length === 0) return []
    return buildPageMeta(pages.map((p) => ({ id: p.id, type: p.templateType })))
  }, [pages])

  // 표지 그룹 추출 (인접한 표지 페이지들의 인덱스 묶음).
  // 한 책에 표지가 여러 그룹일 일은 거의 없지만, 안전하게 active page가 속한 그룹만 표시한다.
  const activeGroup = useMemo(() => {
    if (meta.length === 0) return null
    const active = meta.find((m) => m.index === currentPageIndex)
    if (!active || !active.isCover) return null

    // active 인덱스를 중심으로 좌우로 확장하면서 cover 끝까지 묶기
    let start = active.index
    let end = active.index
    while (start > 0 && meta[start - 1]?.isCover) start -= 1
    while (end < meta.length - 1 && meta[end + 1]?.isCover) end += 1
    return meta.slice(start, end + 1)
  }, [meta, currentPageIndex])

  // 박스 width 비례 분배 — 캔버스 실제 width를 기준으로 (책등 가변폭 자동 반영)
  const flexValues = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.map((m) => {
      const cv = allCanvas[m.index]
      let w = 100 // fallback
      try {
        w = cv?.getWidth?.() ?? cv?.width ?? 100
      } catch {
        w = 100
      }
      return Math.max(20, Math.round(w))
    })
  }, [activeGroup, allCanvas])

  if (!activeGroup || activeGroup.length < 2) {
    // 표지 그룹이 1개 이하면 굳이 보일 필요 없음 (단일 표지/펼침면 단독)
    return null
  }

  const handleSelect = (index: number) => {
    setPage(index)
    goToPage(index)
  }

  return (
    <div
      className="cover-focus-bar bg-editor-panel border-b border-editor-border shadow-sm flex items-center gap-2 px-4 py-2 z-[99]"
      style={{ height: BAR_HEIGHT }}
      role="toolbar"
      aria-label="표지 영역 포커스"
    >
      <span className="text-[11px] font-semibold text-editor-text-muted select-none flex-shrink-0">
        표지
      </span>
      <div className="flex-1 flex items-stretch gap-1 h-full py-0.5 max-w-[640px]">
        {activeGroup.map((m, i) => (
          <CoverThumb
            key={m.id}
            canvas={allCanvas[m.index]}
            flexBasis={flexValues[i] ?? 100}
            active={m.index === currentPageIndex}
            label={m.label}
            onClick={() => handleSelect(m.index)}
          />
        ))}
      </div>
    </div>
  )
})
