import { useEffect, useState } from 'react'
import { Sparkles, Command } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

/**
 * 빈 캔버스 안내 — 사용자 객체가 없을 때 캔버스 중앙에 가이드 표시.
 * 첫 객체 추가 시 자동 사라짐.
 *
 * 시스템 객체(workspace, cut-border, safe-zone-border, guideline 등)는 카운트에서 제외.
 */

const SYSTEM_IDS = new Set(['workspace', 'cut-border', 'safe-zone-border', 'template-background'])
const SYSTEM_EXTENSION_TYPES = new Set(['guideline', 'background', 'overlay', 'outline', 'moldIcon', 'clipping'])

function countUserObjects(canvas: any): number {
  if (!canvas || !canvas.getObjects) return 0
  try {
    const objects = canvas.getObjects() as Array<any>
    return objects.filter((obj) => {
      if (!obj) return false
      if (SYSTEM_IDS.has(obj.id)) return false
      if (SYSTEM_EXTENSION_TYPES.has(obj.extensionType)) return false
      // GuideLine fabric subclass
      if (obj.type === 'GuideLine') return false
      // 'center-guideline-h' 등 id prefix 매칭
      if (typeof obj.id === 'string' && obj.id.startsWith('center-guideline-')) return false
      return true
    }).length
  } catch {
    return 0
  }
}

export default function EmptyCanvasHint() {
  const ready = useAppStore((s) => s.ready)
  const canvas = useAppStore((s) => s.canvas)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    if (!ready || !canvas) {
      setEmpty(true)
      return
    }

    const update = () => setEmpty(countUserObjects(canvas) === 0)
    update()

    // fabric 객체 변화 이벤트 구독
    const events = ['object:added', 'object:removed', 'after:render']
    events.forEach((ev) => canvas.on(ev, update))
    return () => {
      events.forEach((ev) => canvas.off(ev, update))
    }
  }, [ready, canvas])

  if (!ready || !empty) return null

  return (
    <div
      role="presentation"
      className={cn(
        'absolute inset-0 z-[5] flex items-center justify-center pointer-events-none',
        'select-none'
      )}
    >
      <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-xl bg-editor-panel/80 backdrop-blur-sm border border-editor-border shadow-sm max-w-[80%]">
        <Sparkles className="h-6 w-6 text-editor-accent" />
        <div className="text-center">
          <p className="text-sm font-semibold text-editor-text">디자인을 시작해보세요</p>
          <p className="text-[12px] text-editor-text-muted mt-1">
            왼쪽에서 도구를 선택하거나 빠른 검색을 사용하세요
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-editor-text-muted">
          <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded bg-editor-surface-low border border-editor-border font-semibold">
            <Command className="h-3 w-3" />
          </kbd>
          <span className="text-editor-text-muted">+</span>
          <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded bg-editor-surface-low border border-editor-border font-semibold">
            K
          </kbd>
          <span>로 모든 명령 검색</span>
        </div>
      </div>
    </div>
  )
}
