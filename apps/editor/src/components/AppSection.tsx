import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiPrefStore } from '@/stores/useUiPrefStore'

interface AppSectionProps {
  /**
   * 섹션 식별자. 지정하면 펼침 상태가 useUiPrefStore.expandedSections에 영속됨
   * (새로고침 후에도 유지). 명시적 외부 제어(`expanded`/`onExpand`)가 우선.
   */
  id?: string
  title: string
  expanded?: boolean
  onExpand?: () => void
  onDetail?: () => void
  onDelete?: () => void
  children?: ReactNode
  searchSlot?: ReactNode
}

export default function AppSection({
  id,
  title,
  expanded: externalExpanded,
  onExpand,
  onDetail,
  onDelete,
  children,
  searchSlot,
}: AppSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(true)

  // store 연동: id가 있고 외부 제어가 아닐 때만 활성화
  const usesStore = id !== undefined && externalExpanded === undefined && !onExpand
  const storedValue = useUiPrefStore((s) => (id ? s.expandedSections[id] : undefined))
  const toggleStored = useUiPrefStore((s) => s.toggleSectionExpanded)

  // 우선순위: 외부 expanded prop > store(있으면) > internal state
  const isExpanded = externalExpanded !== undefined
    ? externalExpanded
    : usesStore
      ? storedValue ?? true // 기본값 true (현재 동작 유지)
      : internalExpanded

  const handleToggle = () => {
    if (onExpand) {
      onExpand()
    } else if (usesStore && id) {
      toggleStored(id)
    } else {
      setInternalExpanded(!internalExpanded)
    }
  }

  return (
    <section id={id} className="app-section w-full border-b border-editor-border last:border-b-0">
      {/* Header */}
      <div
        className="section-header flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-editor-hover transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-1.5">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-editor-text-muted" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-editor-text-muted" />
          )}
          <span className="text-[13px] font-semibold tracking-tight text-editor-text">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {onDetail && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-editor-text-muted hover:text-editor-text hover:bg-transparent"
              onClick={(e) => {
                e.stopPropagation()
                onDetail()
              }}
            >
              더보기
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-editor-text-muted hover:text-red-500 hover:bg-transparent"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search slot */}
      {searchSlot && isExpanded && (
        <div className="px-4 pb-2">
          {searchSlot}
        </div>
      )}

      {/* Content */}
      {isExpanded && (
        <div className="section-content px-4 pb-4 pt-1">
          {children}
        </div>
      )}
    </section>
  )
}
