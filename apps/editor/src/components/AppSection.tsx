import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AppSectionProps {
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

  const isExpanded = externalExpanded !== undefined ? externalExpanded : internalExpanded

  const handleToggle = () => {
    if (onExpand) {
      onExpand()
    } else {
      setInternalExpanded(!internalExpanded)
    }
  }

  return (
    <section id={id} className="app-section w-full border-b border-gray-100 last:border-b-0">
      {/* Header */}
      <div
        className="section-header flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-1.5">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          )}
          <span className="text-[13px] font-semibold tracking-tight text-gray-700">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {onDetail && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-transparent"
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
              className="h-6 w-6 text-gray-400 hover:text-red-500 hover:bg-transparent"
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
