import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useToastStore, type Toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

/**
 * ToastViewport — 화면 우측 하단에 활성 토스트를 stack으로 렌더.
 * App 루트에서 한 번 마운트.
 */

const ICON_BY_TYPE = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
} as const

const STYLE_BY_TYPE: Record<Toast['type'], string> = {
  success: 'border-l-editor-accent text-editor-text',
  error: 'border-l-red-500 text-editor-text',
  info: 'border-l-blue-500 text-editor-text',
  warning: 'border-l-amber-500 text-editor-text',
}

const ICON_COLOR_BY_TYPE: Record<Toast['type'], string> = {
  success: 'text-editor-accent',
  error: 'text-red-500',
  info: 'text-blue-500',
  warning: 'text-amber-500',
}

export default function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      role="region"
      aria-label="알림"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]"
    >
      {toasts.map((toast) => {
        const Icon = ICON_BY_TYPE[toast.type]
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2 min-w-[280px] max-w-[420px]',
              'bg-editor-panel border border-editor-border border-l-4 shadow-lg rounded-md',
              'px-3 py-2.5 animate-in slide-in-from-right-4 fade-in-0 duration-200',
              STYLE_BY_TYPE[toast.type]
            )}
          >
            <Icon className={cn('h-4 w-4 flex-shrink-0 mt-0.5', ICON_COLOR_BY_TYPE[toast.type])} />
            <p className="flex-1 text-[13px] leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="닫기"
              className="flex-shrink-0 p-0.5 rounded text-editor-text-muted hover:text-editor-text hover:bg-editor-hover transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
